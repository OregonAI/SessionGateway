// Seam 1 (test/CLAUDE.md): ticket #53 (ADR-0037). An Agency Link's evidence document that the feed no longer lists (two
// complete full pulls in a row, ADR-0030) is flagged where it is named, and an Agency Link whose every evidence document
// is no longer listed is flagged and leaves search's Agency filter. It matters for the two kinds of evidence whose
// document is not the node the link sits on: a Fiscal Impact Statement and Testimony. Read with both kinds of client.
//
// Two systems, each as the feed stood on 2026-08-01 (every row exists, the documents are served, the embedder is the fake:
// which documents a filter keeps does not depend on how a meaning ranks, search-agency.test.ts), each changed once.
//
// The statement. SB 69's Fiscal Impact Statement is analysis 85414 (feed/MeasureAnalysisDocuments.json: MeasureAnalysisId
// "85414", DocumentType "Fiscal Impact Statement", Version "A"), and it lists "Bureau of Labor and Industries, Employment
// Department, Judicial Department, Department of Justice" (agency-links.test.ts). Its link sits on SB 69's A-Engrossed
// Version (ADR-0013). What else each of those Agencies has on SB 69, read from get_measure's agency_links before the
// change (the probe of this ticket, the same answer agency-links.test.ts quotes): the Judicial Department has the
// statement and nothing else on SB 69 (it has statements on SB 121 and HB 3027 too); the Employment Department has the
// statement, links derived through the A-Engrossed Version (ORS chapter 657B) and its name in the A-Engrossed Version's
// text, all on the A-Engrossed Version; the Department of Justice has the statement and its name in the A-Engrossed
// Version's text, on the same Version.
//
// Testimony. SB 69's Testimony 196915 has the Organization "Bureau of Labor and Industries" (feed/
// CommitteePublicTestimonies.json), and its link sits on the Measure. The Bureau has other links on SB 69, on other nodes.
// The second Testimony row is MADE UP: CommTestId 900001 for SB 983 with the Organization "Oregon State Treasury" (the
// registry's name, snapshot fixture), added with `addRows`. The fixture gives the Treasury no link on SB 983 (asserted
// before the change), so the Testimony is the Treasury's only evidence on that Measure.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";
import { madeUpTestimonyRow } from "../support/testimony.ts";
import { stopListing } from "../support/unlisted-rows.ts";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

type Example = { document_id: string; node_id?: string; no_longer_listed?: boolean; last_listed_at?: string };
type Entry = { agency_id: string; evidence: { kind: string; examples: Example[] }[] };
type Measure = {
  agency_links: {
    agencies: Entry[];
    documents: { id: string; no_longer_listed?: boolean; last_listed_at?: string }[];
  };
};
type FoundExample = { document_id: string; no_longer_listed?: boolean; last_listed_at?: string };
type Item = {
  id: string;
  measure_id: string;
  no_longer_listed?: boolean;
  evidence: { kind: string; examples: FoundExample[] }[];
};
type Found = { groups: { evidence_kind: string; items: Item[] }[] };
type Hit = { id: string; measure: string | null };

/** What one kind of client reads of one Agency. */
type Read = { measure: Measure; found: Found; hits: Hit[] };

async function call(client: ConnectedClient, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const outcome = await callTool(client, tool, args);
  expect(outcome.isError, outcome.text).toBe(false);
  return outcome.structured;
}

async function readAgency(client: ConnectedClient, agency: string, measure: string): Promise<Read> {
  return {
    measure: (await call(client, "get_measure", { measure })) as Measure,
    found: (await call(client, "find_measures", { agency })) as Found,
    hits: ((await call(client, "search", { query: "sick time paid leave", agency, limit: 50 })) as { results: Hit[] })
      .results,
  };
}

const exampleOf = (read: Read, agency: string, kind: string, document: string): Example | undefined =>
  read.measure.agency_links.agencies
    .find((entry) => entry.agency_id === agency)
    ?.evidence.find((group) => group.kind === kind)
    ?.examples.find((example) => example.document_id === document);

