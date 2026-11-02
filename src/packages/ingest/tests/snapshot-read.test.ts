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
import type { IndexWriter } from "#/packages/database/writer.ts";
import type { DocumentId, DocumentLink, StoredDocument } from "#/packages/domain/documents.ts";
import { parseAgencyId, parseOrsChapterId, parseOrsSectionId } from "#/packages/domain/oregonai.ts";
import type { Snapshot } from "#/packages/oregonai-snapshot/index.ts";
import { beginSnapshotRead, type PullKind, type SnapshotReadOutcome } from "../snapshot-read.ts";
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
  postedAmendment,
  pulledFeed,
  session,
  stoppingBeforeAgencyLinks,
  storeDocuments,
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

type Pull = {
  rig: IndexRig;
  snapshot: Snapshot;
  pull: PullKind;
  /** The documents this Pull fetches and stores. */
  fetched: StoredDocument[];
  /** The Testimony rows the feed lists in this Pull. */
  testimony?: DocumentLink[];
  /** What the Snapshot read stores through: the Index's writer, unless a case watches it or stops it. */
  through?: IndexWriter;
};

/**
 * A Pull as `ingest/index.ts` runs it: the Snapshot read begins, the feed and the documents it fetched are stored, and the
 * Snapshot read finishes.
 */
function runPull({ rig, snapshot, pull, fetched, testimony = [], through }: Pull): Promise<SnapshotReadOutcome> {
  const read = beginSnapshotRead({ writer: through ?? rig.writer, session, snapshot, pull });
  const links = [...fetched, ...testimony];
  const feed = pulledFeed({
    meetings: [humanServicesMeeting],
    documentLinks: links,
    testimony: read.testimonyRecordsOf(links),
  });
  if (pull === "full_pull") rig.writer.recordFullPull(session, fullPullAt, feed);
  else rig.writer.recordIncrement(session, incrementAt, feed);
  storeDocuments(rig.writer, ...fetched);
  return read.finish();
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

  test("reads every Version's and posting's Statute Links, then every one's Agency Links, and reports the new Snapshot last", async () => {
    const rig = await indexAfterFullPull(committedSnapshot(), introducedVersion(), postedAmendment());
    expect(rig.reader.snapshotVersion(session)?.commit).toBe(committedCommit);
    const log: string[] = [];

    await runPull({
      rig,
      snapshot: madeUpSnapshot(),
      pull: "full_pull",
      fetched: [],
      through: loggedWriter(rig.writer, log),
    });

    // A file is read once for Statute Links, and a document once for Agency Links; which of the two goes first within a
    // step is the store's order. What the step holds is the order between them, then the Snapshot.
    expect(log.slice(0, 2).toSorted()).toEqual(["statute-links of a posting", "statute-links of a version"]);
    expect(log.slice(2, 4).toSorted()).toEqual([
      "agency-links of posting-2025r1-28997",
      "agency-links of version-2025r1-hb3027-introduced",
    ]);
    expect(log.slice(4)).toEqual([`snapshot ${madeUpCommit}`]);
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

    expect(outcome).toEqual({ kind: "read" });
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

function failed(message: string): never {
  throw new Error(message);
}
