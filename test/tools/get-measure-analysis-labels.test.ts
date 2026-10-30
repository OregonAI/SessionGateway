// Seam 1: the labels of the feed's `Version` property that the committed fixture has no row for
// ("B*", "MRA", "MRB", "MRC", a letter whose Version the Measure lacks...), and a label OLIS changes
// after the file was fetched. The fixture is never edited by hand (test/fixtures/CLAUDE.md), so each
// case adds a feed row to the fake OLIS (`strayRows`), served with a fixture file (`strayDocuments`).
// EVERY ROW BELOW IS MADE UP: its id (9001xx), its Measure and its files are not the feed's. What is
// real is the label it carries: "B*", "MRA", "MRB", "MRC" and "A" on a Measure without A-Engrossed
// occur in the full 2025R1 cache (olis-odata.md gotcha 9; docs/adr/0013 has the rows), and so does a row
// flagged IsMinority=true beside a majority row of the same type, committee and label (SB 916's 87550
// and 87549, Staff Measure Summaries labelled "A"). "Z9" and a null Version do not, and are made up to
// show the branches for a label nobody has met. Made-up row 900110 is
// an "INTRO" statement with the highest id of its Measure, so that the order of the Versions is not the
// order of the ids.
// Cases that only read the fixture are in get-measure-analysis.test.ts.
// The last case is a made-up Measure with no digest and no analysis documents. Every case runs once
// with a 2026-07-28 client and once with a legacy client (test/CLAUDE.md, "MCP client").
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient, type ToolOutcome } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

const clockAt = "2026-08-01T17:00:00Z";

// A case that builds its own system and serves the documents pulls the fixture's 278 files, about four
// seconds on its own and more with the other files' workers running beside it (the default is five).
vi.setConfig({ testTimeout: 60_000 });
const root = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads";

