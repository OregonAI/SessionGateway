// The ingest worker. A full pull reads the deployment's Session from OLIS (its Measures, Legislators,
// sponsors, history and votes, its committees and their members, meetings and their agenda items, its Testimony
// rows, and the documents they link). It counts as complete only when every set came with as many rows as the feed
// counted; one that did not stores nothing and says which sets were short in the build report
// (docs/adr/0030-a-row-is-no-longer-listed-after-two-complete-pulls-miss-it-and-the-tools-flag-it.md). A complete
// pull stores the feed, with which documents each meeting lists, the Agency each
// Testimony's Organization names and the time the pull started as the index's "as of" time. It resolves the
// Legislator Code of each sponsor and each vote to a Legislator on the way and reports the codes it could not. It refreshes
// what the feed says about the documents it already holds, fetches every linked document the store does
// not hold yet, once each, keeps its text, and writes the build report
// (docs/adr/0011-an-amendment-is-a-node-and-its-postings-are-documents.md). The Snapshot read (`snapshot-read.ts`) then
// reads the Statute Links and the Agency Links of what is stored with the OregonAI snapshot and, in a full pull, the
// series of the Statutes Affected Table the deployment names, and records the snapshot the index reports
// (docs/adr/0035-statute-links-are-read-again-when-the-snapshot-changes-before-the-agency-links.md,
// docs/adr/0044-the-held-statutes-affected-table-is-read-again-when-the-snapshot-changes-from-the-held-copy-if-it-cannot-be-fetched.md).
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type { IngestConfig } from "#/packages/config/index.ts";
import {
  documentLinksOf,
  openIndexWriter,
  type CommitteeVoteRecord,
  type FullPullRecord,
  type FloorVoteRecord,
  type IndexWriter,
  type StoredDocumentHash,
  type SearchRecord,
  type SponsorRecord,
} from "#/packages/database/writer.ts";
import type { Embedder } from "#/packages/embedder/index.ts";
import { findCitations } from "#/packages/domain/citations.ts";
import { fullPullStopped, isStopRequest } from "./lib/stop.ts";
import type {
  AgendaItem,
  Committee,
  CommitteeId,
  CommitteeMember,
  Convening,
  DocumentLink,
  Meeting,
  PulledEntitySet,
  SessionDates,
} from "#/packages/domain/documents.ts";
import { measureIdOf, type HistoryAction, type Measure } from "#/packages/domain/index.ts";
import type { LegislatorId, LegislatorRow, Sponsorship } from "#/packages/domain/legislators.ts";
import type { Passage, SearchEntry } from "#/packages/domain/search.ts";
import type { CommitteeVoteEntry, FloorVoteEntry } from "#/packages/domain/votes.ts";
import type { LegislatorAlias } from "#/packages/legislators/aliases.ts";
import {
  createLegislatorResolver,
  type LegislatorResolver,
  type Resolution,
  type UnresolvedLegislatorCode,
} from "#/packages/legislators/resolver.ts";
import {
  createOlisClient,
  type DocumentSets,
  type OlisClient,
  type PullRead,
  type SetCount,
} from "#/packages/olis-client/index.ts";
import { loadSnapshot } from "#/packages/oregonai-snapshot/index.ts";
import { extractPdfText, type ExtractedPdf } from "#/packages/pdf-text/index.ts";
import { searchEntryOf } from "#/packages/search/documents.ts";
import { measuresOfAgendaItem, speakerTurnSpans } from "#/packages/recording-log/index.ts";
import { splitAroundTurns, splitPassages } from "#/packages/search/passages.ts";
import { quantizeUnitVector } from "#/packages/search/vectors.ts";
import type { Clock } from "#/packages/time/clock.ts";
import { formatPacific, pacificTimestampOf, type Timestamp } from "#/packages/time/pacific.ts";
import { readSpeakerTurnIndex } from "./lib/speaker-turns.ts";
import { ingestTranscripts, transcriptsReportOf, type TranscriptsRun } from "./lib/transcripts.ts";
import { buildReportPath, writeBuildReport, type BuildReport, type SetReport } from "./lib/build-report.ts";
import {
  hashSampleReportPath,
  lastHashSampleAt,
  readHashSampleReport,
  sampleHashes,
  writeHashSampleReport,
  type HashSampleReport,
} from "./lib/hash-sample.ts";
import { documentSetsReadOf, pullReadOf, type PullRun } from "./lib/pull-register.ts";
import {
  beginFullPullSnapshotRead,
  beginIncrementSnapshotRead,
  type SnapshotRead,
  type StatutesAffectedTableFetch,
} from "./snapshot-read.ts";

export type IngestDeps = {
  fetch: typeof fetch;
  clock: Clock;
  /** Aborts the pull on shutdown. */
  signal: AbortSignal;
  /** Waits between attempts to fetch a document. Created in the entry script, so a test need not wait. */
  pause: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  /** How long one attempt to fetch a document may take, in milliseconds. 60 seconds by default. */
  documentTimeoutMs?: number;
  /** The alias file's entries: who the Legislator Codes it lists are, where the Legislators rows do not say. */
  legislatorAliases: readonly LegislatorAlias[];
  /** Counts the tokens that decide where a passage ends. Created in the entry script, like the clock. */
  embedder: Embedder;
};

