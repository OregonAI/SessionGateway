// Seam 1: the labels of the feed's `Version` property that the committed fixture has no row for
// ("B*", "MRA", "MRB", "MRC", a letter whose Version the Measure lacks...), and a label OLIS changes
// after the file was fetched. The fixture is never edited by hand (test/fixtures/CLAUDE.md), so each
// case adds a feed row to the fake OLIS (`strayRows`), served with a fixture file (`strayDocuments`).
// EVERY ROW BELOW IS MADE UP: its id (9001xx), its Measure and its files are not the feed's. What is
// real is the label it carries: each one occurs in the full 2025R1 cache (olis-odata.md gotcha 9;
// docs/adr/0012 has the rows). Cases that only read the fixture are in get-measure-analysis.test.ts.
// The last case is a made-up Measure with no digest and no analysis documents.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, type ConnectedClient, type ToolOutcome } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

const clockAt = "2026-08-01T17:00:00Z";
const root = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads";

/** A made-up MeasureAnalysisDocuments row, shaped like the feed's (with `CommittteCode` and the string key). */
function analysisRow(
  id: number,
  measure: { prefix: string; number: number },
  version: string | null,
): Record<string, unknown> {
  return {
    MeasureAnalysisId: String(id),
    SessionKey: "2025R1",
    CommittteCode: "HALNRW",
    DocumentType: "Fiscal Impact Statement",
    MeasurePrefix: measure.prefix,
    MeasureNumber: measure.number,
    Version: version,
    IsMinority: false,
    DocumentUrl: `${root}/MeasureAnalysisDocument/${id}`,
    CreatedDate: "2025-02-12T10:00:00",
    ModifiedDate: null,
  };
}

/** The file every made-up analysis document is served as: HB 3131's real Fiscal Impact Statement. */
function strayFiles(ids: readonly number[]): Record<string, string> {
  return Object.fromEntries(
    ids.map((id) => [`/liz/2025R1/Downloads/MeasureAnalysisDocument/${id}`, "measure-analysis-documents/85869.pdf"]),
  );
}

type Unmapped = { id: string; type: string; version_label: string; unmapped_reason: string };
type Analysis = {
  by_version: { version_id: string; version: string; documents: { id: string; version_label: string }[] }[];
  unmapped: Unmapped[];
};

function analysisOf(outcome: ToolOutcome): Analysis {
  expect(outcome.isError).toBe(false);
  return outcome.structured?.["analysis_documents"] as Analysis;
}

describe("labels the fixture has no row for", () => {
  // HB 3131 lists one Version, Introduced (feed/MeasureDocuments.json). Each made-up row is its Fiscal
  // Impact Statement with another label. HB 3795 lists A-Engrossed and B-Engrossed, and the made-up
  // MeasureDocuments row 'C-Engrossed' below gives it a third.
  const hb3131 = { prefix: "HB", number: 3131 };
  const hb3795 = { prefix: "HB", number: 3795 };
  const rows: [id: number, label: string | null][] = [
    [900101, "B*"],
    [900102, "MRA"],
    [900103, "MRB"],
    [900104, "MRC"],
    [900105, "A"],
    [900106, "Z9"],
    [900107, null],
  ];
  const cEngrossedRow = {
    SessionKey: "2025R1",
    MeasurePrefix: "HB",
    MeasureNumber: 3795,
    VersionDescription: "C-Engrossed",
    DocumentUrl: `${root}/MeasureDocument/HB3795/C-Engrossed`,
    CreatedDate: "2025-06-01T10:00:00",
    ModifiedDate: null,
  };
  let system: System;
  let connected: ConnectedClient;

  beforeAll(async () => {
    system = await startSystem({
      clockAt,
      documents: true,
      olis: {
        strayRows: {
          MeasureAnalysisDocuments: [
            ...rows.map(([id, label]) => analysisRow(id, hb3131, label)),
            analysisRow(900108, hb3795, "C"),
          ],
          MeasureDocuments: [cEngrossedRow],
        },
        strayDocuments: {
          ...strayFiles([...rows.map(([id]) => id), 900108]),
          "/liz/2025R1/Downloads/MeasureDocument/HB3795/C-Engrossed": "measure-documents/HB3795/B-Engrossed.pdf",
        },
      },
    });
    connected = await connectClient("2026-07-28", system.handler);
  }, 60_000);

  afterAll(async () => {
    await connected.close();
    await system.stop();
  });

  async function unmappedOf(measure: string): Promise<Unmapped[]> {
    return analysisOf(await callTool(connected, "get_measure", { measure })).unmapped;
  }

  // Not placed on a Version, not dropped, and each says what the feed leaves unsaid. The reasons are
  // matched on the label they quote and on the fact they state, not word for word.
  it.for([
    ["B*", 900101, /"B\*".*asterisk/s],
    ["MRA", 900102, /"MRA".*minority report/s],
    ["MRB", 900103, /"MRB".*minority report/s],
    ["MRC", 900104, /"MRC".*minority report/s],
    // A Version the Measure lacks: HB 3131 has no A-Engrossed, so an edge to it would point at nothing.
    ["A", 900105, /"A".*A-Engrossed.*lists no A-Engrossed Version of HB 3131/s],
    ["Z9", 900106, /"Z9".*not one this service reads/s],
  ] as const)("lists the document labelled %s (made-up row %s) apart, with the reason", async ([label, id, reason]) => {
    const listed = (await unmappedOf("HB 3131")).find((document) => document.id === `analysis-2025r1-${id}`);

    expect(listed).toMatchObject({ type: "Fiscal Impact Statement", version_label: label });
    expect(listed?.unmapped_reason).toMatch(reason);
  });

  it("lists a document whose Version the feed leaves null as one with a blank label", async () => {
    const listed = (await unmappedOf("HB 3131")).find((document) => document.id === "analysis-2025r1-900107");

    expect(listed).toMatchObject({ version_label: "" });
    expect(listed?.unmapped_reason).toMatch(/no Version label/i);
  });

  it("drops none of the Measure's documents: 3 real and 7 made up are listed, and only the 2 real statements are on a Version", async () => {
    const analysis = analysisOf(await callTool(connected, "get_measure", { measure: "HB 3131" }));

    expect(analysis.by_version.flatMap((group) => group.documents)).toHaveLength(2);
    expect(analysis.unmapped).toHaveLength(8);
    // Each resolves in get_document, and points at no Version.
    for (const { id } of analysis.unmapped) {
      const outcome = await callTool(connected, "get_document", { id });
      expect.soft(outcome.isError, id).toBe(false);
      const related = outcome.structured?.["related"] as { relation: string }[];
      expect
        .soft(
          related.map((node) => node.relation),
          id,
        )
        .not.toContain("version");
    }
  });

  // The rule is "a single letter is that letter's Engrossed Version", not a table of A and B.
  it("places a document labelled C under C-Engrossed, after A and B, when the Measure lists that Version", async () => {
    const analysis = analysisOf(await callTool(connected, "get_measure", { measure: "HB 3795" }));

    expect(analysis.by_version.map((group) => [group.version_id, group.version])).toEqual([
      ["version-2025r1-hb3795-a-engrossed", "A-Engrossed"],
      ["version-2025r1-hb3795-b-engrossed", "B-Engrossed"],
      ["version-2025r1-hb3795-c-engrossed", "C-Engrossed"],
    ]);
    expect(analysis.by_version[2]?.documents).toMatchObject([{ id: "analysis-2025r1-900108", version_label: "C" }]);
    expect(analysis.unmapped).toEqual([]);
  });
});

