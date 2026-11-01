// Seam 1 (test/CLAUDE.md): the documents that search finds by their words and never by meaning (ADR-0006):
// agendas, Recording Logs and witness-registration lists. The embedding model is the real one, because the
// claim is about what the vector side would have found; the corpus is small, so that it embeds in a few
// seconds. The clock is 2025-01-15 14:00 Pacific, when the feed had created SLB's agenda for 2025-01-21 and the
// Introduced Versions of HB 3027, HB 3131, SB 64, SB 69 and SB 121, and nothing else.
//
// The fixture has no Recording Log, and its witness-registration lists are all created after 2025-01-22, when
// SB 64's Testimony 117281 (395,000 characters) comes in. So four rows are made up here, as the feed's
// CommitteeMeetingDocuments rows (fake OLIS `strayRows`), each served with a fixture file (`strayDocuments`):
//   - 900001: DocumentType "Witness Registration", the files of HB 3131's real list (row 288487);
//   - 900002: DocumentType "Meeting Material" titled "HB 3131 (witness registration)": the feed files 44 such
//     lists under Meeting Material, and one under Presentation (cache of 2026-10-28);
//   - 900003: DocumentType "Recording Log", with the text of HB 3131's Preliminary SMS (row 287931);
//   - 900004: DocumentType "Meeting Material", with that same text: the control that IS found by meaning.
//
// Its database is built by this file, once, with the real embedder, which is why it is not a copy of the run's
// template (test/CLAUDE.md, Database, Templates).
// It embeds about 13,000 characters (measured 2026-10-30); the early clock keeps that small.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { loadRealEmbedder } from "../support/real-embedder.ts";
import { startSystem, type System } from "../support/system.ts";

const root = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeMeetingDocument";

function exhibitRow(id: number, documentType: string, title: string): Record<string, unknown> {
  return {
    SessionKey: "2025R1",
    CommitteeMeetingDocumentId: id,
    CommitteeCode: "HALNRW",
    MeetingDate: "2025-01-22T08:00:00",
    ExhibitTitle: title,
    DocumentType: documentType,
    MeasurePrefix: "HB",
    MeasureNumber: 3131,
    DocumentUrl: `${root}/${id}`,
  };
}

let system: System;

beforeAll(async () => {
  system = await startSystem({
    clockAt: "2025-01-15T22:00:00Z",
    documents: true,
    embedder: await loadRealEmbedder(),
    olis: {
      strayRows: {
        CommitteeMeetingDocuments: [
          exhibitRow(900001, "Witness Registration", "HB 3131 (witness registration)"),
          exhibitRow(900002, "Meeting Material", "HB 3131 (witness registration)"),
          exhibitRow(900003, "Recording Log", "HALNRW 1-22-2025 Recording Log"),
          exhibitRow(900004, "Meeting Material", "HB 3131 background"),
        ],
      },
      strayDocuments: {
        "/liz/2025R1/Downloads/CommitteeMeetingDocument/900001": "committee-meeting-documents/288487.pdf",
        "/liz/2025R1/Downloads/CommitteeMeetingDocument/900002": "committee-meeting-documents/288487.pdf",
        "/liz/2025R1/Downloads/CommitteeMeetingDocument/900003": "committee-meeting-documents/287931.pdf",
        "/liz/2025R1/Downloads/CommitteeMeetingDocument/900004": "committee-meeting-documents/287931.pdf",
      },
    },
  });
}, 120_000);

afterAll(async () => {
  await system.stop();
});

type Hit = { id: string; kind: string; found_by: string[] };
const hitsOf = (outcome: { structured: Record<string, unknown> | undefined }): Hit[] =>
  outcome.structured?.["results"] as Hit[];

