import { describe, expect, test } from "vitest";
import { legislatorOfSpeaker, measureOfAgendaItem, playerLinkOf, type RecordingLogLink } from "../index.ts";

// Seam 2: what the worker adds to a parsed speaker turn (ticket #126): the Legislator Code of a speaker, the Measure of
// an Agenda item, and the player link of a turn.
//
// Speakers are quoted from the Recording Logs of the fixture (documents/committee-meeting-documents/, as the pdf-text
// package extracts them and the parser reports them as `speaker`): 288741 (HALNRW 2025-01-22), the Senate and House
// logs named per row. A committee's members are given as the Legislators row names them (test/fixtures/olis-2025R1/
// feed/Legislators.json: code, first name, last name) and the CommitteeMembers rows list them. Rows that are MADE UP
// say so.

const HALNRW = [
  { code: "Rep Helm", name: "Ken Helm" },
  { code: "Rep Owens", name: "Mark Owens" },
  { code: "Rep Boice", name: "Court Boice" },
  { code: "Rep Hartman", name: "Annessa Hartman" },
  { code: "Rep Scharf", name: "Anna Scharf" },
  { code: "Rep Levy B", name: "Bobby Levy" },
  { code: "Rep Marsh", name: "Pam Marsh" },
  { code: "Rep McLain", name: "Susan McLain" },
  // The Legislators row's last name is "McDonald" (with a trailing space in the feed); the log writes "Finger McDonald".
  { code: "Rep McDonald", name: "Sarah McDonald" },
];

describe("legislatorOfSpeaker", () => {
  test.for<[string, string, string | null]>([
    ["Co-Chair Helm", "log 288741, 00:00:04", "Rep Helm"],
    ["Rep. McLain", "log 288741", "Rep McLain"],
    ["Rep. B. Levy", "log 288741: an initial for the first name", "Rep Levy B"],
    ["Vice-Chair Finger McDonald", "log 288741: a compound surname the feed holds as McDonald", "Rep McDonald"],
    ["Rep. Susan McLain, House District 29", "a member who testifies by full name and district", "Rep McLain"],
    ["Rep. Ricki Ruiz, House District 50", "a Legislator who is not a member of this committee", null],
    ["Anna Glueder, LPRO Analyst", "log 288741: staff, no title", null],
    ["REP. SCHARF DECLARES POTENTIAL CONFLICT OF INTEREST", "log 288741: a line that is not a speaker's name", null],
    ["Kurt Williams, Director, Oregon Veterinary Diagnostics Lab, Oregon State University (OSU)", "a witness", null],
  ])("%s resolves to %s (%s)", ([speaker, , expected]) => {
    expect(legislatorOfSpeaker(speaker, HALNRW)).toBe(expected);
  });

  test("a witness who shares a member's last name is not that member: a Legislator is named with a title", () => {
    // Quoted: "Mike Weber, volunteer, Marion Polk Food Share" is a witness at a Senate committee that has Sen. Suzanne Weber.
    const members = [{ code: "Sen Weber", name: "Suzanne Weber" }];

    expect(legislatorOfSpeaker("Mike Weber, volunteer, Marion Polk Food Share", members)).toBeNull();
    expect(legislatorOfSpeaker("Sen. Suzanne Weber, Senate District 16", members)).toBe("Sen Weber");
  });

  test("MADE UP: two members with one last name resolve only when the first name or its initial says which", () => {
    const members = [
      { code: "Rep Levy B", name: "Bobby Levy" },
      { code: "Rep Levy A", name: "Ann Levy" },
    ];

    expect(legislatorOfSpeaker("Rep. Levy", members)).toBeNull();
    expect(legislatorOfSpeaker("Rep. B. Levy", members)).toBe("Rep Levy B");
    expect(legislatorOfSpeaker("Rep. Ann Levy, House District 7", members)).toBe("Rep Levy A");
  });
});

describe("measureOfAgendaItem", () => {
  test.for<[string | null, { prefix: string; number: number } | null]>([
    ["HB 2167 - Public Hearing", { prefix: "HB", number: 2167 }],
    ["HB 3131 - Public Hearing", { prefix: "HB", number: 3131 }],
    ["Adoption of Committee Rules - Organizational Meeting", null],
    [null, null],
  ])("%s", ([text, expected]) => {
    // Quoted from log 288741's agenda lines (HB 2167, HB 3131, the committee rules) and the log's lack of one before the first.
    expect(measureOfAgendaItem(text)).toEqual(expected);
  });
});

describe("playerLinkOf", () => {
  // The two links of 288741 that matter, as pdf.js gives them: the meeting's materials, and the timecode "00:00:03".
  const links: RecordingLogLink[] = [
    {
      page: 1,
      url: "https://olis.oregonlegislature.gov/liz/2025R1/Committees/HALNRW/2025-01-22-08-00/MeetingMaterials",
      rect: [424.04, 405.98, 451.77, 418.63],
    },
    {
      page: 1,
      url: "https://olis.oregonlegislature.gov/liz/mediaplayer?clientID=4879615486&eventID=2025011038&startStreamAt=3",
      rect: [69.75, 250.74, 122.29, 264.54],
    },
  ];

  test("is the log's own player link with the turn's second", () => {
    expect(playerLinkOf(links, "2025011038", 4)).toBe(
      "https://olis.oregonlegislature.gov/liz/mediaplayer?clientID=4879615486&eventID=2025011038&startStreamAt=4",
    );
  });

  test("is the link of the same address when the second is the one the log's link gives", () => {
    expect(playerLinkOf(links, "2025011038", 3)).toBe(links[1]?.url);
  });

  test("is null when the log has no player link for that event", () => {
    expect(playerLinkOf(links, "2025011099", 4)).toBeNull();
    expect(playerLinkOf(links.slice(0, 1), "2025011038", 4)).toBeNull();
  });
});