export type FullPullResult = {
  measures: number;
  asOf: Timestamp;
  /** Documents fetched by this pull; the ones the store already held are not fetched again. */
  documentsFetched: number;
  /** Documents the feed links that this pull could not get or read. The next pull tries them again. */
  documentsNotFetched: number;
  /**
   * The build report of Legislator Codes (spec #1, story 54): every code the pull could not resolve,
   * with how often each entity set used it. Empty when every code resolved.
   */
  unresolvedLegislatorCodes: UnresolvedLegislatorCode[];
};

/** A document that takes longer than this is an outage, not a slow answer (olis-odata.md gotcha 15). */
const DEFAULT_DOCUMENT_TIMEOUT_MS = 60_000;

/** What a pull made of one linked document: its file and text, or why it is left out of the store. */
type Fetched = { kind: "fetched"; bytes: Uint8Array; pdf: ExtractedPdf } | { kind: "left_out"; reason: string };

/**
 * Fetches one document and reads its text. A document OLIS will not give, or a file that is not a PDF,
 * is an expected outcome and is left out with its reason. A failure of the extractor is not: it throws,
 * naming the document, so a broken install stops the pull instead of filling the report.
 */
async function fetchAndRead(olis: OlisClient, link: DocumentLink, signal: AbortSignal): Promise<Fetched> {
  const download = await olis.downloadDocument(link, signal);
  switch (download.kind) {
    case "fetched": {
      const extraction = await readPdf(link, download.bytes);
      switch (extraction.kind) {
        case "read":
          return { kind: "fetched", bytes: download.bytes, pdf: extraction.pdf };
        case "unreadable":
          return { kind: "left_out", reason: extraction.reason };
        default:
          return extraction satisfies never;
      }
    }
    case "failed":
      return { kind: "left_out", reason: download.reason };
    default:
      return download satisfies never;
  }
}

async function readPdf(link: DocumentLink, bytes: Uint8Array): ReturnType<typeof extractPdfText> {
  try {
    return await extractPdfText(bytes);
  } catch (error) {
    throw new Error(`The PDF extractor failed on ${link.id} (${link.sourceUrl})`, { cause: error });
  }
}

/** The id of the Legislator a code resolved to, or null while it is unresolved. */
function legislatorIdOfResolution(resolution: Resolution): LegislatorId | null {
  switch (resolution.kind) {
    case "resolved":
      return resolution.legislator.id;
    case "unresolved":
      return null;
    default:
      return resolution satisfies never;
  }
}

/** What the database keeps of one MeasureSponsors row. A Member row names a Legislator by a code the resolver reads. */
function sponsorRecordOf(sponsorship: Sponsorship, resolver: LegislatorResolver): SponsorRecord {
  const common = {
    id: sponsorship.id,
    measure: sponsorship.measure,
    level: sponsorship.level,
    printOrder: sponsorship.printOrder,
    ...(sponsorship.createdAt === undefined ? {} : { createdAt: sponsorship.createdAt }),
  };
  switch (sponsorship.kind) {
    case "member":
      return {
        ...common,
        kind: "member",
        legislatorCode: sponsorship.legislatorCode,
        legislatorId: legislatorIdOfResolution(resolver.resolve("MeasureSponsors", sponsorship.legislatorCode)),
      };
    case "committee":
      return { ...common, kind: "committee", committeeCode: sponsorship.committeeCode };
    case "presession":
      return { ...common, kind: "presession", message: sponsorship.message };
    default:
      return sponsorship satisfies never;
  }
}

/** What the database keeps of one entry of a floor vote: the entry and the Legislator its code names. */
function floorVoteRecordOf(entry: FloorVoteEntry, resolver: LegislatorResolver): FloorVoteRecord {
  return { ...entry, legislatorId: legislatorIdOfResolution(resolver.resolve("MeasureVotes", entry.legislatorCode)) };
}

/** What the database keeps of one entry of a committee vote: the entry and the Legislator its code names. */
function committeeVoteRecordOf(entry: CommitteeVoteEntry, resolver: LegislatorResolver): CommitteeVoteRecord {
  return { ...entry, legislatorId: legislatorIdOfResolution(resolver.resolve("CommitteeVotes", entry.legislatorCode)) };
}

/** What a pull made of the passages of the documents it stored: how many, and how many it had to embed. */
type PassageCounts = { passages: number; keywordOnly: number; embedded: number; reused: number };

/**
 * The vectors a document needs that the index does not hold: one for each distinct passage text of a document
 * that is found by meaning, unless the same text already has a vector under this model (identical Testimony,
 * a Proposed Amendment posted again, a passage the pull stored before). Embedding is the slow part of a
 * pull, so this is where "embedded once" is decided.
 */
