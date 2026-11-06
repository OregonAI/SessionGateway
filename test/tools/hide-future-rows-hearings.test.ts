// Seam 1 (test/CLAUDE.md): get_measure's hearings follow their meeting (ticket #153, ADR-0056): a hearing is a Recording Log's
// agenda item, read through the Meeting the log belongs to, so a Meeting the clock has not reached takes its hearing with it.
//
// The fixture cannot show that on its own: every Recording Log of it was created after its meeting (hide-future-rows.test.ts
// has the log's side of the rule), so no clock has a visible log and a hidden meeting. This file makes one up, labelled so:
// the worker pulls the fixture, then OLIS is made to say that HALNRW's meeting of 2025-01-22 08:00 was created on
// MADE UP "2025-02-10T09:00:00" (the fixture's own CreatedDate is "2025-01-17T14:16:07"), and the worker pulls again. The
// meeting's Recording Log 288741 is still the fixture's, created "2025-01-29T13:13:06.5416935", and the log of 2025-01-27
// (289259, created "2025-02-03T11:07:10.8054981", a Meeting of its own that is not changed) is the control. Both name HB 3131.
// Each case copies the template of the fixture's pull and pulls once more, so the file pulls for itself (test/CLAUDE.md,
// "Which cases pull"); nothing else is changed. The expected ids are the fixture's.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

const first = "recording-log-2025r1-288741";
const second = "recording-log-2025r1-289259";
const firstMeeting = "meeting-2025r1-halnrw-2025-01-22-0800";

let system: System;

beforeAll(async () => {
  system = await startCopiedSystem({ clockAt: "2026-08-05T17:00:00Z", documents: true });
  // MADE UP: OLIS created the meeting of 2025-01-22 on 2025-02-10, after its Recording Log.
  system.olis.amendRows(
    "CommitteeMeetings",
    (row) => row["CommitteeCode"] === "HALNRW" && row["MeetingDate"] === "2025-01-22T08:00:00",
    { CreatedDate: "2025-02-10T09:00:00" },
  );
  await system.pullAgain();
}, 120_000);

afterAll(async () => {
  await system.stop();
});

describe.for(eras)(
  "get_measure's hearings of HB 3131 at a clock between a log and its made-up meeting, for a %s client",
  (era) => {
    let connected: ConnectedClient;

    beforeAll(async () => {
      connected = await connectClient(era, system.handler);
    });

    afterAll(async () => {
      await connected.close();
    });

    async function hearingLogsAt(moment: string): Promise<string[]> {
      system.clock.set(moment);
      const outcome = await callTool(connected, "get_measure", { measure: "HB 3131" });
      expect(outcome.isError, outcome.text).toBe(false);
      return (outcome.structured?.["hearings"] as { recording_log_id: string }[]).map(
        (hearing) => hearing.recording_log_id,
      );
    }

    it("lists the hearing of a meeting only from the meeting's own CreatedDate, though its log was created before", async () => {
      // Both logs exist from 2025-02-03 11:07:11; the first one's meeting is not there until 2025-02-10 09:00:00.
      expect(await hearingLogsAt("2025-02-04T09:00:00-08:00")).toEqual([second]);
      expect(await hearingLogsAt("2025-02-10T08:59:59-08:00")).toEqual([second]);
      expect(await hearingLogsAt("2025-02-10T09:00:00-08:00")).toEqual([first, second]);
    });

    it("leaves the meeting out of meetings at the same clock, which is why its hearing is not listed", async () => {
      system.clock.set("2025-02-04T09:00:00-08:00");
      const outcome = await callTool(connected, "meetings", {
        committee: "HALNRW",
        from: "2025-01-22",
        to: "2025-01-22",
      });
      expect(outcome.isError, outcome.text).toBe(false);
      expect(JSON.stringify(outcome.structured ?? null)).not.toContain(firstMeeting);
    });
  },
);
