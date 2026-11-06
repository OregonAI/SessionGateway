// Seam 1 (test/CLAUDE.md): a database a worker left before the feed's CreatedDate was stored for sponsors, history actions,
// votes, meetings and agenda items (ticket #153, ADR-0056 extended, schema step 5). Such a row has no time, so the tools show
// it at any clock until the worker's next full pull writes the time, and from then on hide it before that time.
// The database is a copy of the run's template of the fixture's pull; the arrangement (test/support/old-database.ts, SQL that
// only arranges) takes the times out as an old file would lack them, and `pullAgain` is the next full pull.
//
// Expected values are the fixture's: MeasureSponsors 148617 (Sen Reynolds on SB 64) was created "2025-01-23T08:49:51" and
// MeasureHistoryActions 620210 (SB 69, "Recommendation: Do pass with amendments.  (Printed A-Eng.)") "2025-02-03T10:41:38".
import { describe, expect, it } from "vitest";
import { callTool, connectClient, type ConnectedClient } from "../support/mcp-clients.ts";
import { forgetCreatedTimes, leaveAsVersionFour } from "../support/old-database.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

const clockAt = "2026-08-05T17:00:00Z";
const early = "2025-01-23T08:49:50-08:00";
const reached = "2025-01-23T08:49:51-08:00";

async function sponsorCodes(system: System, connected: ConnectedClient, moment: string): Promise<string[]> {
  system.clock.set(moment);
  const outcome = await callTool(connected, "get_measure", { measure: "SB 64" });
  expect(outcome.isError, outcome.text).toBe(false);
  return (outcome.structured?.["sponsors"] as { legislator_code: string }[]).map((sponsor) => sponsor.legislator_code);
}

async function historyTexts(system: System, connected: ConnectedClient, moment: string): Promise<string[]> {
  system.clock.set(moment);
  const outcome = await callTool(connected, "get_measure", { measure: "SB 69" });
  expect(outcome.isError, outcome.text).toBe(false);
  return (outcome.structured?.["history"] as { text: string }[]).map((line) => line.text);
}

describe("a database whose rows have no CreatedDate yet", () => {
  it("shows them at any clock until the next full pull, which stores the times and hides them before it", async () => {
    const system = await startCopiedSystem({ clockAt, documents: true });
    try {
      forgetCreatedTimes(system.database.path);
      const connected = await connectClient("legacy", system.handler);
      try {
        expect(await sponsorCodes(system, connected, early)).toContain("Sen Reynolds");
        expect(await historyTexts(system, connected, "2025-02-03T10:40:00-08:00")).toContain(
          "Recommendation: Do pass with amendments.  (Printed A-Eng.)",
        );

        // The worker's clock is the system's: the pull is made when every row exists, as the real one is.
        system.clock.set(clockAt);
        await system.pullAgain();

        expect(await sponsorCodes(system, connected, early)).not.toContain("Sen Reynolds");
        expect(await sponsorCodes(system, connected, reached)).toContain("Sen Reynolds");
        expect(await historyTexts(system, connected, "2025-02-03T10:40:00-08:00")).not.toContain(
          "Recommendation: Do pass with amendments.  (Printed A-Eng.)",
        );
        expect(await historyTexts(system, connected, "2025-02-03T10:41:38-08:00")).toContain(
          "Recommendation: Do pass with amendments.  (Printed A-Eng.)",
        );
      } finally {
        await connected.close();
      }
    } finally {
      await system.stop();
    }
  });

  it("is a file at schema version 4: the worker's step 5 makes the columns, and the full pull that follows fills them", async () => {
    const system = await startCopiedSystem({ clockAt, documents: true });
    try {
      leaveAsVersionFour(system.database.path);

      await system.pullAgain();

      const connected = await connectClient("legacy", system.handler);
      try {
        expect(await sponsorCodes(system, connected, early)).not.toContain("Sen Reynolds");
        expect(await sponsorCodes(system, connected, reached)).toContain("Sen Reynolds");
      } finally {
        await connected.close();
      }
    } finally {
      await system.stop();
    }
  });
});
