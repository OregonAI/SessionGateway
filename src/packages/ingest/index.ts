// The ingest worker. A full pull reads the deployment's Session from OLIS (its Measures, Legislators,
// sponsors, history and votes, its committees, meetings and their agenda items, its Testimony rows, and
// the documents they link) and stores the feed, with which documents each meeting lists, the Agency each
// Testimony's Organization names, the version of the OregonAI snapshot and the time the pull started as
// the index's "as of" time. It resolves the Legislator Code of
// each sponsor and each vote to a Legislator on the way and reports the codes it could not. It refreshes
// what the feed says about the documents it already holds, fetches every linked document the store does
// not hold yet, once each, keeps its text, reads the Statute Links of the Versions and Proposed Amendments it
// holds, and writes the build report
// (docs/adr/0011-an-amendment-is-a-node-and-its-postings-are-documents.md).
import { createHash } from "node:crypto";
import { testimonyAgencyLinks } from "#/packages/agency-links/index.ts";
import type { IngestConfig } from "#/packages/config/index.ts";
import {
  openIndexWriter,
  type CommitteeVoteRecord,
  type FloorVoteRecord,
  type IndexWriter,
  type SearchRecord,
  type SponsorRecord,
  type TestimonyRecord,
  type StatuteParseRecord,
  type UnreadStatuteFile,
} from "#/packages/database/writer.ts";
import type { Embedder } from "#/packages/embedder/index.ts";
import type { CommitteeId, DocumentLink } from "#/packages/domain/documents.ts";
import type { LegislatorId, Sponsorship } from "#/packages/domain/legislators.ts";
import type { OrsSectionId } from "#/packages/domain/oregonai.ts";
import { unreadStatuteParse } from "#/packages/domain/statute-links.ts";
import type { Passage, SearchEntry } from "#/packages/domain/search.ts";
import type { CommitteeVoteEntry, FloorVoteEntry } from "#/packages/domain/votes.ts";
import type { LegislatorAlias } from "#/packages/legislators/aliases.ts";
import {
  createLegislatorResolver,
  type LegislatorResolver,
  type Resolution,
  type UnresolvedLegislatorCode,
} from "#/packages/legislators/resolver.ts";
import { createOlisClient, type OlisClient } from "#/packages/olis-client/index.ts";
import { loadSnapshot, type Snapshot } from "#/packages/oregonai-snapshot/index.ts";
import { extractPdfText, type ExtractedPdf } from "#/packages/pdf-text/index.ts";
import { parseStatuteLinks, readAmendedVersionHeader } from "#/packages/statute-links/index.ts";
import { searchEntryOf } from "#/packages/search/documents.ts";
import { splitPassages } from "#/packages/search/passages.ts";
import { quantizeUnitVector } from "#/packages/search/vectors.ts";
import type { Clock } from "#/packages/time/clock.ts";
import { formatPacific, type Timestamp } from "#/packages/time/pacific.ts";
import { buildReportPath, writeBuildReport, type BuildReport } from "./lib/build-report.ts";

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

/**
 * The Testimony rows among the links, each with the Agency its `Organization` names. The match is the Agency
 * Link extractor's (`testimonyAgencyLinks`, spec #1 module 5), made here because the registry is the snapshot's
 * and only the worker reads that (ADR-0012). It matches the Organization and nothing else.
 */
function testimonyRecordsOf(links: readonly DocumentLink[], snapshot: Snapshot): TestimonyRecord[] {
  const records: TestimonyRecord[] = [];
  for (const link of links) {
    const details = link.testimony;
    if (details === undefined) continue;
    const agency = testimonyAgencyLinks(details.organization ?? "", snapshot.agencies)[0];
    records.push({ link: { ...link, testimony: details }, agencyId: agency?.agency ?? null });
  }
  return records;
}

/**
 * What reading one stored file for Statute Links comes to (ADR-0015): the links of a Version, or of a
 * Proposed Amendment's inserted sections with its relating clause edits and the Version its header names. A
 * file with no text layer gives no links and is recorded as not read.
 */
