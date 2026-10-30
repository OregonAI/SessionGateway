// Seam 1 (test/CLAUDE.md): what the ingest worker makes of the passages it stores, as an operator reads it in
// build-report.json, and what the server finds once a pull has stored them. Each case builds its own system and
// pulls more than once, moving the clock between pulls. The embedder is the fake (test/support/fake-embedder.ts):
// the cases are about how often a passage is embedded and whether the server sees a new pull, not about how
// well anything ranks.
import { afterEach, describe, expect, it } from "vitest";
import type { Embedder } from "#/packages/embedder/index.ts";
import { createFakeEmbedder } from "../support/fake-embedder.ts";
import { callTool, connectClient } from "../support/mcp-clients.ts";
import { loadRealEmbedder } from "../support/real-embedder.ts";
import { recordEmbeddings } from "../support/recording-embedder.ts";
import { startSystem, type System } from "../support/system.ts";

const systems: System[] = [];

afterEach(async () => {
  for (const system of systems.splice(0)) await system.stop();
});

async function start(clockAt: string, embedder?: Embedder): Promise<System> {
  const system = await startSystem({ clockAt, documents: true, ...(embedder === undefined ? {} : { embedder }) });
  systems.push(system);
  return system;
}

type SearchIndexReport = {
  model: string;
  passages: number;
  keyword_only_passages: number;
  embedded: number;
  reused: number;
};

function searchIndexOf(system: System): SearchIndexReport {
  return system.buildReport()["search_index"] as SearchIndexReport;
}

// SB 64's Testimony 117286 and 117289 are byte-identical files (`cmp` finds no difference), a letter from the Oregon
// Center for Public Policy on SB 438 of 2023. The feed created 117286 on 2025-01-22 at 14:14:53 Pacific, 117288 at
// 14:35:58 and 117289 at 14:36:45 (CommitteePublicTestimonies rows), and no document at any time in between.
describe("identical Testimony", () => {
  const firstPull = "2025-01-22T22:36:00Z"; // 14:36 Pacific: 117286 is in, 117289 is not
  const secondPull = "2025-01-22T22:37:00Z"; // 14:37 Pacific: 117289 is the only document the feed created since

  it("is embedded once: a pull that stores the twin of a letter the index holds embeds none of its passages", async () => {
    const system = await start(firstPull);

    const first = searchIndexOf(system);
    expect(first.passages).toBeGreaterThan(0);
    expect(first.embedded).toBeGreaterThan(0);
    expect(first.embedded + first.reused + first.keyword_only_passages).toBe(first.passages);

    system.clock.set(secondPull);
    await system.pullAgain();

    const second = searchIndexOf(system);
    expect(second.passages).toBeGreaterThan(0);
    expect(second.embedded).toBe(0);
    expect(second.reused).toBe(second.passages);
    expect(second.keyword_only_passages).toBe(0);
  }, 60_000);

  it("embeds nothing when a pull finds nothing new: an unchanged passage is never embedded again", async () => {
    const system = await start(firstPull);
    const model = searchIndexOf(system).model;

    await system.pullAgain();

    expect(searchIndexOf(system)).toEqual({
      model,
      passages: 0,
      keyword_only_passages: 0,
      embedded: 0,
      reused: 0,
    });
  }, 60_000);

  it("is still found by meaning, each letter by its own id, and the server sees the second letter once the pull has stored it", async () => {
    const system = await start(firstPull);
    const connected = await connectClient("2026-07-28", system.handler);
    // Words of the letter ("implement monthly disbursement of state tax credits"), and one that no document has,
    // so that no passage holds all of them and only the meaning of the passages can bring the letter up.
    const query = {
      query: "plan to implement monthly disbursement of state tax credits household eligibility zzqx",
      measure: "SB 64",
      kind: "testimony",
    };
    const idsOf = (outcome: { structured: Record<string, unknown> | undefined }): string[] =>
      (outcome.structured?.["results"] as { id: string }[]).map((hit) => hit.id);

    const before = await callTool(connected, "search", query);
    expect(idsOf(before)).toContain("testimony-2025r1-117286");
    expect(idsOf(before)).not.toContain("testimony-2025r1-117289");

    system.clock.set(secondPull);
    await system.pullAgain();

    const after = await callTool(connected, "search", query);
    expect(idsOf(after)).toEqual(expect.arrayContaining(["testimony-2025r1-117286", "testimony-2025r1-117289"]));
    const hits = after.structured?.["results"] as { id: string; found_by: string[] }[];
    expect(hits.find((hit) => hit.id === "testimony-2025r1-117289")?.found_by).toEqual(["embedding"]);
    expect(after.structured?.["as_of"]).toBe("2025-01-22T14:37:00-08:00");
    await connected.close();
  }, 60_000);
});

