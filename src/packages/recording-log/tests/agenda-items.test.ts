import { describe, expect, test } from "vitest";
import { parseRecordingLog, type FeedAgendaItem } from "../index.ts";
import { agendaItem, e, playerLinks, turnsOf, type QuotedLink } from "./real-logs.ts";

// Seam 2: a log's lines matched against the Meeting's Agenda items as the feed gives them (#125, owner decision Q5 of
// 2026-11-05, amended by owner decision A of #126 on the same day: each line is matched on its own, and the feed wins).
// A line is an Agenda item when it matches one of the feed's items; otherwise the text heuristic decides that line, except
// that a line shaped like a person ("Name, Title", or "Name - Organization" where the right side reads like an
// organisation or "Self") is never taken by the heuristic.
//
// Quoted in the first rows: research cache video-research/dl/logs/sample/309689.pdf (JLCIMT 2025-05-16, feed document
// 309689, a Recording Log), lines 00:00:22 to 00:02:34, with the link annotations of those lines' rows; and, for the
// feed items, the 2025R1 cache's feed/CommitteeAgendaItems.json rows of that Meeting (CommitteCode "JLCIMT",
// MeetingDate 2025-05-16T08:30:00), each item as the feed has it, trimmed to the fields the parser takes.
//
// The rows after those quote the three fixture logs whose feed items are only some of the log's (the fixture is a slice, so
// it holds the CommitteeAgendaItems rows of its chosen Measures only): 288741 (HALNRW 2025-01-22, the fixture holds HB 3131
// of its five items), 289259 (HALNRW 2025-01-27, HB 3131 of six) and 295094 (SFR 2025-03-17, the log names SB 93 and SB 121,
// the feed SB 121). Each quotes the log's lines from test/fixtures/olis-2025R1/documents/committee-meeting-documents/<id>.pdf
// as the pdf-text package extracts them, with the /Rect and /URI of the link annotations of those lines' rows as the file
// holds them (read from the raw PDF, not from pdf.js), and the feed item as test/fixtures/olis-2025R1/feed/
// CommitteeAgendaItems.json has it (CommitteeAgendaItemId 201878, 202055 and 205863).
//
// Made up (labelled in each name): the speaker lines "Jane Doe - Self", "John Roe - Oregon Farm Bureau" and "Pat Poe,
// Informational Services Director", and the feed items that match nothing.

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

  test("made up (the feed items replaced by an item for HB 9999): none matches that line, so the text heuristic decides it and the result says so", () => {
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

  test("made up (309689 with a line 00:03:30 Jane Doe - Self added): a comma-less 'A - B' speaker line is not an Agenda item, with the feed's items matching other lines", () => {
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
  /** The feed's item of both HALNRW meetings (CommitteeAgendaItemId 201878 on 2025-01-22, 202055 on 2025-01-27: the same Measure, type, action and Comments). */
  const HB3131: FeedAgendaItem = {
    measurePrefix: "HB",
    measureNumber: 3131,
    meetingType: "Public Hearing",
    action: "Heard",
    comments:
      "Appropriates moneys to the Oregon Watershed Enhancement Board, out of the General Fund, for deposit in the Oregon Agricultural Heritage Fund.",
  };

  test("HALNRW 2025-01-22 (288741, event 2025011038): the feed holds HB 3131 of the five items, the others are Agenda items by the text, and each later turn carries its own", () => {
    // Lines 01:00:39 to 01:20:56, pages 2 and 3, skipping the lines between 01:00:39 and 01:14:42 (and the turn
    // 01:00:38 Co-Chair Helm, 01:01:23 to 01:10:49) and between 01:16:09 and 01:19:57.
    const parse = parseRecordingLog({
      text: `\f01:00:39 HB 2166 - Public Hearing
01:14:42 Rep. Marsh
01:15:48 HB 3131 - Public Hearing\fHALNRW
01/22/2025
Page 3 of 3
This recording log is in compliance with Senate and House Rules. For complete contents, refer to the digital audio recording.
01:15:49 Co-Chair Helm
01:16:09 Warren Seely, 4th-generation farmer, Warren Seely Farm, Clatskanie
01:19:57 HB 2164 - Public Hearing
01:19:58 Co-Chair Helm
01:20:56 Alice Morrison, Co-Director, Friends of Family Farmers`,
      links: playerLinks("2025011038", [
        [2, [69.75, 195.64, 122.29, 209.44], 3639],
        [2, [141.75, 195.64, 288.29, 209.44], 3639],
        [2, [69.75, 112.85, 122.29, 126.65], 4482],
        [2, [141.75, 112.85, 208.27, 126.65], 4482],
        [2, [69.75, 85.254, 122.29, 99.053], 4548],
        [2, [141.75, 85.254, 288.29, 99.053], 4548],
        [3, [69.75, 706.2, 122.29, 720], 4549],
        [3, [141.75, 706.2, 225.6, 720], 4549],
        [3, [69.75, 692.4, 122.29, 706.2], 4569],
        [3, [141.75, 692.4, 511.95, 706.2], 4569],
        [3, [69.75, 664.8, 122.29, 678.6], 4797],
        [3, [141.75, 664.8, 288.29, 678.6], 4797],
        [3, [69.75, 651.01, 122.29, 664.8], 4798],
        [3, [141.75, 651.01, 225.6, 664.8], 4798],
        [3, [69.75, 637.21, 122.29, 651.01], 4856],
        [3, [141.75, 637.21, 436.31, 651.01], 4856],
      ]),
      agendaItems: [HB3131],
    });

    expect(parse).toEqual({
      kind: "parsed",
      eventId: "2025011038",
      speakerTurns: turnsOf([
        ["01:14:42", 4482, "link", "Rep. Marsh", "HB 2166 - Public Hearing"],
        ["01:15:49", 4549, "link", "Co-Chair Helm", "HB 3131 - Public Hearing"],
        [
          "01:16:09",
          4569,
          "link",
          "Warren Seely, 4th-generation farmer, Warren Seely Farm, Clatskanie",
          "HB 3131 - Public Hearing",
        ],
        ["01:19:58", 4798, "link", "Co-Chair Helm", "HB 2164 - Public Hearing"],
        [
          "01:20:56",
          4856,
          "link",
          "Alice Morrison, Co-Director, Friends of Family Farmers",
          "HB 2164 - Public Hearing",
        ],
      ]),
      entries: [
        agendaItem("01:00:39", 3639, "HB 2166 - Public Hearing", "text"),
        agendaItem("01:15:48", 4548, "HB 3131 - Public Hearing", "feed"),
        agendaItem("01:19:57", 4797, "HB 2164 - Public Hearing", "text"),
      ],
      pagesReadByTimecode: [],
    });
  });

  test("HALNRW 2025-01-27 (289259, event 2025011111): the feed holds HB 3131 of the six items, so HB 2805 is an Agenda item by the text and its turns are not left under HB 3131", () => {
    // Lines 00:00:27 to 00:08:06, pages 1 and 2, with the member roster that ends page 1 and the head of page 2.
    const parse = parseRecordingLog({
      text: `00:00:27 HB 3131 - Public Hearing
00:00:28 Co-Chair Owens
00:07:42 HB 2805 - Public Hearing
00:07:43 Co-Chair Owens
MEMBERS PRESENT: Rep. Ken Helm, Co-Chair
Rep. Mark Owens, Co-Chair
Rep. Sarah Finger McDonald, Vice-Chair
Rep. Court Boice
Rep. Annessa Hartman
Rep. Bobby Levy
Rep. Pam Marsh
Rep. Susan McLain
Rep. Anna Scharf\fHALNRW
01/27/2025
Page 2 of 3
This recording log is in compliance with Senate and House Rules. For complete contents, refer to the digital audio recording.
00:08:06 Lisa Charpilloz Hanson, Director, Oregon Department of Agriculture (ODA)`,
      links: playerLinks("2025011111", [
        [1, [69.75, 222.04, 122.29, 235.84], 27],
        [1, [141.75, 222.04, 288.29, 235.84], 27],
        [1, [69.75, 208.24, 122.29, 222.04], 28],
        [1, [141.75, 208.24, 234.94, 222.04], 28],
        [1, [69.75, 97.853, 122.29, 111.65], 462],
        [1, [141.75, 97.853, 288.29, 111.65], 462],
        [1, [69.75, 84.054, 122.29, 97.853], 463],
        [1, [141.75, 84.054, 234.94, 97.853], 463],
        [2, [69.75, 706.2, 122.29, 720], 486],
        [2, [141.75, 706.2, 541.08, 720], 486],
      ]),
      agendaItems: [HB3131],
    });

    expect(parse).toEqual({
      kind: "parsed",
      eventId: "2025011111",
      speakerTurns: turnsOf([
        ["00:00:28", 28, "link", "Co-Chair Owens", "HB 3131 - Public Hearing"],
        ["00:07:43", 463, "link", "Co-Chair Owens", "HB 2805 - Public Hearing"],
        [
          "00:08:06",
          486,
          "link",
          "Lisa Charpilloz Hanson, Director, Oregon Department of Agriculture (ODA)",
          "HB 2805 - Public Hearing",
        ],
      ]),
      entries: [
        agendaItem("00:00:27", 27, "HB 3131 - Public Hearing", "feed"),
        agendaItem("00:07:42", 462, "HB 2805 - Public Hearing", "text"),
      ],
      pagesReadByTimecode: [],
    });
  });

  test("SFR 2025-03-17 (295094, event 2025031219): the log names SB 93 and SB 121 and the feed only SB 121, so SB 93 is an Agenda item by the text and the turns under it carry it until SB 121", () => {
    // Lines 00:00:43 to 00:03:44 (page 1), then 00:28:19 to 00:28:48 (page 2); the lines between are not quoted, and the
    // member roster that ends page 1 of the log is quoted where this quote breaks.
    const parse = parseRecordingLog({
      text: `00:00:43 SB 93 Public Hearing
00:00:49 Jonathan Hart, Economist
00:03:44 Scott Bruun
MEMBERS PRESENT: Sen. Mark Meek, Chair
Sen. Mike McLane, Vice-Chair
Sen. Bruce Starr\fSFR
3/17/2025
Page 2 of 2
This recording log is in compliance with Senate and House Rules. For complete contents, refer to the digital audio recording.
00:28:19 Chair Meek
00:28:31 SB 121 Public Hearing
00:28:48 Kyle Easton, Senior Economist`,
      links: playerLinks("2025031219", [
        [1, [69.75, 346.72, 122.29, 360.52], 43],
        [1, [141.75, 346.72, 263.65, 360.52], 43],
        [1, [69.75, 332.92, 122.29, 346.72], 49],
        [1, [141.75, 332.92, 284.32, 346.72], 49],
        [1, [69.75, 305.32, 122.29, 319.12], 224],
        [1, [141.75, 305.32, 212.29, 319.12], 224],
        [2, [69.75, 582.01, 122.29, 595.81], 1699],
        [2, [141.75, 582.01, 207.6, 595.81], 1699],
        [2, [69.75, 554.41, 122.29, 568.21], 1711],
        [2, [141.75, 554.41, 270.32, 568.21], 1711],
        [2, [69.75, 540.62, 122.29, 554.41], 1728],
        [2, [141.75, 540.62, 311, 554.41], 1728],
      ]),
      agendaItems: [
        {
          measurePrefix: "SB",
          measureNumber: 121,
          meetingType: "Public Hearing",
          action: "Heard",
          comments: "Extends the sunset for the earned income tax credit.",
        },
      ],
    });

    expect(parse).toEqual({
      kind: "parsed",
      eventId: "2025031219",
      speakerTurns: turnsOf([
        ["00:00:49", 49, "link", "Jonathan Hart, Economist", "SB 93 Public Hearing"],
        ["00:03:44", 224, "link", "Scott Bruun", "SB 93 Public Hearing"],
        ["00:28:19", 1699, "link", "Chair Meek", "SB 93 Public Hearing"],
        ["00:28:48", 1728, "link", "Kyle Easton, Senior Economist", "SB 121 Public Hearing"],
      ]),
      entries: [
        agendaItem("00:00:43", 43, "SB 93 Public Hearing", "text"),
        agendaItem("00:28:31", 1711, "SB 121 Public Hearing", "feed"),
      ],
      pagesReadByTimecode: [],
    });
  });

  test("SRULES 2025-05-05 (306568, event 2025051053): with no feed item matching, 'Executive Appointments - Public Hearing' is an Agenda item by the text and 'Betsy Imholt, Director, ...' a speaker", () => {
    // Lines 00:26:11 to 00:27:23, page 2.
    const parse = parseRecordingLog({
      text: `\f00:26:11 Executive Appointments - Public Hearing
00:26:12 Chair Jama
00:27:23 Betsy Imholt, Director, Department of Administrative Services`,
      links: playerLinks("2025051053", [
        [2, [69.75, 444.02, 121.62, 457.82], 1571],
        [2, [141.75, 444.02, 380.51, 457.82], 1571],
        [2, [69.75, 430.22, 122.29, 444.02], 1572],
        [2, [141.75, 430.22, 207.6, 444.02], 1572],
        [2, [69.75, 416.43, 122.29, 430.22], 1643],
        [2, [141.75, 416.43, 470.37, 430.22], 1643],
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

    expect(parse.kind === "parsed" && parse.entries).toEqual([
      agendaItem("00:26:11", 1571, "Executive Appointments - Public Hearing", "text"),
    ]);
    expect(parse.kind === "parsed" && parse.speakerTurns.map((turn) => [turn.speaker, turn.agendaItem])).toEqual([
      ["Chair Jama", "Executive Appointments - Public Hearing"],
      ["Betsy Imholt, Director, Department of Administrative Services", "Executive Appointments - Public Hearing"],
    ]);
  });

  const noMatch: FeedAgendaItem[] = [
    { measurePrefix: "HB", measureNumber: 9999, meetingType: "Public Hearing", action: "Heard", comments: "Made up." },
  ];

  describe.for<[string, readonly FeedAgendaItem[]]>([
    ["the feed's items match another line of the log", feedItems],
    ["no feed item matches any line", noMatch],
  ])("made up (a line added to 309689 after 00:02:34; %s)", ([, items]) => {
    // The line is added with the log's own player link address and a made-up second 210. Feed items that match no line
    // leave the text heuristic to decide every line, so the guard against a person-shaped line is what keeps it a speaker.
    test.for<[string, string, boolean]>([
      ["Jane Doe - Self", "a person and 'Self'", false],
      ["John Roe - Oregon Farm Bureau", "a person and an organisation", false],
      ["Pat Poe, Informational Services Director", "a person and a title that holds a word of the heuristic", false],
      ["Pat Poe - Cannabis Industry Alliance of Oregon", "a person and an organisation with 'of' in it", false],
      ["Oregon Health Authority - Budget Update", "an agency and a topic", true],
      ["Department of Energy - Energy Audits", "an agency and a topic", true],
      ["Introduction of Committee Members - Organizational Meeting", "the item of log 310489", true],
    ])("%s is an Agenda item: %s", ([line, , isItem]) => {
      const parse = parseRecordingLog({
        text: `${text}\n00:03:30 ${line}`,
        links: playerLinks(EVENT_ID, [
          ...links,
          [1, [69.75, 333.47, 117.36, 348.11], 210],
          [1, [141.75, 333.47, 243.84, 348.11], 210],
        ]),
        agendaItems: items,
      });

      expect(parse.kind === "parsed" && parse.entries.some((entry) => entry.text === line)).toBe(isItem);
      expect(parse.kind === "parsed" && parse.speakerTurns.some((turn) => turn.speaker === line)).toBe(!isItem);
    });
  });
});
