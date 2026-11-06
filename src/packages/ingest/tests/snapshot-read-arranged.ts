// What the seam-4 tests of the Snapshot read arrange (ticket #96): an Index in a WAL file of its own, two Snapshots, two
// stored documents, Testimony rows, a held Statutes Affected Table, and writers that keep a log of what they were asked
// to store or stop at a step. The package's own tests/ fixture: everything goes in and out through package entry points
// (the writer, the reader, the snapshot parser, the statute-links parser), never SQL.
//
// The texts are REAL, quoted from the committed fixture (test/fixtures/olis-2025R1/documents/, extracted by the
// pdf-text package, lines as it gives them). Everything around them is MADE UP and labelled so: the feed's
// bookkeeping (retrieval time, page count, provenance), the second Snapshot, and the Testimony rows.
import { createHash } from "node:crypto";
import { mkdtempDisposableSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type IndexReader, openIndexReader } from "#/packages/database/reader.ts";
import {
  type FullPullRecord,
  type IndexWriter,
  openIndexWriter,
  type SearchRecord,
} from "#/packages/database/writer.ts";
import {
  amendmentIdOf,
  committeeIdOf,
  meetingIdOf,
  positionOf,
  postingIdOf,
  testimonyIdOf,
  versionIdOf,
  type DocumentLink,
  type Meeting,
  type StoredDocument,
  type TestimonyDetails,
} from "#/packages/domain/documents.ts";
import { measureIdOf, parseSessionKey, type MeasureKey } from "#/packages/domain/index.ts";
import { parseSnapshot, type Snapshot } from "#/packages/oregonai-snapshot/index.ts";
import { searchEntryOf } from "#/packages/search/documents.ts";
import { parseStatutesAffectedTable } from "#/packages/statute-links/index.ts";
import { readTimestamp } from "#/packages/time/pacific.ts";
import type { StatutesAffectedTableFetch } from "../snapshot-read.ts";

export const session = parseSessionKey("2025R1") ?? failed("2025R1 is a Session key");

/** When the Full pull of the cases ran, and a later time for an Increment. MADE UP. */
export const fullPullAt = readTimestamp("2026-08-01T10:00:00-07:00") ?? failed("a Pacific time with an offset");
export const incrementAt = readTimestamp("2026-08-01T12:00:00-07:00") ?? failed("a Pacific time with an offset");

export const hb3027: MeasureKey = { session, prefix: "HB", number: 3027 };
export const hb3795: MeasureKey = { session, prefix: "HB", number: 3795 };

/** The registry slugs the tests read links back by (the committed Snapshot's, test/fixtures/oregonai-snapshot/). */
export const hecc = "higher-education-coordinating-commission";
export const boli = "bureau-of-labor-and-industries";
export const dhs = "department-of-human-services";

// --- The Snapshots -------------------------------------------------------------------------------------------------

const committedSnapshotPath = fileURLToPath(
  new URL("../../../../test/fixtures/oregonai-snapshot/snapshot.json", import.meta.url),
);

/** The parts of the snapshot file a test changes. */
type SnapshotFileParts = {
  version: { source: string; commit: string; commitDate: string };
  orsSections: string[];
  agencies: { slug: string; aliases: string[] }[];
};

/** The commit a made-up Snapshot has: not any commit of any repository. MADE UP. */
export const madeUpCommit = "0123456789abcdef0123456789abcdef01234567";

/** The ORS section the made-up Snapshot adds to the committed one: it sits inside "ORS 345.010 to 345.340". MADE UP. */
const madeUpSection = "ors-345.250";

/** The committed Snapshot: the real registry, sections and Chapter table, trimmed to what the 2025R1 fixture touches. */
export function committedSnapshot(): Snapshot {
  return parseSnapshot(JSON.parse(readFileSync(committedSnapshotPath, "utf8")));
}

/**
 * A MADE-UP Snapshot: the committed one with a commit of its own, the section `madeUpSection` added to its list, and
 * whatever `change` does to the rest of the file. Nothing it adds is true.
 */
export function madeUpSnapshot(change: (file: SnapshotFileParts) => void = () => {}): Snapshot {
  const file = JSON.parse(readFileSync(committedSnapshotPath, "utf8")) as SnapshotFileParts;
  file.version = { ...file.version, commit: madeUpCommit, commitDate: "2026-10-01T09:00:00-07:00" };
  file.orsSections = [...file.orsSections, madeUpSection].sort();
  change(file);
  return parseSnapshot(file);
}