const documentOf = (read: Read, id: string): Measure["agency_links"]["documents"][number] | undefined =>
  read.measure.agency_links.documents.find((document) => document.id === id);

/** The item of a group for a node, in what find_measures found. */
const itemOf = (read: Read, kind: string, node: string): Item | undefined =>
  read.found.groups.find((group) => group.evidence_kind === kind)?.items.find((item) => item.id === node);

const exampleOfItem = (item: Item | undefined, kind: string, document: string): FoundExample | undefined =>
  item?.evidence.find((group) => group.kind === kind)?.examples.find((example) => example.document_id === document);

const measuresOf = (hits: Hit[]): string[] => [...new Set(hits.map((hit) => hit.measure ?? "none"))].toSorted();

function clientAt(clients: ConnectedClient[], index: number): ConnectedClient {
  const client = clients[index];
  if (client === undefined) throw new Error(`No client ${index}`);
  return client;
}

const statement = "analysis-2025r1-85414";
const aEngrossed = "version-2025r1-sb69-a-engrossed";
const sb69 = "measure-2025r1-sb69";

describe("the Fiscal Impact Statement 85414 the feed no longer lists", () => {
  let system: System;
  const clients: ConnectedClient[] = [];
  const agencies = ["judicial-department", "department-of-justice", "employment-department"];
  const before = new Map<string, Read>();
  const after = new Map<string, Read>();
  const key = (era: string, agency: string): string => `${era} ${agency}`;

  beforeAll(async () => {
    system = await startSystem({
      clockAt: "2026-08-01T17:00:00Z",
      documents: true,
      serverEnv: { MCP_RATE_LIMIT: "100000" },
    });
    for (const era of eras) clients.push(await connectClient(era, system.handler));
    for (const [index, era] of eras.entries()) {
      for (const agency of agencies)
        before.set(key(era, agency), await readAgency(clientAt(clients, index), agency, "SB 69"));
    }
    stopListing(system.olis, "MeasureAnalysisDocuments", (row) => row["MeasureAnalysisId"] === "85414");
    system.clock.set("2026-08-02T17:00:00Z");
    await system.pullAgain();
    system.clock.set("2026-08-03T17:00:00Z");
    await system.pullAgain();
    for (const [index, era] of eras.entries()) {
      for (const agency of agencies)
        after.set(key(era, agency), await readAgency(clientAt(clients, index), agency, "SB 69"));
    }
  });

  afterAll(async () => {
    for (const client of clients) await client.close();
    await system.stop();
  });

  const readOf = (reads: Map<string, Read>, era: string, agency: string): Read => {
    const read = reads.get(key(era, agency));
    if (read === undefined) throw new Error(`No read for ${era} ${agency}`);
    return read;
  };

  describe.for(eras)("for a %s client", (era) => {
    // Box 1.
    it("get_measure flags the statement in agency_links.documents with the time the feed last listed it, and flags no other document", () => {
      const was = readOf(before, era, "judicial-department");
      const now = readOf(after, era, "judicial-department");

      expect(documentOf(was, statement)?.no_longer_listed).toBeUndefined();
      expect(documentOf(now, statement)?.no_longer_listed).toBe(true);
      expect(documentOf(now, statement)?.last_listed_at).toBe("2026-08-01T10:00:00-07:00");
      expect(now.measure.agency_links.documents.filter((document) => document.id !== statement)).toSatisfy(
        (others: Measure["agency_links"]["documents"]) => others.every((d) => d.no_longer_listed === undefined),
      );
    });

    // Box 1, find_measures. The Employment Department's item for the A-Engrossed Version stays unflagged (box 3), but the
    // example that names the statement is flagged: the document is not listed.
    it("find_measures flags each evidence example that names the statement, for each Agency the statement names", () => {
      for (const agency of agencies) {
        const was = itemOf(readOf(before, era, agency), "fiscal-impact-statement", aEngrossed);
        const now = itemOf(readOf(after, era, agency), "fiscal-impact-statement", aEngrossed);

        expect(exampleOfItem(was, "fiscal-impact-statement", statement)?.no_longer_listed).toBeUndefined();
        expect(exampleOfItem(now, "fiscal-impact-statement", statement)?.no_longer_listed).toBe(true);
        expect(exampleOfItem(now, "fiscal-impact-statement", statement)?.last_listed_at).toBe(
          "2026-08-01T10:00:00-07:00",
        );
      }
    });

    // Box 2.
    it("flags the Judicial Department's link, whose only evidence on SB 69 is the statement, in get_measure and find_measures", () => {
      const was = readOf(before, era, "judicial-department");
      const now = readOf(after, era, "judicial-department");

      expect(exampleOf(was, "judicial-department", "fiscal-impact-statement", statement)?.no_longer_listed).toBe(
        undefined,
      );
      expect(exampleOf(now, "judicial-department", "fiscal-impact-statement", statement)?.no_longer_listed).toBe(true);
      expect(itemOf(was, "fiscal-impact-statement", aEngrossed)?.no_longer_listed).toBeUndefined();
      // The item stays in the list, flagged (ADR-0031), and so do the Judicial Department's statements on other Measures.
      expect(itemOf(now, "fiscal-impact-statement", aEngrossed)?.no_longer_listed).toBe(true);
      expect(
        now.found.groups
          .find((group) => group.evidence_kind === "fiscal-impact-statement")
          ?.items.map((item) => [item.id, item.no_longer_listed === true]),
      ).toEqual(
        was.found.groups
          .find((group) => group.evidence_kind === "fiscal-impact-statement")
          ?.items.map((item) => [item.id, item.id === aEngrossed]),
      );
    });

    it("leaves SB 69 out of search's Agency filter for the Judicial Department, which still finds the Measures it has other evidence on", () => {
      const was = measuresOf(readOf(before, era, "judicial-department").hits);
      const now = measuresOf(readOf(after, era, "judicial-department").hits);

      expect(was).toContain(sb69);
      expect(now).not.toContain(sb69);
      expect(now.length).toBeGreaterThan(0);
    });

    // Box 3.
    it.for(["department-of-justice", "employment-department"])(
      "keeps %s's link unflagged everywhere, and SB 69 in search's filter: it has other listed evidence on the same node",
      (agency) => {
        const was = readOf(before, era, agency);
        const now = readOf(after, era, agency);

        expect(exampleOf(now, agency, "fiscal-impact-statement", statement)?.no_longer_listed).toBeUndefined();
        expect(itemOf(now, "fiscal-impact-statement", aEngrossed)?.no_longer_listed).toBeUndefined();
        expect(itemOf(now, "named-in-text", aEngrossed)?.no_longer_listed).toBeUndefined();
        expect(measuresOf(was.hits)).toContain(sb69);
        expect(measuresOf(now.hits)).toContain(sb69);
      },
    );
  });
});