describe("a label OLIS changes after the file was fetched", () => {
  const started: System[] = [];

  afterEach(async () => {
    for (const system of started.splice(0)) await system.stop();
  });

  // The file is unchanging (ADR-0005); its feed row is not. A made-up row, first published with no
  // Version, is given the label "INTRO" by a later pull: get_measure follows the row, without
  // fetching the file again.
  it("moves the document onto its Version at the next pull, without fetching the file again", async () => {
    const row = analysisRow(900109, { prefix: "HB", number: 3131 }, "");
    const system = await startSystem({
      clockAt,
      documents: true,
      olis: {
        strayRows: { MeasureAnalysisDocuments: [row] },
        strayDocuments: strayFiles([900109]),
      },
    });
    started.push(system);
    const connected = await connectClient("2026-07-28", system.handler);
    try {
      const before = analysisOf(await callTool(connected, "get_measure", { measure: "HB 3131" }));
      expect(before.unmapped.map((document) => [document.id, document.version_label])).toContainEqual([
        "analysis-2025r1-900109",
        "",
      ]);

      row["Version"] = "INTRO";
      await system.pullAgain();

      const after = analysisOf(await callTool(connected, "get_measure", { measure: "HB 3131" }));
      expect(after.unmapped.map((document) => document.id)).not.toContain("analysis-2025r1-900109");
      expect(
        after.by_version.flatMap((group) => group.documents.map((document) => [document.id, document.version_label])),
      ).toContainEqual(["analysis-2025r1-900109", "INTRO"]);
      expect(
        system.olis
          .documentRequests()
          .filter((path) => path === "/liz/2025R1/Downloads/MeasureAnalysisDocument/900109"),
      ).toHaveLength(1);
    } finally {
      await connected.close();
    }
  });
});

describe("a Measure with no digest and no analysis documents", () => {
  // MADE UP: a Measure row the fixture lacks. Every Measure row of the cache has a MeasureSummary, but a
  // row without the property, or with it null, has no digest; and a Measure with no analysis documents
  // has none to list. No documents are served, so the pull is quick.
  const measure = {
    SessionKey: "2025R1",
    MeasurePrefix: "HB",
    MeasureNumber: 9002,
    CatchLine: "A made-up Measure with no digest.",
    CreatedDate: "2025-01-01T10:00:00",
    ModifiedDate: null,
  };

  it.for([
    ["has MeasureSummary null", { ...measure, MeasureSummary: null }],
    ["has no MeasureSummary", measure],
  ] as const)("shows a null digest and empty lists for a row that %s", async ([, row]) => {
    const system = await startSystem({ clockAt, olis: { strayRows: { Measures: [row] } } });
    const connected = await connectClient("2026-07-28", system.handler);
    try {
      const outcome = await callTool(connected, "get_measure", { measure: "HB 9002" });

      expect(outcome.isError).toBe(false);
      expect(outcome.structured).toMatchObject({
        id: "measure-2025r1-hb9002",
        digest: null,
        analysis_documents: { by_version: [], unmapped: [] },
      });
    } finally {
      await connected.close();
      await system.stop();
    }
  });
});
