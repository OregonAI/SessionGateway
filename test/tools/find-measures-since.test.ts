// Seam 1: `find_measures` for an Agency "since yesterday" (ticket #16, spec #1 acceptance question (a)), with the
// whole system behind it. The fake OLIS serves the committed fixture as the feed stood at the clock, so each case
// asks at a simulated day and builds its own system. The cases that read the whole Session are in
// find-measures.test.ts.
//
// Expected values are literals from the fixture's feed rows (test/fixtures/olis-2025R1/feed/), read as Pacific
// time, and from the documents as `pdftotext` prints them.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

type Example = {
  document_id: string;
  unit?: string;
  terms?: string[];
  chapter_id?: string;
};
type KindEvidence = { kind: string; count: number; left_out: number; examples: Example[] };
type Item = {
  id: string;
  type: string;
  title: string;
  measure_id: string;
  source_url: string;
  created_at: string | null;
  last_created_at: string | null;
  evidence: KindEvidence[];
};
type Group = { evidence_kind: string; description: string; total: number; items: Item[] };
type Found = {
  query: { agency: string | null; ors_section: string | null; ors_chapter: string | null; since: string | null };
  total: number;
  page: number;
  last_page: number;
  page_size: number;
  groups: Group[];
  notes: string[];
  as_of: string;
  notice: string;
};

const boli = "bureau-of-labor-and-industries";

/** Starts a system at a simulated instant and connects one client of each era to it. */
function useSystemAt(clockAt: string): {
  system: () => System;
  client: (era: (typeof eras)[number]) => ConnectedClient;
} {
  let system: System;
  const clients = new Map<string, ConnectedClient>();
  beforeAll(async () => {
    system = await startCopiedSystem({ clockAt, documents: true, serverEnv: { MCP_RATE_LIMIT: "1000" } });
    for (const era of eras) clients.set(era, await connectClient(era, system.handler));
  }, 60_000);
  afterAll(async () => {
    for (const connected of clients.values()) await connected.close();
    await system.stop();
  });
  return {
    system: () => system,
    client: (era) => {
      const connected = clients.get(era);
      if (connected === undefined) throw new Error(`No ${era} client`);
      return connected;
    },
  };
}

async function find(connected: ConnectedClient, args: Record<string, unknown>): Promise<Found> {
  const outcome = await callTool(connected, "find_measures", args);
  expect(outcome.isError, outcome.text).toBe(false);
  return outcome.structured as unknown as Found;
}

const groupOf = (found: Found, kind: string): Group => {
  const group = found.groups.find((candidate) => candidate.evidence_kind === kind);
  if (group === undefined) throw new Error(`No group ${kind}`);
  return group;
};