function statuteParseOf(
  file: UnreadStatuteFile,
  stored: { text: string; hasTextLayer: boolean },
  orsSections: readonly OrsSectionId[],
): StatuteParseRecord {
  const common = { contentHash: file.contentHash, readAs: file.readAs };
  if (!stored.hasTextLayer) {
    return { ...common, ...unreadStatuteParse() };
  }
  switch (file.readAs) {
    case "version": {
      const parsed = parseStatuteLinks({ documentKind: "version", text: stored.text, orsSections });
      return {
        ...common,
        textRead: true,
        amendedVersionHeader: null,
        links: parsed.links,
        relatingClauseEdits: parsed.relatingClauseEdits,
      };
    }
    case "proposed_amendment": {
      const parsed = parseStatuteLinks({ documentKind: "proposed-amendment", text: stored.text, orsSections });
      return {
        ...common,
        textRead: true,
        amendedVersionHeader: readAmendedVersionHeader(stored.text) ?? null,
        links: parsed.links,
        relatingClauseEdits: parsed.relatingClauseEdits,
      };
    }
    default:
      return file.readAs satisfies never;
  }
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

export async function runFullPull(config: IngestConfig, deps: IngestDeps): Promise<FullPullResult> {
  // The snapshot is read before OLIS is: a build with no usable snapshot fails at once, naming the file.
  const snapshot = await loadSnapshot(config.snapshotPath);
  const asOf = formatPacific(deps.clock.now());
  const olis = createOlisClient({
    baseUrl: config.olisBaseUrl,
    fetch: deps.fetch,
    documents: {
      origin: config.olisDocumentOrigin,
      timeoutMs: deps.documentTimeoutMs ?? DEFAULT_DOCUMENT_TIMEOUT_MS,
      pause: deps.pause,
    },
  });
  const measures = await olis.readMeasures(config.session, deps.signal);
  const legislatorRows = await olis.readLegislators(config.session, deps.signal);
  const sponsorships = await olis.readSponsorships(config.session, deps.signal);
  const history = await olis.readHistoryActions(config.session, deps.signal);
  const committeeVotes = await olis.readCommitteeVotes(config.session, deps.signal);
  const floorVotes = await olis.readFloorVotes(config.session, deps.signal);
  const committees = await olis.readCommittees(config.session, deps.signal);
  const meetings = await olis.readMeetings(config.session, deps.signal);
  const agendaItems = await olis.readAgendaItems(config.session, deps.signal);
  const links = [
    ...(await olis.readDocumentLinks(config.session, deps.signal)),
    ...meetings.flatMap((meeting) => (meeting.agenda === null ? [] : [meeting.agenda])),
  ];

  // A Member sponsor and the voter of a vote entry each name a Legislator by a Legislator Code; the
  // resolver says who that is.
  const resolver = createLegislatorResolver({
    session: config.session,
    rows: legislatorRows,
    aliases: deps.legislatorAliases,
  });
  const sponsors = sponsorships.map((sponsorship) => sponsorRecordOf(sponsorship, resolver));
  const floorVoteRecords = floorVotes.map((entry) => floorVoteRecordOf(entry, resolver));
  const committeeVoteRecords = committeeVotes.map((entry) => committeeVoteRecordOf(entry, resolver));

  const committeeNames = new Map<CommitteeId, string>(committees.map((committee) => [committee.id, committee.name]));
  const writer = openIndexWriter(config.databasePath);
  let documentsFetched = 0;
  const passageCounts: PassageCounts = { passages: 0, keywordOnly: 0, embedded: 0, reused: 0 };
  const notFetched: BuildReport["documents_not_fetched"] = [];
  try {
    // What each meeting lists and which analysis documents each Measure has are the feed's, so they are
    // stored with the rest of it before any file is fetched: a file that fails to come is still listed,
    // and the server can say a Measure has a statement it does not hold yet.
    writer.recordFullPull(config.session, asOf, {
      measures,
      history,
      legislators: resolver.people,
      legislatorCodes: resolver.codes.map(({ code, legislator }) => ({ code, legislatorId: legislator.id })),
      sponsors,
      floorVotes: floorVoteRecords,
      committeeVotes: committeeVoteRecords,
      snapshot: snapshot.version,
      committees,
      meetings,
      agendaItems,
      documentLinks: links,
      testimony: testimonyRecordsOf(links, snapshot),
    });
    const stored = writer.storedDocumentIds(config.session);
    // A fetched file is unchanging (ADR-0005) but its feed row is not: OLIS changes a posting's Meaning,
    // a Testimony's Measure. What the row says about a stored document is refreshed without fetching it.
    const refreshed = links.filter((link) => stored.has(link.id));
    writer.refreshDocuments(
      config.session,
      refreshed,
      new Map(refreshed.map((link) => [link.id, searchEntryOf(link, committeeNames)])),
    );
    for (const link of links) {
      if (stored.has(link.id)) continue;
      const fetched = await fetchAndRead(olis, link, deps.signal);
      if (fetched.kind === "left_out") {
        notFetched.push({ id: link.id, source_url: link.sourceUrl, reason: fetched.reason });
        continue;
      }
      const entry = searchEntryOf(link, committeeNames);
      const passages = splitPassages(fetched.pdf.text, deps.embedder);
      const vectors = await vectorsForNewPassages(writer, deps.embedder, entry, passages, passageCounts);
      writer.storeDocument(
        config.session,
        {
          ...link,
          retrievedAt: formatPacific(deps.clock.now()),
          contentHash: createHash("sha256").update(fetched.bytes).digest("hex"),
          textHash: createHash("sha256").update(fetched.pdf.text).digest("hex"),
          pageCount: fetched.pdf.pageCount,
          hasTextLayer: fetched.pdf.hasTextLayer,
          text: fetched.pdf.text,
        },
        { entry, passages, vectors },
      );
      stored.add(link.id);
      documentsFetched += 1;
    }
    // The Statute Links of every stored Version and posting not yet read, from the text the store holds: the
    // files are not fetched again. Postings that share a file are read once (ADR-0015).
    for (const file of writer.unreadStatuteFiles(config.session)) {
      writer.storeStatuteParse(statuteParseOf(file, writer.storedText(file.documentId), snapshot.orsSections));
    }
    writeBuildReport(buildReportPath(config.databasePath), {
      session: config.session,
      as_of: asOf,
      documents_without_text_layer: writer.documentsWithoutTextLayer(config.session).map((document) => ({
        id: document.id,
        source_url: document.sourceUrl,
      })),
      documents_not_fetched: notFetched,
      search_index: {
        model: deps.embedder.modelId,
        passages: passageCounts.passages,
        keyword_only_passages: passageCounts.keywordOnly,
        embedded: passageCounts.embedded,
        reused: passageCounts.reused,
      },
    });
  } finally {
    writer.close();
  }
  return {
    measures: measures.length,
    asOf,
    documentsFetched,
    documentsNotFetched: notFetched.length,
    unresolvedLegislatorCodes: resolver.unresolved(),
  };
}
