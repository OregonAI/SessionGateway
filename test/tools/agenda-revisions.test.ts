// Seam 1 (test/CLAUDE.md): a revised agenda (ticket #19, ADR-0005, ADR-0041). A fetched document is treated as
// unchanging, except an agenda, which is fetched again when the meeting's `AgendaRevisionNumber` changes. Each case
// starts a copy of the run's template of the first pull (test/CLAUDE.md, "Templates"), because the feed and the clock move
// after it and the second pull is the subject. The embedder is the fake.
//
// The meeting is SLB's of 2025-01-30, the one spec #1's case (c) names. Its row in feed/CommitteeMeetings.json says
// `AgendaRevisionNumber` 1, created 2025-01-23T07:44:41 and modified 2025-01-29T09:14:12; its agenda item 202165
// (feed/CommitteeAgendaItems.json) is SB 69's Public Hearing and Work Session. The pull is at 2025-01-29 14:00 in
// Oregon, the increment at 14:30, which asks for rows created or modified after 12:00 (no row of the fixture is created between 14:00 and 14:30: the latest, an HHED meeting and an Exhibit, were created at 13:48 and 13:39).
//
// MADE UP: the revised agenda's file (a PDF written by test/support/made-up-pdf.ts, served at the agenda's own URL),
// the revision number 2 and the item's Action "Cancelled" that the amended rows carry.
//
// Each case is read with both kinds of client. It covers an increment and a full pull that fetch a revised agenda
// again, its passages replaced in search, a revision number that did not change, and one fetch for each new
// revision.
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type Era } from "../support/mcp-clients.ts";
import { madeUpPdf } from "../support/made-up-pdf.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

vi.setConfig({ testTimeout: 60_000 });

const started: System[] = [];

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

const pulledAt = "2025-01-29T22:00:00Z";
const incrementAt = "2025-01-29T22:30:00Z";

const agendaId = "agenda-2025r1-slb-2025-01-30-0800";
const agendaPath = "/liz/2025R1/Downloads/CommitteeAgenda/SLB/2025-01-30-08-00";

const revisedAgenda = madeUpPdf([
  ["MADE UP agenda, revision 2", "Item 1: SB 69 is cancelled. The committee takes up the zebrafish bill instead."],
]);

async function start(): Promise<System> {
  const system = await startCopiedSystem({ clockAt: pulledAt, documents: true });
  started.push(system);
  return system;
}

function isSlbThirtieth(row: Record<string, unknown>): boolean {
  return row["CommitteeCode"] === "SLB" && row["MeetingDate"] === "2025-01-30T08:00:00";
}

/** OLIS revises the agenda: the row's revision number and modification time move and a new file is served. */
function reviseAgenda(system: System, changes: { AgendaRevisionNumber: number; ModifiedDate: string }): void {
  system.olis.amendRows("CommitteeMeetings", isSlbThirtieth, changes);
  system.olis.serveDocument(agendaPath, revisedAgenda);
}

async function agendaText(system: System, era: Era): Promise<string> {
  const connected = await connectClient(era, system.handler);
  try {
    const outcome = await callTool(connected, "get_document", { id: agendaId });
    expect(outcome.isError).toBe(false);
    return String(outcome.structured?.["text"]);
  } finally {
    await connected.close();
  }
}

async function agendaItemActions(system: System, era: Era): Promise<(string | null)[]> {
  const connected = await connectClient(era, system.handler);
  try {
    const outcome = await callTool(connected, "meetings", { committee: "SLB", from: "2025-01-30", to: "2025-01-30" });
    expect(outcome.isError).toBe(false);
    const meetings = outcome.structured?.["meetings"] as { agenda_items: { action: string | null }[] }[];
    return meetings.flatMap((meeting) => meeting.agenda_items.map((item) => item.action));
  } finally {
    await connected.close();
  }
}

async function searchIds(system: System, era: Era, query: string): Promise<string[]> {
  const connected = await connectClient(era, system.handler);
  try {
    const outcome = await callTool(connected, "search", { query });
    expect(outcome.isError).toBe(false);
    return (outcome.structured?.["results"] as { id: string }[]).map((hit) => hit.id);
  } finally {
    await connected.close();
  }
}

