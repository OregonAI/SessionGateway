// Seam 4 (test/CLAUDE.md): the Snapshot read, called at its entry point (ticket #96; ADR-0027, ADR-0035, ADR-0044,
// ADR-0047). The real parsers (`statute-links`, `agency-links`) and a WAL database in a temp directory of the test's own,
// no fake OLIS and no MCP client. A case arranges the Index through the writer (the feed a Pull stores, its documents,
// and the Snapshot read itself for the first Snapshot), runs the Pull it is about, and reads what the Index holds back
// through the reader. Seam 1 stays the check of what an agent sees (`test/tools/*-snapshot.test.ts`, `increments.test.ts`,
// `get-measure-statutes-affected-table-*.test.ts`).
//
// The documents are two real texts (HB 3027's Introduced Version, whose range "ORS 345.010 to 345.340" the Snapshot's
// section list expands, and the Proposed Amendment HB 3795-A3, which amends ORS 418.808) and the Snapshots are the
// committed one and a MADE-UP copy of it with one more ORS section inside the range, ors-345.250
// (`snapshot-read-arranged.ts`). The committed Snapshot's section list holds 22 sections from 345.010 to 345.340
// (counted in test/fixtures/oregonai-snapshot/snapshot.json), so the Version's range gives 22 "adds to" links, and 23
// with the made-up section; each of them is one of the `linksInChapter` of the Agency Link derived to the Higher
// Education Coordinating Commission (ADR-0027).
import { afterEach, describe, expect, test } from "vitest";
import type { IndexReader } from "#/packages/database/reader.ts";
import type { FullPullRecord, IndexWriter } from "#/packages/database/writer.ts";
import type { DocumentId, DocumentLink, StoredDocument } from "#/packages/domain/documents.ts";
import { parseAgencyId, parseOrsChapterId, parseOrsSectionId } from "#/packages/domain/oregonai.ts";
import type { Snapshot } from "#/packages/oregonai-snapshot/index.ts";
import { STATUTE_LINK_PARSER_VERSION, STATUTES_AFFECTED_TABLE_PARSER_VERSION } from "#/packages/statute-links/index.ts";
import {
  beginFullPullSnapshotRead,
  beginIncrementSnapshotRead,
  type FullPullSnapshotOutcome,
  type IncrementSnapshotOutcome,
  type SnapshotRead,
  type SnapshotReadStart,
  type StatutesAffectedTableFetch,
} from "../snapshot-read.ts";
import {
  boli,
  committedSnapshot,
  dhs,
  fullPullAt,
  giveBureauTheWageOfficeAlias,
  hb3027,
  hecc,
  humanServicesMeeting,
  incrementAt,
  introducedVersion,
  loggedWriter,
  madeUpCommit,
  madeUpSnapshot,
  openIndexRig,
  placeholderBytes,
  postedAmendment,
  pulledFeed,
  session,
  heldTableRetrievedAt,
  stoppingAtTableEntries,
  stoppingBeforeAgencyLinks,
  storeDocuments,
  storeHeldTable,
  tableFetched,
  tableNotFetched,
  tableUrl,
  testimonyRow,
  wageOffice,
  type IndexRig,
} from "./snapshot-read-arranged.ts";

const committedCommit = "6c41efefb5683a35437c9db6baf235c2051cef4b";

const rigs: IndexRig[] = [];

afterEach(() => {
  for (const rig of rigs.splice(0)) rig.remove();
});

function newIndex(): IndexRig {
  const rig = openIndexRig();
  rigs.push(rig);
  return rig;
}

/** What every Pull arranges: the Index, the Snapshot file it loaded, and what it fetched and listed. */
type PullArranged = {
  rig: IndexRig;
  snapshot: Snapshot;
  /** The documents this Pull fetches and stores. */
  fetched: StoredDocument[];
  /** The Testimony rows the feed lists in this Pull. */
  testimony?: DocumentLink[];
  /** What the Snapshot read stores through: the Index's writer, unless a case watches it or stops it. */
  through?: IndexWriter;
};

