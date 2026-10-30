// Seam 1 (test/CLAUDE.md): `testimony` as an agent sees it, with the whole system behind it. A fake OLIS
// serves the committed fixture and its documents as the feed stands on 2025-07-15 (after the last
// Testimony row of the fixture was created, on 2025-06-05), the ingest worker pulls them into a database,
// and an MCP client calls the tool in-process. One database serves every case in this file because none
// of them changes it. The cases that need rows the fixture lacks are in testimony-made-up.test.ts and
// testimony-large.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  system = await startSystem({ clockAt: "2025-07-15T17:00:00Z", documents: true });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

type PositionCount = { position_id: number; position: string; count: number };
type Item = { id: string; [field: string]: unknown };
type Group = { organization: string | null; spellings: string[]; count: number; items: Item[] };
type IdenticalLetter = { id_to_read: string; count: number; ids: string[]; ids_left_out: number };
type Position = { position_id: number; position: string; count: number; organizations: Group[] };

describe.for(eras)("testimony for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  // Spec #1 case (d) and the ticket's first box: "HB 3131 returns 42 rows: 41 support, 1 oppose". The rows are
  // the 42 CommitteePublicTestimonies rows of HB 3131 in test/fixtures/olis-2025R1/feed/ (41 with
  // PositionOnMeasureId 3983, and CommTestId 117368, David Wall of Newberg, with 3982). No row has 3981 or 4022.
  it("returns HB 3131's 42 rows: 41 support and 1 oppose, and none neutral or unknown", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "HB 3131" });

    expect(outcome.isError).toBe(false);
    expect(outcome.structured).toMatchObject({ measure_id: "measure-2025r1-hb3131", total: 42 });
    expect(outcome.structured?.["position_counts"] as PositionCount[]).toEqual([
      { position_id: 3983, position: "support", count: 41 },
      { position_id: 3982, position: "oppose", count: 1 },
      { position_id: 3981, position: "neutral", count: 0 },
      { position_id: 4022, position: "unknown", count: 0 },
    ]);
  });

  // The ticket's first box says "grouped by organization", and spec #1 case (d) says: "Portland" is the most
  // common Organization value. Eight of HB 3131's rows give it (feed/CommitteePublicTestimonies.json, all
  // support): 117167, 117201, 117213, 117225, 117226, 117282, 117386 spell it "Portland" and 117326 spells it
  // "PORTLAND". They are one group, shown by the spelling that comes first in CommTestId order.
  it("groups HB 3131's support by Organization, with Portland and PORTLAND as one group of eight", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "HB 3131" });

    const positions = outcome.structured?.["positions"] as Position[];
    expect(positions.map((position) => [position.position_id, position.position, position.count])).toEqual([
      [3983, "support", 41],
      [3982, "oppose", 1],
    ]);
    const support = positions[0]?.organizations ?? [];
    expect(support.reduce((rows, group) => rows + group.items.length, 0)).toBe(41);
    const portland = support.find((group) => group.organization === "Portland");
    expect(portland).toMatchObject({ organization: "Portland", spellings: ["Portland", "PORTLAND"], count: 8 });
    expect(portland?.items.map((item) => item.id)).toEqual([
      "testimony-2025r1-117167",
      "testimony-2025r1-117201",
      "testimony-2025r1-117213",
      "testimony-2025r1-117225",
      "testimony-2025r1-117226",
      "testimony-2025r1-117282",
      "testimony-2025r1-117326",
      "testimony-2025r1-117386",
    ]);
    // No other group of support has more rows than Portland's eight.
    expect(Math.max(...support.filter((group) => group !== portland).map((group) => group.count))).toBeLessThan(8);
  });

  // The one oppose row of HB 3131 (feed/CommitteePublicTestimonies.json, CommTestId 117368), field by field as the
  // feed gives it: the submitter's two names, BehalfOf, Organization, DocumentDescription, the committee and the
  // meeting's MeetingDate (2025-01-27T08:00:00, which the tool shows with Pacific time's offset in January). The
  // file is at /Downloads/PublicTestimonyDocument/{CommTestId} (spec #1, module 1). The tool returns no letter text.
  it("describes each item with who submitted it, for whom, from where, and the committee and meeting date", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "HB 3131" });

    const oppose = (outcome.structured?.["positions"] as Position[])[1];
    expect(oppose?.organizations).toHaveLength(1);
    expect(oppose?.organizations[0]?.items).toEqual([
      expect.objectContaining({
        id: "testimony-2025r1-117368",
        source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/PublicTestimonyDocument/117368",
        submitter: "David Wall",
        behalf_of: "Mr Oregon Opposes HB 3131",
        organization: "Newberg",
        document_description: "Testimony",
        committee_id: "committee-2025r1-halnrw",
        committee_code: "HALNRW",
        meeting_date: "2025-01-27T08:00:00-08:00",
        fetched: true,
        has_text_layer: true,
        agency_id: null,
      }),
    ]);
    expect(Object.keys(oppose?.organizations[0]?.items[0] ?? {})).not.toContain("text");
  });

  // Names and Organization are free text typed into a web form, and the tool shows them as the feed has them: row
  // 117182 has a space after the last name ("Albertson ") and after the city ("Lakeview "), 117213 a second space in
  // "Mike  Dill" (the first name is "Mike " and the last "Dill"), and 117167 has BehalfOf "Oregon Association of
  // Conservation Districts" under Organization "Portland": the real organization is in BehalfOf, not Organization.
  it("shows names, BehalfOf and Organization exactly as written, stray spaces included", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "HB 3131" });

    const items = (outcome.structured?.["positions"] as Position[])
      .flatMap((position) => position.organizations)
      .flatMap((group) => group.items);
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.size).toBe(42);
    expect(byId.get("testimony-2025r1-117182")).toMatchObject({
      submitter: "John Albertson ",
      behalf_of: null,
      organization: "Lakeview ",
    });
    expect(byId.get("testimony-2025r1-117213")).toMatchObject({
      submitter: "Mike  Dill",
      behalf_of: "Organically Grown Company",
      organization: "Portland",
    });
    expect(byId.get("testimony-2025r1-117167")).toMatchObject({
      submitter: "Andrea Kreiner",
      behalf_of: "Oregon Association of Conservation Districts",
      organization: "Portland",
    });
  });

  // The ticket's fourth box: "Each item has an id that `get_document` resolves". Every one of HB 3131's 42 ids
  // resolves to Testimony at the Legislature's /Downloads/PublicTestimonyDocument/{CommTestId} (spec #1,
  // module 1), the same source_url the item shows. One id is also asserted whole, as a literal.
  it("gives every item an id that get_document resolves, to the item's own source_url", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "HB 3131" });
    const items = (outcome.structured?.["positions"] as Position[])
      .flatMap((position) => position.organizations)
      .flatMap((group) => group.items);
    expect(items).toHaveLength(42);

    for (const item of items) {
      const document = await callTool(connected, "get_document", { id: item.id });
      expect(document.isError, item.id).toBe(false);
      expect(document.structured, item.id).toMatchObject({
        id: item.id,
        kind: "testimony",
        source_url: `https://olis.oregonlegislature.gov/liz/2025R1/Downloads/PublicTestimonyDocument/${item.id.replace("testimony-2025r1-", "")}`,
        has_text_layer: true,
      });
      expect(document.structured?.["source_url"], item.id).toBe(item["source_url"]);
    }

    const first = await callTool(connected, "get_document", { id: "testimony-2025r1-117165" });
    expect(first.structured).toMatchObject({
      id: "testimony-2025r1-117165",
      source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/PublicTestimonyDocument/117165",
    });
    expect(items.map((item) => item.id)).toContain("testimony-2025r1-117165");
  });

  // The lead checked HB 3131's 42 files by bytes, and `pdftotext -raw` over all 84 fixture files finds the same two
  // pairs of Testimony anywhere in the fixture (SB 64's 117286 and 117289, SB 921's two photographs) and none among
  // HB 3131's. So nothing is reported there, and no item points at another.
  it("reports no identical letters on HB 3131", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "HB 3131" });

    expect(outcome.structured?.["identical_letters"]).toEqual([]);
    const items = (outcome.structured?.["positions"] as Position[])
      .flatMap((position) => position.organizations)
      .flatMap((group) => group.items);
    expect(items.map((item) => item["same_letter_as"])).toEqual(Array<null>(42).fill(null));
  });

  // SB 64's Testimony 117286 and 117289 (Cedric Hayden, "Oregon State Senate ", SHS, 2025-01-23) are byte-identical
  // files: `sha256sum` gives c0bf7b78e4df... for both (98,777 bytes), and `pdftotext -raw` prints the same text.
  // 117281, 117283, 117284, 117288 and 117290 are the same submitter's other files; their hashes and their text
  // differ. The set is reported once, with the lowest CommTestId to read and the count; both items stay listed and
  // point at it, so the rows still add up to the Measure's 12 and who submitted what is not lost.
  it("reports SB 64's two byte-identical letters once, with a count, and points both items at it", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "SB 64" });

    expect(outcome.isError).toBe(false);
    expect(outcome.structured).toMatchObject({ measure_id: "measure-2025r1-sb64", total: 12 });
    expect(outcome.structured?.["identical_letters"] as IdenticalLetter[]).toEqual([
      {
        id_to_read: "testimony-2025r1-117286",
        count: 2,
        ids: ["testimony-2025r1-117286", "testimony-2025r1-117289"],
        ids_left_out: 0,
      },
    ]);
    const items = (outcome.structured?.["positions"] as Position[])
      .flatMap((position) => position.organizations)
      .flatMap((group) => group.items);
    expect(items).toHaveLength(12);
    const pointers = items
      .filter((item) => item["same_letter_as"] !== null)
      .map((item) => [item.id, item["same_letter_as"]]);
    expect(pointers).toEqual([
      ["testimony-2025r1-117286", "testimony-2025r1-117286"],
      ["testimony-2025r1-117289", "testimony-2025r1-117286"],
    ]);
  });

  // SB 921's Testimony 148731 and 148734 are two photographs (test/fixtures/olis-2025R1/README.md) with no text
  // layer, and `pdftotext` finds no character in either. Two files with nothing to read say nothing about each
  // other, so they are not a set; each is listed with the no-text-layer flag.
  it("does not take two files with no text layer for the same letter", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "SB 921" });

    expect(outcome.structured?.["identical_letters"]).toEqual([]);
    const items = (outcome.structured?.["positions"] as Position[])
      .flatMap((position) => position.organizations)
      .flatMap((group) => group.items);
    const photographs = items.filter((item) => ["148731", "148734"].some((id) => item.id.endsWith(id)));
    expect(
      photographs.map((item) => [
        item.id,
        item["document_description"],
        item["has_text_layer"],
        item["same_letter_as"],
      ]),
    ).toEqual([
      ["testimony-2025r1-148731", "Photo", false, null],
      ["testimony-2025r1-148734", "Photo", false, null],
    ]);
  });
});
