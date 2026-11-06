// Seam 1 (test/CLAUDE.md): get_measure shows only the Statutes Affected Table entries whose Version exists at the
// server's clock (ticket #151, owner decision B of 2026-11-05, ADR-0056). The table is one file read at the last pull,
// and an entry for a Version created later is left out, as if the table had been read that day.
//
// SB 69's table rows are all "SB 69 A" (get-measure-statutes-affected-table.test.ts); its A-Engrossed Version's
// MeasureDocuments row was created "2025-02-03T16:42:28.117", Pacific. Its Introduced Version, "2025-01-10T13:20:19.467",
// is shown at both moments. The database never changes between the two calls: the clock alone moves.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { tableUrlOn } from "../support/statutes-affected-table.ts";
import { startSystem, type System } from "../support/system.ts";

vi.setConfig({ testTimeout: 60_000 });

let system: System;

beforeAll(async () => {
  system = await startSystem({
    clockAt: "2026-08-05T17:00:00Z",
    documents: true,
    statutesAffectedTableUrl: tableUrlOn,
    serverEnv: { MCP_RATE_LIMIT: "1000" },
  });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

describe.for(eras)("get_measure's Statutes Affected Table at a clock before a Version, for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  type Shown = {
    lists_measure: boolean;
    other_entries: unknown[];
    versions: { label: string; hasTable: boolean }[];
  };

  async function tableAt(moment: string): Promise<Shown> {
    system.clock.set(moment);
    const outcome = await callTool(connected, "get_measure", { measure: "SB 69" });
    expect(outcome.isError).toBe(false);
    const links = outcome.structured?.["statute_links_by_source"] as
      | {
          statutes_affected_table?: { lists_measure: boolean; other_entries: unknown[] };
          versions: { label: string; statutes_affected_table?: unknown }[];
        }
      | undefined;
    return {
      lists_measure: links?.statutes_affected_table?.lists_measure ?? false,
      other_entries: links?.statutes_affected_table?.other_entries ?? [],
      versions: (links?.versions ?? []).map((version) => ({
        label: version.label,
        hasTable: version.statutes_affected_table !== undefined,
      })),
    };
  }

  it("leaves out the nine entries of the A-Engrossed Version until it is created: the table lists nothing for SB 69", async () => {
    const early = await tableAt("2025-02-03T08:00:00-08:00");
    expect(early.versions).toEqual([{ label: "Introduced", hasTable: false }]);
    expect(early.lists_measure).toBe(false);
    expect(early.other_entries).toEqual([]);
  });

  it("shows them once the Version exists: the table lists SB 69 and the A-Engrossed Version is compared with it", async () => {
    const late = await tableAt("2025-02-03T16:50:00-08:00");
    expect(late.versions).toEqual([
      { label: "Introduced", hasTable: false },
      { label: "A-Engrossed", hasTable: true },
    ]);
    expect(late.lists_measure).toBe(true);
  });
});
