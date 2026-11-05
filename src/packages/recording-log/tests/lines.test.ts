import { describe, expect, test } from "vitest";
import { parseRecordingLog } from "../index.ts";
import { agendaItem, e, playerLinks, turnsOf, vote, type ExpectedTurn, type QuotedLink } from "./real-logs.ts";

// Seam 2: a Recording Log's text and link annotations in; the event ID, the speaker turns and the other entries out
// (#125, spec #123 stage 1). One row for each wording variant, each quoting a real log and naming it: the document and
// the lines of its pdf-text extraction, with the annotations of those lines' rows (real-logs.ts says how they are quoted).
// A quote from page 2 starts with a form feed, the page break of the page it omits. A quote that skips lines between two it keeps says so in its name.

type Row = {
  name: string;
  /** The document and the lines of its pdf-text extraction the passage is. */
  source: string;
  eventId: string;
  text: string;
  links: QuotedLink[];
  turns: ExpectedTurn[];
  entries: ReturnType<typeof e>[];
};

const rows: Row[] = [
  {
    name: "a call to order, then the chair's turn before any Agenda item",
    source:
      "research cache video-research/dl/logs/halnrw_0122.pdf (HALNRW 2025-01-22, feed document 288741), lines 00:00:03-00:00:04, page 1",
    eventId: "2025011038",
    text: `00:00:03 Meeting Called to Order
00:00:04 Co-Chair Helm`,
    links: [
      [1, [69.75, 250.74, 122.29, 264.54], 3],
      [1, [141.75, 250.74, 273.64, 264.54], 3],
      [1, [69.75, 236.94, 122.29, 250.74], 4],
      [1, [141.75, 236.94, 225.6, 250.74], 4],
    ],
    turns: [["00:00:04", 4, "link", "Co-Chair Helm", null]],
    entries: [e("call-to-order", "00:00:03", 3, "Meeting Called to Order")],
  },
  {
    name: "an Agenda item that is not a Measure, and the chair's turn under it",
    source:
      "research cache video-research/dl/logs/halnrw_0122.pdf (HALNRW 2025-01-22, feed document 288741), lines 00:00:48-00:00:49, page 1",
    eventId: "2025011038",
    text: `00:00:48 Adoption of Committee Rules - Organizational Meeting
00:00:49 Co-Chair Helm`,
    links: [
      [1, [69.75, 209.34, 122.29, 223.14], 48],
      [1, [141.75, 209.34, 457.59, 223.14], 48],
      [1, [69.75, 195.54, 122.29, 209.34], 49],
      [1, [141.75, 195.54, 225.6, 209.34], 49],
    ],
    turns: [["00:00:49", 49, "link", "Co-Chair Helm", "Adoption of Committee Rules - Organizational Meeting"]],
    entries: [agendaItem("00:00:48", 48, "Adoption of Committee Rules - Organizational Meeting")],
  },
  {
    name: "a motion that wraps onto a second line",
    source:
      "research cache video-research/dl/logs/halnrw_0122.pdf (HALNRW 2025-01-22, feed document 288741), lines 00:00:52 and its wrap, page 1",
    eventId: "2025011038",
    text: `00:00:52 MOTION: VICE-CHAIR FINGER MCDONALD MOVES ADOPTION OF
COMMITTEE RULES`,
    links: [
      [1, [69.75, 181.75, 122.29, 195.54], 52],
      [1, [141.75, 181.75, 542.25, 195.54], 52],
      [1, [69.75, 167.95, 261.59, 181.75], 52],
    ],
    turns: [],
    entries: [e("motion", "00:00:52", 52, "MOTION: VICE-CHAIR FINGER MCDONALD MOVES ADOPTION OF COMMITTEE RULES")],
  },
  {
    name: "a vote with its tally, the names of the ayes and the excused on lines below",
    source:
      "research cache video-research/dl/logs/halnrw_0122.pdf (HALNRW 2025-01-22, feed document 288741), lines 00:01:09 and the three lines under it, page 1",
    eventId: "2025011038",
    text: `00:01:09 VOTE: 7-0-2
AYES: BOICE, HARTMAN, B. LEVY, MARSH, MCLAIN, FINGER
MCDONALD, HELM
EXCUSED: SCHARF, OWENS`,
    links: [
      [1, [69.75, 154.15, 122.29, 167.95], 69],
      [1, [141.75, 154.15, 542.25, 167.95], 69],
      [1, [69.75, 140.35, 542.25, 154.15], 69],
      [1, [69.75, 126.55, 542.25, 140.35], 69],
      [1, [69.75, 112.75, 310.94, 126.55], 69],
    ],
    turns: [],
    entries: [vote("00:01:09", 69, "VOTE: 7-0-2", [7, 0, 2])],
  },
  {
    name: "an Agenda item, then the member roster and the next page's header, then two turns under the item",
    source:
      "research cache video-research/dl/logs/halnrw_0122.pdf (HALNRW 2025-01-22, feed document 288741), lines 00:01:37 to 00:01:47, from the foot of page 1 to the head of page 2",
    eventId: "2025011038",
    text: `00:01:37 HB 2167 - Public Hearing
MEMBERS PRESENT: Rep. Ken Helm, Co-Chair
Rep. Sarah Finger McDonald, Vice-Chair
Rep. Court Boice
Rep. Annessa Hartman
Rep. Bobby Levy
Rep. Pam Marsh
Rep. Susan McLain
MEMBER(S) EXCUSED: Rep. Mark Owens, Co-Chair
Rep. Anna Scharf\fHALNRW
01/22/2025
Page 2 of 3
This recording log is in compliance with Senate and House Rules. For complete contents, refer to the digital audio recording.
00:01:38 Co-Chair Helm
00:01:47 Anna Glueder, LPRO Analyst`,
    links: [
      [1, [69.75, 85.15, 122.29, 98.95], 97],
      [1, [141.75, 85.15, 288.29, 98.95], 97],
      [2, [69.75, 706.2, 122.29, 720], 98],
      [2, [141.75, 706.2, 225.6, 720], 98],
      [2, [69.75, 692.4, 122.29, 706.2], 107],
      [2, [141.75, 692.4, 301.01, 706.2], 107],
    ],
    turns: [
      ["00:01:38", 98, "link", "Co-Chair Helm", "HB 2167 - Public Hearing"],
      ["00:01:47", 107, "link", "Anna Glueder, LPRO Analyst", "HB 2167 - Public Hearing"],
    ],
    entries: [agendaItem("00:01:37", 97, "HB 2167 - Public Hearing")],
  },
  {
    name: "titles that wrap onto a second line are joined, beside turns that are a legislator's name alone",
    source:
      "research cache video-research/dl/logs/halnrw_0122.pdf (HALNRW 2025-01-22, feed document 288741), lines 00:02:49 to 00:12:05, page 2",
    eventId: "2025011038",
    text: `\f00:02:49 Kurt Williams, Director, Oregon Veterinary Diagnostics Lab, Oregon State
University (OSU)
00:06:15 Melissa Rice, student, Carlson College of Veterinary Medicine, OSU
00:08:44 Wendy Krebs, graduate, Carlson College of Veterinary Medicine, OSU;
equine veterinarian, co-owner, Bend Equine Medical Center
00:11:29 Rep. B. Levy
00:12:05 Rep. McLain`,
    links: [
      [2, [69.75, 678.6, 122.29, 692.4], 169],
      [2, [141.75, 678.6, 542.25, 692.4], 169],
      [2, [69.75, 664.8, 236.26, 678.6], 169],
      [2, [69.75, 651.01, 122.29, 664.8], 375],
      [2, [141.75, 651.01, 507.08, 664.8], 375],
      [2, [69.75, 637.21, 122.29, 651.01], 524],
      [2, [141.75, 637.21, 542.25, 651.01], 524],
      [2, [69.75, 623.41, 463.11, 637.21], 524],
      [2, [69.75, 609.61, 121.62, 623.41], 689],
      [2, [141.75, 609.61, 214.95, 623.41], 689],
      [2, [69.75, 595.81, 122.29, 609.61], 725],
      [2, [141.75, 595.81, 213.62, 609.61], 725],
    ],
    turns: [
      [
        "00:02:49",
        169,
        "link",
        "Kurt Williams, Director, Oregon Veterinary Diagnostics Lab, Oregon State University (OSU)",
        null,
      ],
      ["00:06:15", 375, "link", "Melissa Rice, student, Carlson College of Veterinary Medicine, OSU", null],
      [
        "00:08:44",
        524,
        "link",
        "Wendy Krebs, graduate, Carlson College of Veterinary Medicine, OSU; equine veterinarian, co-owner, Bend Equine Medical Center",
        null,
      ],
      ["00:11:29", 689, "link", "Rep. B. Levy", null],
      ["00:12:05", 725, "link", "Rep. McLain", null],
    ],
    entries: [],
  },
  {
    name: "an Agenda item logged after the chair's turn that opens it: the turn belongs to the item, and the offsets follow the links",
    source:
      "research cache video-research/dl/logs/halnrw_0122.pdf (HALNRW 2025-01-22, feed document 288741), lines 00:21:43 to 00:23:06, page 2",
    eventId: "2025011038",
    text: `\f00:21:43 Vice-Chair Finger McDonald
00:22:39 HB 2168 - Public Hearing
00:22:38 Co-Chair Helm
00:23:06 Anna Glueder, LPRO Analyst`,
    links: [
      [2, [69.75, 513.02, 122.29, 526.82], 1303],
      [2, [141.75, 513.02, 296.75, 526.82], 1303],
      [2, [69.75, 485.42, 122.29, 499.22], 1359],
      [2, [141.75, 485.42, 288.29, 499.22], 1359],
      [2, [69.75, 471.62, 122.29, 485.42], 1358],
      [2, [141.75, 471.62, 225.6, 485.42], 1358],
      [2, [69.75, 457.82, 122.29, 471.62], 1386],
      [2, [141.75, 457.82, 301.01, 471.62], 1386],
    ],
    turns: [
      ["00:21:43", 1303, "link", "Vice-Chair Finger McDonald", null],
      ["00:22:38", 1358, "link", "Co-Chair Helm", "HB 2168 - Public Hearing"],
      ["00:23:06", 1386, "link", "Anna Glueder, LPRO Analyst", "HB 2168 - Public Hearing"],
    ],
    entries: [agendaItem("00:22:39", 1359, "HB 2168 - Public Hearing")],
  },
  {
    name: "a meeting with two Agenda items: each turn falls under the most recent one",
    source:
      "research cache video-research/dl/logs/sample/288254.pdf (HREV 2025-01-23, feed document 288254), lines 00:00:31 to 00:15:04, page 1",
    eventId: "2025011064",
    text: `00:00:31 HB 2073 Public Hearing
00:00:39 Chris Allanach, Legislative Revenue Officer
00:01:13 Alan S. Dale, Senior Deputy Legislative Counsel
00:03:59 Vice-Chair Reschke
00:08:05 Vice-Chair Reschke
00:11:50 Rep. B. Levy
00:14:00 HB 2084 Public Hearing
00:14:01 Chair Nathanson
00:15:04 Jonathan Hart`,
    links: [
      [1, [69.75, 327.83, 122.28, 341.63], 31],
      [1, [141.75, 327.83, 284.3, 341.63], 31],
      [1, [69.75, 314.03, 122.28, 327.83], 39],
      [1, [141.75, 314.03, 377.03, 327.83], 39],
      [1, [69.75, 300.23, 122.28, 314.03], 73],
      [1, [141.75, 300.23, 403.06, 314.03], 73],
      [1, [69.75, 286.43, 122.28, 300.23], 239],
      [1, [141.75, 286.43, 252.29, 300.23], 239],
      [1, [69.75, 272.63, 122.28, 286.43], 485],
      [1, [141.75, 272.63, 252.29, 286.43], 485],
      [1, [69.75, 258.83, 122.28, 272.63], 710],
      [1, [141.75, 258.83, 214.95, 272.63], 710],
      [1, [69.75, 231.24, 122.28, 245.04], 840],
      [1, [141.75, 231.24, 284.3, 245.04], 840],
      [1, [69.75, 217.44, 122.28, 231.24], 841],
      [1, [141.75, 217.44, 236.3, 231.24], 841],
      [1, [69.75, 203.64, 122.28, 217.44], 904],
      [1, [141.75, 203.64, 221.63, 217.44], 904],
    ],
    turns: [
      ["00:00:39", 39, "link", "Chris Allanach, Legislative Revenue Officer", "HB 2073 Public Hearing"],
      ["00:01:13", 73, "link", "Alan S. Dale, Senior Deputy Legislative Counsel", "HB 2073 Public Hearing"],
      ["00:03:59", 239, "link", "Vice-Chair Reschke", "HB 2073 Public Hearing"],
      ["00:08:05", 485, "link", "Vice-Chair Reschke", "HB 2073 Public Hearing"],
      ["00:11:50", 710, "link", "Rep. B. Levy", "HB 2073 Public Hearing"],
      ["00:14:01", 841, "link", "Chair Nathanson", "HB 2084 Public Hearing"],
      ["00:15:04", 904, "link", "Jonathan Hart", "HB 2084 Public Hearing"],
    ],
    entries: [
      agendaItem("00:00:31", 31, "HB 2073 Public Hearing"),
      agendaItem("00:14:00", 840, "HB 2084 Public Hearing"),
    ],
  },
  {
    name: "a recess and a reconvene between turns",
    source:
      "research cache video-research/dl/logs/sample/288707.pdf (HREV 2025-01-28, feed document 288707), lines 00:00:03 to 00:01:04, page 1",
    eventId: "2025011145",
    text: `00:00:03 Meeting Called to Order
00:00:04 Chair Nathanson
00:00:54 Meeting Recessed
00:00:55 Chair Nathanson
00:01:03 Meeting Reconvened
00:01:04 Vice-Chair Walters`,
    links: [
      [1, [69.75, 341.28, 122.28, 355.08], 3],
      [1, [141.75, 341.28, 281.6, 355.08], 3],
      [1, [69.75, 327.48, 122.28, 341.28], 4],
      [1, [141.75, 327.48, 236.3, 341.28], 4],
      [1, [69.75, 299.88, 122.28, 313.68], 54],
      [1, [141.75, 299.88, 250.96, 313.68], 54],
      [1, [69.75, 286.09, 120.96, 299.88], 55],
      [1, [141.75, 286.09, 236.3, 299.88], 55],
      [1, [69.75, 272.29, 122.28, 286.09], 63],
      [1, [141.75, 272.29, 266.27, 286.09], 63],
      [1, [69.75, 258.49, 120.96, 272.29], 64],
      [1, [141.75, 258.49, 246.27, 272.29], 64],
    ],
    turns: [
      ["00:00:04", 4, "link", "Chair Nathanson", null],
      ["00:00:55", 55, "link", "Chair Nathanson", null],
      ["00:01:04", 64, "link", "Vice-Chair Walters", null],
    ],
    entries: [
      e("call-to-order", "00:00:03", 3, "Meeting Called to Order"),
      e("recess", "00:00:54", 54, "Meeting Recessed"),
      e("reconvene", "00:01:03", 63, "Meeting Reconvened"),
    ],
  },
  {
    name: "a Work Session: motions, a slash-form vote, 'Motion Passed' and a wrapped motion",
    source:
      "research cache video-research/dl/logs/sample/309305.pdf (HREV 2025-06-11, feed document 309305), lines 00:21:30 to 00:23:31, page 2",
    eventId: "2025061107",
    text: `\f00:21:30 HB 2725 Work Session
00:21:31 Chair Nathanson
00:21:35 Beau Olen, Economist
00:22:22 Chair Nathanson
00:22:50 MOTION: Vice-Chair Walters moves to adopt the -2 amendment dated
1/30/25 to HB 2725
00:22:59 Chair Nathanson
00:23:10 Rep. Levy
00:23:19 VOTE: 6/0/1
AYE: 6
NAY: 0
EXCUSED: 1
00:23:26 Motion Passed
00:23:31 MOTION: Vice-Chair Walters moves HB 2725 to the floor with a do
pass recommendation`,
    links: [
      [2, [69.75, 607.06, 122.28, 620.57], 1290],
      [2, [141.75, 607.06, 279.63, 620.57], 1290],
      [2, [69.75, 593.55, 122.28, 607.06], 1291],
      [2, [141.75, 593.55, 236.3, 607.06], 1291],
      [2, [69.75, 580.04, 122.28, 593.55], 1295],
      [2, [141.75, 580.04, 265.65, 593.55], 1295],
      [2, [69.75, 566.53, 122.28, 580.04], 1342],
      [2, [141.75, 566.53, 236.3, 580.04], 1342],
      [2, [69.75, 553.01, 122.28, 566.53], 1370],
      [2, [141.75, 553.01, 544.31, 566.53], 1370],
      [2, [69.75, 539.5, 251.64, 553.01], 1370],
      [2, [69.75, 525.99, 122.28, 539.5], 1379],
      [2, [141.75, 525.99, 236.3, 539.5], 1379],
      [2, [69.75, 512.48, 122.28, 525.99], 1390],
      [2, [141.75, 512.48, 200.28, 525.99], 1390],
      [2, [69.75, 498.97, 122.28, 512.48], 1399],
      [2, [141.75, 498.97, 542.25, 512.48], 1399],
      [2, [69.75, 485.46, 542.25, 498.97], 1399],
      [2, [69.75, 471.95, 542.25, 485.46], 1399],
      [2, [69.75, 458.43, 218.27, 471.95], 1399],
      [2, [69.75, 444.92, 122.28, 458.43], 1406],
      [2, [141.75, 444.92, 225.63, 458.43], 1406],
      [2, [69.75, 431.41, 122.28, 444.92], 1411],
      [2, [141.75, 431.41, 542.25, 444.92], 1411],
      [2, [69.75, 417.9, 273.62, 431.41], 1411],
    ],
    turns: [
      ["00:21:31", 1291, "link", "Chair Nathanson", "HB 2725 Work Session"],
      ["00:21:35", 1295, "link", "Beau Olen, Economist", "HB 2725 Work Session"],
      ["00:22:22", 1342, "link", "Chair Nathanson", "HB 2725 Work Session"],
      ["00:22:59", 1379, "link", "Chair Nathanson", "HB 2725 Work Session"],
      ["00:23:10", 1390, "link", "Rep. Levy", "HB 2725 Work Session"],
    ],
    entries: [
      agendaItem("00:21:30", 1290, "HB 2725 Work Session"),
      e(
        "motion",
        "00:22:50",
        1370,
        "MOTION: Vice-Chair Walters moves to adopt the -2 amendment dated 1/30/25 to HB 2725",
      ),
      vote("00:23:19", 1399, "VOTE: 6/0/1", [6, 0, 1]),
      e("motion-result", "00:23:26", 1406, "Motion Passed"),
      e(
        "motion",
        "00:23:31",
        1411,
        "MOTION: Vice-Chair Walters moves HB 2725 to the floor with a do pass recommendation",
      ),
    ],
  },
  {
    name: "a Ways and Means item named for an agency, a presiding co-chair, and a vote whose roster runs across the page break",
    source:
      "research cache video-research/dl/logs/sample/289983.pdf (JWM 2025-02-07, feed document 289983), lines 00:00:07 to 00:02:05, pages 1-2",
    eventId: "2025021120",
    text: `00:00:07 Meeting Called to Order
00:00:08 Representative Sanchez, Presiding Co-Chair
00:00:29 Department of Energy - Energy Audits
00:00:36 MOTION: Rep. Owens reads the Subcommittee Recommendation
00:01:58 VOTE: 18-0-5
Ayes: Sens. Anderson, Broadman, Campos, Girod, Lieber, McLane, Woods; Reps.
Bowman, Cate, Drazan, Evans, Gomberg, Levy, Owens, Ruiz, Sanchez, Smith,
Valderrama
Sen. Kate Lieber, Co-Chair
Sen. Fred Girod, Co-Vice Chair
Sen. Dick Anderson
Sen. Anthony Broadman
Sen. Wlnsvey Campos
Sen. Mike McLane
Sen. Janeen Sollman
Sen. Aaron Woods
Rep. Tawna Sanchez, Co-Chair
Rep. David Gomberg, Co-Vice Chair
Rep. Greg Smith, Co-Vice Chair
Rep. Ben Bowman
Rep. Jami Cate
Rep. Christine Drazan
Rep. Paul Evans
Rep. Emerson Levy
Rep. Mark Owens
Rep. Ricki Ruiz
Rep. Andrea Valderrama
Sen. Daniel Bonham
Sen. Lew Frederick
Sen. David Brock Smith
Rep. Vikki Breese-Iverson\fJWM
02/07/2025
Page 2 of 3
This recording log is in compliance with Senate and House Rules. For complete contents, refer to the digital audio recording.
Exc: Sens. Bonham, Frederick, Brock Smith, Sollman; Rep. Breese-Iverson
MOTION CARRIES
00:02:05 Department of Fish and Wildlife - Keno Fish Passage`,
    links: [
      [1, [69.75, 202.32, 117.36, 216.97], 7],
      [1, [141.75, 202.32, 266.16, 216.97], 7],
      [1, [69.75, 187.67, 117.36, 202.32], 8],
      [1, [141.75, 187.67, 356.27, 202.32], 8],
      [1, [69.75, 158.38, 117.36, 173.02], 29],
      [1, [141.75, 158.38, 334.13, 173.02], 29],
      [1, [69.75, 143.73, 117.36, 158.38], 36],
      [1, [141.75, 143.73, 463.28, 158.38], 36],
      [1, [69.75, 129.08, 117.36, 143.73], 118],
      [1, [141.75, 129.08, 542.25, 143.73], 118],
      [1, [69.75, 114.43, 542.25, 129.08], 118],
      [1, [69.75, 99.78, 542.25, 114.43], 118],
      [1, [69.75, 85.13, 542.25, 99.78], 118],
      [2, [69.75, 705.35, 542.25, 720], 118],
      [2, [69.75, 690.7, 232.06, 705.35], 118],
      [2, [69.75, 661.41, 117.36, 676.05], 125],
      [2, [141.75, 661.41, 403.91, 676.05], 125],
    ],
    turns: [["00:00:08", 8, "link", "Representative Sanchez, Presiding Co-Chair", null]],
    entries: [
      e("call-to-order", "00:00:07", 7, "Meeting Called to Order"),
      agendaItem("00:00:29", 29, "Department of Energy - Energy Audits"),
      e("motion", "00:00:36", 36, "MOTION: Rep. Owens reads the Subcommittee Recommendation"),
      vote("00:01:58", 118, "VOTE: 18-0-5", [18, 0, 5]),
      agendaItem("00:02:05", 125, "Department of Fish and Wildlife - Keno Fish Passage"),
    ],
  },
  {
    name: "a roll call, and a roster of members that follows a turn with no label over it",
    source:
      "research cache video-research/dl/logs/sample/315920.pdf (JLAC 2025-06-13, feed document 315920), lines 00:00:03 to 00:01:52, page 1",
    eventId: "2025061121",
    text: `00:00:03 Meeting Called to Order
00:00:04 Co-Chair Fahey
00:00:18 ROLL CALL
00:00:40 Adoption of Committee Rules - Organizational Meeting
00:00:41 Co-Chair Fahey
00:00:49 MOTION: CO-CHAIR WAGNER MOVES ADOPTION OF COMMITTEE
RULES
00:01:03 VOTE: 7-0-3
AYE: SENS. ANDERSON, BONHAM, PATTERSON, WAGNER; REPS.
BOWMAN, GOMBERG, FAHEY
EXCUSED: SEN. MANNING JR.; REPS. DRAZAN, G. SMITH
00:01:51 Confirmation of Capitol Foundation Board Members - Work Session
00:01:52 Co-Chair Fahey
Sen. Rob Wagner, Co-Chair
Sen. Dick Anderson
Sen. Daniel Bonham
Sen. Deb Patterson
Rep. Julie Fahey, Co-Chair
Rep. Ben Bowman
Rep. David Gomberg
Rep. Greg Smith
Sen. James Manning Jr. Rep. Christine Drazan\fJLAC
06/13/2025
Page 2 of 3
This recording log is in compliance with Senate and House Rules. For complete contents, refer to the digital audio recording.`,
    links: [
      [1, [69.75, 269.14, 122.29, 282.94], 3],
      [1, [141.75, 269.14, 273.64, 282.94], 3],
      [1, [69.75, 255.34, 122.29, 269.14], 4],
      [1, [141.75, 255.34, 230.95, 269.14], 4],
      [1, [69.75, 241.54, 122.29, 255.34], 18],
      [1, [141.75, 241.54, 210.5, 255.34], 18],
      [1, [69.75, 215.09, 122.29, 228.89], 40],
      [1, [141.75, 215.09, 457.59, 228.89], 40],
      [1, [69.75, 201.29, 122.29, 215.09], 41],
      [1, [141.75, 201.29, 230.95, 215.09], 41],
      [1, [69.75, 187.5, 122.29, 201.29], 49],
      [1, [141.75, 187.5, 542.25, 201.29], 49],
      [1, [69.75, 173.7, 186.26, 187.5], 49],
      [1, [69.75, 159.9, 122.29, 173.7], 63],
      [1, [141.75, 159.9, 542.25, 173.7], 63],
      [1, [69.75, 146.1, 542.25, 159.9], 63],
      [1, [69.75, 132.3, 542.25, 146.1], 63],
      [1, [69.75, 118.5, 475.62, 132.3], 63],
      [1, [69.75, 92.05, 122.29, 105.85], 111],
      [1, [141.75, 92.05, 532.04, 105.85], 111],
      [1, [69.75, 78.25, 122.29, 92.05], 112],
      [1, [141.75, 78.25, 230.95, 92.05], 112],
    ],
    turns: [
      ["00:00:04", 4, "link", "Co-Chair Fahey", null],
      ["00:00:41", 41, "link", "Co-Chair Fahey", "Adoption of Committee Rules - Organizational Meeting"],
      ["00:01:52", 112, "link", "Co-Chair Fahey", "Confirmation of Capitol Foundation Board Members - Work Session"],
    ],
    entries: [
      e("call-to-order", "00:00:03", 3, "Meeting Called to Order"),
      e("roll-call", "00:00:18", 18, "ROLL CALL"),
      agendaItem("00:00:40", 40, "Adoption of Committee Rules - Organizational Meeting"),
      e("motion", "00:00:49", 49, "MOTION: CO-CHAIR WAGNER MOVES ADOPTION OF COMMITTEE RULES"),
      vote("00:01:03", 63, "VOTE: 7-0-3", [7, 0, 3]),
      agendaItem("00:01:51", 111, "Confirmation of Capitol Foundation Board Members - Work Session"),
    ],
  },
];

describe("a Recording Log's lines", () => {
  test.for(rows)("$name ($source)", ({ text, links, eventId, turns, entries }) => {
    const parse = parseRecordingLog({ text, links: playerLinks(eventId, links) });

    expect(parse).toEqual({
      kind: "parsed",
      eventId,
      speakerTurns: turnsOf(turns),
      entries,
      pagesReadByTimecode: [],
    });
  });
});
