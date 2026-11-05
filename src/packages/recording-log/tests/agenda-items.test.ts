import { describe, expect, test } from "vitest";
import { parseRecordingLog, type FeedAgendaItem } from "../index.ts";
import { agendaItem, e, playerLinks, turnsOf, type QuotedLink } from "./real-logs.ts";

// Seam 2: a log's lines matched against the Meeting's Agenda items as the feed gives them (#125, owner decision Q5 of
// 2026-11-05). Quoted: research cache video-research/dl/logs/sample/309689.pdf (JLCIMT 2025-05-16, feed document
// 309689, a Recording Log), lines 00:00:22 to 00:02:34, with the link annotations of those lines' rows; and, for the
// feed items, the 2025R1 cache's feed/CommitteeAgendaItems.json rows of that Meeting (CommitteCode "JLCIMT",
// MeetingDate 2025-05-16T08:30:00), each item as the feed has it, trimmed to the fields the parser takes.
//
// Made up (labelled in each name): the speaker line "Jane Doe - Self" and the feed items that match nothing.

const EVENT_ID = "2025051213";

const text = `00:00:22 Meeting Called to Order
00:00:23 Representative Nathanson, Presiding Co-Chair
00:01:04 State Web Portal, e-Commerce, and Online Services
00:01:12 Sean McSpaden, Legislative Fiscal Office
00:02:34 Co-Chair Nathanson`;

const links: QuotedLink[] = [
  [1, [69.75, 420.51, 117.36, 435.16], 22],
  [1, [141.75, 420.51, 266.16, 435.16], 22],
  [1, [69.75, 405.86, 117.36, 420.51], 23],
  [1, [141.75, 405.86, 369.81, 420.51], 23],
  [1, [69.75, 377.41, 117.36, 392.06], 64],
  [1, [141.75, 377.41, 402.58, 392.06], 64],
  [1, [69.75, 362.76, 117.36, 377.41], 72],
  [1, [141.75, 362.76, 340.69, 377.41], 72],
  [1, [69.75, 348.11, 117.36, 362.76], 154],
  [1, [141.75, 348.11, 243.84, 362.76], 154],
];

/** The Meeting's items in the feed (CommitteeAgendaItems, PrintOrder 1 to 4; the "Tag Line" item has no Comments). */
const feedItems: FeedAgendaItem[] = [
  {
    measurePrefix: null,
    measureNumber: null,
    meetingType: null,
    action: null,
    comments: "<b>* PLEASE NOTE TIME CHANGE TO 8:30 AM *</b>\n",
  },
  {
    measurePrefix: null,
    measureNumber: null,
    meetingType: null,
    action: null,
    comments: "Presiding Co-Chair, Representative Nancy Nathanson\n",
  },
  {
    measurePrefix: null,
    measureNumber: null,
    meetingType: "Informational Meeting",
    action: null,
    comments:
      "State Web Portal, e-Commerce, and Online Services\n•  E-Government Program, E-Government Portal Advisory Board, Portal Provider Contract\n•  Oregon Business Xpress License Directory\n",
  },
  {
    measurePrefix: null,
    measureNumber: null,
    meetingType: null,
    action: null,
    comments: "DELETED: HB 3684 Relating to the security of state information technology assets\n",
  },
];

const AGENDA = "State Web Portal, e-Commerce, and Online Services";

