// Seam 1 (test/CLAUDE.md): `find_measures` on values the committed fixture lacks. Each case builds its own system,
// because the feed it needs is the thing under test. A row that a case adds is MADE UP (a `strayRows` row of the fake
// OLIS, shaped like feed/CommitteePublicTestimonies.json's) and is said so in the case's comment. The cases that read
// the fixture as it stands are in find-measures.test.ts and find-measures-since.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type Era } from "../support/mcp-clients.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";
import { madeUpTestimonyRow } from "../support/testimony.ts";

vi.setConfig({ testTimeout: 60_000 });

const started: System[] = [];

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

type Item = {
  id: string;
  evidence_total: number;
  evidence: { document_id: string; organization?: string }[];
};
type Group = { evidence_kind: string; total: number; items: Item[] };
type Found = { total: number; page: number; last_page: number; page_size: number; groups: Group[] };

async function find(system: System, era: Era, args: Record<string, unknown>) {
  const connected = await connectClient(era, system.handler);
  try {
    return await callTool(connected, "find_measures", args);
  } finally {
    await connected.close();
  }
}

// MADE UP: 60 Testimony rows (CommTestId 900001 to 900060), each from the Bureau of Labor and Industries ("Organization")
// on a Measure of its own (SB 9001 to SB 9060), and 12 rows (900101 to 900112) on SB 9100. Each row was created
// 2025-06-05 at 17:31:25.087 (test/support/testimony.ts). With SB 69's Testimony 196915, created 2025-04-21 and the
// Bureau's only real Testimony in the fixture, the Bureau has 62 Measures with Testimony. The files are not served, so
// no Version or statement exists and no other group has an item: the pull stores the rows from the feed alone.
describe.for(eras)("find_measures past one page, for a %s client", (era) => {
  const boli = "Bureau of Labor and Industries";
  const rows = [
    ...Array.from({ length: 60 }, (_, index) =>
      madeUpTestimonyRow({
        commTestId: 900001 + index,
        organization: boli,
        measure: { prefix: "SB", number: 9001 + index },
      }),
    ),
    ...Array.from({ length: 12 }, (_, index) =>
      madeUpTestimonyRow({
        commTestId: 900101 + index,
        organization: boli,
        measure: { prefix: "SB", number: 9100 },
      }),
    ),
  ];

  async function start(): Promise<System> {
    const system = await startSystem({
      clockAt: "2025-07-15T17:00:00Z",
      olis: { strayRows: { CommitteePublicTestimonies: rows } },
      serverEnv: { MCP_RATE_LIMIT: "1000" },
    });
    started.push(system);
    return system;
  }

  it("lists 50 items on the first page, counted across the groups, and says how many pages there are", async () => {
    const system = await start();

    const outcome = await find(system, era, { agency: "bureau-of-labor-and-industries" });

    expect(outcome.isError, outcome.text).toBe(false);
    const found = outcome.structured as unknown as Found;
    expect([found.total, found.page, found.last_page, found.page_size]).toEqual([62, 1, 2, 50]);
    const testimony = found.groups.find((group) => group.evidence_kind === "testimony");
    expect(testimony?.total).toBe(62);
    expect(testimony?.items).toHaveLength(50);
    // Made-up rows share one creation time, so they come in the order of their ids.
    expect(testimony?.items.map((item) => item.id).slice(0, 3)).toEqual([
      "measure-2025r1-sb9001",
      "measure-2025r1-sb9002",
      "measure-2025r1-sb9003",
    ]);
    expect(testimony?.items.at(-1)?.id).toBe("measure-2025r1-sb9050");
  });

  it("lists the rest on the next page: the later ids, then the older Testimony last", async () => {
    const system = await start();

    const outcome = await find(system, era, { agency: "bureau-of-labor-and-industries", page: 2 });

    const found = outcome.structured as unknown as Found;
    expect(found.page).toBe(2);
    const testimony = found.groups.find((group) => group.evidence_kind === "testimony");
    expect(testimony?.items.map((item) => item.id)).toEqual([
      ...Array.from({ length: 10 }, (_, index) => `measure-2025r1-sb${9051 + index}`),
      "measure-2025r1-sb9100",
      "measure-2025r1-sb69",
    ]);
    expect(
      found.groups.filter((group) => group.evidence_kind !== "testimony").every((group) => group.total === 0),
    ).toBe(true);
  });

  it("limits an item's evidence to ten pieces and says how many there are", async () => {
    const system = await start();

    const outcome = await find(system, era, { agency: "bureau-of-labor-and-industries", page: 2 });

    const found = outcome.structured as unknown as Found;
    const item = found.groups
      .find((group) => group.evidence_kind === "testimony")
      ?.items.find((candidate) => candidate.id === "measure-2025r1-sb9100");
    expect(item?.evidence_total).toBe(12);
    expect(item?.evidence.map((evidence) => evidence.document_id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `testimony-2025r1-${900101 + index}`),
    );
  });

  it("refuses a page past the last, saying how many there are", async () => {
    const system = await start();

    const outcome = await find(system, era, { agency: "bureau-of-labor-and-industries", page: 3 });

    expect(outcome.isError).toBe(true);
    expect(outcome.text).toBe("The answer has 2 pages, so there is no page 3. Ask for a page from 1 to 2.");
  });
});