async function vectorsForNewPassages(
  writer: IndexWriter,
  embedder: Embedder,
  entry: SearchEntry,
  passages: readonly Passage[],
  counts: PassageCounts,
): Promise<SearchRecord["vectors"]> {
  counts.passages += passages.length;
  if (entry.keywordOnly) {
    counts.keywordOnly += passages.length;
    return { modelId: embedder.modelId, rows: [] };
  }
  const distinct = [...new Map(passages.map((passage) => [passage.hash, passage])).values()];
  const stored = writer.storedVectorHashes(
    embedder.modelId,
    distinct.map((passage) => passage.hash),
  );
  const missing = distinct.filter((passage) => !stored.has(passage.hash));
  counts.embedded += missing.length;
  counts.reused += passages.length - missing.length;
  const vectors = await embedder.embedPassages(missing.map((passage) => passage.text));
  return {
    modelId: embedder.modelId,
    rows: missing.map((passage, index) => ({
      hash: passage.hash,
      vector: quantizeUnitVector(vectors[index] as Float32Array),
    })),
  };
}

/** What the build report says of one set the pull read. */
function setReportOf(count: SetCount): SetReport {
  return {
    entity_set: count.entitySet,
    counted: count.counted,
    read: count.read,
    complete: count.read === count.counted,
  };
}

/** The CommitteeMembers rows the table holds, for each committee, as the build report shows them. */
function committeeMembersReportOf(
  stored: readonly { committeeCode: string; legislatorCode: string }[],
  unresolvedCodes: ReadonlySet<string>,
): BuildReport["committee_members"] {
  const byCommittee = new Map<string, string[]>();
  for (const row of stored)
    byCommittee.set(row.committeeCode, [...(byCommittee.get(row.committeeCode) ?? []), row.legislatorCode]);
  return [...byCommittee].map(([committeeCode, codes]) => ({
    committee_code: committeeCode,
    rows_stored: codes.length,
    legislator_codes: codes,
    unresolved_legislator_codes: [...new Set(codes.filter((code) => unresolvedCodes.has(code)))],
  }));
}

/** What the build report says of how the Recording Logs were read: the logs left with no index, and the pages read by timecode. */
function recordingLogNotesOf(
  notes: ReturnType<IndexWriter["recordingLogReadingNotes"]>,
): Pick<
  BuildReport,
  "recording_log_gaps" | "recording_log_pages_read_by_timecode" | "recording_log_turns_without_passage"
> {
  return {
    recording_log_gaps: notes.gaps.map((gap) => ({
      id: gap.id,
      source_url: gap.sourceUrl,
      kind: gap.kind,
      event_ids: gap.eventIds,
    })),
    recording_log_pages_read_by_timecode: notes.readByTimecode.map((note) => ({
      id: note.id,
      source_url: note.sourceUrl,
      pages: note.pages,
    })),
    recording_log_turns_without_passage: notes.turnsWithoutPassage.map((note) => ({
      id: note.id,
      source_url: note.sourceUrl,
      turns: note.turns,
    })),
  };
}

/** What the documents step of a pull and of an increment share. */
type DocumentsStep = {
  config: IngestConfig;
  deps: IngestDeps;
  writer: IndexWriter;
  olis: OlisClient;
  /** The links of the rows this run read. */
  links: readonly DocumentLink[];
  /** Says who a Legislator Code is, for the speaker turns of the Recording Logs this run fetches (ticket #126). */
  resolver: LegislatorResolver;
  committeeNames: ReadonlyMap<CommitteeId, string>;
  passageCounts: PassageCounts;
  /** Gets an entry for each document this run could not get or read. */
  notFetched: BuildReport["documents_not_fetched"];
  /** Gets the stored Recording Logs this run fetched again to read their links, and what became of each (ADR-0052). */
  refetches: BuildReport["recording_log_refetches"];
};

/**
 * Fetches the linked documents the store does not hold, once each, and keeps their text; refreshes what the feed says of
 * the ones it holds. A full pull and an increment do the same here with the links each read, and it returns how many
 * documents it fetched. Reading what is stored for links is the Snapshot read's (`snapshot-read.ts`).
 */