type FullPull = PullArranged & {
  pull: "full_pull";
  /** The Statutes Affected Table the Pull fetched, or nothing when the deployment names none. */
  table?: StatutesAffectedTableFetch;
};

/** An Increment fetches no table, so it has none to hand over. */
type Increment = PullArranged & { pull: "increment" };

/** The feed a Pull stores: the Snapshot read matches the Agency of its Testimony rows. */
function feedOf({ fetched, testimony = [] }: PullArranged, read: SnapshotRead): FullPullRecord {
  return pulledFeed({
    CommitteeMeetings: [humanServicesMeeting],
    MeasureDocuments: fetched.filter((link) => link.kind === "version"),
    CommitteeProposedAmendments: fetched.filter((link) => link.kind === "proposed_amendment"),
    CommitteePublicTestimonies: read.testimonyRecordsOf(testimony),
  });
}

/**
 * A Pull as `ingest/index.ts` runs it: the Snapshot read begins, the feed and the documents it fetched are stored, and the
 * Snapshot read finishes.
 */
function runPull(pull: FullPull): Promise<FullPullSnapshotOutcome>;
function runPull(pull: Increment): Promise<IncrementSnapshotOutcome>;
function runPull(pull: FullPull | Increment): Promise<FullPullSnapshotOutcome | IncrementSnapshotOutcome> {
  const { rig, snapshot, fetched, through } = pull;
  const start = { writer: through ?? rig.writer, session, snapshot };
  switch (pull.pull) {
    case "full_pull": {
      const read = beginFullPullSnapshotRead(start);
      rig.writer.recordFullPull(session, fullPullAt, feedOf(pull, read));
      storeDocuments(rig.writer, ...fetched);
      return read.finish(pull.table);
    }
    case "increment": {
      const read = beginIncrementSnapshotRead(start);
      rig.writer.recordIncrement(session, incrementAt, feedOf(pull, read));
      storeDocuments(rig.writer, ...fetched);
      return read.finish();
    }
    default:
      return pull satisfies never;
  }
}

/** An Index whose Full pull fetched these documents and read them with the Snapshot. */
async function indexAfterFullPull(snapshot: Snapshot, ...fetched: StoredDocument[]): Promise<IndexRig> {
  const rig = newIndex();
  await runPull({ rig, snapshot, pull: "full_pull", fetched });
  return rig;
}

const chapter345 = parseOrsChapterId("ors-chapter-345") ?? failed("ors-chapter-345 is an ORS chapter id");
const heccId = parseAgencyId(hecc) ?? failed("the registry slug of the HECC");
const ors418808 = parseOrsSectionId("ors-418.808") ?? failed("ors-418.808 is an ORS section id");

/** The ORS sections of chapter 345 that a stored document adds to, as the Index holds its reading. */
function sectionsAddedToIn345(reader: IndexReader, document: DocumentId): string[] {
  return reader
    .findStatuteLinked(session, { chapter: chapter345 })
    .filter((found) => found.document.id === document && found.link.kind === "adds-to")
    .map((found) => found.link.target.id);
}

/** How many of a document's links that change the law reach chapter 345, as the Agency Link derived to the HECC says. */
function linksInChapterOfHeccLink(reader: IndexReader, document: DocumentId): number | undefined {
  for (const link of reader.findAgencyLinks(session, { agency: heccId })) {
    if (link.document.id === document && link.evidence.kind === "derived") return link.evidence.linksInChapter;
  }
  return undefined;
}

/** The documents with a Statute Link that amends ORS 418.808, which the posting of HB 3795-A3 does. */
function documentsAmending418808(reader: IndexReader): string[] {
  return reader
    .findStatuteLinked(session, { section: ors418808 })
    .filter((found) => found.link.kind === "amends")
    .map((found) => found.document.id);
}