/**
 * An Organization that no registry of the committed Snapshot names, and the change that gives it to the Bureau of Labor
 * and Industries as an alias: a made-up Snapshot with it matches the Organization and the committed one does not. MADE UP.
 */
export const wageOffice = "MADE UP Wage Office";

export function giveBureauTheWageOfficeAlias(file: { agencies: { slug: string; aliases: string[] }[] }): void {
  const bureau =
    file.agencies.find((agency) => agency.slug === boli) ?? failed("The committed Snapshot lacks the Bureau");
  bureau.aliases = [...bureau.aliases, wageOffice];
}

// --- The Index ------------------------------------------------------------------------------------------------------

/** An Index in a WAL file of its own, opened for writing and for reading, as the worker and the server open it. */
export type IndexRig = {
  writer: IndexWriter;
  reader: IndexReader;
  remove(): void;
};

export function openIndexRig(): IndexRig {
  const directory = mkdtempDisposableSync(join(tmpdir(), "session-gateway-snapshot-read-"));
  const path = join(directory.path, "index.db");
  const writer = openIndexWriter(path);
  // A clock after every made-up time, so the reader hides nothing. It is the twin of `afterEverythingMadeUp` in
  // database/tests/clock.ts, written out here because a package's tests do not import another package's test files.
  const reader = openIndexReader(path, { now: () => new Date("2100-01-01T00:00:00Z") });
  return {
    writer,
    reader,
    remove: () => {
      try {
        reader.close();
        writer.close();
      } finally {
        directory.remove();
      }
    },
  };
}

// --- The stored documents ------------------------------------------------------------------------------------------

/** HB 3027, Introduced, SECTION 1 and the start of SECTION 2: the pdf-text package's text of measure-documents/HB3027/Introduced.pdf, lines as it gives them. */
const hb3027IntroducedText = [
  "SECTION 1. Section 2 of this 2025 Act is added to and made a part of ORS 345.010 to",
  "345.340.",
  "SECTION 2. (1) The Higher Education Coordinating Commission may seek an injunction",
  "against a person or career school that is engaged, has engaged or is about to engage in any",
  "activity in violation of ORS 345.010 to 345.340 or any rule adopted under the authority of ORS",
  "345.010 to 345.340.",
].join("\n");

/** HB 3795-A3, a Proposed Amendment: the pdf-text package's text of proposed-amendments/28997.pdf, from its first line of words to the start of its quoted ORS 418.808. */
const hb3795A3Text = [
  "HB 3795-A3",
  "(LC 1688)",
  "4/29/25 (LAS/ps)",
  "Requested by Senator GELSER BLOUIN",
  "PROPOSED AMENDMENTS TO",
  "A-ENGROSSED HOUSE BILL 3795",
  "On page 1 of the printed A-engrossed bill, line 2, before the period insert",
  "“and 418.808”.",
  "On page 2, after line 12, insert:",
  "“SECTION 2. ORS 418.808 is amended to read:",
  "“418.808. As used in ORS 418.806 to 418.816, ‘critical incident’ means an",
  "incident that resulted in the death of a child if the Department of Human",
  "Services reasonably believes the death was the result of child abuse and:",
  "“(1) The child was in the custody of the department at the time of death;",
].join("\n");

type MadeUpBookkeeping = { measure: MeasureKey; provenance: string };

function stored(
  link: Pick<StoredDocument, "id" | "nodeId" | "kind" | "label" | "sourceUrl" | "relations"> &
    Partial<Pick<StoredDocument, "postedAt" | "date">>,
  text: string,
): StoredDocument {
  return {
    postedAt: null,
    date: null,
    ...link,
    // MADE UP: when the worker fetched it and how many pages the file has.
    retrievedAt: fullPullAt,
    contentHash: createHash("sha256").update(text).digest("hex"),
    textHash: createHash("sha256").update(text).digest("hex"),
    pageCount: 1,
    hasTextLayer: true,
    text,
  };
}

function relationsOf({ measure, provenance }: MadeUpBookkeeping): StoredDocument["relations"] {
  return [{ relation: "measure", to: measureIdOf(measure), meaning: null, provenance }];
}

/** HB 3027's Introduced Version: a range ("ORS 345.010 to 345.340") that the Snapshot's section list expands. */
export function introducedVersion(): StoredDocument {
  const id = versionIdOf(hb3027, "Introduced");
  return stored(
    {
      id,
      nodeId: id,
      kind: "version",
      label: "Introduced",
      sourceUrl: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/HB3027/Introduced",
      relations: relationsOf({ measure: hb3027, provenance: "MADE UP: MeasureDocuments HB 3027 Introduced" }),
    },
    hb3027IntroducedText,
  );
}