describe("Agenda items matched against the Meeting's items in the feed", () => {
  test("JLCIMT 2025-05-16 (309689): the line that is the first line of a feed item's Comments is an Agenda item, and later turns carry it", () => {
    const parse = parseRecordingLog({ text, links: playerLinks(EVENT_ID, links), agendaItems: feedItems });

    expect(parse).toEqual({
      kind: "parsed",
      eventId: EVENT_ID,
      speakerTurns: turnsOf([
        ["00:00:23", 23, "link", "Representative Nathanson, Presiding Co-Chair", null],
        ["00:01:12", 72, "link", "Sean McSpaden, Legislative Fiscal Office", AGENDA],
        ["00:02:34", 154, "link", "Co-Chair Nathanson", AGENDA],
      ]),
      entries: [
        e("call-to-order", "00:00:22", 22, "Meeting Called to Order"),
        agendaItem("00:01:04", 64, AGENDA, "feed"),
      ],
      pagesReadByTimecode: [],
    });
  });

  test("the same log with no feed items passed: nothing says the line is an Agenda item, so it is a speaker turn", () => {
    const parse = parseRecordingLog({ text, links: playerLinks(EVENT_ID, links) });

    expect(parse.kind === "parsed" && parse.entries.map((entry) => entry.kind)).toEqual(["call-to-order"]);
  });

  test("made up (the feed items replaced by an item for HB 9999): none matches, so the text heuristic is the fallback and the result says so", () => {
    const quoted = `00:00:40 Adoption of Committee Rules - Organizational Meeting
00:00:41 Co-Chair Fahey`;
    // JLAC 2025-06-13 (feed document 315920), lines 00:00:40 and 00:00:41, with their links.
    const parse = parseRecordingLog({
      text: quoted,
      links: playerLinks("2025061121", [
        [1, [69.75, 215.09, 122.29, 228.89], 40],
        [1, [141.75, 215.09, 457.59, 228.89], 40],
        [1, [69.75, 201.29, 122.29, 215.09], 41],
        [1, [141.75, 201.29, 230.95, 215.09], 41],
      ]),
      agendaItems: [
        {
          measurePrefix: "HB",
          measureNumber: 9999,
          meetingType: "Public Hearing",
          action: "Heard",
          comments: "Made up.",
        },
      ],
    });

    expect(parse).toEqual({
      kind: "parsed",
      eventId: "2025061121",
      speakerTurns: turnsOf([
        ["00:00:41", 41, "link", "Co-Chair Fahey", "Adoption of Committee Rules - Organizational Meeting"],
      ]),
      entries: [agendaItem("00:00:40", 40, "Adoption of Committee Rules - Organizational Meeting", "text")],
      pagesReadByTimecode: [],
    });
  });

  test("made up (309689 with a line 00:03:30 Jane Doe - Self added): a comma-less 'A - B' speaker line is not an Agenda item when feed items match", () => {
    const parse = parseRecordingLog({
      text: `${text}\n00:03:30 Jane Doe - Self`,
      links: playerLinks(EVENT_ID, [
        ...links,
        [1, [69.75, 333.47, 117.36, 348.11], 210],
        [1, [141.75, 333.47, 243.84, 348.11], 210],
      ]),
      agendaItems: feedItems,
    });

    expect(parse.kind === "parsed" && parse.speakerTurns.at(-1)).toEqual({
      timecode: "00:03:30",
      offsetSeconds: 210,
      offsetSource: "link",
      speaker: "Jane Doe - Self",
      agendaItem: AGENDA,
    });
    expect(parse.kind === "parsed" && parse.entries.filter((entry) => entry.kind === "agenda-item")).toHaveLength(1);
  });

  test("made up (a measure's Agenda item as the feed has it, HB 2167 Public Hearing, Heard): the line with the measure id and its action is an Agenda item", () => {
    const parse = parseRecordingLog({
      text: "00:01:37 HB 2167 - Public Hearing\n00:01:38 Chair Owens",
      links: playerLinks("2025012201", [
        [1, [69.75, 300, 122.29, 314], 97],
        [1, [141.75, 300, 457.59, 314], 97],
        [1, [69.75, 286, 122.29, 300], 98],
        [1, [141.75, 286, 230.95, 300], 98],
      ]),
      agendaItems: [
        {
          measurePrefix: "HB",
          measureNumber: 2167,
          meetingType: "Public Hearing",
          action: "Heard",
          comments: "Made up.",
        },
      ],
    });

    expect(parse.kind === "parsed" && parse.entries).toEqual([
      agendaItem("00:01:37", 97, "HB 2167 - Public Hearing", "feed"),
    ]);
  });
});
