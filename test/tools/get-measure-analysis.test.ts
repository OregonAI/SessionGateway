// Seam 1 (test/CLAUDE.md): what get_measure shows of a Measure's digest and of its analysis documents
// (Fiscal Impact Statements, revenue impact statements, staff measure summaries, budget reports),
// with the whole system behind it. A fake OLIS serves the committed fixture and its documents, the
// ingest worker pulls them into a database, and an MCP client calls the tool in-process. One database
// serves every case in this file because none of them changes it; cases that need a feed row the
// fixture lacks, or that change a row between two pulls, are in get-measure-analysis-labels.test.ts.
//
// Its database is shared by every case and is a copy of the run's template for its options (test/CLAUDE.md,
// Database, Templates).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  // 2026-08-01 10:00 in Oregon: every row of the fixture exists by then, so the pull fetches all 280
  // documents, the analysis documents among them.
  // The cases make more than the default 120 tool calls in a minute together (the simulated clock never
  // moves, so the window never ends); the limit has its own file, get-measure-rate-limit.test.ts.
  system = await startCopiedSystem({
    clockAt: "2026-08-01T17:00:00Z",
    documents: true,
    serverEnv: { MCP_RATE_LIMIT: "1000" },
  });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

describe.for(eras)("get_measure's digest for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  // Expected values are literals from outside the code: the digest is the feed row's MeasureSummary
  // as the fixture holds it (test/fixtures/olis-2025R1/feed/Measures.json), served as published, with
  // its tabs, its newlines and its markup (olis-odata.md gotcha 8).
  it("returns HB 3131's digest exactly as the feed publishes it", async () => {
    const outcome = await callTool(connected, "get_measure", { measure: "HB 3131" });

    expect(outcome.isError).toBe(false);
    expect(outcome.structured?.["digest"]).toBe(
      "\tDigest: The Act gives money to a state agency for uses related to working lands. The Act goes into effect when the Governor signs it. (Flesch Readability Score: 71.2). \n" +
        "\tAppropriates moneys to the Oregon Watershed Enhancement Board, out of the General Fund, for deposit in the Oregon Agricultural Heritage Fund. \n" +
        "\tEstablishes a maximum limit for payment of expenses by the board from the Oregon Agricultural Heritage Fund. \n" +
        "\tDeclares an emergency, effective on passage.",
    );
  });

  it("keeps the feed's markup in SB 69's digest: <b> for new text and [<i>...</i>] for text deleted from the prior Version", async () => {
    const outcome = await callTool(connected, "get_measure", { measure: "SB 69" });

    const digest = String(outcome.structured?.["digest"]);
    expect(
      digest.startsWith("\t<b>Digest: The Act makes changes to laws concerning job-protected time off from work."),
    ).toBe(true);
    expect(digest).toContain(
      "\n\t[<i>Digest: The Act tells OED to study issues related to job-protected time of from work.",
    );
    expect(digest.endsWith("\tTakes effect on the 91st day following adjournment sine die.</b>")).toBe(true);
  });
});

type Entry = {
  id: string;
  type: string;
  version_label: string;
  committee_id: string | null;
  source_url: string;
};
type Unmapped = Entry & { unmapped_reason: string };
type Analysis = {
  by_version: { version_id: string; version: string; documents: Entry[] }[];
  unmapped: Unmapped[];
};

const analysisUrl = (id: string): string =>
  `https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureAnalysisDocument/${id}`;

/** One expected entry, from a row of test/fixtures/olis-2025R1/feed/MeasureAnalysisDocuments.json. */
function entry(id: string, type: string, versionLabel: string, committee: string): Entry {
  return {
    id: `analysis-2025r1-${id}`,
    type,
    version_label: versionLabel,
    committee_id: `committee-2025r1-${committee}`,
    source_url: analysisUrl(id),
  };
}