// Spec #1 acceptance question (a): "what was introduced or posted since yesterday that touches statutes my Agency
// administers, or names my Agency in a Fiscal Impact Statement?" The clock is Friday 2025-01-24 at noon Pacific.
// SB 69's postings 26285, 26286, 26287 and 26288 (SB 69-1 and -2) were created on 2025-01-23 (feed/
// CommitteeProposedAmendments.json: 16:27:27.553, 16:27:27.63, 16:27:37.06 and 16:27:37.073); -1's first posting, 26284,
// was created on 2025-01-17 at 16:39:33.207. Both amendments amend ORS 657B.070, 659A.159, 659A.165, 657B.400,
// 657B.060, 653.616, 653.626 and 659A.156 (pdftotext of proposed-amendments/26284.pdf and 26286.pdf), in chapters 653,
// 657B and 659A, which the snapshot gives to the Bureau of Labor and Industries (chapter 653 to it alone).
describe("find_measures for an Agency, with the clock on 2025-01-24", () => {
  const at = useSystemAt("2025-01-24T20:00:00Z");

  describe.for(eras)("for a %s client", (era) => {
    it("returns the amendments posted yesterday that touch the Agency's statutes, newest first, and names the Statute Link", async () => {
      const found = await find(at.client(era), { agency: boli, since: "2025-01-23" });

      expect(found.query).toEqual({
        agency: boli,
        ors_section: null,
        ors_chapter: null,
        since: "2025-01-23T00:00:00-08:00",
      });
      const touching = groupOf(found, "derived");
      expect(touching.total).toBe(2);
      expect(touching.items.map((item) => [item.id, item.type, item.measure_id, item.title])).toEqual([
        ["amendment-2025r1-sb69-2", "proposed_amendment", "measure-2025r1-sb69", "SB 69-2"],
        ["amendment-2025r1-sb69-1", "proposed_amendment", "measure-2025r1-sb69", "SB 69-1"],
      ]);
      expect(touching.items[0]?.evidence.map((group) => [group.kind, group.count, group.left_out])).toEqual([
        ["derived", 3, 0],
      ]);
      expect(touching.items[0]?.evidence[0]?.examples.map((example) => example.chapter_id)).toEqual([
        "ors-chapter-657b",
        "ors-chapter-659a",
        "ors-chapter-653",
      ]);
    });

    it("gives each item's created time: the earliest posting, and the latest, as OLIS created them", async () => {
      const found = await find(at.client(era), { agency: boli, since: "2025-01-23" });

      const [second, first] = groupOf(found, "derived").items;
      expect([second?.created_at, second?.last_created_at]).toEqual([
        "2025-01-23T16:27:27.63-08:00",
        "2025-01-23T16:27:37.073-08:00",
      ]);
      expect([first?.created_at, first?.last_created_at]).toEqual([
        "2025-01-17T16:39:33.207-08:00",
        "2025-01-23T16:27:37.06-08:00",
      ]);
    });

    it("keeps the items in the other groups apart: nothing yet names the Agency in a Fiscal Impact Statement", async () => {
      const found = await find(at.client(era), { agency: boli, since: "2025-01-23" });

      expect(found.groups.map((group) => [group.evidence_kind, group.total])).toEqual([
        ["derived", 2],
        ["fiscal-impact-statement", 0],
        ["named-in-text", 2],
        ["testimony", 0],
      ]);
      expect(found.total).toBe(4);
    });

    it("returns an item created at the time asked for and none created before it", async () => {
      const found = await find(at.client(era), { agency: boli, since: "2025-01-23T16:27:37.073-08:00" });

      expect(groupOf(found, "derived").items.map((item) => item.id)).toEqual(["amendment-2025r1-sb69-2"]);
    });

    it("returns nothing created since the day after", async () => {
      const found = await find(at.client(era), { agency: boli, since: "2025-01-24" });

      expect(found.total).toBe(0);
      expect(found.groups.every((group) => group.items.length === 0)).toBe(true);
    });

    it("reads a time with no offset as Pacific and a time with an offset as that instant", async () => {
      const noOffset = await find(at.client(era), { agency: boli, since: "2025-01-23T16:27:37.073" });
      const utc = await find(at.client(era), { agency: boli, since: "2025-01-24T00:27:37.073Z" });

      expect(groupOf(noOffset, "derived").items.map((item) => item.id)).toEqual(["amendment-2025r1-sb69-2"]);
      expect(groupOf(utc, "derived").items.map((item) => item.id)).toEqual(["amendment-2025r1-sb69-2"]);
    });

    // ISO 8601 writes an offset with or without the colon, and Temporal's PlainDateTime ignores an offset it is given:
    // reading "+0000" as Pacific would move the time by eight hours without a word.
    it("reads an offset written without a colon as that offset, not as Pacific time", async () => {
      const found = await find(at.client(era), { agency: boli, since: "2025-01-24T00:27:37.073+0000" });

      expect(found.query.since).toBe("2025-01-23T16:27:37.073-08:00");
      expect(groupOf(found, "derived").items.map((item) => item.id)).toEqual(["amendment-2025r1-sb69-2"]);
    });

    // ISO 8601 and RFC 9557 write a time in more forms than "T" and an offset. SB 69-2's latest posting, 26288, was
    // created at 2025-01-23T16:27:37.073 Pacific (feed/CommitteeProposedAmendments.json), which is 2025-01-24T00:27:37.073
    // UTC (Pacific standard time, UTC-8, in January), so a `since` naming that instant keeps -2 and drops -1 (latest
    // posting 16:27:37.06). The first two rows are the inputs the review of #16 found read eight hours late or refused.
    it.for([
      [
        "a space for the T and a numeric offset",
        "2025-01-24 00:27:37.073+00:00",
        "2025-01-23T16:27:37.073-08:00",
        ["amendment-2025r1-sb69-2"],
      ],
      [
        "a space for the T and Z",
        "2025-01-24 00:27:37.073Z",
        "2025-01-23T16:27:37.073-08:00",
        ["amendment-2025r1-sb69-2"],
      ],
      ["a lower-case z", "2025-01-24T00:27:37.073z", "2025-01-23T16:27:37.073-08:00", ["amendment-2025r1-sb69-2"]],
      [
        "an offset and the zone it was written in (the review's input)",
        "2025-01-23T13:27:37.073-05:00[America/New_York]",
        "2025-01-23T10:27:37.073-08:00",
        ["amendment-2025r1-sb69-2", "amendment-2025r1-sb69-1"],
      ],
      [
        "an offset and a zone, at the posting's instant",
        "2025-01-23T19:27:37.073-05:00[America/New_York]",
        "2025-01-23T16:27:37.073-08:00",
        ["amendment-2025r1-sb69-2"],
      ],
      [
        "a zone and no offset: that zone's wall clock, not Pacific's",
        "2025-01-23T19:27:37.073[America/New_York]",
        "2025-01-23T16:27:37.073-08:00",
        ["amendment-2025r1-sb69-2"],
      ],
      [
        "a space for the T and no offset: Pacific",
        "2025-01-23 16:27:37.073",
        "2025-01-23T16:27:37.073-08:00",
        ["amendment-2025r1-sb69-2"],
      ],
    ] as const)("reads %s as the instant it names", async ([, written, read, derived]) => {
      const found = await find(at.client(era), { agency: boli, since: written });

      expect(found.query.since).toBe(read);
      expect(groupOf(found, "derived").items.map((item) => item.id)).toEqual(derived);
    });

    // With no time the answer also holds HB 3027's Introduced Version, created 2025-01-10 (feed/MeasureDocuments.json):
    // its SECTION 1 is "added to and made a part of ORS 345.010 to 345.340" (pdftotext of
    // measure-documents/HB3027/Introduced.pdf), and the snapshot gives chapter 345 to the Bureau among other Agencies.
    it("returns everything the index holds about the Agency when no time is given", async () => {
      const found = await find(at.client(era), { agency: boli });

      expect(found.query.since).toBeNull();
      expect(groupOf(found, "derived").items.map((item) => item.id)).toEqual([
        "amendment-2025r1-sb69-2",
        "amendment-2025r1-sb69-1",
        "version-2025r1-hb3027-introduced",
      ]);
    });
  });
});

