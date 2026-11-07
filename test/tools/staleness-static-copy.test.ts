// Seam 1 (test/CLAUDE.md): the static-copy note (ticket #119, ADR-0057, which amends ADR-0039). A deployment that runs no
// worker sets INGEST_WORKER=off on the server; its answers then say the index is a static copy as of its last full pull,
// with that time read from the database, and never say an update was missed. Each case builds its own system (a real
// pull at a simulated clock, the fake embedder), moves the simulated clock without running the worker and reads what an
// agent reads: the text of a tool's answer. The setting is the server's (`serverEnv`); the worker is not given it.
// Times are Pacific (UTC-8 in January). The existing staleness cases, with the setting absent, are in staleness.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, connectClient } from "../support/mcp-clients.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";

const started: System[] = [];

vi.setConfig({ testTimeout: 60_000 });

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

async function start(options: SystemOptions): Promise<System> {
  const system = await startSystem(options);
  started.push(system);
  return system;
}

/** What an agent reads from one answer: all of its text, the tool's own content (its first block), and the As of it carries. */
async function answer(system: System, tool: string): Promise<{ text: string; own: string; asOf: unknown }> {
  const connected = await connectClient("2026-07-28", system.handler);
  try {
    const args = tool === "get_measure" ? { measure: "SB 69" } : {};
    const result = await callTool(connected, tool, args);
    const raw = await connected.client.callTool({ name: tool, arguments: args });
    const first = raw.content[0];
    return { text: result.text, own: first?.type === "text" ? first.text : "", asOf: result.structured?.["as_of"] };
  } finally {
    await connected.close();
  }
}

/** A tool's own JSON content without live_status. */
function withoutLiveStatus(own: string): unknown {
  const { live_status: _liveStatus, ...rest } = JSON.parse(own) as Record<string, unknown>;
  return rest;
}

// The pull is Wednesday 2025-01-22 at 7:00 am, a Session meeting day.
const pulledAt = "2025-01-22T15:00:00Z";
const pulledAtPacific = "2025-01-22T07:00:00-08:00";
const LIVE_CLAUSE = "except get_measure's live_status, which is read from OLIS when you ask";
const LIVE_NOTE = `Note: this index is a static copy, as of its last full pull at ${pulledAtPacific}. No worker updates it, so changes the Legislature has made since then are not in it, ${LIVE_CLAUSE}.`;
const worker = { off: { INGEST_WORKER: "off" } };

describe("INGEST_WORKER=off: the index is a static copy", () => {
  it("says so on session_overview, as of the full pull's time, and never that an update was missed", async () => {
    // `daily` and `weekly` are what the box's compose sets: without the setting, a week on, they warn "a nightly update was missed".
    const system = await start({
      clockAt: pulledAt,
      ingest: { increments: "daily", fullPull: "weekly" },
      serverEnv: worker.off,
    });

    const fresh = await answer(system, "session_overview"); // the moment of the pull: nothing is old yet
    expect(fresh.text).toContain("static copy");
    expect(fresh.text).toContain(`as of its last full pull at ${pulledAtPacific}`);
    expect(fresh.text).not.toContain(LIVE_CLAUSE);

    system.clock.set("2025-02-26T20:00:00Z"); // five weeks on, and many night windows with no update
    const { text } = await answer(system, "session_overview");

    expect(text).toContain("static copy");
    expect(text).toContain(`as of its last full pull at ${pulledAtPacific}`);
    expect(text).not.toContain(LIVE_CLAUSE); // only get_measure reads OLIS when asked
    expect(text).not.toContain("may be out of date");
    expect(text).not.toContain("missed");
  });

  it("says so on a document tool too, and the answer's own text is unchanged", async () => {
    const system = await start({ clockAt: pulledAt, serverEnv: worker.off });

    const fresh = await answer(system, "get_measure");
    expect(fresh.text).toContain("static copy");
    system.clock.set("2025-03-05T20:00:00Z");
    const later = await answer(system, "get_measure");

    expect(later.text).toContain("static copy");
    expect(later.text).toContain(`as of its last full pull at ${pulledAtPacific}`);
    // get_measure's note, and only its, ends with the clause on its live_status (owner's decision of 2026-11-06, ADR-0057).
    expect(fresh.text).toContain(LIVE_NOTE);
    expect(later.text).toContain(LIVE_NOTE);
    expect(later.text).not.toContain("missed");
    // The note is one more block of text after the tool's own; the tool's own block and the As of are the index's, as ever.
    expect(later.own).not.toContain("static copy");
    // get_measure's live_status is read from OLIS when the call arrives, so it differs between the two moments by design.
    expect(withoutLiveStatus(later.own)).toEqual(withoutLiveStatus(fresh.own));
    expect(later.asOf).toBe(fresh.asOf);
  });

  it("takes the time from the database: an increment moves the As of, not the full pull the note names", async () => {
    const system = await start({ clockAt: pulledAt, serverEnv: worker.off });

    system.clock.set("2025-01-22T17:00:00Z"); // 9:00 am, two hours after the pull
    await system.incrementAgain();
    system.clock.set("2025-01-23T20:00:00Z");
    const { text, asOf } = await answer(system, "session_overview");

    expect(asOf).toBe("2025-01-22T09:00:00-08:00");
    expect(text).toContain(`as of its last full pull at ${pulledAtPacific}`);
  });

  it("treats INGEST_WORKER=on as absent: the warning follows the rhythm settings, and there is no static-copy note", async () => {
    const system = await start({
      clockAt: pulledAt,
      ingest: { increments: "daily", fullPull: "weekly" },
      serverEnv: { INGEST_WORKER: "on" },
    });

    system.clock.set("2025-02-26T20:00:00Z");
    const { text } = await answer(system, "session_overview");

    expect(text).toContain("a nightly update was missed");
    expect(text).not.toContain("static copy");
  });

  it("is the same in a legacy client's answer", async () => {
    const system = await start({ clockAt: pulledAt, serverEnv: worker.off });
    system.clock.set("2025-02-26T20:00:00Z");
    const connected = await connectClient("legacy", system.handler);
    try {
      expect((await callTool(connected, "session_overview", {})).text).toContain("static copy");
    } finally {
      await connected.close();
    }
  });

  it("is a value the server checks: another value stops the start-up, naming the variable and not the value", async () => {
    const error: unknown = await start({ clockAt: pulledAt, serverEnv: { INGEST_WORKER: "nope" } }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(String(error)).toContain("INGEST_WORKER");
    expect(String(error)).not.toContain("nope");
  });
});
