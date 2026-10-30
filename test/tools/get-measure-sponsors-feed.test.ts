// Seam 1: what get_measure shows of a Measure's sponsors depends on what the feed said. Each case
// here builds its own system, because the rows the fake OLIS serves (or the time it serves them at)
// are the thing under test. Cases that only read the committed fixture are in
// get-measure-sponsors.test.ts.
//
// A stray row is a MeasureSponsors row the test adds to what the fake OLIS serves; the committed
// fixture never changes (test/CLAUDE.md). Each one is a real row of the cached 2025R1 feed, pointed
// at SB 69 so that the fixture holds the Measure it names.
import { afterEach, describe, expect, it } from "vitest";
import { callTool, connectClient, type ToolOutcome } from "../support/mcp-clients.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";

const started: System[] = [];

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

/** Builds one system and calls get_measure for one Measure in it. */
async function getMeasure(options: SystemOptions, reference: string): Promise<ToolOutcome> {
  const system = await startSystem(options);
  started.push(system);
  const connected = await connectClient("2026-07-28", system.handler);
  try {
    return await callTool(connected, "get_measure", { measure: reference });
  } finally {
    await connected.close();
  }
}

/** A Member row of MeasureSponsors in the feed's own shape, on SB 69. */
function sb69MemberRow(id: string, code: string, level: "Chief" | "Regular", printOrder: string) {
  return {
    MeasureSponsorId: id,
    SessionKey: "2025R1",
    MeasurePrefix: "SB",
    MeasureNumber: 69,
    SponsorType: "Member",
    LegislatoreCode: code,
    CommitteeCode: null,
    SponsorLevel: level,
    PrintOrder: printOrder,
    PresessionFiledMessage: null,
    CreatedDate: "2024-12-30T16:16:37",
    ModifiedDate: null,
  };
}

// 2025-12-15, after the newest Legislators row was created (2025-06-07).
const afterTheSession = "2025-12-15T17:00:00Z";

type Sponsor = { level: string; legislator_code: string; legislator: { id: string; name: string } | null };

describe("Legislator Codes that carry a leadership title", () => {
  // The codes are the cache's own: "Rep Speaker Fahey" is the chief sponsor of HB 2010 (MeasureSponsorId
  // 143197) and "Sen President Wagner" a sponsor of SB 223 (143036). Each has a Legislators row with
  // that code (Title "Speaker" and "President"), whose name is Julie Fahey and Rob Wagner.
  it.for([
    ["Speaker", "Rep Speaker Fahey", "legislator-2025r1-fahey", "Julie Fahey"],
    ["President", "Sen President Wagner", "legislator-2025r1-wagner", "Rob Wagner"],
  ])(
    "resolves the code of the %s (%s) to the Legislator, named for the person and not the office",
    async ([, code, id, name]) => {
      const outcome = await getMeasure(
        {
          clockAt: afterTheSession,
          olis: { strayRows: { MeasureSponsors: [sb69MemberRow("143197", code as string, "Chief", "1")] } },
        },
        "SB 69",
      );

      expect((outcome.structured?.["sponsors"] as Sponsor[])[0]).toEqual({
        level: "chief",
        legislator_code: code,
        legislator: { id, name },
      });
    },
  );
});