// Spec #1's seam-1 pattern: run the worker, call the tools, move the clock, run the worker again and call them again.
// SB 69's Fiscal Impact Statement 85414 (label "A", created 2025-01-30) names the Bureau of Labor and Industries. On
// 2025-01-31 the feed lists no A-Engrossed Version, which OLIS created on 2025-02-03, so the statement is on the Measure;
// once a pull sees the Version, the statement is on it, and the Version's own links are read from its text.
describe.for(eras)("find_measures after the clock moves and the worker pulls again, for a %s client", (era) => {
  const boli = "bureau-of-labor-and-industries";

  async function startAt(clockAt: string): Promise<System> {
    const options: SystemOptions = { clockAt, documents: true, serverEnv: { MCP_RATE_LIMIT: "1000" } };
    const system = await startSystem(options);
    started.push(system);
    return system;
  }

  it("moves the statement's link from the Measure to the Version the pull then lists, and reads the Version's links", async () => {
    const system = await startAt("2025-01-31T20:00:00Z");

    const before = (await find(system, era, { agency: boli, since: "2025-01-30" })).structured as unknown as Found;
    system.clock.set("2025-02-04T20:00:00Z");
    await system.pullAgain();
    const after = (await find(system, era, { agency: boli, since: "2025-01-30" })).structured as unknown as Found;

    const idsOf = (found: Found, kind: string): string[] =>
      found.groups.find((group) => group.evidence_kind === kind)?.items.map((item) => item.id) ?? [];
    expect([idsOf(before, "fiscal-impact-statement"), idsOf(before, "derived")]).toEqual([["measure-2025r1-sb69"], []]);
    expect([idsOf(after, "fiscal-impact-statement"), idsOf(after, "derived")]).toEqual([
      ["version-2025r1-sb69-a-engrossed"],
      ["version-2025r1-sb69-a-engrossed"],
    ]);
  });

  it("changes nothing when the worker pulls the same feed again", async () => {
    const system = await startAt("2025-02-04T20:00:00Z");

    const before = await find(system, era, { agency: boli });
    await system.pullAgain();
    const after = await find(system, era, { agency: boli });

    expect(before.isError).toBe(false);
    expect(after.text).toBe(before.text);
  });
});