describe.for(eras)("a revised agenda, for a %s client", (era) => {
  it("is fetched again by the next increment, and get_document and meetings show the new content", async () => {
    const system = await start();
    expect(await agendaText(system, era)).not.toContain("MADE UP agenda, revision 2");
    const requestsBefore = system.olis.documentRequests().length;

    system.clock.set(incrementAt);
    reviseAgenda(system, { AgendaRevisionNumber: 2, ModifiedDate: "2025-01-29T14:15:00" });
    system.olis.amendRows("CommitteeAgendaItems", (row) => row["CommitteeAgendaItemId"] === 202165, {
      Action: "Cancelled",
      ModifiedDate: "2025-01-29T14:15:00",
    });
    await system.incrementAgain();

    const text = await agendaText(system, era);
    expect(text).toContain("MADE UP agenda, revision 2");
    expect(text).toContain("SB 69 is cancelled");
    expect(await agendaItemActions(system, era)).toEqual(["Cancelled"]);
    // Only the agenda was asked for: no other stored document is fetched again.
    expect(system.olis.documentRequests().slice(requestsBefore)).toEqual([agendaPath]);
  });

  it("replaces the agenda's passages, so search finds the new words and no longer the old ones", async () => {
    const system = await start();
    expect(await searchIds(system, era, "zebrafish")).not.toContain(agendaId);
    // Words only the real agenda holds: its staff list (the file's own text).
    expect(await searchIds(system, era, "Whitney Perez, LPRO Analyst")).toContain(agendaId);

    system.clock.set(incrementAt);
    reviseAgenda(system, { AgendaRevisionNumber: 2, ModifiedDate: "2025-01-29T14:15:00" });
    await system.incrementAgain();

    expect(await searchIds(system, era, "zebrafish")).toContain(agendaId);
    expect(await searchIds(system, era, "Whitney Perez, LPRO Analyst")).not.toContain(agendaId);
  });

  it("is fetched again by a full pull when only the revision number changed", async () => {
    // The full pull reads every row, so it needs no new ModifiedDate to see the revision.
    const system = await start();
    const requestsBefore = system.olis.documentRequests().length;

    system.clock.set(incrementAt);
    system.olis.amendRows("CommitteeMeetings", isSlbThirtieth, { AgendaRevisionNumber: 2 });
    system.olis.serveDocument(agendaPath, revisedAgenda);
    await system.pullAgain();

    expect(await agendaText(system, era)).toContain("MADE UP agenda, revision 2");
    expect(system.olis.documentRequests().slice(requestsBefore)).toEqual([agendaPath]);
  });

  it("is not fetched again while its revision number is unchanged, by an increment or by a full pull", async () => {
    const system = await start();
    const original = await agendaText(system, era);
    const requestsBefore = system.olis.documentRequests().length;

    // The meeting row is modified (so the increment reads it) but its revision is still 1. The file served at the
    // URL is another one, which must not be fetched.
    system.clock.set(incrementAt);
    system.olis.amendRows("CommitteeMeetings", isSlbThirtieth, { ModifiedDate: "2025-01-29T14:15:00" });
    system.olis.serveDocument(agendaPath, revisedAgenda);
    await system.incrementAgain();
    await system.pullAgain();

    expect(system.olis.documentRequests().slice(requestsBefore)).toEqual([]);
    expect(await agendaText(system, era)).toBe(original);
  });

  it("is fetched again once for each new revision, not again by the run after", async () => {
    const system = await start();
    const requestsBefore = system.olis.documentRequests().length;

    system.clock.set(incrementAt);
    reviseAgenda(system, { AgendaRevisionNumber: 2, ModifiedDate: "2025-01-29T14:15:00" });
    await system.incrementAgain();
    system.clock.set("2025-01-29T23:00:00Z");
    await system.incrementAgain();
    await system.pullAgain();

    expect(system.olis.documentRequests().slice(requestsBefore)).toEqual([agendaPath]);
  });

  it("keeps the old agenda when the fetch fails, does not list it as not fetched, and asks again on the next run", async () => {
    const system = await start();
    const original = await agendaText(system, era);

    system.clock.set(incrementAt);
    system.olis.amendRows("CommitteeMeetings", isSlbThirtieth, { AgendaRevisionNumber: 2 });
    system.olis.serveDocument(agendaPath, revisedAgenda);
    system.olis.failDocuments(`${system.olis.origin}${agendaPath}`, [404]);
    const requestsBefore = system.olis.documentRequests().length;
    await system.pullAgain();

    expect(await agendaText(system, era)).toBe(original);
    expect(system.olis.documentRequests().slice(requestsBefore)).toEqual([agendaPath]);
    const listed = JSON.stringify(system.buildReport()["documents_not_fetched"] ?? []);
    expect(listed).not.toContain(agendaId);

    // The URL answers again, and the old recorded revision makes the next run ask again.
    await system.pullAgain();
    expect(await agendaText(system, era)).toContain("MADE UP agenda, revision 2");
    expect(system.olis.documentRequests().slice(requestsBefore)).toEqual([agendaPath, agendaPath]);
  });
});