async function storeLinkedDocuments(step: DocumentsStep): Promise<number> {
  const { config, deps, writer, olis, links, resolver, committeeNames, passageCounts, notFetched, refetches } = step;
  let documentsFetched = 0;
  const stored = writer.storedDocumentIds(config.session);
  // A fetched file is unchanging (ADR-0005) but its feed row is not: OLIS changes a posting's Meaning,
  // a Testimony's Measure. What the row says about a stored document is refreshed without fetching it.
  const refreshed = links.filter((link) => stored.has(link.id));
  const refreshedEntries = new Map(refreshed.map((link) => [link.id, searchEntryOf(link, committeeNames)]));
  // A document OLIS now files as embeddable that the index holds as keyword-only (a list relabelled as material)
  // has passages and no vectors. They are embedded in this pull, before the document is refiled, so that it is
  // never filed as embeddable without them. The other direction needs nothing: the vectors of a keyword-only
  // document are never loaded.
  const keywordOnlyBefore = writer.keywordOnlyDocumentIds(config.session);
  for (const [id, entry] of refreshedEntries) {
    if (!keywordOnlyBefore.has(id) || entry.keywordOnly) continue;
    writer.storeVectors(
      await vectorsForNewPassages(writer, deps.embedder, entry, writer.passagesOf(id), passageCounts),
    );
  }
  writer.refreshDocuments(config.session, refreshed, refreshedEntries);
  // An agenda is the one document fetched again (ADR-0005, ADR-0041): when its meeting's revision is not the one it was
  // fetched at. An agenda stored before revisions were recorded has none, so it is fetched once more.
  const agendaRevisions = writer.storedAgendaRevisions(config.session);
  const revised = new Set(
    refreshed
      .filter((link) => link.agendaRevision !== undefined && agendaRevisions.get(link.id) !== link.agendaRevision)
      .map((link) => link.id),
  );
  // A Recording Log stored before the speaker-turn index existed (or whose index never came), or with no stored link
  // annotation (ticket #160, ADR-0058), is fetched once more to read its links, which the store keeps only as the index and the
  // annotations (ticket #126, ADR-0052). Its stored text and search entry stay as they are.
  const unindexed = writer.recordingLogsWithoutIndex(config.session);
  const speakerTurns = { session: config.session, writer, resolver };
  for (const link of links) {
    if (stored.has(link.id) && unindexed.has(link.id) && link.kind === "recording_log" && !revised.has(link.id)) {
      refetches.attempted += 1;
      const again = await fetchAndRead(olis, link, deps.signal);
      if (again.kind === "left_out") {
        // The log has no index and the next pull tries it again: this pull says it did not read it.
        refetches.failed.push({ id: link.id, source_url: link.sourceUrl, reason: again.reason });
        continue;
      }
      const fetchedHash = createHash("sha256").update(again.bytes).digest("hex");
      const storedHash = writer.storedContentHash(link.id);
      if (fetchedHash !== storedHash) {
        // Not the file the stored text was made from: its turns would not belong to that text. Nothing is stored from
        // it, as the nightly hash sample stores nothing from a replaced file (ADR-0040), and the report says so.
        refetches.bytes_changed.push({
          id: link.id,
          source_url: link.sourceUrl,
          stored_content_hash: storedHash ?? "",
          fetched_content_hash: fetchedHash,
        });
        continue;
      }
      writer.storeSpeakerTurnIndex({
        documentId: link.id,
        outcome: await readSpeakerTurnIndex(speakerTurns, link, again.bytes, again.pdf.text),
      });
      continue;
    }
    if (stored.has(link.id) && !revised.has(link.id)) continue;
    const fetched = await fetchAndRead(olis, link, deps.signal);
    if (fetched.kind === "left_out") {
      // A revised agenda that cannot be fetched stays as it was stored (ADR-0041): the index holds it, so it is not
      // a document the index lacks.
      if (!revised.has(link.id)) notFetched.push({ id: link.id, source_url: link.sourceUrl, reason: fetched.reason });
      continue;
    }
    const entry = searchEntryOf(link, committeeNames);
    const passages = splitPassages(fetched.pdf.text, deps.embedder);
    const vectors = await vectorsForNewPassages(writer, deps.embedder, entry, passages, passageCounts);
    const document = {
      ...link,
      retrievedAt: formatPacific(deps.clock.now()),
      contentHash: createHash("sha256").update(fetched.bytes).digest("hex"),
      textHash: createHash("sha256").update(fetched.pdf.text).digest("hex"),
      pageCount: fetched.pdf.pageCount,
      hasTextLayer: fetched.pdf.hasTextLayer,
      text: fetched.pdf.text,
    };
    const search = { entry, passages, citations: findCitations(fetched.pdf.text, config.session), vectors };
    if (revised.has(link.id)) writer.replaceDocument(config.session, document, search);
    else writer.storeDocument(config.session, document, search);
    if (link.kind === "recording_log") {
      writer.storeSpeakerTurnIndex({
        documentId: link.id,
        outcome: await readSpeakerTurnIndex(speakerTurns, link, fetched.bytes, fetched.pdf.text),
      });
    }
    stored.add(link.id);
    documentsFetched += 1;
  }
  // A Recording Log whose turns are stored and that has not been cut around them is cut from the text and the turns the store
  // holds (ticket #127, ADR-0053): a log just read, one stored before the passages were linked, one whose index was stored
  // again. Nothing is fetched, and every line of the text stays in one passage. A turn the text cannot place, or that is longer
  // than a Passage may be, is counted and the log is marked, so it is not cut again on every pull.
  for (const log of writer.recordingLogsWithoutTurnPassages(config.session)) {
    const passages = splitAroundTurns(log.text, speakerTurnSpans(log.text, log.turns), deps.embedder);
    const placed = passages.filter((passage) => passage.turn !== undefined).length;
    writer.replacePassages(log.id, passages, log.turns.length - placed);
  }
  // The Measures each Agenda item of a stored log names are read from the item's text, for a log just read and for one stored
  // before step 3, in the same way (ADR-0053). The index may not hold a Measure yet: the reader leaves out the ones it lacks.
  for (const log of writer.recordingLogsWithoutItemMeasures(config.session)) {
    writer.storeItemMeasures(
      log.id,
      log.agendaItems.map((agendaItem) => ({
        agendaItem,
        measures: measuresOfAgendaItem(agendaItem).map((named) => measureIdOf({ session: config.session, ...named })),
      })),
    );
  }
  return documentsFetched;
}