// A document's file never changes (ADR-0005) but its feed row can: OLIS changes the Measure a piece of Testimony is
// filed under (ADR-0011). Search files each document under the Measure its row names now. The row here is made up:
// Testimony 900006, to SLB's meeting of 2025-01-28, served with the file of Testimony 117165 (a letter from the Oregon
// Climate and Agriculture Network), first filed under SB 69 and then under HB 3131.
describe("a row OLIS changes after the pull", () => {
  const olisRoot = "https://olis.oregonlegislature.gov/liz/2025R1";
  const row: Record<string, unknown> = {
    SessionKey: "2025R1",
    CommTestId: 900006,
    CommitteeCode: "SLB",
    MeetingDate: "2025-01-28T08:00:00",
    DocumentDescription: "Testimony",
    MeasurePrefix: "SB",
    MeasureNumber: 69,
    DocumentUrl: olisRoot,
  };

  it("is found under the Measure the row names now", async () => {
    const system = await startSystem({
      clockAt: "2025-01-15T22:00:00Z",
      documents: true,
      olis: {
        strayRows: { CommitteePublicTestimonies: [row] },
        strayDocuments: { "/liz/2025R1/Downloads/PublicTestimonyDocument/900006": "testimony/117165.pdf" },
      },
    });
    systems.push(system);
    const connected = await connectClient("2026-07-28", system.handler);
    const idsFor = async (measure: string): Promise<string[]> => {
      const outcome = await callTool(connected, "search", { query: "Oregon Climate and Agriculture Network", measure });
      return (outcome.structured?.["results"] as { id: string }[]).map((hit) => hit.id);
    };

    expect(await idsFor("SB 69")).toContain("testimony-2025r1-900006");
    expect(await idsFor("HB 3131")).not.toContain("testimony-2025r1-900006");

    row["MeasurePrefix"] = "HB";
    row["MeasureNumber"] = 3131;
    // The next pull begins later, so the index has a later as-of time, and its refresh of the row changes how the
    // document is filed: either tells the server to read its vectors again.
    system.clock.advance(60 * 60 * 1000);
    await system.pullAgain();

    expect(await idsFor("HB 3131")).toContain("testimony-2025r1-900006");
    expect(await idsFor("SB 69")).not.toContain("testimony-2025r1-900006");
    await connected.close();
  }, 60_000);
});

