// Seam 1 (test/CLAUDE.md): `get_document`'s `timecode` on a Recording Log long enough to be several parts with the gate off
// (ticket #174, ADR-0061). With the gate off the log is cut as its text alone, and the part is the one that holds where the
// worker placed the turn's line. No fixture log, and no 2026R1 log, is over one part with the gate off (the longest is 11,270
// characters), so nothing else reaches that branch.
//
// THE LOG IS MADE UP (test/support/made-up-pdf.ts), at the fixture's meeting of HALNRW 2025-01-22, row 999201: a made-up log's
// text is not a quotation of OLIS's. It is 700 turns, one a second from 00:00:10, each "Pat Poe N, MADE UP Association of
// Filler Words" (about 60 characters a line), 60 lines to a page, so its text is over 20,000 characters, two or three parts. Its first
// page's lines carry player links to a made-up event; the lines after it are placed by their timecodes.
//
// Expected values are the log's own lines: the part a turn is in is found by reading the parts by number and looking for the
// turn's line, never from the tool's answer to the timecode.
//
// Which cases copy (test/CLAUDE.md, "Templates"): the describe copies the run's template of the fixture's pull (documents
// served, the gate off), adds the made-up row, serves its bytes and pulls, which fetches only what it adds; its cases only read.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { madeUpPdf, type MadeUpLink } from "../support/made-up-pdf.ts";
import { callTool, connectClient, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

const root = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeMeetingDocument";
const PLAYER = "https://olis.oregonlegislature.gov/liz/mediaplayer?clientID=4879615486";
const LOG = "recording-log-2025r1-999201";
const LINES_PER_PAGE = 60;

const timecodeOf = (second: number): string =>
  [Math.floor(second / 3600), Math.floor(second / 60) % 60, second % 60]
    .map((unit) => String(unit).padStart(2, "0"))
    .join(":");

const turnLines = Array.from(
  { length: 700 },
  (_, index) =>
    `${timecodeOf(10 + index)} Pat Poe ${String(index + 1).padStart(3, "0")}, MADE UP Association of Filler Words`,
);

function longLogBytes(): Uint8Array {
  const pages: string[][] = [];
  const all = ["MADE UP RECORDING LOG", ...turnLines];
  for (let start = 0; start < all.length; start += LINES_PER_PAGE) pages.push(all.slice(start, start + LINES_PER_PAGE));
  const links: MadeUpLink[] = [];
  (pages[0] ?? []).forEach((line, index) => {
    const second = Number(line.slice(0, 2)) * 3600 + Number(line.slice(3, 5)) * 60 + Number(line.slice(6, 8));
    if (!/^\d\d:\d\d:\d\d /.test(line)) return;
    const y = 760 - index * 12;
    for (const x of [40, 120]) {
      links.push({
        page: 1,
        url: `${PLAYER}&eventID=2099020201&startStreamAt=${second}`,
        rect: [x, y - 2, x + 60, y + 10],
      });
    }
  });
  return madeUpPdf(pages, { links });
}

type Part = { part: number; part_count: number; text: string };

let system: System;
let connected: ConnectedClient;

beforeAll(async () => {
  system = await startCopiedSystem({ clockAt: "2026-08-05T17:00:00Z", documents: true });
  system.olis.addRows("CommitteeMeetingDocuments", [
    {
      CommitteeMeetingDocumentId: 999201,
      SessionKey: "2025R1",
      CommitteeCode: "HALNRW",
      MeetingDate: "2025-01-22T08:00:00",
      ExhibitReference: null,
      ExhibitTitle: "MADE UP long recording log",
      Submitter: "staff",
      DocumentType: "Recording Log",
      MeasurePrefix: null,
      MeasureNumber: null,
      DocumentUrl: `${root}/999201`,
      CreatedDate: "2025-01-29T13:13:06.5416935",
      ModifiedDate: null,
    },
  ]);
  system.olis.serveDocument("/liz/2025R1/Downloads/CommitteeMeetingDocument/999201", longLogBytes());
  await system.pullAgain();
  connected = await connectClient("2026-07-28", system.handler);
}, 120_000);

afterAll(async () => {
  await connected.close();
  await system.stop();
});

async function partNumbered(part: number): Promise<Part> {
  const outcome = await callTool(connected, "get_document", { id: LOG, part });
  expect(outcome.isError, outcome.text).toBe(false);
  return outcome.structured as unknown as Part;
}

describe("get_document with a timecode on a made-up log of several parts, the gate off", () => {
  it("is several parts", async () => {
    const first = await partNumbered(1);

    expect(first.part_count).toBeGreaterThanOrEqual(2);
  });

  it("gives, for turns across the log, the part whose text holds the turn's line", async () => {
    const first = await partNumbered(1);
    const parts: Part[] = [];
    for (let number = 1; number <= first.part_count; number += 1) parts.push(await partNumbered(number));

    const seen = new Set<number>();
    for (const index of [0, 120, 250, 380, 500, 640, 699]) {
      const line = turnLines[index] ?? "";
      const timecode = line.slice(0, 8);
      const holding = parts.filter((part) => `\n${part.text}`.includes(`\n${line}`)).map((part) => part.part);
      expect(holding, `the log's own part for ${timecode}`).toHaveLength(1);

      const outcome = await callTool(connected, "get_document", { id: LOG, timecode });

      expect(outcome.isError, `${timecode}: ${outcome.text}`).toBe(false);
      expect((outcome.structured as unknown as Part).part, `the part of the turn at ${timecode}`).toBe(holding[0]);
      seen.add(holding[0] ?? 0);
    }
    // The turns are in every part, so a tool that always answered part 1 (or the last) is wrong somewhere.
    expect(seen.size).toBe(first.part_count);
  });
});