/**
 * Reads the transcript folder the deployment names (TRANSCRIPTS_PATH). A deployment that names none and holds no transcript has
 * nothing to do. One that names none and holds transcripts still runs the step, with no files: a stored transcript whose log's
 * index was stored again is attached to the new turns, and each is reported as without its file (ADR-0055).
 */
function ingestTranscriptsOf(
  config: IngestConfig,
  deps: IngestDeps,
  writer: IndexWriter,
): Promise<TranscriptsRun | undefined> {
  if (config.transcriptsPath === null && writer.storedTranscripts(config.session).length === 0) {
    return Promise.resolve(undefined);
  }
  return ingestTranscripts({
    session: config.session,
    writer,
    embedder: deps.embedder,
    folder: config.transcriptsPath,
  });
}

/** No documents linked: what a Pull that leaves the five document sets alone has of them. */
const noDocuments: DocumentSets = {
  MeasureDocuments: [],
  MeasureAnalysisDocuments: [],
  CommitteeMeetingDocuments: [],
  CommitteeProposedAmendments: [],
  CommitteePublicTestimonies: [],
};

/** Everything one Pull read of the feed, before it is resolved and stored: the rows of each entity set, under the feed's name for it. */
type FeedRead = DocumentSets & {
  Measures: Measure[];
  Legislators: LegislatorRow[];
  MeasureSponsors: Sponsorship[];
  MeasureHistoryActions: HistoryAction[];
  MeasureVotes: FloorVoteEntry[];
  CommitteeVotes: CommitteeVoteEntry[];
  Committees: Committee[];
  CommitteeMeetings: Meeting[];
  CommitteeAgendaItems: AgendaItem[];
  CommitteeMembers: CommitteeMember[];
  ConveneTimes: Convening[];
  LegislativeSessions: SessionDates | undefined;
  FloorLetters: DocumentLink[];
};

/**
 * Reads the sets a Pull stores, each the way the register says this kind of Pull reads it (`lib/pull-register.ts`): the
 * Pull's reads are the register's, and this holds no rule about a set. A set the register leaves alone gives no rows. The
 * sets are read in the order the Build report lists them, and the result has one field for each entity set: the compiler
 * refuses a set `pulledEntitySets` names that is not read here.
 */
async function readFeed(olis: OlisClient, config: IngestConfig, deps: IngestDeps, run: PullRun): Promise<FeedRead> {
  const { session } = config;
  const { signal } = deps;
  const readSet = async <Rows>(
    entitySet: PulledEntitySet,
    unread: Rows,
    read: (how: PullRead) => Promise<Rows>,
  ): Promise<Rows> => {
    const how = pullReadOf(entitySet, run);
    return how === undefined ? unread : read(how);
  };
  // The five sets that link documents are read in one call, in the mode their entries in the register agree on.
  const documentsRead = documentSetsReadOf(run);
  return {
    Measures: await readSet("Measures", [], (how) => olis.readMeasures(session, how, signal)),
    Legislators: await readSet("Legislators", [], (how) => olis.readLegislators(session, how, signal)),
    MeasureSponsors: await readSet("MeasureSponsors", [], (how) => olis.readSponsorships(session, how, signal)),
    MeasureHistoryActions: await readSet("MeasureHistoryActions", [], (how) =>
      olis.readHistoryActions(session, how, signal),
    ),
    CommitteeVotes: await readSet("CommitteeVotes", [], (how) => olis.readCommitteeVotes(session, how, signal)),
    MeasureVotes: await readSet("MeasureVotes", [], (how) => olis.readFloorVotes(session, how, signal)),
    Committees: await readSet("Committees", [], (how) => olis.readCommittees(session, how, signal)),
    CommitteeMeetings: await readSet("CommitteeMeetings", [], (how) => olis.readMeetings(session, how, signal)),
    CommitteeAgendaItems: await readSet("CommitteeAgendaItems", [], (how) =>
      olis.readAgendaItems(session, how, signal),
    ),
    CommitteeMembers: await readSet("CommitteeMembers", [], (how) => olis.readCommitteeMembers(session, how, signal)),
    ConveneTimes: await readSet("ConveneTimes", [], (how) => olis.readConvenings(session, how, signal)),
    LegislativeSessions: await readSet("LegislativeSessions", undefined, (how) =>
      olis.readSessionDates(session, how, signal),
    ),
    ...(documentsRead === undefined ? noDocuments : await olis.readDocumentLinks(session, documentsRead, signal)),
    FloorLetters: await readSet("FloorLetters", [], (how) => olis.readFloorLetters(session, how, signal)),
  } satisfies Record<PulledEntitySet, unknown>;
}