describe("a Full pull with a new Snapshot", () => {
  test("reads the Statute Links of every stored Version again with the new section list, then the Agency Links made from them", async () => {
    const rig = await indexAfterFullPull(committedSnapshot(), introducedVersion(), postedAmendment());
    const version = introducedVersion().id;
    expect(sectionsAddedToIn345(rig.reader, version)).toHaveLength(22);
    expect(linksInChapterOfHeccLink(rig.reader, version)).toBe(22);

    await runPull({ rig, snapshot: madeUpSnapshot(), pull: "full_pull", fetched: [] });

    expect(sectionsAddedToIn345(rig.reader, version)).toHaveLength(23);
    expect(sectionsAddedToIn345(rig.reader, version)).toContain("ors-345.250");
    expect(linksInChapterOfHeccLink(rig.reader, version)).toBe(23);
    expect(rig.reader.snapshotVersion(session)?.commit).toBe(madeUpCommit);
  });
});

// Ticket #183 (ADR-0064): a parser change reaches a stored database. A file is read again when its reading's parser version
// is not the current one, as when its snapshot commit is not, so a Snapshot that has not changed does not stop a fix landing.
describe("a Full pull with the Snapshot the Index reports", () => {
  test("reads again a file read with an older parser version, and its Statute Links change", async () => {
    const rig = await indexAfterFullPull(committedSnapshot(), introducedVersion());
    const version = introducedVersion();
    expect(sectionsAddedToIn345(rig.reader, version.id)).toHaveLength(22);
    // The reading an older parser left: the same Snapshot, no links, and its parser's version.
    rig.writer.storeStatuteParse(
      {
        contentHash: version.contentHash,
        readAs: "version",
        textRead: true,
        amendedVersionHeader: null,
        links: [],
        relatingClauseEdits: [],
        parserVersion: STATUTE_LINK_PARSER_VERSION - 1,
      },
      committedSnapshot().version,
    );
    expect(sectionsAddedToIn345(rig.reader, version.id)).toHaveLength(0);
    const log: string[] = [];

    await runPull({
      rig,
      snapshot: committedSnapshot(),
      pull: "full_pull",
      fetched: [],
      through: loggedWriter(rig.writer, log),
    });

    expect(log).toContain("statute-links of a version");
    expect(sectionsAddedToIn345(rig.reader, version.id)).toHaveLength(22);
    // The Agency Links made from the links are read again with them.
    expect(log).toContain(`agency-links of ${version.id}`);
  });

  test("does not read again a file read with the current parser version", async () => {
    const rig = await indexAfterFullPull(committedSnapshot(), introducedVersion(), postedAmendment());
    const log: string[] = [];

    await runPull({
      rig,
      snapshot: committedSnapshot(),
      pull: "full_pull",
      fetched: [],
      through: loggedWriter(rig.writer, log),
    });

    expect(log).toEqual([`snapshot ${committedCommit}`]);
  });
});

// Ticket #184 (ADR-0065): the held table has a parser version of its own, beside its snapshot commit, apart from the Statute
// Links' (ADR-0064). The held copy is read again when its version is not the current one, as when its commit is not.
const tableUnavailable = () => tableNotFetched(503, "MADE UP: the server answered 503 three times");