describe.for(eras)("get_measure's analysis documents for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  async function analysisOf(measure: string): Promise<Analysis> {
    const outcome = await callTool(connected, "get_measure", { measure });
    expect(outcome.isError).toBe(false);
    return outcome.structured?.["analysis_documents"] as Analysis;
  }

  // Spec #1 case (e), ticket #12: HB 3131's rows 85869 (Fiscal Impact Statement) and 85719 (Revenue
  // Impact Statement) both say Version "INTRO", and HB 3131 has one Version, Introduced.
  it("shows HB 3131's Introduced Fiscal Impact Statement and revenue impact statement", async () => {
    const analysis = await analysisOf("HB 3131");

    expect(analysis.by_version).toEqual([
      {
        version_id: "version-2025r1-hb3131-introduced",
        version: "Introduced",
        documents: [
          entry("85869", "Fiscal Impact Statement", "INTRO", "halnrw"),
          entry("85719", "Revenue Impact Statement", "INTRO", "halnrw"),
        ],
      },
    ]);
  });

  // Rows 85414 (Fiscal), 85419 (Revenue), 85482 (SLB's Staff Measure Summary) and 91380 (HLWS's) all
  // say Version "A"; SB 69 lists an A-Engrossed Version.
  it("shows SB 69's A-Engrossed statements and both staff measure summaries", async () => {
    const analysis = await analysisOf("SB 69");

    expect(analysis.by_version).toEqual([
      {
        version_id: "version-2025r1-sb69-a-engrossed",
        version: "A-Engrossed",
        documents: [
          entry("85414", "Fiscal Impact Statement", "A", "slb"),
          entry("85419", "Revenue Impact Statement", "A", "slb"),
          entry("85482", "Staff Measure Summary", "A", "slb"),
          entry("91380", "Staff Measure Summary", "A", "hlws"),
        ],
      },
    ]);
    expect(analysis.unmapped).toEqual([]);
  });

  // HB 3795's rows say "A" (89095, 89155, 89471) and "B" (92069, 92125, 92329); it lists both Versions.
  it("groups a Measure's analysis documents by Version, in the order of the Versions", async () => {
    const analysis = await analysisOf("HB 3795");

    expect(analysis.by_version).toEqual([
      {
        version_id: "version-2025r1-hb3795-a-engrossed",
        version: "A-Engrossed",
        documents: [
          entry("89095", "Fiscal Impact Statement", "A", "hechs"),
          entry("89155", "Revenue Impact Statement", "A", "hechs"),
          entry("89471", "Staff Measure Summary", "A", "hechs"),
        ],
      },
      {
        version_id: "version-2025r1-hb3795-b-engrossed",
        version: "B-Engrossed",
        documents: [
          entry("92069", "Fiscal Impact Statement", "B", "shs"),
          entry("92125", "Revenue Impact Statement", "B", "shs"),
          entry("92329", "Staff Measure Summary", "B", "shs"),
        ],
      },
    ]);
  });

  // The documents a group holds are the statements; the group itself is the Version they are of, and its
  // id is one an agent follows to read the text the statements are about. The whole fixture is held, so
  // every group's Version resolves (when the Version's own file is missing it does not: see
  // get-measure-analysis-pull.test.ts).
  it("gives each Version it groups under an id that resolves in get_document", async () => {
    const versionIds = new Set<string>();
    for (const measure of ["SB 69", "HB 3795", "HB 3131", "SB 64", "SB 121", "SB 921", "SB 983", "HB 3027"]) {
      for (const group of (await analysisOf(measure)).by_version) versionIds.add(group.version_id);
    }

    expect([...versionIds].toSorted()).toEqual([
      "version-2025r1-hb3027-introduced",
      "version-2025r1-hb3131-introduced",
      "version-2025r1-hb3795-a-engrossed",
      "version-2025r1-hb3795-b-engrossed",
      "version-2025r1-sb121-introduced",
      "version-2025r1-sb64-introduced",
      "version-2025r1-sb69-a-engrossed",
      "version-2025r1-sb921-a-engrossed",
      "version-2025r1-sb983-a-engrossed",
      "version-2025r1-sb983-introduced",
    ]);
    for (const id of versionIds) {
      const outcome = await callTool(connected, "get_document", { id });
      expect.soft(outcome.isError, id).toBe(false);
      expect.soft(outcome.structured, id).toMatchObject({ id, kind: "version" });
    }
  });

  // Row 85989, HB 3131's Staff Measure Summary, has Version "" (688 of the Session's 5,260 rows do:
  // olis-odata.md gotcha 9). The feed says nothing about which Version it is of, so it is listed, not
  // dropped, and says why it is on none.
  it("lists a document whose label is blank, and says it could not be placed on a Version", async () => {
    const analysis = await analysisOf("HB 3131");

    expect(analysis.unmapped).toHaveLength(1);
    const { unmapped_reason: reason, ...listed } = analysis.unmapped[0] as Unmapped;
    expect(listed).toEqual(entry("85989", "Staff Measure Summary", "", "halnrw"));
    expect(reason).toMatch(/no Version label/i);
  });

  // The fixture's 34 MeasureAnalysisDocuments rows belong to its 10 Measures; 7 of them have a blank
  // Version (HB 3027 86401 and 91908, HB 3131 85989, SB 64 90799 and 91528, SB 121 90895, SB 983 88201).
  it("lists every one of the fixture's 34 analysis documents, and each id resolves in get_document", async () => {
    const measures = ["SB 69", "HB 3795", "HB 3131", "SB 64", "SB 121", "SB 921", "SB 983", "HB 3027"];
    const listed: { entry: Entry; versionId: string | null }[] = [];
    for (const measure of measures) {
      const analysis = await analysisOf(measure);
      for (const group of analysis.by_version) {
        for (const document of group.documents) listed.push({ entry: document, versionId: group.version_id });
      }
      for (const document of analysis.unmapped) listed.push({ entry: document, versionId: null });
    }

    expect(listed).toHaveLength(34);
    expect(listed.filter((item) => item.versionId === null)).toHaveLength(7);
    for (const { entry: listedEntry, versionId } of listed) {
      const outcome = await callTool(connected, "get_document", { id: listedEntry.id });
      expect.soft(outcome.isError, listedEntry.id).toBe(false);
      expect.soft(outcome.structured, listedEntry.id).toMatchObject({
        id: listedEntry.id,
        kind: "analysis",
        label: listedEntry.type,
        source_url: listedEntry.source_url,
      });
      // get_document and get_measure read the label one way: the Version get_document points at is
      // the Version get_measure puts the document under, and a document under none points at none.
      const versions = (outcome.structured?.["related"] as { id: string; relation: string }[])
        .filter((node) => node.relation === "version")
        .map((node) => node.id);
      expect.soft(versions, listedEntry.id).toEqual(versionId === null ? [] : [versionId]);
    }
  });
});