// A vector is kept under the hash of its passage's text and reused by it (ADR-0025), so it has to be a function of
// that text and of nothing that happened to be embedded beside it. The real model, with its weights quantized,
// scales its activations over the whole batch it is given, so a passage run with others gets a slightly different
// vector from the same passage run alone (cosine about 0.997 in the review of #9). The worker's embedder is
// wrapped to read the vectors it hands back (test/support/recording-embedder.ts).
describe("a passage's vector", () => {
  const startOf = (passage: { text: string }): string => passage.text.replace(/\s+/g, " ").slice(0, 60);
  const smallPull = "2025-01-15T22:00:00Z"; // 14:00 Pacific: 6 documents, SLB's agenda and the Introduced Versions of five Measures
  const largerPull = "2025-01-18T02:00:00Z"; // 2025-01-17 18:00 Pacific: the early Session of search.test.ts, 9 more documents

  it("is the one the model gives the passage on its own, whichever other documents were pulled with it", async () => {
    const model = await loadRealEmbedder();
    const small = recordEmbeddings(model);
    const larger = recordEmbeddings(model);
    await start(smallPull, small.embedder);
    await start(largerPull, larger.embedder);

    expect(small.embedded.length).toBeGreaterThan(5);
    expect(larger.embedded.length).toBeGreaterThan(small.embedded.length);
    const largerByText = new Map(larger.embedded.map((passage) => [passage.text, passage.vector]));
    const same = (a: Float32Array | undefined, b: Float32Array | undefined): boolean =>
      a !== undefined && b !== undefined && a.every((value, place) => value === b[place]);
    // The five Versions are in both pulls, with other documents beside them in the larger one.
    expect(
      small.embedded.filter((passage) => !same(largerByText.get(passage.text), passage.vector)).map(startOf),
    ).toEqual([]);
    // And each is what the model gives that passage with nothing beside it.
    const differing: string[] = [];
    for (const passage of larger.embedded) {
      const [alone] = await model.embedPassages([passage.text]);
      if (!same(passage.vector, alone)) differing.push(startOf(passage));
    }
    expect(differing).toEqual([]);
  }, 180_000);
});

// A document is cut into passages by the model's own tokenizer, in production and in every test: the fake embedder
// replaces the ONNX session and nothing else (test/support/fake-embedder.ts). Where a passage ends decides which
// citations a cut splits, so a test that ran the fake on cuts the real model never makes would show behaviour
// production does not have. An operator sees the cuts as the number of passages in build-report.json.
describe("the passages a document is cut into", () => {
  it("are the same whether the embedder runs the real model or the fake", async () => {
    const clockAt = "2025-01-18T02:00:00Z"; // 2025-01-17 18:00 Pacific: 15 documents
    const real = await start(clockAt, await loadRealEmbedder());
    const fake = await start(clockAt, await createFakeEmbedder());

    const realReport = searchIndexOf(real);
    const fakeReport = searchIndexOf(fake);
    expect(realReport.passages).toBeGreaterThan(50);
    expect(fakeReport.passages).toBe(realReport.passages);
    expect(fakeReport.keyword_only_passages).toBe(realReport.keyword_only_passages);
  }, 120_000);
});

