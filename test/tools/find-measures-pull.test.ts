// Seam 1 (test/CLAUDE.md): `find_measures` on values the committed fixture lacks. Each case builds its own system,
// because the feed it needs is the thing under test. A row that a case adds is MADE UP (a `strayRows` row of the fake
// OLIS, shaped like feed/CommitteePublicTestimonies.json's) and is said so in the case's comment. The cases that read
// the fixture as it stands are in find-measures.test.ts and find-measures-since.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type Era } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";
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