describe("the Statutes Affected Table's parser version", () => {
  test("a table read with an older table parser is read again from the held copy, though the Snapshot has not changed", async () => {
    const rig = await indexHoldingTable({
      parserVersion: STATUTES_AFFECTED_TABLE_PARSER_VERSION - 1,
      entriesLeftOut: true,
    });
    const log: string[] = [];

    const read = await runPull({
      rig,
      snapshot: committedSnapshot(),
      pull: "full_pull",
      fetched: [],
      table: tableUnavailable(),
      through: loggedWriter(rig.writer, log),
    });

    expect(read).toMatchObject({ statutesAffectedTable: { outcome: "read_again_from_held_copy", entries: 22 } });
    expect(log).toContain("table entries");
    expect(heldTableOf(rig.reader)).toMatchObject({ entries: 22 });
    expect(
      rig.writer.heldStatutesAffectedTable(session)?.parserVersion,
      "the reading is stamped with the current parser",
    ).toBe(STATUTES_AFFECTED_TABLE_PARSER_VERSION);

    // A second pull of the same snapshot finds the reading current, and reads the table no further.
    const second: string[] = [];
    const again = await runPull({
      rig,
      snapshot: committedSnapshot(),
      pull: "full_pull",
      fetched: [],
      table: tableUnavailable(),
      through: loggedWriter(rig.writer, second),
    });
    expect(again).toMatchObject({ statutesAffectedTable: { outcome: "not_fetched" } });
    expect(second).toEqual([`snapshot ${committedCommit}`]);
  });

  test("a table read with the current table parser is not read again", async () => {
    const rig = await indexHoldingTable();
    const log: string[] = [];

    const read = await runPull({
      rig,
      snapshot: committedSnapshot(),
      pull: "full_pull",
      fetched: [],
      table: tableUnavailable(),
      through: loggedWriter(rig.writer, log),
    });

    expect(read).toMatchObject({ statutesAffectedTable: { outcome: "not_fetched" } });
    expect(log).toEqual([`snapshot ${committedCommit}`]);
  });

  test("a Statute Link parser bump reads the Statute Links again and not the table", async () => {
    const rig = await indexHoldingTable();
    const version = introducedVersion();
    await runPull({ rig, snapshot: committedSnapshot(), pull: "full_pull", fetched: [version] });
    rig.writer.storeStatuteParse(
      {
        contentHash: version.contentHash,
        readAs: "version",
        textRead: true,
        amendedVersionHeader: null,
        links: [],
        relatingClauseEdits: [],
        parserVersion: STATUTE_LINK_PARSER_VERSION - 1,
      },
      committedSnapshot().version,
    );
    const log: string[] = [];

    await runPull({
      rig,
      snapshot: committedSnapshot(),
      pull: "full_pull",
      fetched: [],
      table: tableUnavailable(),
      through: loggedWriter(rig.writer, log),
    });

    expect(log).toContain("statute-links of a version");
    expect(log).not.toContain("table entries");
  });

  test("a table parser bump reads the table again and not the Statute Links", async () => {
    const rig = await indexHoldingTable({ parserVersion: STATUTES_AFFECTED_TABLE_PARSER_VERSION - 1 });
    await runPull({ rig, snapshot: committedSnapshot(), pull: "full_pull", fetched: [introducedVersion()] });
    const log: string[] = [];

    await runPull({
      rig,
      snapshot: committedSnapshot(),
      pull: "full_pull",
      fetched: [],
      table: tableUnavailable(),
      through: loggedWriter(rig.writer, log),
    });

    expect(log).toContain("table entries");
    expect(log.filter((entry) => entry.startsWith("statute-links"))).toEqual([]);
  });
});

describe("a run that stops between the two reads", () => {
  test("leaves the old Snapshot reported, and the next run reads what is still unread: the Agency Links, not the Statute Links again", async () => {
    const rig = await indexAfterFullPull(committedSnapshot(), introducedVersion(), postedAmendment());
    const version = introducedVersion().id;

    const stopped = runPull({
      rig,
      snapshot: madeUpSnapshot(),
      pull: "full_pull",
      fetched: [],
      through: stoppingBeforeAgencyLinks(rig.writer),
    });
    await expect(stopped).rejects.toThrow("The run stopped between the Statute Links and the Agency Links");

    // The Statute Links are read with the new Snapshot, the Agency Links are not, and the Index still says the old one.
    expect(sectionsAddedToIn345(rig.reader, version)).toHaveLength(23);
    expect(linksInChapterOfHeccLink(rig.reader, version)).toBe(22);
    expect(rig.reader.snapshotVersion(session)?.commit).toBe(committedCommit);

    const log: string[] = [];
    await runPull({
      rig,
      snapshot: madeUpSnapshot(),
      pull: "full_pull",
      fetched: [],
      through: loggedWriter(rig.writer, log),
    });

    expect(log.toSorted()).toEqual([
      "agency-links of posting-2025r1-28997",
      "agency-links of version-2025r1-hb3027-introduced",
      `snapshot ${madeUpCommit}`,
    ]);
    expect(linksInChapterOfHeccLink(rig.reader, version)).toBe(23);
    expect(rig.reader.snapshotVersion(session)?.commit).toBe(madeUpCommit);
  });
});