/** What a run stores of what it read: the rows, with each Legislator Code resolved. */
function feedRecordOf(
  config: IngestConfig,
  deps: IngestDeps,
  feed: FeedRead,
  snapshotRead: SnapshotRead,
): { record: FullPullRecord; resolver: LegislatorResolver; committeeNames: Map<CommitteeId, string> } {
  // A Member sponsor and the voter of a vote entry each name a Legislator by a Legislator Code; the
  // resolver says who that is.
  const resolver = createLegislatorResolver({
    session: config.session,
    rows: feed.Legislators,
    aliases: deps.legislatorAliases,
  });
  const sponsors = feed.MeasureSponsors.map((sponsorship) => sponsorRecordOf(sponsorship, resolver));
  // A CommitteeMembers row names a person by a Legislator Code, but a task force's members are not all Legislators
  // ("Shanbo Zhang", olis-odata.md gotcha 5): the code is stored as the feed writes it, and one that names no
  // Legislator is reported with the others, never an error.
  for (const member of feed.CommitteeMembers) resolver.resolve("CommitteeMembers", member.legislatorCode);
  const floorVoteRecords = feed.MeasureVotes.map((entry) => floorVoteRecordOf(entry, resolver));
  const committeeVoteRecords = feed.CommitteeVotes.map((entry) => committeeVoteRecordOf(entry, resolver));

  const committeeNames = new Map<CommitteeId, string>(
    feed.Committees.map((committee) => [committee.id, committee.name]),
  );
  const record: FullPullRecord = {
    Measures: feed.Measures,
    Legislators: feed.Legislators,
    MeasureSponsors: sponsors,
    MeasureHistoryActions: feed.MeasureHistoryActions,
    MeasureVotes: floorVoteRecords,
    CommitteeVotes: committeeVoteRecords,
    Committees: feed.Committees,
    CommitteeMeetings: feed.CommitteeMeetings,
    CommitteeAgendaItems: feed.CommitteeAgendaItems,
    MeasureDocuments: feed.MeasureDocuments,
    MeasureAnalysisDocuments: feed.MeasureAnalysisDocuments,
    CommitteeMeetingDocuments: feed.CommitteeMeetingDocuments,
    CommitteeProposedAmendments: feed.CommitteeProposedAmendments,
    CommitteePublicTestimonies: snapshotRead.testimonyRecordsOf(feed.CommitteePublicTestimonies),
    CommitteeMembers: feed.CommitteeMembers,
    ConveneTimes: feed.ConveneTimes,
    LegislativeSessions: feed.LegislativeSessions,
    FloorLetters: feed.FloorLetters,
    legislators: resolver.people,
    legislatorCodes: resolver.codes.map(({ code, legislator }) => ({ code, legislatorId: legislator.id })),
  };
  return { record, resolver, committeeNames };
}

/**
 * The OLIS client every run of the worker is made with: the feed, and the documents' origin, timeout and pause. A Full
 * pull gives `onSetRead` to be told each set's counts, so a set that is short is reported and the pull refused whole; a run
 * that gives none throws on a short read (ADR-0005).
 */
function createWorkerClient(config: IngestConfig, deps: IngestDeps, onSetRead?: (count: SetCount) => void): OlisClient {
  return createOlisClient({
    baseUrl: config.olisBaseUrl,
    fetch: deps.fetch,
    ...(onSetRead === undefined ? {} : { onSetRead }),
    documents: {
      origin: config.olisDocumentOrigin,
      timeoutMs: deps.documentTimeoutMs ?? DEFAULT_DOCUMENT_TIMEOUT_MS,
      pause: deps.pause,
    },
  });
}

export { isFullPullStopped, type FullPullStopped } from "./lib/stop.ts";

/** How many documents the Index holds for the Session, or `undefined` when it cannot be counted: a count must not turn a stop into a crash. */
function countStoredDocuments(config: IngestConfig): number | undefined {
  // A first-ever pull stopped before it stored anything has no database, and counting must not create one.
  if (!existsSync(config.databasePath)) return 0;
  try {
    const writer = openIndexWriter(config.databasePath);
    try {
      return writer.storedDocumentIds(config.session).size;
    } finally {
      writer.close();
    }
  } catch {
    return undefined;
  }
}

/** Runs the full pull. A stop asked for through `deps.signal` ends it with `FullPullStopped`; any other failure throws as itself. */
export async function runFullPull(config: IngestConfig, deps: IngestDeps): Promise<FullPullResult> {
  try {
    return await pullEverything(config, deps);
  } catch (error) {
    if (!isStopRequest(deps.signal, error)) throw error;
    throw fullPullStopped(countStoredDocuments(config), error);
  }
}