describe.for(eras)("what is found by words and never by meaning for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  // SLB's agenda for 2025-01-21 (committee-agendas/SLB/2025-01-21-08-00.pdf) lists SB 397: "Provides that laws
  // regarding employee entitlements for recovery of unpaid wages and penalties do not apply to wages and
  // penalties lost as a result of an employer's time-rounding policies". No Version of SB 397 is in the fixture.
  it("finds an agenda by its words, and the hit says it was found by its words alone", async () => {
    const outcome = await callTool(connected, "search", { query: "time-rounding policies unpaid wages penalties" });

    expect(hitsOf(outcome)[0]).toMatchObject({
      id: "agenda-2025r1-slb-2025-01-21-0800",
      kind: "agenda",
      found_by: ["keyword"],
    });
  });

  it("does not find an agenda from a question about what it says in other words, though nothing else answers it", async () => {
    // The question says what SB 397 does in words the agenda does not use ("clocking-in", "quarter hour", "reclaimed").
    // None of its keywords is in the agenda, so only meaning could bring the agenda up, and an agenda has none.
    const question =
      "Makes clear that shortfalls in pay caused by punching the clock to the nearest quarter hour cannot be reclaimed through litigation";

    const everything = await callTool(connected, "search", { query: question });
    const agendas = await callTool(connected, "search", { query: question, kind: "agenda" });

    expect(hitsOf(everything).length).toBeGreaterThan(0);
    expect(hitsOf(everything).map((hit) => hit.id)).not.toContain("agenda-2025r1-slb-2025-01-21-0800");
    expect(hitsOf(agendas)).toEqual([]);
  });

  it("finds a witness-registration list by its words: the feed's label, or a title that says so", async () => {
    // Names from the list (documents/committee-meeting-documents/288487.pdf): its first registrant.
    const outcome = await callTool(connected, "search", { query: "Karsyn Kendrick Coalition of Oregon Land Trusts" });

    const lists = hitsOf(outcome).filter(
      (hit) => hit.id === "exhibit-2025r1-900001" || hit.id === "exhibit-2025r1-900002",
    );
    expect(lists.map((hit) => hit.id).toSorted()).toEqual(["exhibit-2025r1-900001", "exhibit-2025r1-900002"]);
    expect(lists.map((hit) => hit.found_by)).toEqual([["keyword"], ["keyword"]]);
  });

  it("finds a Recording Log by its words, and an Exhibit of the same text by its words and its meaning", async () => {
    // Words of HB 3131's Preliminary SMS (documents/committee-meeting-documents/287931.pdf): "the grant awards
    // funded conservation easements for seven land trust grantees".
    const outcome = await callTool(connected, "search", {
      query: "grant awards funded conservation easements seven land trust grantees",
    });

    const byId = new Map(hitsOf(outcome).map((hit) => [hit.id, hit]));
    expect(byId.get("recording-log-2025r1-900003")).toMatchObject({ kind: "recording_log", found_by: ["keyword"] });
    expect(byId.get("exhibit-2025r1-900004")?.found_by).toEqual(["keyword", "embedding"]);
  });

  it("finds a witness-registration list and a Recording Log from a question that has a word they lack, by the words they have", async () => {
    // "zzqx" is in no document, so no passage holds every word of either question: the lists have no meaning side to
    // fall back on, and are found by the words they do have. The Exhibit that has the Recording Log's text is not:
    // it is found by its meaning, which is the other half of what ADR-0006 says.
    const list = await callTool(connected, "search", {
      query: "Karsyn Kendrick Coalition of Oregon Land Trusts zzqx",
    });
    const log = await callTool(connected, "search", {
      query: "grant awards funded conservation easements seven land trust grantees zzqx",
    });

    const listIds = ["exhibit-2025r1-900001", "exhibit-2025r1-900002"];
    expect(
      hitsOf(list)
        .filter((hit) => listIds.includes(hit.id))
        .map((hit) => [hit.id, hit.found_by]),
    ).toEqual([
      ["exhibit-2025r1-900001", ["keyword"]],
      ["exhibit-2025r1-900002", ["keyword"]],
    ]);
    const byId = new Map(hitsOf(log).map((hit) => [hit.id, hit]));
    expect(byId.get("recording-log-2025r1-900003")?.found_by).toEqual(["keyword"]);
    expect(byId.get("exhibit-2025r1-900004")?.found_by).toEqual(["embedding"]);
  });

  it("does not find a Recording Log, a witness-registration list or an agenda from a question in other words", async () => {
    // The text of the Preliminary SMS: "The Oregon Agricultural Heritage Fund (OAHF) was established as part of
    // the Oregon Agricultural Heritage Program (OAHP) in 2017 to help address challenges for farms and ranches
    // associated with farmland fragmentation and conversions, complex regulations, and planning for generational
    // transfers." The question is that, worded without any of those words, nor any other word of the text. The
    // Exhibit 900004 has the same text as the Recording Log 900003 and answers it; the Recording Log must not.
    const outcome = await callTool(connected, "search", {
      query:
        "A scheme launched in the previous decade that spares those who grow crops and raise cattle from carving up their holdings, and eases handing them down to their children",
    });

    const ids = hitsOf(outcome).map((hit) => hit.id);
    expect(ids).toContain("exhibit-2025r1-900004");
    expect(ids).not.toContain("recording-log-2025r1-900003");
    expect(ids).not.toContain("exhibit-2025r1-900001");
    expect(ids).not.toContain("exhibit-2025r1-900002");
    expect(hitsOf(outcome).filter((hit) => hit.kind === "agenda")).toEqual([]);
    // The witness-registration lists are Exhibits that list names, positions and cities (documents/committee-meeting-
    // documents/288487.pdf). A question about who signed up to speak, with none of the words the lists are made of,
    // finds neither of them.
    const speakers = await callTool(connected, "search", {
      query: "Which individuals put themselves forward to speak before the lawmakers, and where do they live?",
      kind: "exhibit",
    });
    const speakerIds = hitsOf(speakers).map((hit) => hit.id);
    expect(speakerIds).toContain("exhibit-2025r1-900004");
    expect(speakerIds).not.toContain("exhibit-2025r1-900001");
    expect(speakerIds).not.toContain("exhibit-2025r1-900002");
  });
});