/**
 * The meeting the posting was posted to: CommitteeProposedAmendments 28997 says the Senate Committee On Human Services
 * (SHS) met at 8:00 on 2025-05-15 (feed/CommitteeProposedAmendments.json). Its status is MADE UP.
 */
const postedAt = readTimestamp("2025-05-15T08:00:00-07:00") ?? failed("a Pacific time with an offset is a Timestamp");

export const humanServicesMeeting: Meeting = {
  session,
  committeeCode: "SHS",
  id: meetingIdOf(session, "SHS", postedAt),
  committeeId: committeeIdOf(session, "SHS"),
  at: postedAt,
  status: "Scheduled",
  agenda: null,
};

/** The posting of HB 3795's -A3 (ProposedAmendmentId 28997), which amends ORS 418.808. */
export function postedAmendment(): StoredDocument {
  const provenance = "CommitteeProposedAmendments 28997";
  return stored(
    {
      id: postingIdOf(session, 28997),
      nodeId: amendmentIdOf(hb3795, "-A3"),
      kind: "proposed_amendment",
      label: "-A3",
      sourceUrl: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/ProposedAmendment/28997",
      postedAt,
      date: postedAt,
      relations: [
        ...relationsOf({ measure: hb3795, provenance }),
        { relation: "committee", to: humanServicesMeeting.committeeId, meaning: null, provenance },
        { relation: "posted_to", to: humanServicesMeeting.id, meaning: "Proposed", provenance },
        { relation: "amendment", to: amendmentIdOf(hb3795, "-A3"), meaning: null, provenance },
      ],
    },
    hb3795A3Text,
  );
}

/** What a pull read of the feed, with these parts and nothing else. */
export function pulledFeed(parts: Partial<FullPullRecord>): FullPullRecord {
  return {
    Measures: [],
    Legislators: [],
    MeasureSponsors: [],
    MeasureHistoryActions: [],
    MeasureVotes: [],
    CommitteeVotes: [],
    Committees: [],
    CommitteeMeetings: [],
    CommitteeAgendaItems: [],
    MeasureDocuments: [],
    MeasureAnalysisDocuments: [],
    CommitteeMeetingDocuments: [],
    CommitteeProposedAmendments: [],
    CommitteePublicTestimonies: [],
    CommitteeMembers: [],
    ConveneTimes: [],
    LegislativeSessions: undefined,
    FloorLetters: [],
    legislators: [],
    legislatorCodes: [],
    ...parts,
  };
}

/**
 * A Testimony row of HB 3027 as the feed would list it, and its `Organization`. MADE UP: the row, its id, its submitter and
 * its meeting (the posting's, at 8:00 on 2025-05-15), which are not any row of the feed. Its file is never fetched.
 */
export function testimonyRow(commTestId: number, organization: string): DocumentLink & { testimony: TestimonyDetails } {
  const id = testimonyIdOf(session, commTestId);
  const provenance = `MADE UP: CommitteePublicTestimonies ${String(commTestId)}`;
  return {
    id,
    nodeId: id,
    kind: "testimony",
    label: "Testimony",
    sourceUrl: `https://olis.oregonlegislature.gov/liz/2025R1/Downloads/PublicTestimonyDocument/${String(commTestId)}`,
    postedAt: null,
    date: humanServicesMeeting.at,
    testimony: {
      commTestId,
      position: positionOf(3983),
      submitter: "MADE UP Submitter",
      behalfOf: null,
      organization,
      committeeCode: humanServicesMeeting.committeeCode,
      meetingAt: humanServicesMeeting.at,
    },
    relations: [
      ...relationsOf({ measure: hb3027, provenance }),
      { relation: "committee", to: humanServicesMeeting.committeeId, meaning: null, provenance },
    ],
  };
}

/** What search keeps of a document: its entry, and nothing to find it by, which the Snapshot read does not read. */
function searchRecordOf(document: StoredDocument): SearchRecord {
  return {
    entry: searchEntryOf(document, new Map()),
    passages: [],
    citations: [],
    vectors: { modelId: "made-up", rows: [] },
  };
}

/** Stores the documents as a pull's documents step does, files and text with no passages. */
export function storeDocuments(writer: IndexWriter, ...documents: StoredDocument[]): void {
  for (const document of documents) writer.storeDocument(session, document, searchRecordOf(document));
}

// --- The Statutes Affected Table ----------------------------------------------------------------------------------------

