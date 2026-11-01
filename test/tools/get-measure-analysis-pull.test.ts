// Seam 1: what get_measure says of the analysis documents the worker could not fetch. The index holds
// only the documents whose files the worker fetched, so that every id get_measure lists resolves in
// get_document (ADR-0013). The Measure must not read as having no statement when the feed lists one
// and the worker has not got it, so get_measure counts the feed's analysis documents it does not hold.
// Cases here change what the fake OLIS answers, so each builds its own system; cases that only read the
// fixture are in get-measure-analysis.test.ts, and cases that add feed rows are in
// get-measure-analysis-labels.test.ts. Every case runs once with each client.
//
// It covers an analysis document or a Version that the worker could not fetch.
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type Era } from "../support/mcp-clients.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";

// 2026-08-01 10:00 in Oregon: every row of the fixture exists by then.
const clockAt = "2026-08-01T17:00:00Z";
const root = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads";
const started: System[] = [];

// A case that serves the documents pulls the fixture's 278 files, about four seconds on its own and more
// with the other files' workers running beside it.
vi.setConfig({ testTimeout: 60_000 });

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

async function start(options: Omit<SystemOptions, "clockAt">): Promise<System> {
  const system = await startSystem({ clockAt, ...options });
  started.push(system);
  return system;
}

type Analysis = {
  by_version: { version_id: string; documents: { id: string }[] }[];
  unmapped: { id: string }[];
  not_held: number;
};

async function analysisOf(system: System, era: Era, measure: string): Promise<Analysis> {
  const connected = await connectClient(era, system.handler);
  try {
    const outcome = await callTool(connected, "get_measure", { measure });
    expect(outcome.isError).toBe(false);
    return outcome.structured?.["analysis_documents"] as Analysis;
  } finally {
    await connected.close();
  }
}

type JsonSchema = { description?: string; properties?: Record<string, JsonSchema>; items?: JsonSchema };

/** The description get_measure's output schema gives the `version_id` of each group of analysis documents. */
function versionIdDescription(schema: JsonSchema | undefined): string | undefined {
  const byVersion = schema?.properties?.["analysis_documents"]?.properties?.["by_version"];
  return byVersion?.items?.properties?.["version_id"]?.description;
}

function listedIds(analysis: Analysis): string[] {
  return [...analysis.by_version.flatMap((group) => group.documents), ...analysis.unmapped].map(
    (document) => document.id,
  );
}

describe.for(eras)("analysis documents the worker does not hold, for a %s client", (era) => {
  // The fake serves no document files by default (every request is answered 404, which OLIS does for a
  // file it does not have), so the worker holds none of the feed's analysis documents.
  // HB 3131 has 3 rows in the feed (85719, 85869 and 85989), and SB 69 has 4 (85414, 85419, 85482, 91380):
  // test/fixtures/olis-2025R1/feed/MeasureAnalysisDocuments.json.
  it("counts the documents the feed lists and the index does not hold, instead of reading as none", async () => {
    const system = await start({});

    expect(await analysisOf(system, era, "HB 3131")).toEqual({ by_version: [], unmapped: [], not_held: 3 });
    expect(await analysisOf(system, era, "SB 69")).toEqual({ by_version: [], unmapped: [], not_held: 4 });
  });

  it("counts none when the index holds every document", async () => {
    const system = await start({ documents: true });

    expect((await analysisOf(system, era, "HB 3131")).not_held).toBe(0);
  });

  // 85869 is HB 3131's Fiscal Impact Statement. It times out on all three attempts of the first pull and
  // is served from then on, as OLIS does when it has an outage and recovers.
  it("counts a document whose download timed out, lists the others, and lists it once a later pull has it", async () => {
    const system = await start({
      documents: true,
      documentTimeoutMs: 200,
      olis: { documentFailures: { [`${root}/MeasureAnalysisDocument/85869`]: ["hang", "hang", "hang"] } },
    });

    const before = await analysisOf(system, era, "HB 3131");
    expect(before.not_held).toBe(1);
    expect(listedIds(before).toSorted()).toEqual(["analysis-2025r1-85719", "analysis-2025r1-85989"]);

    await system.pullAgain();

    const after = await analysisOf(system, era, "HB 3131");
    expect(after.not_held).toBe(0);
    expect(listedIds(after).toSorted()).toEqual([
      "analysis-2025r1-85719",
      "analysis-2025r1-85869",
      "analysis-2025r1-85989",
    ]);
  });
});

describe.for(eras)("a Version whose file the worker could not fetch, for a %s client", (era) => {
  // SB 69's A-Engrossed Version is a node the feed lists, and its four statements are held. Its own file
  // answers 404 (OLIS has no file for it), so the worker leaves it out and get_document cannot serve it.
  const sb69AEngrossed = `${root}/MeasureDocument/SB69/A-Engrossed`;

  it("still lists the statements under it, and the output schema says its id does not resolve then", async () => {
    const system = await start({ documents: true, olis: { documentFailures: { [sb69AEngrossed]: [404] } } });
    const connected = await connectClient(era, system.handler);
    try {
      const measure = await callTool(connected, "get_measure", { measure: "SB 69" });
      expect(measure.isError).toBe(false);
      const analysis = measure.structured?.["analysis_documents"] as Analysis;
      expect(analysis.by_version.map((group) => [group.version_id, group.documents.length])).toEqual([
        ["version-2025r1-sb69-a-engrossed", 4],
      ]);

      const version = await callTool(connected, "get_document", { id: "version-2025r1-sb69-a-engrossed" });
      expect(version.isError).toBe(true);

      // What the agent reads of the field in tools/list says so too, instead of promising that it resolves.
      const tools = await connected.client.listTools();
      const schema = tools.tools.find((tool) => tool.name === "get_measure")?.outputSchema;
      expect(versionIdDescription(schema as JsonSchema | undefined)).toMatch(
        /get_document resolves it when this index holds the Version's file/,
      );
    } finally {
      await connected.close();
    }
  });
});