// The server serves while the worker pulls (ADR-0007). A full pull records its as-of time first and stores its
// documents one by one afterwards, so a search in the middle of a pull sees the new as-of time with only some of
// the pull's documents stored. The vectors of the rest must still reach the meaning side once they are stored.
// SB 921's Introduced Version, created 2025-01-16 13:48 Pacific, is the one document the second pull gets late: its
// file hangs once, so that the pull waits on it while the test searches.
describe("a search in the middle of a pull", () => {
  const firstPull = "2025-01-15T22:00:00Z"; // 2025-01-15 14:00 Pacific: SB 921's Introduced Version is not in the feed yet
  const secondPull = "2025-01-18T02:00:00Z"; // 2025-01-17 18:00 Pacific
  const sb921 = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB921/Introduced";
  // Words of SB 921's Introduced Version (it requires the Oregon Business Development Department to study needed
  // investments in shipyards), and one that no document has, so that only the meaning of its passages can bring it up.
  const query = "Oregon Business Development Department study needed investments in shipyards zzqx";

  it("does not hide the documents the pull stores after it from the meaning side", async () => {
    const system = await startSystem({
      clockAt: firstPull,
      documents: true,
      documentTimeoutMs: 3000,
      olis: { documentFailures: { [sb921]: ["hang"] } },
    });
    systems.push(system);
    const connected = await connectClient("2026-07-28", system.handler);
    const idsOf = async (): Promise<string[]> => {
      const outcome = await callTool(connected, "search", { query });
      return (outcome.structured?.["results"] as { id: string }[]).map((hit) => hit.id);
    };
    expect(await idsOf()).not.toContain("version-2025r1-sb921-introduced");

    system.clock.set(secondPull);
    const pull = system.pullAgain();
    for (let waited = 0; !system.olis.documentRequests().includes(new URL(sb921).pathname); waited += 20) {
      if (waited > 10_000) throw new Error("The worker never asked for SB 921's Introduced Version");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // The pull has stored the documents before SB 921's and waits for its file. A search now reads the vectors there are.
    expect(await idsOf()).not.toContain("version-2025r1-sb921-introduced");
    await pull;

    const hits = (await callTool(connected, "search", { query })).structured?.["results"] as {
      id: string;
      found_by: string[];
    }[];
    expect(hits[0]).toMatchObject({ id: "version-2025r1-sb921-introduced", found_by: ["embedding"] });
    await connected.close();
  }, 60_000);
});

// OLIS changes a row after the file was stored (ADR-0005): the label of an Exhibit can change from a witness-registration
// list, which is found by its words and never embedded, to material, which is found by its meaning too, and back. The
// pull that sees the new label moves the document across, in either direction. The rows here are made up: Exhibit
// 900005 is served with the text of HB 3131's Preliminary SMS (row 287931), filed first under one label and then under
// the other. The embedder is the fake, whose vectors point the same way for texts that share words; the query is words
// of the SMS and one that no document has ("zzqx"), so that no passage holds all of them and a document is found by
// its words only if it is keyword-only, and by its meaning only if it is not.
describe("an Exhibit whose label OLIS changes", () => {
  const root = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeMeetingDocument";
  const query = "Oregon Agricultural Heritage Fund established farmland fragmentation zzqx";
  const label = { list: "Witness Registration", material: "Meeting Material" } as const;

  async function startWith(documentType: string): Promise<{ system: System; row: Record<string, unknown> }> {
    const row: Record<string, unknown> = {
      SessionKey: "2025R1",
      CommitteeMeetingDocumentId: 900005,
      CommitteeCode: "HALNRW",
      MeetingDate: "2025-01-22T08:00:00",
      ExhibitTitle: "HB 3131 notes",
      DocumentType: documentType,
      MeasurePrefix: "HB",
      MeasureNumber: 3131,
      DocumentUrl: `${root}/900005`,
    };
    const system = await startSystem({
      clockAt: "2025-01-15T22:00:00Z",
      documents: true,
      olis: {
        strayRows: { CommitteeMeetingDocuments: [row] },
        strayDocuments: {
          "/liz/2025R1/Downloads/CommitteeMeetingDocument/900005": "committee-meeting-documents/287931.pdf",
        },
      },
    });
    systems.push(system);
    return { system, row };
  }

  async function foundBy(system: System): Promise<string[] | undefined> {
    const connected = await connectClient("2026-07-28", system.handler);
    const outcome = await callTool(connected, "search", { query, kind: "exhibit" });
    await connected.close();
    return (outcome.structured?.["results"] as { id: string; found_by: string[] }[]).find(
      (hit) => hit.id === "exhibit-2025r1-900005",
    )?.found_by;
  }

  it("is found by its meaning from the pull that sees it relabelled as material, and no longer by its words alone", async () => {
    const { system, row } = await startWith(label.list);
    expect(await foundBy(system)).toEqual(["keyword"]);

    row["DocumentType"] = label.material;
    system.clock.advance(60 * 60 * 1000);
    await system.pullAgain();

    expect(await foundBy(system)).toEqual(["embedding"]);
    const report = searchIndexOf(system);
    expect(report.embedded).toBeGreaterThan(0);
  }, 60_000);

  it("is found by its words alone from the pull that sees it relabelled as a witness-registration list, and no longer by its meaning", async () => {
    const { system, row } = await startWith(label.material);
    expect(await foundBy(system)).toEqual(["embedding"]);

    row["DocumentType"] = label.list;
    system.clock.advance(60 * 60 * 1000);
    await system.pullAgain();

    expect(await foundBy(system)).toEqual(["keyword"]);
  }, 60_000);
});
