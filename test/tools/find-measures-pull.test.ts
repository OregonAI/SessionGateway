// Seam 1 (test/CLAUDE.md): `find_measures` on values the committed fixture lacks. Each case builds its own system,
// because the feed it needs is the thing under test. A row that a case adds is MADE UP (a `strayRows` row of the fake
// OLIS, shaped like feed/CommitteePublicTestimonies.json's) and is said so in the case's comment. The cases that read
// the fixture as it stands are in find-measures.test.ts and find-measures-since.test.ts.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type Era } from "../support/mcp-clients.ts";
import { snapshotFixturePath } from "../support/oregonai-snapshot.ts";
import { lazySystemTemplate, startSystem, type System, type SystemOptions } from "../support/system.ts";
import { madeUpTestimonyRow } from "../support/testimony.ts";

vi.setConfig({ testTimeout: 60_000 });

const started: System[] = [];

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

type Example = {
  document_id: string;
  organization?: string;
  through?: string[];
  through_total?: number;
  created_at?: string;
};
type KindEvidence = { kind: string; count: number; left_out: number; examples: Example[] };
type Item = {
  id: string;
  created_at: string | null;
  last_created_at: string | null;
  evidence: KindEvidence[];
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

  // The four cases only read, so they copy one database (test/CLAUDE.md, "Database").
  const template = lazySystemTemplate(
    {
      clockAt: "2025-07-15T17:00:00Z",
      olis: { strayRows: { CommitteePublicTestimonies: rows } },
      serverEnv: { MCP_RATE_LIMIT: "1000" },
    },
    "past-one-page",
  );
  afterAll(() => template.remove());

  async function start(): Promise<System> {
    const system = await template.start();
    started.push(system);
    return system;
  }

  it("lists 12 items on the first page and says how many pages there are", async () => {
    const system = await start();

    const outcome = await find(system, era, { agency: "bureau-of-labor-and-industries" });

    expect(outcome.isError, outcome.text).toBe(false);
    const found = outcome.structured as unknown as Found;
    expect([found.total, found.page, found.last_page, found.page_size]).toEqual([62, 1, 6, 12]);
    const testimony = found.groups.find((group) => group.evidence_kind === "testimony");
    expect(testimony?.total).toBe(62);
    expect(testimony?.items).toHaveLength(12);
    // Made-up rows share one creation time, so they come in the order of their ids.
    expect(testimony?.items.map((item) => item.id).slice(0, 3)).toEqual([
      "measure-2025r1-sb9001",
      "measure-2025r1-sb9002",
      "measure-2025r1-sb9003",
    ]);
    expect(testimony?.items.at(-1)?.id).toBe("measure-2025r1-sb9012");
  });

  it("lists the rest on the last page: the later ids, then the older Testimony last", async () => {
    const system = await start();

    const outcome = await find(system, era, { agency: "bureau-of-labor-and-industries", page: 6 });

    const found = outcome.structured as unknown as Found;
    expect(found.page).toBe(6);
    const testimony = found.groups.find((group) => group.evidence_kind === "testimony");
    expect(testimony?.items.map((item) => item.id)).toEqual(["measure-2025r1-sb9100", "measure-2025r1-sb69"]);
    expect(
      found.groups.filter((group) => group.evidence_kind !== "testimony").every((group) => group.total === 0),
    ).toBe(true);
  });

  it("limits an item's evidence to three examples, the newest first, and counts the rest", async () => {
    const system = await start();

    const outcome = await find(system, era, { agency: "bureau-of-labor-and-industries", page: 6 });

    const found = outcome.structured as unknown as Found;
    const item = found.groups
      .find((group) => group.evidence_kind === "testimony")
      ?.items.find((candidate) => candidate.id === "measure-2025r1-sb9100");
    // Twelve rows made at one time: the cut keeps the first three by the feed's number.
    expect(item?.evidence.map((group) => [group.kind, group.count, group.left_out])).toEqual([["testimony", 12, 9]]);
    expect(item?.evidence[0]?.examples.map((example) => example.document_id)).toEqual(
      Array.from({ length: 3 }, (_, index) => `testimony-2025r1-${900101 + index}`),
    );
  });

  it("refuses a page past the last, saying how many there are", async () => {
    const system = await start();

    const outcome = await find(system, era, { agency: "bureau-of-labor-and-industries", page: 7 });

    expect(outcome.isError).toBe(true);
    expect(outcome.text).toBe("The answer has 6 pages, so there is no page 7. Ask for a page from 1 to 6.");
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

    const template = lazySystemTemplate(
      {
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
      },
      "postings-dated",
    );
    afterAll(() => template.remove());

    async function start(): Promise<System> {
      const system = await template.start();
      started.push(system);
      return system;
    }

    type Dated = { id: string; created_at: string | null; last_created_at: string | null };
    const datedOf = (found: Found, kind: string): [string, string | null][] =>
      (found.groups.find((group) => group.evidence_kind === kind)?.items as Dated[] | undefined)?.map((item) => [
        item.id,
        item.last_created_at,
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

// With `since`, an item lists only the evidence posted at or after it, and a cap keeps the newest first and says how many
// it left out (#16 F4). MADE UP Testimony from the Bureau of Labor and Industries (rows of test/support/testimony.ts, each
// with a CreatedDate of its own), on Measures the fixture lacks:
//   SB 9300: 900301 to 900310 created 2025-03-01 at 09:00, 900311 created 2025-04-01 at 09:00 (the review's probe);
//   SB 9400: 900401 to 900412, one an hour from 09:00 to 20:00 on 2025-03-02.
// The clock is 2025-07-15, after all of them.
describe.for(eras)("find_measures lists the newest evidence, for a %s client", (era) => {
  const boli = "Bureau of Labor and Industries";
  const row = (commTestId: number, sb: number, createdDate: string): Record<string, unknown> => ({
    ...madeUpTestimonyRow({ commTestId, organization: boli, measure: { prefix: "SB", number: sb } }),
    CreatedDate: createdDate,
  });
  const rows = [
    ...Array.from({ length: 10 }, (_, index) => row(900301 + index, 9300, "2025-03-01T09:00:00")),
    row(900311, 9300, "2025-04-01T09:00:00"),
    ...Array.from({ length: 12 }, (_, index) =>
      row(900401 + index, 9400, `2025-03-02T${String(9 + index).padStart(2, "0")}:00:00`),
    ),
  ];

  const template = lazySystemTemplate(
    {
      clockAt: "2025-07-15T17:00:00Z",
      olis: { strayRows: { CommitteePublicTestimonies: rows } },
      serverEnv: { MCP_RATE_LIMIT: "1000" },
    },
    "newest-evidence",
  );
  afterAll(() => template.remove());

  async function itemsAfter(args: Record<string, unknown>): Promise<Item[]> {
    const system = await template.start();
    started.push(system);
    const outcome = await find(system, era, { agency: "bureau-of-labor-and-industries", ...args });
    expect(outcome.isError, outcome.text).toBe(false);
    const found = outcome.structured as unknown as Found;
    return found.groups.find((group) => group.evidence_kind === "testimony")?.items ?? [];
  }
  const ids = (item: Item | undefined): string[] =>
    item?.evidence.flatMap((group) => group.examples.map((example) => example.document_id)) ?? [];
  const countOf = (item: Item | undefined): [number | undefined, number | undefined] => [
    item?.evidence[0]?.count,
    item?.evidence[0]?.left_out,
  ];
  const testimonyIds = (first: number, last: number): string[] =>
    Array.from({ length: last - first + 1 }, (_, index) => `testimony-2025r1-${first + index}`);

  it("shows only the Testimony created since the time asked for, and dates the item by it", async () => {
    const items = await itemsAfter({ since: "2025-04-01" });

    const item = items.find((candidate) => candidate.id === "measure-2025r1-sb9300");
    expect(ids(item)).toEqual(["testimony-2025r1-900311"]);
    expect(countOf(item)).toEqual([1, 0]);
    expect([item?.created_at, item?.last_created_at]).toEqual([
      "2025-04-01T09:00:00-07:00",
      "2025-04-01T09:00:00-07:00",
    ]);
  });

  it("keeps the newest evidence when it cuts, and says how many it left out", async () => {
    const items = await itemsAfter({});

    const item = items.find((candidate) => candidate.id === "measure-2025r1-sb9300");
    expect(ids(item)).toEqual(["testimony-2025r1-900311", "testimony-2025r1-900301", "testimony-2025r1-900302"]);
    expect(countOf(item)).toEqual([11, 8]);
    const later = items.find((candidate) => candidate.id === "measure-2025r1-sb9400");
    expect(ids(later)).toEqual(testimonyIds(900410, 900412).toReversed());
    expect(countOf(later)).toEqual([12, 9]);
  });

  it("cuts only what was created since the time asked for, newest first", async () => {
    const items = await itemsAfter({ since: "2025-03-02T18:00:00" });

    const item = items.find((candidate) => candidate.id === "measure-2025r1-sb9400");
    expect(ids(item)).toEqual(testimonyIds(900410, 900412).toReversed());
    expect(countOf(item)).toEqual([3, 0]);
    expect([item?.created_at, item?.last_created_at]).toEqual([
      "2025-03-02T18:00:00-08:00",
      "2025-03-02T20:00:00-08:00",
    ]);
    expect(items.some((candidate) => candidate.id === "measure-2025r1-sb9300")).toBe(true);
  });
});

// A page is bounded (#16 F6): a full page, with every item at its evidence cap, stays at or under about 25,000 characters,
// which is what a page of `testimony` is (src/packages/mcp-server/lib/testimony.ts) and a little over one part of
// get_document (20,000). Three full pages of MADE UP rows, each the largest kind of item the fixture can be made to give:
//   Testimony: 80 Measures (SB 9601 to SB 9680) with 12 Testimony rows each (900601 and up), from the Organization with the
//     longest name in the snapshot fixture (96 characters), so that every item is cut at its evidence cap;
//   derived, the Bureau: 60 Proposed Amendments of SB 69 (SB 69-3 to -62: rows 990201 to 990260, created 2026-01-01 at 08:00,
//     each served with the file of SB 69-2, 26286.pdf), each reaching chapters 657B, 659A and 653, which the Bureau's rules implement;
//   derived, the Department of Human Services: the same 60 amendments, each reaching chapter 659A through its sub-unit
//     (department-of-human-services-aging-and-people-with-disabilities-and-developmental-disabilities, 94 characters), so
//     that the link says `through` it.
// The clock is 2026-08-01.
describe.for(eras)("find_measures stays inside a page's size, for a %s client", (era) => {
  const longest = "Higher Education Coordinating Commission, Office of Community Colleges and Workforce Development";
  const longestSlug = "higher-education-coordinating-commission-office-of-community-colleges-and-workforce-development";
  const testimony = Array.from({ length: 80 }, (_, measure) =>
    Array.from({ length: 12 }, (_, row) =>
      madeUpTestimonyRow({
        commTestId: 900601 + measure * 12 + row,
        organization: longest,
        measure: { prefix: "SB", number: 9601 + measure },
      }),
    ),
  ).flat();
  const amendments = Array.from({ length: 60 }, (_, index) => ({
    ProposedAmendmentId: 990201 + index,
    CommitteeAgendaItemId: 202165,
    SessionKey: "2025R1",
    CommitteeCode: "SLB",
    MeetingDate: "2025-01-30T08:00:00",
    MeasurePrefix: "SB",
    MeasureNumber: 69,
    AmendmentNumber: `-${3 + index}`,
    Meaning: "Proposed",
    ProposedAmendmentUrl: `https://olis.oregonlegislature.gov/liz/2025R1/Downloads/ProposedAmendment/${990201 + index}`,
    CreatedDate: "2026-01-01T08:00:00",
    ModifiedDate: null,
  }));

  const template = lazySystemTemplate(
    {
      clockAt: "2026-08-01T17:00:00Z",
      documents: true,
      serverEnv: { MCP_RATE_LIMIT: "1000" },
      olis: {
        strayRows: { CommitteePublicTestimonies: testimony, CommitteeProposedAmendments: amendments },
        strayDocuments: Object.fromEntries(
          amendments.map((row) => [
            `/liz/2025R1/Downloads/ProposedAmendment/${String(row["ProposedAmendmentId"])}`,
            "proposed-amendments/26286.pdf",
          ]),
        ),
      },
    },
    "page-size",
  );
  afterAll(() => template.remove());

  async function start(): Promise<System> {
    const system = await template.start();
    started.push(system);
    return system;
  }

  it.for([
    ["Testimony cut at the cap", longestSlug, "testimony"],
    ["three derived links, each dated", "bureau-of-labor-and-industries", "derived"],
    ["a derived link through a sub-unit", "department-of-human-services", "derived"],
  ] as const)("keeps a full page of %s to about 25,000 characters", async ([, agency, kind]) => {
    const system = await start();

    const outcome = await find(system, era, { agency });

    expect(outcome.isError, outcome.text).toBe(false);
    const found = outcome.structured as unknown as Found;
    const items = found.groups.find((group) => group.evidence_kind === kind)?.items ?? [];
    expect(found.total).toBeGreaterThan(found.page_size);
    expect(items).toHaveLength(found.page_size);
    expect(outcome.text.length).toBeLessThanOrEqual(25_000);
  });

  // The largest derived evidence a registry can give: a Department whose sub-units implement every chapter a Version
  // changes. MADE UP: a snapshot (the fixture's ORS sections) whose Chapter table gives chapters 653, 657B and 659A to five
  // sub-units of one Department, each with a 94-character slug (the longest in the registry is 95), so every derived link of
  // the Department says `through` three of them, and every item has three of those at its cap.
  const subUnits = Array.from({ length: 5 }, (_, index) =>
    `made-up-department-sub-unit-${index + 1}-with-a-slug-as-long-as-the-registry-has-b`.padEnd(94, "x"),
  );
  function madeUpDepartmentSnapshot(): { path: string; remove: () => void } {
    const fixture = JSON.parse(readFileSync(snapshotFixturePath, "utf8")) as { orsSections: string[] };
    const directory = mkdtempSync(join(tmpdir(), "made-up-department-snapshot-"));
    const path = join(directory, "snapshot.json");
    const row = (slug: string, name: string, parent: string | null): Record<string, unknown> => ({
      slug,
      name,
      aliases: [],
      oarChapter: null,
      dasAgencyNumber: null,
      parent,
    });
    writeFileSync(
      path,
      JSON.stringify({
        formatVersion: 1,
        version: {
          source: "executive-regulatory-frameworks",
          commit: "0123456789abcdef0123456789abcdef01234567",
          commitDate: "2026-02-03T04:05:06-08:00",
        },
        agencies: [
          row("made-up-department", "Made-Up Department", null),
          ...subUnits.map((slug, index) => row(slug, `Made-Up Sub-Unit ${index + 1}`, "made-up-department")),
        ],
        orsSections: fixture.orsSections,
        chapterAgencies: Object.fromEntries(
          ["ors-chapter-653", "ors-chapter-657b", "ors-chapter-659a"].map((chapter) => [chapter, subUnits]),
        ),
      }),
    );
    return {
      path,
      remove: () => {
        rmSync(directory, { recursive: true, force: true });
      },
    };
  }

  it("keeps a full page of a Department's derived links through five long-named sub-units to about 25,000 characters", async () => {
    const snapshot = madeUpDepartmentSnapshot();
    try {
      const system = await startSystem({
        clockAt: "2026-08-01T17:00:00Z",
        documents: true,
        snapshot: snapshot.path,
        serverEnv: { MCP_RATE_LIMIT: "1000" },
        olis: {
          strayRows: { CommitteeProposedAmendments: amendments },
          strayDocuments: Object.fromEntries(
            amendments.map((row) => [
              `/liz/2025R1/Downloads/ProposedAmendment/${String(row["ProposedAmendmentId"])}`,
              "proposed-amendments/26286.pdf",
            ]),
          ),
        },
      });
      started.push(system);

      const outcome = await find(system, era, { agency: "made-up-department" });

      expect(outcome.isError, outcome.text).toBe(false);
      const found = outcome.structured as unknown as Found;
      const derived = found.groups.find((group) => group.evidence_kind === "derived")?.items ?? [];
      expect(derived).toHaveLength(found.page_size);
      const examples = derived[0]?.evidence[0]?.examples;
      expect(examples).toHaveLength(3);
      expect(examples?.map((example) => [example.through?.length, example.through_total])).toEqual([
        [2, 5],
        [2, 5],
        [2, 5],
      ]);
      expect(outcome.text.length).toBeLessThanOrEqual(25_000);
    } finally {
      snapshot.remove();
    }
  });
});

// A page counts its items across the groups in their fixed order, so a page can end one group and start the next (#16 F9).
// The paging cases above fill only the last group. Here the Bureau of Labor and Industries has items in all four groups
// and a page boundary falls inside two of them. 20 MADE UP Proposed Amendments of SB 69 (SB 69-3 to -22: rows 990301 to
// 990320, created 2026-01-01 at 08:00, each served with the file of SB 69-2, 26286.pdf) add to the fixture's 12 items of
// the Bureau (6 derived, 1 Fiscal Impact Statement, 4 named in the text, 1 Testimony) 20 derived and 20 named in the text:
// 26, 1, 24 and 1 items, 52 in all, which are 5 pages of 12, 12, 12, 12 and 4.
describe.for(eras)("find_measures counts a page across the groups, for a %s client", (era) => {
  const amendments = Array.from({ length: 20 }, (_, index) => ({
    ProposedAmendmentId: 990301 + index,
    CommitteeAgendaItemId: 202165,
    SessionKey: "2025R1",
    CommitteeCode: "SLB",
    MeetingDate: "2025-01-30T08:00:00",
    MeasurePrefix: "SB",
    MeasureNumber: 69,
    AmendmentNumber: `-${3 + index}`,
    Meaning: "Proposed",
    ProposedAmendmentUrl: `https://olis.oregonlegislature.gov/liz/2025R1/Downloads/ProposedAmendment/${990301 + index}`,
    CreatedDate: "2026-01-01T08:00:00",
    ModifiedDate: null,
  }));

  const template = lazySystemTemplate(
    {
      clockAt: "2026-08-01T17:00:00Z",
      documents: true,
      serverEnv: { MCP_RATE_LIMIT: "1000" },
      olis: {
        strayRows: { CommitteeProposedAmendments: amendments },
        strayDocuments: Object.fromEntries(
          amendments.map((row) => [
            `/liz/2025R1/Downloads/ProposedAmendment/${String(row["ProposedAmendmentId"])}`,
            "proposed-amendments/26286.pdf",
          ]),
        ),
      },
    },
    "page-across-groups",
  );
  afterAll(() => template.remove());

  it("puts each item on one page, and the group a page starts in after the groups before it", async () => {
    const system = await template.start();
    started.push(system);

    const pages: Found[] = [];
    for (const page of [1, 2, 3, 4, 5]) {
      const outcome = await find(system, era, { agency: "bureau-of-labor-and-industries", page });
      expect(outcome.isError, outcome.text).toBe(false);
      pages.push(outcome.structured as unknown as Found);
    }

    const kinds = ["derived", "fiscal-impact-statement", "named-in-text", "testimony"];
    const countsOn = (found: Found): number[] =>
      kinds.map((kind) => found.groups.find((group) => group.evidence_kind === kind)?.items.length ?? 0);
    expect(pages.map((found) => [found.total, found.last_page])).toEqual([
      [52, 5],
      [52, 5],
      [52, 5],
      [52, 5],
      [52, 5],
    ]);
    expect(pages.map(countsOn)).toEqual([
      [12, 0, 0, 0],
      [12, 0, 0, 0],
      [2, 1, 9, 0],
      [0, 0, 12, 0],
      [0, 0, 3, 1],
    ]);
    // Every group's items are listed once across the pages, and the group totals are the same on every page.
    for (const [index, kind] of kinds.entries()) {
      const listed = pages.flatMap((found) => found.groups.find((group) => group.evidence_kind === kind)?.items ?? []);
      expect(new Set(listed.map((item) => item.id)).size).toBe(listed.length);
      expect(listed).toHaveLength([26, 1, 24, 1][index] ?? -1);
      for (const found of pages) {
        expect(found.groups.find((group) => group.evidence_kind === kind)?.total).toBe([26, 1, 24, 1][index]);
      }
    }
    // The page that ends the derived group starts the Fiscal Impact Statement group with SB 69's A-Engrossed Version.
    expect(pages[2]?.groups.find((group) => group.evidence_kind === "fiscal-impact-statement")?.items[0]?.id).toBe(
      "version-2025r1-sb69-a-engrossed",
    );
  });
});