describe("an Increment", () => {
  test("with the Snapshot the Index reports reads only the documents not yet read with it", async () => {
    const rig = await indexAfterFullPull(committedSnapshot(), introducedVersion());
    const log: string[] = [];

    const outcome = await runPull({
      rig,
      snapshot: committedSnapshot(),
      pull: "increment",
      fetched: [postedAmendment()],
      through: loggedWriter(rig.writer, log),
    });

    expect(outcome).toEqual({ kind: "read", statutesAffectedTable: undefined });
    expect(log).toEqual([
      "statute-links of a posting",
      "agency-links of posting-2025r1-28997",
      `snapshot ${committedCommit}`,
    ]);
    expect(documentsAmending418808(rig.reader)).toEqual(["posting-2025r1-28997"]);
  });

  test("under another Snapshot reads nothing and leaves the Snapshot the Index reports", async () => {
    const rig = await indexAfterFullPull(committedSnapshot(), introducedVersion());
    const version = introducedVersion().id;
    const log: string[] = [];

    const outcome = await runPull({
      rig,
      snapshot: madeUpSnapshot(),
      pull: "increment",
      fetched: [postedAmendment()],
      through: loggedWriter(rig.writer, log),
    });

    expect(outcome).toEqual({ kind: "left_to_full_pull" });
    expect(log).toEqual([]);
    expect(rig.reader.snapshotVersion(session)?.commit).toBe(committedCommit);
    // The Version keeps the reading it has, with the old section list, and the document the Increment stored has none.
    expect(sectionsAddedToIn345(rig.reader, version)).toHaveLength(22);
    expect(documentsAmending418808(rig.reader)).toEqual([]);
  });

  test("under another Snapshot is followed by a Full pull that reads every document with it and reports it", async () => {
    const rig = await indexAfterFullPull(committedSnapshot(), introducedVersion());
    const version = introducedVersion().id;
    await runPull({ rig, snapshot: madeUpSnapshot(), pull: "increment", fetched: [postedAmendment()] });

    await runPull({ rig, snapshot: madeUpSnapshot(), pull: "full_pull", fetched: [] });

    expect(sectionsAddedToIn345(rig.reader, version)).toHaveLength(23);
    expect(documentsAmending418808(rig.reader)).toEqual(["posting-2025r1-28997"]);
    expect(rig.reader.snapshotVersion(session)?.commit).toBe(madeUpCommit);
  });
});

// A Pull calls `finish` once. A second call is a bug in the Pull, so it throws and reads nothing more: here a document the
// Pull stores between the two calls stays unread, whichever way the first call went.
describe("finish, called a second time", () => {
  const posting = postedAmendment();

  describe.for([
    {
      pull: "a Full pull",
      snapshot: madeUpSnapshot,
      finishOf: (start: SnapshotReadStart) => {
        const read = beginFullPullSnapshotRead(start);
        return () => read.finish(undefined);
      },
    },
    {
      pull: "an Increment under the Snapshot the Index reports",
      snapshot: committedSnapshot,
      finishOf: (start: SnapshotReadStart) => {
        const read = beginIncrementSnapshotRead(start);
        return () => read.finish();
      },
    },
    {
      pull: "an Increment under another Snapshot",
      snapshot: madeUpSnapshot,
      finishOf: (start: SnapshotReadStart) => {
        const read = beginIncrementSnapshotRead(start);
        return () => read.finish();
      },
    },
  ])("$pull", ({ snapshot, finishOf }) => {
    test("throws, and reads nothing the first call did not", async () => {
      const rig = await indexAfterFullPull(committedSnapshot(), introducedVersion());
      const finish = finishOf({ writer: rig.writer, session, snapshot: snapshot() });
      await finish();
      rig.writer.recordIncrement(
        session,
        incrementAt,
        pulledFeed({ CommitteeMeetings: [humanServicesMeeting], CommitteeProposedAmendments: [posting] }),
      );
      storeDocuments(rig.writer, posting);

      await expect(finish()).rejects.toThrow("finished already");

      expect(documentsAmending418808(rig.reader)).toEqual([]);
    });
  });
});