// SB 69's Fiscal Impact Statement is analysis 85414, created 2025-01-30 at 10:43:53.29 (feed/
// MeasureAnalysisDocuments.json), and its "Government Unit(s) Affected:" line names the Bureau of Labor and Industries.
// Its label "A" is the A-Engrossed Version, which OLIS created on 2025-02-03 (feed/MeasureDocuments.json), so on
// 2025-01-31 the feed lists no Version for it to sit on: the link sits on the Measure (ADR-0013).
describe("find_measures for an Agency, with the clock on 2025-01-31", () => {
  const at = useSystemAt("2025-01-31T20:00:00Z");

  describe.for(eras)("for a %s client", (era) => {
    it("returns the Measure whose Fiscal Impact Statement was posted yesterday and names the Agency, apart from the statutes", async () => {
      const found = await find(at.client(era), { agency: boli, since: "2025-01-30" });

      const naming = groupOf(found, "fiscal-impact-statement");
      expect(naming.items.map((item) => [item.id, item.type, item.created_at, item.last_created_at])).toEqual([
        ["measure-2025r1-sb69", "measure", "2025-01-30T10:43:53.29-08:00", "2025-01-30T10:43:53.29-08:00"],
      ]);
      expect(
        naming.items[0]?.evidence.flatMap((group) =>
          group.examples.map((example) => [group.kind, example.document_id, example.unit]),
        ),
      ).toEqual([["fiscal-impact-statement", "analysis-2025r1-85414", "Bureau of Labor and Industries"]]);
      expect(groupOf(found, "derived").items).toEqual([]);
    });
  });
});

// On 2025-02-04 the A-Engrossed Version (created 2025-02-03 at 16:42:28.117) exists, so the statement of 2025-01-30
// sits on it, and the Version itself amends the sections of chapters 653, 657B and 659A and names the Bureau: one day
// shows both groups.
describe("find_measures for an Agency, with the clock on 2025-02-04", () => {
  const at = useSystemAt("2025-02-04T20:00:00Z");

  describe.for(eras)("for a %s client", (era) => {
    it("returns the A-Engrossed Version in both groups, each with its own created time", async () => {
      const found = await find(at.client(era), { agency: boli, since: "2025-01-30" });

      const touching = groupOf(found, "derived");
      expect(touching.items.map((item) => [item.id, item.type, item.created_at])).toEqual([
        ["version-2025r1-sb69-a-engrossed", "version", "2025-02-03T16:42:28.117-08:00"],
      ]);
      const naming = groupOf(found, "fiscal-impact-statement");
      expect(naming.items.map((item) => [item.id, item.type, item.created_at])).toEqual([
        ["version-2025r1-sb69-a-engrossed", "version", "2025-01-30T10:43:53.29-08:00"],
      ]);
      expect(
        naming.items[0]?.evidence.flatMap((group) => group.examples.map((example) => example.document_id)),
      ).toEqual(["analysis-2025r1-85414"]);
    });
  });
});
