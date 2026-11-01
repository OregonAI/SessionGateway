// Seam 1 (test/CLAUDE.md): `testimony` as an agent sees it, with the whole system behind it. A fake OLIS
// serves the committed fixture and its documents as the feed stands on 2025-07-15 (after the last
// Testimony row of the fixture was created, on 2025-06-05), the ingest worker pulls them into a database,
// and an MCP client calls the tool in-process. One database serves every case in this file because none
// of them changes it. The cases that need rows the fixture lacks are in testimony-made-up.test.ts and
// testimony-large.test.ts.
//
// Its database is shared by every case and is a copy of the run's template for its options (test/CLAUDE.md,
// Database, Templates).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

let system: System;

// The cases of both clients make about 130 calls, 42 of them to get_document, and the simulated clock never moves, so
// the default 120 calls a minute would refuse the last ones. The ceiling is raised here and is tested in
// meetings-pull.test.ts.
beforeAll(async () => {
  system = await startCopiedSystem({
    clockAt: "2025-07-15T17:00:00Z",
    documents: true,
    serverEnv: { MCP_RATE_LIMIT: "1000" },
  });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

type PositionCount = { position_id: number; position: string; count: number };
type Item = { id: string; [field: string]: unknown };
type Group = { organization: string | null; spellings: string[]; count: number; items: Item[] };
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

  // A page is 50 items, and HB 3131, the Measure spec #1 uses as its example, has 42 rows: all of them are on page 1 of
  // 1, and the answer says how many a page holds at the most.
  it("lists HB 3131's 42 rows on one page of at most 50", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "HB 3131" });

    expect(outcome.structured).toMatchObject({ page: 1, last_page: 1, page_size: 50 });
    const items = (outcome.structured?.["positions"] as Position[])
      .flatMap((position) => position.organizations)
      .flatMap((group) => group.items);
    expect(items).toHaveLength(42);
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
  });

  // The brief: "The tool returns no letter text. An agent reads a letter with `get_document`." The proof is the whole
  // list of an item's fields, written out here: a field added to an item, whatever it is called, fails this test
  // until someone reads it and adds it to the list. All 42 of HB 3131's items are checked, because an item is built
  // the same way for every row.
  it("gives each item exactly these fields, and none of them is a letter's text", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "HB 3131" });

    const items = (outcome.structured?.["positions"] as Position[])
      .flatMap((position) => position.organizations)
      .flatMap((group) => group.items);
    expect(items).toHaveLength(42);
    for (const item of items) {
      expect(Object.keys(item).toSorted(), item.id).toEqual([
        "agency_id",
        "behalf_of",
        "committee_code",
        "committee_id",
        "document_description",
        "fetched",
        "has_text_layer",
        "id",
        "meeting_date",
        "organization",
        "same_letter_as",
        "same_letter_count",
        "source_url",
        "submitter",
      ]);
    }
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
  // resolves to a Testimony with a text layer (spec #1, module 1: the file is at
  // /Downloads/PublicTestimonyDocument/{CommTestId}).
  it("gives every item an id that get_document resolves", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "HB 3131" });
    const items = (outcome.structured?.["positions"] as Position[])
      .flatMap((position) => position.organizations)
      .flatMap((group) => group.items);
    expect(items).toHaveLength(42);

    for (const item of items) {
      const document = await callTool(connected, "get_document", { id: item.id });
      expect(document.isError, item.id).toBe(false);
      expect(document.structured, item.id).toMatchObject({ id: item.id, kind: "testimony", has_text_layer: true });
    }
  });

  // The Legislature's own address for three of those files, as literals: the `source_url` that
  // test/fixtures/olis-2025R1/manifest.json records for CommTestId 117165 (Sophie Els), 117167 (Andrea Kreiner) and
  // 117368 (David Wall, the one oppose row). `get_document` is asked for the id and answers with that address. It is
  // not compared with what `testimony` says, because both read one DocumentLink and would agree on a wrong URL.
  it.for([
    [
      "testimony-2025r1-117165",
      "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/PublicTestimonyDocument/117165",
    ],
    [
      "testimony-2025r1-117167",
      "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/PublicTestimonyDocument/117167",
    ],
    [
      "testimony-2025r1-117368",
      "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/PublicTestimonyDocument/117368",
    ],
  ] as const)("resolves %s to the Legislature's file at %s", async ([id, sourceUrl]) => {
    const document = await callTool(connected, "get_document", { id });

    expect(document.isError).toBe(false);
    expect(document.structured).toMatchObject({ id, kind: "testimony", source_url: sourceUrl });
  });

  // The lead checked HB 3131's 42 files by bytes, and `pdftotext -raw` over all 84 fixture files finds the same two
  // pairs of Testimony anywhere in the fixture (SB 64's 117286 and 117289, SB 921's two photographs) and none among
  // HB 3131's. So nothing is reported there, and no item points at another.
  it("reports no identical letters on HB 3131", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "HB 3131" });

    expect(outcome.structured?.["identical_letters"]).toEqual([]);
    expect(outcome.structured).toMatchObject({ identical_letters_left_out: 0 });
    const items = (outcome.structured?.["positions"] as Position[])
      .flatMap((position) => position.organizations)
      .flatMap((group) => group.items);
    expect(items.map((item) => item["same_letter_as"])).toEqual(Array<null>(42).fill(null));
    expect(items.map((item) => item["same_letter_count"])).toEqual(Array<null>(42).fill(null));
  });

  // SB 64's Testimony 117286 and 117289 (Cedric Hayden, "Oregon State Senate ", SHS, 2025-01-23) are byte-identical
  // files: `sha256sum` gives c0bf7b78e4df... for both (98,777 bytes), and `pdftotext -raw` prints the same text.
  // 117281, 117283, 117284, 117288 and 117290 are the same submitter's other files; their hashes and their text
  // differ. The set is reported once, with the lowest CommTestId to read and the count; both items stay listed and
  // point at it, each saying the count too, so the rows still add up to the Measure's 12 and who submitted what is not lost.
  it("reports SB 64's two byte-identical letters once, with a count, and points both items at it", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "SB 64" });

    expect(outcome.isError).toBe(false);
    expect(outcome.structured).toMatchObject({ measure_id: "measure-2025r1-sb64", total: 12 });
    expect(outcome.structured?.["identical_letters"]).toEqual([{ id_to_read: "testimony-2025r1-117286", count: 2 }]);
    expect(outcome.structured).toMatchObject({ identical_letters_left_out: 0 });
    const items = (outcome.structured?.["positions"] as Position[])
      .flatMap((position) => position.organizations)
      .flatMap((group) => group.items);
    expect(items).toHaveLength(12);
    const pointers = items
      .filter((item) => item["same_letter_as"] !== null)
      .map((item) => [item.id, item["same_letter_as"], item["same_letter_count"]]);
    expect(pointers).toEqual([
      ["testimony-2025r1-117286", "testimony-2025r1-117286", 2],
      ["testimony-2025r1-117289", "testimony-2025r1-117286", 2],
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

  // The ticket's third box: "Testimony from an Agency carries its registry slug". The Organization of three rows
  // (feed/CommitteePublicTestimonies.json) is the whole of an Agency's name in the committed snapshot's registry
  // (test/fixtures/oregonai-snapshot/snapshot.json): SB 69's 196915 "Bureau of Labor and Industries" is
  // `bureau-of-labor-and-industries` and HB 3027's 122570 "Higher Education Coordinating Commission" is
  // `higher-education-coordinating-commission`. HB 3795's 209256 gives "ODHS", an alias of the Department of Human
  // Services in the registry since ERF 6c41efefb5 (ticket #49), so it carries `department-of-human-services`.
  it.for([
    ["SB 69", "testimony-2025r1-196915", "Bureau of Labor and Industries", "bureau-of-labor-and-industries"],
    [
      "HB 3027",
      "testimony-2025r1-122570",
      "Higher Education Coordinating Commission",
      "higher-education-coordinating-commission",
    ],
    ["HB 3795", "testimony-2025r1-209256", "ODHS", "department-of-human-services"],
  ] as const)("marks %s's Testimony %s from %j with the Agency slug %j", async ([citation, id, organization, slug]) => {
    const outcome = await callTool(connected, "testimony", { measure: citation });

    const items = (outcome.structured?.["positions"] as Position[])
      .flatMap((position) => position.organizations)
      .flatMap((group) => group.items);
    expect(items.find((item) => item.id === id)).toMatchObject({ organization, agency_id: slug });
  });

  // Nothing else is matched: HB 3131 names no Agency in any Organization, so no item of it carries a slug (the
  // matching is of the whole Organization against the registry, and cities and groups are not in it).
  it("marks no item of HB 3131 with an Agency slug", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "HB 3131" });

    const items = (outcome.structured?.["positions"] as Position[])
      .flatMap((position) => position.organizations)
      .flatMap((group) => group.items);
    expect(items.map((item) => item["agency_id"])).toEqual(Array<null>(42).fill(null));
  });

  // Two of HB 3131's rows spell a city in capitals: 117204 "Oregon City" and 117301 "OREGON CITY" (both support,
  // feed/CommitteePublicTestimonies.json). They are one group of two, shown as the first by CommTestId, 117204's.
  it("groups Oregon City and OREGON CITY together, under the spelling of the lower CommTestId", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "HB 3131" });

    const support = (outcome.structured?.["positions"] as Position[])[0];
    const city = support?.organizations.find((group) => group.organization === "Oregon City");
    expect(city).toMatchObject({ spellings: ["Oregon City", "OREGON CITY"], count: 2 });
    expect(city?.items.map((item) => item.id)).toEqual(["testimony-2025r1-117204", "testimony-2025r1-117301"]);
    // 33 groups in all: 32 of support and Newberg's, which is the one group of oppose.
    expect(outcome.structured).toMatchObject({ organization_groups: 33 });
    expect(support?.organizations).toHaveLength(32);
  });

  // The brief for #14: "Organization is free text and often a city (spec #1, Further Notes). Say so in the tool's
  // description". An agent reads the description before it reads a result, so it learns that grouping by
  // Organization is not grouping by organization, and where the real one often is (BehalfOf).
  it("says in its description that Organization is free text, often a city, and that BehalfOf often names the organization", async () => {
    const { tools } = await connected.client.listTools();

    const tool = tools.find((candidate) => candidate.name === "testimony");
    expect(tool?.description).toMatch(/free text/i);
    expect(tool?.description).toMatch(/city/i);
    expect(tool?.description).toMatch(/BehalfOf/);
    expect(tool?.annotations?.readOnlyHint).toBe(true);
  });

  // An identical-letter set is decided by the text a file holds, so a Testimony whose file is not fetched is in no set
  // (testimony-made-up.test.ts shows it). The output schema, which an agent reads before a result, says that the
  // count is of the rows whose files are held.
  it("says in its output schema that a set of identical letters counts only the rows whose files are held", async () => {
    const { tools } = await connected.client.listTools();

    const schema = tools.find((candidate) => candidate.name === "testimony")?.outputSchema as
      { properties: { identical_letters: { items: { properties: { count: { description: string } } } } } } | undefined;
    expect(schema?.properties.identical_letters.items.properties.count.description).toMatch(
      /counts only rows whose files this index holds/,
    );
  });

  // The index only adds and updates Testimony rows; one that OLIS stops listing stays until ticket #18 marks removals
  // (spec #1, module 2). So `total` is the rows this index holds from the feed it last read, which is what the output
  // schema says, and it does not claim to be what OLIS lists now.
  it("says in its output schema that total is the rows the index holds from the feed it last read, not what OLIS lists now", async () => {
    const { tools } = await connected.client.listTools();

    const schema = tools.find((candidate) => candidate.name === "testimony")?.outputSchema as
      { properties: { total: { description: string } } } | undefined;
    expect(schema?.properties.total.description).toMatch(/rows this index holds/);
    expect(schema?.properties.total.description).toMatch(/feed it last read/);
    expect(schema?.properties.total.description).not.toMatch(/OLIS lists/);
  });

  // An unknown Measure is an MCP error, as for get_measure and meetings (spec #1: "Errors are reported as MCP
  // errors"), and the message names what was asked for and how to ask.
  it("answers an unknown Measure with an error that names it", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "SB 9999" });

    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain('No Measure "SB 9999" in the 2025R1 Session.');
  });

  it("answers a Measure's id as well as its citation", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "measure-2025r1-hb3131" });

    expect(outcome.structured).toMatchObject({ measure_id: "measure-2025r1-hb3131", total: 42 });
  });

  // Every result carries the as-of time and the non-official notice (spec #1, "What every result must carry"); the
  // clock of this file is 2025-07-15 10:00 in Oregon, and the full pull began then.
  it("carries the as-of time and the notice that it is not the official record", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "HB 3131" });

    expect(outcome.structured?.["as_of"]).toBe("2025-07-15T10:00:00-07:00");
    expect(String(outcome.structured?.["notice"])).toMatch(/not the official record/i);
  });
});