describe("Testimony the feed no longer lists", () => {
  let system: System;
  const clients: ConnectedClient[] = [];
  const boli = "bureau-of-labor-and-industries";
  const treasury = "oregon-state-treasury";
  const real = "testimony-2025r1-196915";
  const madeUp = "testimony-2025r1-900001";
  const sb983 = "measure-2025r1-sb983";
  const before = new Map<string, Read>();
  const after = new Map<string, Read>();
  const key = (era: string, agency: string): string => `${era} ${agency}`;

  beforeAll(async () => {
    system = await startSystem({
      clockAt: "2026-08-01T17:00:00Z",
      documents: true,
      serverEnv: { MCP_RATE_LIMIT: "100000" },
    });
    for (const client of eras) clients.push(await connectClient(client, system.handler));
    // MADE UP: a Testimony row for SB 983 whose Organization is the Treasury's registry name; the next pull lists it.
    system.olis.addRows("CommitteePublicTestimonies", [
      madeUpTestimonyRow({ commTestId: 900001, organization: "Oregon State Treasury" }),
    ]);
    system.clock.set("2026-08-02T17:00:00Z");
    await system.pullAgain();
    for (const [index, era] of eras.entries()) {
      before.set(key(era, boli), await readAgency(clientAt(clients, index), boli, "SB 69"));
      before.set(key(era, treasury), await readAgency(clientAt(clients, index), treasury, "SB 983"));
    }
    const isTestimony = (row: Record<string, unknown>): boolean =>
      row["CommTestId"] === 196915 || row["CommTestId"] === 900001;
    stopListing(system.olis, "CommitteePublicTestimonies", isTestimony);
    system.clock.set("2026-08-03T17:00:00Z");
    await system.pullAgain();
    system.clock.set("2026-08-04T17:00:00Z");
    await system.pullAgain();
    for (const [index, era] of eras.entries()) {
      after.set(key(era, boli), await readAgency(clientAt(clients, index), boli, "SB 69"));
      after.set(key(era, treasury), await readAgency(clientAt(clients, index), treasury, "SB 983"));
    }
  });

  afterAll(async () => {
    for (const client of clients) await client.close();
    await system.stop();
  });

  const readOf = (reads: Map<string, Read>, era: string, agency: string): Read => {
    const read = reads.get(key(era, agency));
    if (read === undefined) throw new Error(`No read for ${era} ${agency}`);
    return read;
  };

  describe.for(eras)("for a %s client", (era) => {
    it("get_measure flags the Testimony in agency_links.documents with the time the feed last listed it", () => {
      const was = readOf(before, era, boli);
      const now = readOf(after, era, boli);

      expect(documentOf(was, real)?.no_longer_listed).toBeUndefined();
      expect(documentOf(now, real)?.no_longer_listed).toBe(true);
      expect(documentOf(now, real)?.last_listed_at).toBe("2026-08-02T10:00:00-07:00");
    });

    it("flags the Bureau's Testimony link in get_measure and find_measures, and no other link of the Bureau", () => {
      const was = readOf(before, era, boli);
      const now = readOf(after, era, boli);

      expect(exampleOf(was, boli, "testimony", real)?.no_longer_listed).toBeUndefined();
      expect(exampleOf(now, boli, "testimony", real)?.no_longer_listed).toBe(true);
      expect(itemOf(now, "testimony", sb69)?.no_longer_listed).toBe(true);
      expect(exampleOfItem(itemOf(now, "testimony", sb69), "testimony", real)?.no_longer_listed).toBe(true);
      expect(itemOf(now, "fiscal-impact-statement", aEngrossed)?.no_longer_listed).toBeUndefined();
      expect(itemOf(now, "named-in-text", aEngrossed)?.no_longer_listed).toBeUndefined();
      // The Bureau has links on SB 69's other nodes, so search's filter still finds the Measure.
      expect(measuresOf(now.hits)).toContain(sb69);
    });

    it("leaves SB 983 out of search's Agency filter for the Treasury, whose only evidence on it is the Testimony", () => {
      const was = readOf(before, era, treasury);
      const now = readOf(after, era, treasury);

      // The Treasury has no other link on SB 983: before the change its only item there is the Testimony's.
      expect(
        was.found.groups.flatMap((group) =>
          group.items.filter((item) => item.measure_id === sb983).map((item) => [group.evidence_kind, item.id]),
        ),
      ).toEqual([["testimony", sb983]]);
      expect(measuresOf(was.hits)).toContain(sb983);
      expect(itemOf(was, "testimony", sb983)?.no_longer_listed).toBeUndefined();

      expect(itemOf(now, "testimony", sb983)?.no_longer_listed).toBe(true);
      expect(exampleOfItem(itemOf(now, "testimony", sb983), "testimony", madeUp)?.no_longer_listed).toBe(true);
      expect(measuresOf(now.hits)).not.toContain(sb983);
      expect(measuresOf(now.hits)).toContain(sb69);
    });
  });
});