/** Where Legislative Counsel publishes the 2025R1 table (test/CLAUDE.md, "The Statutes Affected Table"). */
export const tableUrl = "https://www.oregonlegislature.gov/AutoPubs/artables2025R1.pdf";

/**
 * MADE UP: a table of one series, 345.010 to 345.340, that amends HB 3027 in section 2, a row the real table does not
 * have. The two lines are how PDF.js writes the series of the real table, as `madeUpRows` of
 * test/tools/get-measure-statutes-affected-table-snapshot.test.ts has them.
 */
const madeUpTableText = ["345.010 to)", "345.340 ) A §2 HB 3027"].join("\n");

/** When the held table was retrieved. MADE UP, a month before the Pulls of the cases. */
export const heldTableRetrievedAt =
  readTimestamp("2026-07-01T10:00:00-07:00") ?? failed("a Pacific time with an offset is a Timestamp");

/**
 * Stores the made-up table as a Pull with this Snapshot leaves it: its series expanded against the Snapshot's section
 * list, which the committed one holds 22 sections of, and the Snapshot's commit beside it (ADR-0044).
 */
export function storeHeldTable(writer: IndexWriter, snapshot: Snapshot): void {
  writer.storeStatutesAffectedTable(session, {
    sourceUrl: tableUrl,
    retrievedAt: heldTableRetrievedAt,
    contentHash: createHash("sha256").update("MADE UP: the bytes of the held table").digest("hex"),
    pageCount: 1,
    text: madeUpTableText,
    entries: parseStatutesAffectedTable({ text: madeUpTableText, orsSections: snapshot.orsSections }).entries,
    snapshotCommit: snapshot.version.commit,
  });
}

/** What a Pull is handed when the server fails to give the table: the status of its last answer, or null for none. */
export function tableNotFetched(status: number | null, reason: string): StatutesAffectedTableFetch {
  return { url: tableUrl, retrievedAt: fullPullAt, download: { kind: "failed", reason, status } };
}

/** What a Pull is handed when the server gives these bytes. */
export function tableFetched(bytes: Uint8Array): StatutesAffectedTableFetch {
  return { url: tableUrl, retrievedAt: fullPullAt, download: { kind: "fetched", bytes } };
}

/** Bytes that are no table, not even a PDF: a placeholder the server might give. MADE UP. */
export const placeholderBytes = new TextEncoder().encode("MADE UP: this is a placeholder, not a table");

// --- What the writer was asked to store ---------------------------------------------------------------------------

/**
 * A writer that does what `writer` does and writes down, in order, what the Snapshot read stored through it: one entry
 * for each file read for Statute Links ("statute-links of a version"), each document read for Agency Links
 * ("agency-links of version-2025r1-hb3027-introduced"), the Statutes Affected Table's series read again ("table
 * entries") and the Snapshot the Index was told to report ("snapshot 0123...").
 */
export function loggedWriter(writer: IndexWriter, log: string[]): IndexWriter {
  return {
    ...writer,
    storeStatuteParse: (record, snapshot) => {
      log.push(`statute-links of a ${record.readAs === "version" ? "version" : "posting"}`);
      writer.storeStatuteParse(record, snapshot);
    },
    storeAgencyRead: (record, snapshot) => {
      log.push(`agency-links of ${record.documentId}`);
      writer.storeAgencyRead(record, snapshot);
    },
    rereadStatutesAffectedTable: (sessionKey, reading) => {
      log.push("table entries");
      writer.rereadStatutesAffectedTable(sessionKey, reading);
    },
    recordSnapshotRead: (sessionKey, snapshot, agencyParents) => {
      log.push(`snapshot ${snapshot.commit}`);
      writer.recordSnapshotRead(sessionKey, snapshot, agencyParents);
    },
  };
}

/** The same writer, except that asking it for the documents whose Agency Links are unread fails: a run that stops there. */
export function stoppingBeforeAgencyLinks(writer: IndexWriter): IndexWriter {
  return {
    ...writer,
    unreadAgencyDocuments: () => {
      throw new Error("The run stopped between the Statute Links and the Agency Links");
    },
  };
}

/** The same writer, except that replacing the entries of the held table fails: a run that stops at the Statutes Affected Table. */
export function stoppingAtTableEntries(writer: IndexWriter): IndexWriter {
  return {
    ...writer,
    rereadStatutesAffectedTable: () => {
      throw new Error("The run stopped at the Statutes Affected Table");
    },
  };
}

function failed(message: string): never {
  throw new Error(message);
}