/** The Agency each of HB 3027's Testimony rows is stored with, by the row's feed id (`CommTestId`), as the Index holds them. */
function testimonyAgencies(reader: IndexReader): Record<number, string | null> {
  return Object.fromEntries(reader.findTestimony(hb3027).map((row) => [row.commTestId, row.agencyId]));
}

// The Agency a Testimony row's Organization names is matched when the Pull stores the row, with the Snapshot's registry
// (ADR-0016), and an Increment under a Snapshot other than the one the Index reports leaves it to the next Full pull
// (ADR-0047). MADE-UP rows: 900101 and 900102 are not rows of the feed. The Organization "MADE UP Wage Office" is an alias
// of the Bureau of Labor and Industries in the made-up Snapshot and in no registry of the committed one.
describe("Testimony's Agency", () => {
  const withWageOffice = (): Snapshot => madeUpSnapshot(giveBureauTheWageOfficeAlias);

  test("is matched by a Full pull with the Snapshot it reads with, though the Index reports another until the pull ends", async () => {
    const rig = await indexAfterFullPull(committedSnapshot());

    await runPull({
      rig,
      snapshot: withWageOffice(),
      pull: "full_pull",
      fetched: [],
      testimony: [testimonyRow(900101, wageOffice), testimonyRow(900102, "Department of Human Services")],
    });

    expect(testimonyAgencies(rig.reader)).toEqual({ 900101: boli, 900102: dhs });
  });

  test("is matched by an Increment with the registry of the Snapshot the Index reports, for a row new to the Index", async () => {
    const rig = await indexAfterFullPull(committedSnapshot());

    await runPull({
      rig,
      snapshot: committedSnapshot(),
      pull: "increment",
      fetched: [],
      testimony: [testimonyRow(900101, wageOffice), testimonyRow(900102, "Bureau of Labor and Industries")],
    });

    // The committed registry names the Bureau by its name and the Wage Office by nothing.
    expect(testimonyAgencies(rig.reader)).toEqual({ 900101: null, 900102: boli });
  });

  test("is left alone by an Increment under another Snapshot: a row the Index holds keeps its Agency, and a new row has none", async () => {
    const rig = newIndex();
    await runPull({
      rig,
      snapshot: committedSnapshot(),
      pull: "full_pull",
      fetched: [],
      testimony: [testimonyRow(900101, "Department of Human Services")],
    });
    expect(testimonyAgencies(rig.reader)).toEqual({ 900101: dhs });

    // The Increment reads the held row again with another Organization, which the made-up registry gives to the Bureau,
    // and a new row with that Organization: a match with the Snapshot file's registry would store the Bureau for both.
    await runPull({
      rig,
      snapshot: withWageOffice(),
      pull: "increment",
      fetched: [],
      testimony: [testimonyRow(900101, wageOffice), testimonyRow(900102, wageOffice)],
    });

    expect(testimonyAgencies(rig.reader)).toEqual({ 900101: dhs, 900102: null });
    expect(rig.reader.findTestimony(hb3027).find((row) => row.commTestId === 900101)?.organization).toBe(wageOffice);
    expect(rig.reader.snapshotVersion(session)?.commit).toBe(committedCommit);
  });

  test("is matched for every row by the Full pull that follows, which reports the Snapshot", async () => {
    const rig = newIndex();
    const held = testimonyRow(900101, wageOffice);
    const rows = [held, testimonyRow(900102, wageOffice)];
    await runPull({ rig, snapshot: committedSnapshot(), pull: "full_pull", fetched: [], testimony: [held] });
    await runPull({ rig, snapshot: withWageOffice(), pull: "increment", fetched: [], testimony: rows });
    expect(testimonyAgencies(rig.reader)).toEqual({ 900101: null, 900102: null });

    await runPull({ rig, snapshot: withWageOffice(), pull: "full_pull", fetched: [], testimony: rows });

    expect(testimonyAgencies(rig.reader)).toEqual({ 900101: boli, 900102: boli });
    expect(rig.reader.snapshotVersion(session)?.commit).toBe(madeUpCommit);
  });
});