/** A made-up MeasureAnalysisDocuments row, shaped like the feed's (with `CommittteCode` and the string key). */
function analysisRow(
  id: number,
  measure: { prefix: string; number: number },
  version: string | null,
  options: { type?: string; isMinority?: boolean } = {},
): Record<string, unknown> {
  return {
    MeasureAnalysisId: String(id),
    SessionKey: "2025R1",
    CommittteCode: "HALNRW",
    DocumentType: options.type ?? "Fiscal Impact Statement",
    MeasurePrefix: measure.prefix,
    MeasureNumber: measure.number,
    Version: version,
    IsMinority: options.isMinority ?? false,
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
  // MeasureDocuments row 'C-Engrossed' below gives it a third. SB 921 lists A-Engrossed and Introduced.
  const hb3131 = { prefix: "HB", number: 3131 };
  const hb3795 = { prefix: "HB", number: 3795 };
  const sb921 = { prefix: "SB", number: 921 };
  const sb69 = { prefix: "SB", number: 69 };
  // The pair the cache has for SB 916 (87549 and 87550, 11 seconds apart): a Staff Measure Summary of the
  // majority and one the feed flags IsMinority=true, both labelled "A". SB 69 lists A-Engrossed and no
  // B-Engrossed. 900113 and 900114 are flagged and carry a label of a Version it lacks, and no label.
  const staffSummary = { type: "Staff Measure Summary" };
  const minorityRows = [
    analysisRow(900111, sb69, "A", staffSummary),
    analysisRow(900112, sb69, "A", { ...staffSummary, isMinority: true }),
    analysisRow(900113, sb69, "B", { ...staffSummary, isMinority: true }),
    analysisRow(900114, sb69, "", { ...staffSummary, isMinority: true }),
  ];
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

  beforeAll(async () => {
    system = await startSystem({
      clockAt,
      documents: true,
      olis: {
        strayRows: {
          MeasureAnalysisDocuments: [
            ...rows.map(([id, label]) => analysisRow(id, hb3131, label)),
            analysisRow(900108, hb3795, "C"),
            // The highest id of SB 921's analysis documents, though it is of the first Version printed.
            analysisRow(900110, sb921, "INTRO"),
            ...minorityRows,
          ],
          MeasureDocuments: [cEngrossedRow],
        },
        strayDocuments: {
          ...strayFiles([...rows.map(([id]) => id), 900108, 900110, 900111, 900112, 900113, 900114]),
          "/liz/2025R1/Downloads/MeasureDocument/HB3795/C-Engrossed": "measure-documents/HB3795/B-Engrossed.pdf",
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await system.stop();
  });

  describe.for(eras)("for a %s client", (era) => {
    let connected: ConnectedClient;

    beforeAll(async () => {
      connected = await connectClient(era, system.handler);
    });

    afterAll(async () => {
      await connected.close();
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
    ] as const)(
      "lists the document labelled %s (made-up row %s) apart, with the reason",
      async ([label, id, reason]) => {
        const listed = (await unmappedOf("HB 3131")).find((document) => document.id === `analysis-2025r1-${id}`);

        expect(listed).toMatchObject({ type: "Fiscal Impact Statement", version_label: label });
        expect(listed?.unmapped_reason).toMatch(reason);
      },
    );

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

    // SB 921's real statements (87631, 87652, 87909) say "A". Made-up row 900110 says "INTRO" and has a
    // higher id than all three, so the documents reach the grouping A first. The Versions are listed in
    // the order they were printed, whichever way the documents come: Introduced, then A-Engrossed.
    it("lists the Versions in the order they were printed, whatever the order of the documents' ids", async () => {
      const analysis = analysisOf(await callTool(connected, "get_measure", { measure: "SB 921" }));

      expect(
        analysis.by_version.map((group) => [group.version_id, group.documents.map((document) => document.id)]),
      ).toEqual([
        ["version-2025r1-sb921-introduced", ["analysis-2025r1-900110"]],
        [
          "version-2025r1-sb921-a-engrossed",
          ["analysis-2025r1-87631", "analysis-2025r1-87652", "analysis-2025r1-87909"],
        ],
      ]);
    });

    // The feed flags 18 of the cache's rows IsMinority=true (ADR-0013). Its label says "A", but the row
    // is the minority report's, not the majority's A-Engrossed text, so the document is listed apart
    // and says why. The majority's own summary next to it (900111) stays on A-Engrossed.
    it("lists a document the feed flags as a minority report's apart, even when its label names a listed Version", async () => {
      const analysis = analysisOf(await callTool(connected, "get_measure", { measure: "SB 69" }));

      expect(analysis.by_version.map((group) => group.version_id)).toEqual(["version-2025r1-sb69-a-engrossed"]);
      expect(analysis.by_version[0]?.documents.map((document) => document.id)).toEqual([
        "analysis-2025r1-85414",
        "analysis-2025r1-85419",
        "analysis-2025r1-85482",
        "analysis-2025r1-91380",
        "analysis-2025r1-900111",
      ]);
      expect(analysis.unmapped.map((document) => [document.id, document.version_label])).toEqual([
        ["analysis-2025r1-900112", "A"],
        ["analysis-2025r1-900113", "B"],
        ["analysis-2025r1-900114", ""],
      ]);
      const reasons = analysis.unmapped.map((document) => document.unmapped_reason);
      expect(reasons[0]).toMatch(/flags this document as a minority report's.*labels it "A"/s);
      expect(reasons[1]).toMatch(/flags this document as a minority report's.*labels it "B"/s);
      expect(reasons[2]).toMatch(/flags this document as a minority report's.*no Version label/s);
    });

    it("points a document the feed flags as a minority report's at no Version in get_document", async () => {
      for (const id of [900112, 900113, 900114]) {
        const outcome = await callTool(connected, "get_document", { id: `analysis-2025r1-${id}` });
        expect.soft(outcome.isError, String(id)).toBe(false);
        const related = outcome.structured?.["related"] as { relation: string }[];
        expect
          .soft(
            related.map((node) => node.relation),
            String(id),
          )
          .not.toContain("version");
      }
    });
  });
});

describe.for(eras)("a label OLIS changes after the file was fetched, for a %s client", (era) => {
  // The file is unchanging (ADR-0005); its feed row is not. A made-up row, first published with no
  // Version, is given the label "INTRO" by a later pull: get_measure follows the row, without
  // fetching the file again. The case changes the feed, so it builds its own system.
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
    const connected = await connectClient(era, system.handler);
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
      await system.stop();
    }
  });
});

describe.for(eras)("a minority flag OLIS sets after the file was fetched, for a %s client", (era) => {
  // Made-up row 900115 is a majority Staff Measure Summary labelled "A" on SB 69, then flagged
  // IsMinority=true by a later pull: get_measure and get_document follow the row, without fetching the
  // file again.
  it("moves the document off its Version at the next pull", async () => {
    const row = analysisRow(900115, { prefix: "SB", number: 69 }, "A", { type: "Staff Measure Summary" });
    const system = await startSystem({
      clockAt,
      documents: true,
      olis: {
        strayRows: { MeasureAnalysisDocuments: [row] },
        strayDocuments: strayFiles([900115]),
      },
    });
    const connected = await connectClient(era, system.handler);
    try {
      const before = analysisOf(await callTool(connected, "get_measure", { measure: "SB 69" }));
      expect(before.by_version.flatMap((group) => group.documents.map((document) => document.id))).toContain(
        "analysis-2025r1-900115",
      );

      row["IsMinority"] = true;
      await system.pullAgain();

      const after = analysisOf(await callTool(connected, "get_measure", { measure: "SB 69" }));
      expect(after.by_version.flatMap((group) => group.documents.map((document) => document.id))).not.toContain(
        "analysis-2025r1-900115",
      );
      expect(after.unmapped.map((document) => document.id)).toEqual(["analysis-2025r1-900115"]);
      const document = await callTool(connected, "get_document", { id: "analysis-2025r1-900115" });
      const related = document.structured?.["related"] as { relation: string }[];
      expect(related.map((node) => node.relation)).not.toContain("version");
      expect(
        system.olis
          .documentRequests()
          .filter((path) => path === "/liz/2025R1/Downloads/MeasureAnalysisDocument/900115"),
      ).toHaveLength(1);
    } finally {
      await connected.close();
      await system.stop();
    }
  });
});

describe.for(eras)("a Measure with no digest and no analysis documents, for a %s client", (era) => {
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
    const connected = await connectClient(era, system.handler);
    try {
      const outcome = await callTool(connected, "get_measure", { measure: "HB 9002" });

      expect(outcome.isError).toBe(false);
      expect(outcome.structured).toMatchObject({
        id: "measure-2025r1-hb9002",
        digest: null,
        analysis_documents: { by_version: [], unmapped: [], not_held: 0 },
      });
    } finally {
      await connected.close();
      await system.stop();
    }
  });
});