// A Proposed Amendment is posted to more than one meeting, and a posting can hold a different text (spec #1 module 8:
// "if the text differs between postings, each document is kept"). `since` asks what was posted since a time that
// touches an Agency's statutes or names it, so an amendment is dated by the latest posting whose own file carries that
// evidence: the same file, or a file that reads the same. A posting of a different file does not date what it does
// not hold (#16 F2). Both rows below are MADE UP, shaped like feed/CommitteeProposedAmendments.json's SB 69 rows, filed
// to SLB's real meeting of 2025-01-30 (agenda item 202165), and created on 2025-01-24, a day after the real postings.
//   990101: SB 69-1 again, created 2025-01-24 at 08:00, served with the file of SB 921-2 (proposed-amendments/26923.pdf),
//     whose text names no Bureau of Labor and Industries and no section of ORS 653 (pdftotext).
//   990102: SB 69-2 again, created 2025-01-24 at 09:00, served with the file of SB 69-2's own posting 26286.
// The clock is Friday 2025-01-24 at noon Pacific.
describe.for(eras)(
  "find_measures dates a Proposed Amendment by the postings that hold the evidence, for a %s client",
  (era) => {
    const boli = "bureau-of-labor-and-industries";
    const root = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/ProposedAmendment";
    const repostingRow = (id: number, number: string, createdDate: string): Record<string, unknown> => ({
      ProposedAmendmentId: id,
      CommitteeAgendaItemId: 202165,
      SessionKey: "2025R1",
      CommitteeCode: "SLB",
      MeetingDate: "2025-01-30T08:00:00",
      MeasurePrefix: "SB",
      MeasureNumber: 69,
      AmendmentNumber: number,
      Meaning: "Proposed",
      ProposedAmendmentUrl: `${root}/${id}`,
      CreatedDate: createdDate,
      ModifiedDate: null,
    });

    async function start(): Promise<System> {
      const system = await startSystem({
        clockAt: "2025-01-24T20:00:00Z",
        documents: true,
        serverEnv: { MCP_RATE_LIMIT: "1000" },
        olis: {
          strayRows: {
            CommitteeProposedAmendments: [
              repostingRow(990101, "-1", "2025-01-24T08:00:00"),
              repostingRow(990102, "-2", "2025-01-24T09:00:00"),
            ],
          },
          strayDocuments: {
            "/liz/2025R1/Downloads/ProposedAmendment/990101": "proposed-amendments/26923.pdf",
            "/liz/2025R1/Downloads/ProposedAmendment/990102": "proposed-amendments/26286.pdf",
          },
        },
      });
      started.push(system);
      return system;
    }

    type Dated = { id: string; posted_at: string | null; last_posted_at: string | null };
    const datedOf = (found: Found, kind: string): [string, string | null][] =>
      (found.groups.find((group) => group.evidence_kind === kind)?.items as Dated[] | undefined)?.map((item) => [
        item.id,
        item.last_posted_at,
      ]) ?? [];

    it("lists SB 69-2, whose reposted file reads the same, and not SB 69-1, whose reposted file holds none of the evidence", async () => {
      const system = await start();

      const outcome = await find(system, era, { agency: boli, since: "2025-01-24" });

      expect(outcome.isError, outcome.text).toBe(false);
      const found = outcome.structured as unknown as Found;
      expect(datedOf(found, "derived")).toEqual([["amendment-2025r1-sb69-2", "2025-01-24T09:00:00-08:00"]]);
      expect(datedOf(found, "named-in-text")).toEqual([["amendment-2025r1-sb69-2", "2025-01-24T09:00:00-08:00"]]);
    });

    it("dates SB 69-1 by its last posting that holds the evidence, though a later posting of another file exists", async () => {
      const system = await start();

      const outcome = await find(system, era, { agency: boli, since: "2025-01-23" });

      const found = outcome.structured as unknown as Found;
      expect(datedOf(found, "derived")).toEqual([
        ["amendment-2025r1-sb69-2", "2025-01-24T09:00:00-08:00"],
        ["amendment-2025r1-sb69-1", "2025-01-23T16:27:37.06-08:00"],
      ]);
      expect(datedOf(found, "named-in-text")).toEqual([
        ["amendment-2025r1-sb69-2", "2025-01-24T09:00:00-08:00"],
        ["amendment-2025r1-sb69-1", "2025-01-23T16:27:37.06-08:00"],
      ]);
    });

    it("dates a Statute Link of an ORS section the same way", async () => {
      const system = await start();

      const outcome = await find(system, era, { ors_section: "ORS 653.616", since: "2025-01-24" });

      const found = outcome.structured as unknown as Found;
      expect(datedOf(found, "statute-link")).toEqual([["amendment-2025r1-sb69-2", "2025-01-24T09:00:00-08:00"]]);
    });
  },
);