async function pullEverything(config: IngestConfig, deps: IngestDeps): Promise<FullPullResult> {
  // The snapshot is read before OLIS is: a build with no usable snapshot fails at once, naming the file.
  const snapshot = await loadSnapshot(config.snapshotPath);
  const asOf = formatPacific(deps.clock.now());
  // Every whole set the pull reads says how many rows the feed counted and how many came (ADR-0005).
  const setCounts: SetCount[] = [];
  const olis = createWorkerClient(config, deps, (count) => {
    setCounts.push(count);
  });
  const feed = await readFeed(olis, config, deps, { kind: "full_pull" });

  // The pull is complete only when every set it read came with as many rows as the feed counted. One that is not
  // stores nothing: the index goes on answering from the last complete pull, and no row is marked as missed by it.
  const shortSets = setCounts.filter((count) => count.read !== count.counted);
  if (shortSets.length > 0) {
    writeBuildReport(buildReportPath(config.databasePath), {
      session: config.session,
      attempted_at: asOf,
      pull: { complete: false, entity_sets: setCounts.map(setReportOf) },
    });
    const which = shortSets.map(
      (set) => `Short read of ${set.entitySet}: OLIS counted ${set.counted} rows; read ${set.read}`,
    );
    throw new Error(`The full pull is incomplete, so it stored nothing. ${which.join("; ")}`);
  }

  const writer = openIndexWriter(config.databasePath);
  const passageCounts: PassageCounts = { passages: 0, keywordOnly: 0, embedded: 0, reused: 0 };
  const notFetched: BuildReport["documents_not_fetched"] = [];
  const refetches: BuildReport["recording_log_refetches"] = { attempted: 0, failed: [], bytes_changed: [] };
  try {
    const snapshotRead = beginFullPullSnapshotRead({ writer, session: config.session, snapshot });
    const { record, resolver, committeeNames } = feedRecordOf(config, deps, feed, snapshotRead);
    // What each meeting lists and which analysis documents each Measure has are the feed's, so they are
    // stored with the rest of it before any file is fetched: a file that fails to come is still listed,
    // and the server can say a Measure has a statement it does not hold yet.
    writer.recordFullPull(config.session, asOf, record);
    const documentsFetched = await storeLinkedDocuments({
      config,
      deps,
      writer,
      olis,
      links: documentLinksOf(record),
      resolver,
      committeeNames,
      passageCounts,
      notFetched,
      refetches,
    });
    // The folder of machine-transcript files, when the deployment names one: read after every Recording Log's turns are stored
    // and cut, so that a transcript of a log fetched in this pull is read in it (ticket #134, ADR-0055).
    const transcriptsRun = await ingestTranscriptsOf(config, deps, writer);
    // Legislative Counsel's Statutes Affected Table, when the deployment names it: a second source for the Statute Links,
    // fetched in each pull. The Snapshot read reads it, and says what became of it (ADR-0034, ADR-0044).
    const tableUrl = config.statutesAffectedTableUrl;
    const table: StatutesAffectedTableFetch | undefined =
      tableUrl === null
        ? undefined
        : {
            url: tableUrl,
            retrievedAt: formatPacific(deps.clock.now()),
            download: await olis.downloadFile(new URL(tableUrl), deps.signal),
          };
    // The Statute Links and Agency Links of what is stored, and the table's series, with this pull's snapshot; then the
    // index reports the snapshot.
    const { statutesAffectedTable } = await snapshotRead.finish(table);
    const listingCounts = new Map(writer.listingCounts(config.session).map((count) => [count.entitySet, count]));
    const unresolvedMemberCodes = new Set(
      resolver
        .unresolved()
        .filter((entry) => entry.references.some((reference) => reference.source === "CommitteeMembers"))
        .map((entry) => entry.code),
    );
    writeBuildReport(buildReportPath(config.databasePath), {
      session: config.session,
      as_of: asOf,
      committee_members: committeeMembersReportOf(writer.committeeMembers(config.session), unresolvedMemberCodes),
      pull: {
        complete: true,
        entity_sets: setCounts.map((count) => ({
          ...setReportOf(count),
          listed: listingCounts.get(count.entitySet)?.listed ?? 0,
          no_longer_listed: listingCounts.get(count.entitySet)?.noLongerListed ?? 0,
        })),
      },
      documents_without_text_layer: writer.documentsWithoutTextLayer(config.session).map((document) => ({
        id: document.id,
        source_url: document.sourceUrl,
      })),
      documents_not_fetched: notFetched,
      ...recordingLogNotesOf(writer.recordingLogReadingNotes(config.session)),
      recording_log_refetches: refetches,
      search_index: {
        model: deps.embedder.modelId,
        passages: passageCounts.passages,
        keyword_only_passages: passageCounts.keywordOnly,
        embedded: passageCounts.embedded,
        reused: passageCounts.reused,
      },
      ...(statutesAffectedTable === undefined ? {} : { statutes_affected_table: statutesAffectedTable }),
      ...(transcriptsRun === undefined
        ? {}
        : { transcripts: transcriptsReportOf(transcriptsRun, writer.transcriptNotes(config.session)) }),
    });
    return {
      measures: feed.Measures.length,
      asOf,
      documentsFetched,
      documentsNotFetched: notFetched.length,
      unresolvedLegislatorCodes: resolver.unresolved(),
    };
  } finally {
    writer.close();
  }
}