/** What the Index holds of the made-up table for HB 3027: the number of its entries, where it came from and when. */
function heldTableOf(reader: IndexReader): { entries: number; sourceUrl: string; retrievedAt: string } | undefined {
  const table = reader.statutesAffectedTableOf(hb3027);
  return table === undefined
    ? undefined
    : { entries: table.entries.length, sourceUrl: table.sourceUrl, retrievedAt: table.retrievedAt };
}

/** An Index that holds the made-up table, read with the committed Snapshot: its series gives 22 entries. */
async function indexHoldingTable(reading: Parameters<typeof storeHeldTable>[2] = {}): Promise<IndexRig> {
  const rig = newIndex();
  await runPull({ rig, snapshot: committedSnapshot(), pull: "full_pull", fetched: [] });
  storeHeldTable(rig.writer, committedSnapshot(), reading);
  expect(heldTableOf(rig.reader)).toEqual({
    entries: reading.entriesLeftOut === true ? 0 : 22,
    sourceUrl: tableUrl,
    retrievedAt: heldTableRetrievedAt,
  });
  return rig;
}

// The Statutes Affected Table's series are expanded against the Snapshot's section list, so a Full pull with a new Snapshot
// reads the held table again with it, in the Snapshot read and before the Snapshot is reported (ADR-0044). The Pull fetches
// the table and hands the Snapshot read what it got. The held table is MADE UP (`snapshot-read-arranged.ts`): one series,
// 345.010 to 345.340, which the committed Snapshot expands to 22 entries and the made-up one to 23.
describe("the Statutes Affected Table", () => {
  const stillHeld = { sourceUrl: tableUrl, retrievedAt: heldTableRetrievedAt };

  describe.for([
    { failure: "answers 404", status: 404, outcome: "not_published", reason: "The server answered 404" },
    {
      failure: "keeps failing",
      status: 503,
      outcome: "not_fetched",
      reason: "MADE UP: the server answered 503 three times",
    },
  ])("when the server $failure", ({ status, outcome, reason }) => {
    test("a new Snapshot reads the held table again from the held copy, and keeps the copy as it was", async () => {
      const rig = await indexHoldingTable();

      const read = await runPull({
        rig,
        snapshot: madeUpSnapshot(),
        pull: "full_pull",
        fetched: [],
        table: tableNotFetched(status, reason),
      });

      expect(read).toEqual({
        kind: "read",
        statutesAffectedTable: {
          source_url: tableUrl,
          outcome: "read_again_from_held_copy",
          held: true,
          entries: 23,
          previous_session_entries: 0,
          unread_lines: 0,
          lone_e_entries: 0,
          lone_e_with_e_engrossed_version: 0,
          reason,
        },
      });
      expect(heldTableOf(rig.reader)).toEqual({ entries: 23, ...stillHeld });
    });

    test("the same Snapshot leaves the held table as it is and says why the table was not fetched", async () => {
      const rig = await indexHoldingTable();

      const read = await runPull({
        rig,
        snapshot: committedSnapshot(),
        pull: "full_pull",
        fetched: [],
        table: tableNotFetched(status, reason),
      });

      expect(read).toEqual({
        kind: "read",
        statutesAffectedTable: {
          source_url: tableUrl,
          outcome,
          held: true,
          ...(status === 404 ? {} : { reason }),
        },
      });
      expect(heldTableOf(rig.reader)).toEqual({ entries: 22, ...stillHeld });
    });
  });
  describe("when the server gives bytes that are no table", () => {
    test("a new Snapshot reads the held table again for the refusal's sake, keeps the copy, and remembers the refusal", async () => {
      const rig = await indexHoldingTable();

      const first = await runPull({
        rig,
        snapshot: madeUpSnapshot(),
        pull: "full_pull",
        fetched: [],
        table: tableFetched(placeholderBytes),
      });

      // The refused bytes replace nothing; the held copy's text is read again with the new section list, and counted.
      expect(first).toEqual({
        kind: "read",
        statutesAffectedTable: {
          source_url: tableUrl,
          outcome: "not_read",
          held: true,
          entries: 23,
          previous_session_entries: 0,
          unread_lines: 0,
          lone_e_entries: 0,
          lone_e_with_e_engrossed_version: 0,
          reason: expect.stringContaining("is not a PDF the extractor can read") as unknown,
        },
      });
      expect(heldTableOf(rig.reader)).toEqual({ entries: 23, ...stillHeld });

      // The same bytes again, with the same Snapshot: the refusal is remembered, nothing is read, the copy is as it was.
      const again = await runPull({
        rig,
        snapshot: madeUpSnapshot(),
        pull: "full_pull",
        fetched: [],
        table: tableFetched(placeholderBytes),
      });

      expect(again).toEqual({
        kind: "read",
        statutesAffectedTable: {
          source_url: tableUrl,
          outcome: "refused_unchanged",
          held: true,
          reason: expect.stringContaining("is not a PDF the extractor can read") as unknown,
        },
      });
      expect(heldTableOf(rig.reader)).toEqual({ entries: 23, ...stillHeld });
    });

    test("stores nothing when the Index holds no table", async () => {
      const rig = await indexAfterFullPull(committedSnapshot());

      const read = await runPull({
        rig,
        snapshot: madeUpSnapshot(),
        pull: "full_pull",
        fetched: [],
        table: tableFetched(placeholderBytes),
      });

      expect(read).toEqual({
        kind: "read",
        statutesAffectedTable: {
          source_url: tableUrl,
          outcome: "not_read",
          held: false,
          reason: expect.stringContaining("is not a PDF the extractor can read") as unknown,
        },
      });
      expect(heldTableOf(rig.reader)).toBeUndefined();
    });
  });

  test("is read again before the new Snapshot is reported, and a run that stops there leaves the old one reported", async () => {
    const rig = await indexHoldingTable();
    const stopped = runPull({
      rig,
      snapshot: madeUpSnapshot(),
      pull: "full_pull",
      fetched: [],
      table: tableNotFetched(404, "The server answered 404"),
      through: stoppingAtTableEntries(rig.writer),
    });
    await expect(stopped).rejects.toThrow("The run stopped at the Statutes Affected Table");
    expect(rig.reader.snapshotVersion(session)?.commit).toBe(committedCommit);
    expect(heldTableOf(rig.reader)).toEqual({ entries: 22, ...stillHeld });
    const log: string[] = [];

    await runPull({
      rig,
      snapshot: madeUpSnapshot(),
      pull: "full_pull",
      fetched: [],
      table: tableNotFetched(404, "The server answered 404"),
      through: loggedWriter(rig.writer, log),
    });

    expect(log).toEqual(["table entries", `snapshot ${madeUpCommit}`]);
    expect(heldTableOf(rig.reader)).toEqual({ entries: 23, ...stillHeld });
    expect(rig.reader.snapshotVersion(session)?.commit).toBe(madeUpCommit);
  });

  test("is left alone when the Pull hands the Snapshot read no table, as when the deployment names none (ADR-0044)", async () => {
    const rig = await indexHoldingTable();

    const read = await runPull({ rig, snapshot: madeUpSnapshot(), pull: "full_pull", fetched: [] });

    expect(read).toEqual({ kind: "read", statutesAffectedTable: undefined });
    expect(heldTableOf(rig.reader)).toEqual({ entries: 22, ...stillHeld });
  });
});

function failed(message: string): never {
  throw new Error(message);
}