export type IncrementResult = {
  asOf: Timestamp;
  /** Documents fetched by this increment: the ones the store already held are not fetched again. */
  documentsFetched: number;
  documentsNotFetched: number;
};

/** How far before the last run an increment starts reading (ADR-0005, ADR-0039): rows OLIS wrote while that run read. */
const INCREMENT_OVERLAP_HOURS = 2;

/**
 * An increment (ADR-0005, ADR-0039): reads the rows OLIS created or modified since the last run, less a two-hour
 * overlap (`CreatedDate gt X or ModifiedDate gt X`), stores them, and fetches the documents they link that the store
 * does not hold. It is not a complete pull: it lists nothing and marks nothing no longer listed (ADR-0030). A short read
 * stores nothing and throws. The Snapshot read (`snapshot-read.ts`) reads the links of the documents it stores, and matches
 * each Testimony row's Agency, only when the snapshot file is the one the index reports; under a changed file it leaves
 * both to the next full pull (ADR-0035, ADR-0047).
 */
export async function runIncrement(config: IngestConfig, deps: IngestDeps): Promise<IncrementResult> {
  const snapshot = await loadSnapshot(config.snapshotPath);
  const asOf = formatPacific(deps.clock.now());
  const writer = openIndexWriter(config.databasePath);
  try {
    // The Index's As of is when the last run began: the same time the server answers with.
    const lastRun = writer.asOf(config.session);
    if (lastRun === undefined)
      throw new Error("An increment needs a complete full pull before it: the index holds none");
    const since = pacificTimestampOf(Temporal.Instant.from(lastRun).subtract({ hours: INCREMENT_OVERLAP_HOURS }));
    const olis = createWorkerClient(config, deps);
    const feed = await readFeed(olis, config, deps, { kind: "increment", since, writer, session: config.session });
    const snapshotRead = beginIncrementSnapshotRead({ writer, session: config.session, snapshot });
    const { record, resolver, committeeNames } = feedRecordOf(config, deps, feed, snapshotRead);
    writer.recordIncrement(config.session, asOf, record);
    const passageCounts: PassageCounts = { passages: 0, keywordOnly: 0, embedded: 0, reused: 0 };
    const notFetched: BuildReport["documents_not_fetched"] = [];
    const refetches: BuildReport["recording_log_refetches"] = { attempted: 0, failed: [], bytes_changed: [] };
    const documentsFetched = await storeLinkedDocuments({
      config,
      deps,
      writer,
      olis,
      links: documentLinksOf(record),
      resolver,
      committeeNames,
      passageCounts,
      notFetched,
      refetches,
    });
    // A transcript file the folder gained since the last run is read by an increment too; the build report is a full pull's.
    await ingestTranscriptsOf(config, deps, writer);
    // Whether the Increment read or left it to the next Full pull, it has nothing more to do or to report.
    await snapshotRead.finish();
    return { asOf, documentsFetched, documentsNotFetched: notFetched.length };
  } finally {
    writer.close();
  }
}

export type { HashSampleReport };
export { hashSampleReportPath, lastHashSampleAt };

/**
 * The nightly hash sample (ticket #20, ADR-0040): fetches `config.hashSampleSize` random stored documents again and
 * compares their hashes with the stored ones. It stores nothing; it writes `hash-sample-report.json` beside the
 * database, a report every time it runs, empty or not. `random` draws the documents; no document is fetched at or
 * after `deadline`.
 */
export async function runHashSample(
  config: IngestConfig,
  deps: IngestDeps & { random: () => number },
  deadline: Timestamp | undefined,
): Promise<HashSampleReport> {
  const olis = createWorkerClient(config, deps);
  const writer = openIndexWriter(config.databasePath);
  let documents: StoredDocumentHash[];
  try {
    documents = writer.documentsToSample(config.session);
  } finally {
    writer.close();
  }
  const untilDeadline =
    deadline === undefined ? undefined : Temporal.Instant.from(deadline).epochMilliseconds - deps.clock.now().getTime();
  const report = await sampleHashes({
    session: config.session,
    documents,
    size: config.hashSampleSize,
    random: deps.random,
    olis,
    clock: deps.clock,
    signal: deps.signal,
    deadline,
    ...(untilDeadline === undefined ? {} : { windowSignal: AbortSignal.timeout(Math.max(untilDeadline, 1)) }),
    previous: readHashSampleReport(config.databasePath)?.mismatches ?? [],
  });
  writeHashSampleReport(hashSampleReportPath(config.databasePath), report);
  return report;
}
