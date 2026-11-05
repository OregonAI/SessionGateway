import { describe, expect, test } from "vitest";
import {
  hearingKindOf,
  legislatorOfSpeaker,
  measureOfAgendaItem,
  measuresOfAgendaItem,
  playerLinkOf,
  type RecordingLogLink,
} from "../index.ts";

// Seam 2: what the worker adds to a parsed speaker turn (ticket #126): the Legislator Code of a speaker, the Measure of
// an Agenda item, and the player link of a turn.
//
// Speakers are quoted from the Recording Logs of the fixture (documents/committee-meeting-documents/, as the pdf-text
// package extracts them and the parser reports them as `speaker`), each row naming its log, or from a log of the research
// cache (video-research/dl/logs/sample/, not committed) or of the 2026R1 database, which a row says. A Legislator is given
// as the Legislators row names them (test/fixtures/olis-2025R1/feed/Legislators.json: code, first name, last name), and a
// committee's members as the CommitteeMembers rows list them. Rows that are MADE UP say so.
//
// The rule (ADR-0052, owner decision B of 2026-11-05): a speaker line resolves only when it begins with a title, the title's
// chamber agrees with the Legislator's code ("Rep." and "Representative" a House member, "Sen." and "Senator" a Senate member;
// Chair, Co-Chair and Vice-Chair are any chamber), the surname matches, and the logged first name or initial agrees when
// the line gives one. Among the committee's members first; when none matches, among all of the Session's Legislators, where
// a first name or initial must be given, since a surname alone never resolves there. Only a unique match resolves.

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

/** The Legislators of the 2025R1 fixture that the rows below name, with the names their rows give. Every row's Session. */
const SESSION = [
  ...HALNRW,
  { code: "Rep Levy E", name: "Emerson Levy" },
  { code: "Rep Nguyen D", name: "Daniel Nguyen" },
  { code: "Rep Nguyen H", name: "Hoa Nguyen" },
  { code: "Rep Pham H", name: "Hai Pham" },
  { code: "Sen Pham", name: "Khanh Pham" },
  { code: "Rep Smith G", name: "Gregory Smith" },
  { code: "Sen Smith DB", name: "David Brock Smith" },
  { code: "Rep Reschke", name: "E. Werner Reschke" },
  { code: "Rep Nathanson", name: "Nancy Nathanson" },
  { code: "Rep Walters", name: "Jules Walters" },
  { code: "Rep Hudson", name: "Zach Hudson" },
  { code: "Rep Ruiz", name: "Ricki Ruiz" },
  { code: "Rep Sosa", name: "Nathan Sosa" },
  { code: "Sen Meek", name: "Mark Meek" },
  { code: "Sen Nash", name: "Todd Nash" },
  { code: "Sen Weber", name: "Suzanne Weber" },
  { code: "Sen Hayden", name: "Cedric Hayden" },
  { code: "Sen Taylor", name: "Kathleen Taylor" },
  { code: "Sen Bonham", name: "Daniel Bonham" },
  { code: "Sen Patterson", name: "Deb Patterson" },
  { code: "Sen Gelser Blouin", name: "Sara Gelser Blouin" },
  { code: "Sen Prozanski", name: "Floyd Prozanski" },
  { code: "Sen Reynolds", name: "Lisa Reynolds" },
  { code: "Sen Linthicum", name: "Diane Linthicum" },
];

/** The members of SLB (the CommitteeMembers rows of the fixture), SHS and HREV (the roster of log 309305). */
const SLB = ["Sen Taylor", "Sen Hayden", "Sen Pham", "Sen Bonham", "Sen Patterson"];
const SHS = ["Sen Gelser Blouin", "Sen Prozanski", "Sen Nash", "Sen Reynolds", "Sen Linthicum"];
const HREV = ["Rep Nathanson", "Rep Reschke", "Rep Walters", "Rep Hudson", "Rep Levy B", "Rep Marsh", "Rep Smith G"];

function membersOf(codes: readonly string[]): { code: string; name: string }[] {
  return codes.map((code) => {
    const found = SESSION.find((legislator) => legislator.code === code);
    if (found === undefined) throw new Error(`${code} is not in the test's Legislators`);
    return found;
  });
}

describe("legislatorOfSpeaker, within the committee's members", () => {
  test.for<[string, string, string | null]>([
    ["Co-Chair Helm", "log 288741, 00:00:04", "Rep Helm"],
    ["Rep. McLain", "log 288741, 00:12:05", "Rep McLain"],
    ["Rep. B. Levy", "log 288741, 00:11:29: an initial for the first name", "Rep Levy B"],
    [
      "Vice-Chair Finger McDonald",
      "log 288741, 00:21:43: a compound surname the feed holds as McDonald",
      "Rep McDonald",
    ],
    [
      "Rep. Susan McLain, House District 29",
      "log 292588, 01:16:23: a member who testifies by full name and district",
      "Rep McLain",
    ],
    ["Anna Glueder, LPRO Analyst", "log 288741, 00:01:47: staff, no title", null],
    [
      "REP. SCHARF DECLARES POTENTIAL CONFLICT OF INTEREST",
      "log 289259, 00:47:33: a line that is not a speaker's name",
      null,
    ],
    [
      "Kurt Williams, Director, Oregon Veterinary Diagnostics Lab, Oregon State University (OSU)",
      "log 288741, 00:02:49 (the wrapped title joined): a witness",
      null,
    ],
  ])("%s resolves to %s (%s)", ([speaker, , expected]) => {
    expect(legislatorOfSpeaker(speaker, HALNRW)).toBe(expected);
  });

  test("a witness who shares a member's last name is not that member: a Legislator is named with a title", () => {
    // Quoted: log 289010 (SHS 2025-01-23), 01:02:39 "Mike Weber, volunteer, Marion Polk Food Share" and 00:19:54 "Sen.
    // Suzanne Weber, Senate District 16". MADE UP: that Sen. Weber is a member of the committee (the real SHS has no Weber).
    const members = [{ code: "Sen Weber", name: "Suzanne Weber" }];

    expect(legislatorOfSpeaker("Mike Weber, volunteer, Marion Polk Food Share", members)).toBeNull();
    expect(legislatorOfSpeaker("Sen. Suzanne Weber, Senate District 16", members)).toBe("Sen Weber");
  });

  test("a member of the other chamber with the member's surname is not that member: log 309305 (HREV 2025-06-11), 00:01:33", () => {
    // Sen. David Brock Smith, SD01, testifies to the House Committee on Revenue, whose member is Rep. Gregory Smith. The
    // title's chamber does not agree with the member's code, so the surname alone resolves nothing.
    expect(legislatorOfSpeaker("Sen. David Brock Smith, SD01", membersOf(HREV))).toBeNull();
    // The member himself, as the log's lines give him: "Rep. Smith" (00:11:58).
    expect(legislatorOfSpeaker("Rep. Smith", membersOf(HREV))).toBe("Rep Smith G");
  });

  test("the review's real case: log 315399 (SCGG 2026-02-23, 2026R1 database), 00:01:04 'Rep. Hai Pham, House District 36' is not the Senate committee's Sen. Khanh Pham", () => {
    // The Senate Committee on Commerce and General Government has Sen. Khanh Pham (the log's own roster has "Sen. Khanh
    // Pham", line 31 of its text). Before this rule the one Pham among the members resolved, whatever its chamber or first name.
    const scgg = [
      { code: "Sen Pham", name: "Khanh Pham" },
      { code: "Sen Meek", name: "Mark Meek" },
    ];

    expect(legislatorOfSpeaker("Rep. Hai Pham, House District 36", scgg)).toBeNull();
    expect(legislatorOfSpeaker("Sen. Khanh Pham", scgg)).toBe("Sen Pham");
  });

  test("MADE UP: a first name that is not the member's does not resolve to the member, in either chamber", () => {
    // The Session's Legislators tell a first name ("Daniel", "Hai") from the start of a compound surname ("Finger").
    // Hoa Nguyen and Khanh Pham are the committee; Daniel Nguyen and Hai Pham are in the Session, not on it.
    const committee = [
      { code: "Rep Nguyen H", name: "Hoa Nguyen" },
      { code: "Sen Pham", name: "Khanh Pham" },
    ];
    const resolve = (speaker: string): string | null => legislatorOfSpeaker(speaker, committee, SESSION);

    expect(resolve("Rep. Hoa Nguyen")).toBe("Rep Nguyen H");
    expect(resolve("Rep. H. Nguyen")).toBe("Rep Nguyen H");
    expect(resolve("Rep. Nguyen")).toBe("Rep Nguyen H");
    expect(resolve("Rep. Daniel Nguyen, House District 51")).toBe("Rep Nguyen D");
    expect(resolve("Rep. D. Nguyen")).toBe("Rep Nguyen D");
    expect(resolve("Chair Pham")).toBe("Sen Pham");
    expect(resolve("Senator Khanh Pham")).toBe("Sen Pham");
    expect(resolve("Chair Hai Pham")).toBe("Rep Pham H");
    expect(resolve("Representative Pham")).toBeNull();
    // No Legislator of that chamber and name anywhere: the committee's Pham is of the other chamber.
    expect(resolve("Sen. Hai Pham")).toBeNull();
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

describe("legislatorOfSpeaker, when no committee member matches: all of the Session's Legislators", () => {
  test.for<[string, string, string, readonly string[], string | null]>([
    [
      "Sen. Mark Meek, Senate District 20",
      "log 302332 (SLB 2025-01-30), 01:08:58: the owner's example",
      "SLB",
      SLB,
      "Sen Meek",
    ],
    [
      "Rep. Nathan Sosa, House District 30",
      "log 302332 (SLB 2025-01-30), 00:13:13: a Representative at a Senate committee",
      "SLB",
      SLB,
      "Rep Sosa",
    ],
    [
      "Sen. Todd Nash, Senate District 29",
      "log 289259 (HALNRW 2025-01-27), 00:27:19: a Senator at a House committee",
      "HALNRW",
      HALNRW.map((m) => m.code),
      "Sen Nash",
    ],
    ["Rep. Ricki Ruiz, House District 50", "log 290006 (SHS 2025-02-04), 00:15:08", "SHS", SHS, "Rep Ruiz"],
    [
      "Sen. David Brock Smith, SD01",
      "log 309305 (HREV 2025-06-11), 00:01:33: the real analogue of the 2026R1 case, a Senator at a House committee with a Smith",
      "HREV",
      HREV,
      "Sen Smith DB",
    ],
    [
      "Rep. Hai Pham, House District 36",
      "log 315399 (SCGG 2026-02-23, 2026R1 database), 00:01:04, with Sen. Khanh Pham among the members",
      "SCGG",
      ["Sen Pham", "Sen Meek"],
      "Rep Pham H",
    ],
    ["Sen. Meek", "MADE UP: a surname alone never resolves among all the Legislators", "SHS", SHS, null],
    ["Sen. M. Meek", "MADE UP: an initial resolves", "SHS", SHS, "Sen Meek"],
    ["Chair Mark Meek", "MADE UP: an office title is any chamber, and the full name resolves", "SHS", SHS, "Sen Meek"],
    ["Rep. Mark Meek", "MADE UP: the title's chamber must agree", "SHS", SHS, null],
    ["Sen. Daniel Meek", "MADE UP: a first name that is not the Legislator's", "SHS", SHS, null],
    ["Rep. Levy", "MADE UP: a surname with two Legislators, and none named", "SHS", SHS, null],
    ["Rep. Bobby Levy", "MADE UP: a full name picks one of two Levys", "SHS", SHS, "Rep Levy B"],
    ["Rep. E. Levy", "MADE UP: an initial picks the other", "SHS", SHS, "Rep Levy E"],
    [
      "Rep. Finger McDonald",
      "MADE UP: a compound surname is not a first name, and a surname alone never resolves among all",
      "SHS",
      SHS,
      null,
    ],
    [
      "Mike Meek, volunteer, Marion Polk Food Share",
      "MADE UP: no title, a witness who shares a Legislator's surname",
      "SHS",
      SHS,
      null,
    ],
    [
      "Kurt Williams, Director, Oregon Veterinary Diagnostics Lab, Oregon State University (OSU)",
      "log 288741, 00:02:49: a witness",
      "HALNRW",
      HALNRW.map((m) => m.code),
      null,
    ],
  ])("%s resolves to %s (%s)", ([speaker, , , committee, expected]) => {
    expect(legislatorOfSpeaker(speaker, membersOf(committee), SESSION)).toBe(expected);
  });

  test("with no list of the Session's Legislators the committee's members are all that is searched", () => {
    // Log 290006 (SHS 2025-02-04), 00:15:08.
    expect(legislatorOfSpeaker("Rep. Ricki Ruiz, House District 50", membersOf(SHS))).toBeNull();
    expect(legislatorOfSpeaker("Rep. Ricki Ruiz, House District 50", membersOf(SHS), SESSION)).toBe("Rep Ruiz");
  });

  test("a Legislator who is a member of the committee still resolves among the members, and two members of one name do not fall back to all", () => {
    const levys = membersOf(["Rep Levy B", "Rep Levy E"]);

    expect(legislatorOfSpeaker("Rep. Levy", levys, SESSION)).toBeNull();
    expect(legislatorOfSpeaker("Rep. Bobby Levy", levys, SESSION)).toBe("Rep Levy B");
    expect(legislatorOfSpeaker("Co-Chair Helm", membersOf(HALNRW.map((m) => m.code)), SESSION)).toBe("Rep Helm");
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

describe("measuresOfAgendaItem", () => {
  // Owner decision of 2026-11-05 (ticket #127): an Agenda line that names several Measures counts for each. The rows are
  // lines of the 2026R1 Recording Logs, as the stored text prints them (the log is named in each row), and the lines that
  // name one Measure or none are the 2025R1 fixture's (288741).
  test.for<[string, string | null, { prefix: string; number: number }[]]>([
    [
      "315069 SCT 2026-02-09",
      "SB 1542 and SB 1543 - Public Hearing",
      [
        { prefix: "SB", number: 1542 },
        { prefix: "SB", number: 1543 },
      ],
    ],
    [
      "312105 SCT 2026-02-02",
      "SB 1542 and SB 1543 - Informational Meeting",
      [
        { prefix: "SB", number: 1542 },
        { prefix: "SB", number: 1543 },
      ],
    ],
    [
      "316088 SEE 2026-02-25",
      "HB 4077 and HB 4076 A - Public Hearing",
      [
        { prefix: "HB", number: 4077 },
        { prefix: "HB", number: 4076 },
      ],
    ],
    [
      "315410 SED 2026-02-24",
      "HB 4079 A and HB 4160 A - Public Hearing",
      [
        { prefix: "HB", number: 4079 },
        { prefix: "HB", number: 4160 },
      ],
    ],
    [
      "315321 SED 2026-02-05",
      "SB 1538, SB 1581, and SB 1596 - Public Hearing",
      [
        { prefix: "SB", number: 1538 },
        { prefix: "SB", number: 1581 },
        { prefix: "SB", number: 1596 },
      ],
    ],
    [
      "317279 HRULES 2026-02-17",
      "HB 4159, HB 4161, and HB 4177 - Public Hearing",
      [
        { prefix: "HB", number: 4159 },
        { prefix: "HB", number: 4161 },
        { prefix: "HB", number: 4177 },
      ],
    ],
    ["288741 HALNRW 2025-01-22", "HB 3131 - Public Hearing", [{ prefix: "HB", number: 3131 }]],
    ["316088 SEE 2026-02-25", "HB 4076 A - Work Session", [{ prefix: "HB", number: 4076 }]],
    ["288741 HALNRW 2025-01-22", "Adoption of Committee Rules - Organizational Meeting", []],
    // A Measure named inside a title is not one the line begins with: the line is a topic, not that Measure's hearing.
    ["2026R1 HB 4046 informational", "Nuclear Energy Study (HB 4046, 2026) - Informational Meeting", []],
  ])("%s: %s", ([, text, expected]) => {
    expect(measuresOfAgendaItem(text)).toEqual(expected);
  });

  test("an Agenda item with no text names no Measure", () => {
    expect(measuresOfAgendaItem(null)).toEqual([]);
  });
});

describe("hearingKindOf", () => {
  test.for<[string, string]>([
    ["HB 3131 - Public Hearing", "Public Hearing"],
    ["HB 3131 - Work Session", "Work Session"],
    ["HB 4079 A and HB 4160 A - Public Hearing", "Public Hearing"],
    ["SB 1542 and SB 1543 - Informational Meeting", "Informational Meeting"],
    // The item's own wording when it is neither: the text after the Measures, without the hyphen.
    ["HB 4102 - Subcommittee Review", "Subcommittee Review"],
    // No wording after the Measures: the line itself.
    ["HB 4102", "HB 4102"],
  ])("%s is a %s", ([text, kind]) => {
    // The first four rows are real lines (288741, 292588, 315410 and 312105); the last two are MADE UP.
    expect(hearingKindOf(text)).toBe(kind);
  });
});

describe("playerLinkOf", () => {
  // The two links of 288741 that matter, as the raw PDF has them (/Rect and /URI): the meeting's materials, and the timecode "00:00:03".
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
  test("is the player page's rule of event-id.ts and no looser: a path that only contains 'mediaplayer' is not a player link", () => {
    // MADE UP: the same query on other paths. event-id.ts's `playerUrl` is /^\/liz\/mediaplayer\/?$/.
    const query = "?clientID=4879615486&eventID=2025011038&startStreamAt=3";
    const other = (path: string): RecordingLogLink[] => [
      { page: 1, url: `https://olis.oregonlegislature.gov${path}${query}`, rect: [69.75, 250.74, 122.29, 264.54] },
    ];

    expect(playerLinkOf(other("/liz/2025R1/Committees/mediaplayer"), "2025011038", 4)).toBeNull();
    expect(playerLinkOf(other("/liz/mediaplayerhelp"), "2025011038", 4)).toBeNull();
    expect(playerLinkOf(other("/liz/mediaplayer/extra"), "2025011038", 4)).toBeNull();
    expect(playerLinkOf(other("/liz/mediaplayer"), "2025011038", 4)).toBe(
      "https://olis.oregonlegislature.gov/liz/mediaplayer?clientID=4879615486&eventID=2025011038&startStreamAt=4",
    );
    expect(playerLinkOf(other("/liz/mediaplayer/"), "2025011038", 4)).toBe(
      "https://olis.oregonlegislature.gov/liz/mediaplayer/?clientID=4879615486&eventID=2025011038&startStreamAt=4",
    );
  });

  test("rewrites only startStreamAt in the query string and keeps every other byte of the link", () => {
    // MADE UP queries (the real logs' are all clientID, eventID, startStreamAt): the encodings, the order and the
    // fragment are the log's, and the parameters that URLSearchParams would write differently stay as they were.
    const link = (query: string): RecordingLogLink[] => [
      {
        page: 1,
        url: `https://olis.oregonlegislature.gov/liz/mediaplayer${query}`,
        rect: [69.75, 250.74, 122.29, 264.54],
      },
    ];

    expect(
      playerLinkOf(link("?startStreamAt=3&label=a%20b+c%2f&eventID=2025011038&clientID=4879615486"), "2025011038", 61),
    ).toBe(
      "https://olis.oregonlegislature.gov/liz/mediaplayer?startStreamAt=61&label=a%20b+c%2f&eventID=2025011038&clientID=4879615486",
    );
    expect(playerLinkOf(link("?eventID=2025011038&startStreamAt=3#t=1"), "2025011038", 61)).toBe(
      "https://olis.oregonlegislature.gov/liz/mediaplayer?eventID=2025011038&startStreamAt=61#t=1",
    );
    expect(playerLinkOf(link("?eventID=2025011038&x=%E2%82%AC&startStreamAt=3&y"), "2025011038", 0)).toBe(
      "https://olis.oregonlegislature.gov/liz/mediaplayer?eventID=2025011038&x=%E2%82%AC&startStreamAt=0&y",
    );
    // A link with no startStreamAt gets one at the end of its query.
    expect(playerLinkOf(link("?eventID=2025011038&clientID=4879615486"), "2025011038", 61)).toBe(
      "https://olis.oregonlegislature.gov/liz/mediaplayer?eventID=2025011038&clientID=4879615486&startStreamAt=61",
    );
    // The parameter whose name only ends in startStreamAt is not it.
    expect(playerLinkOf(link("?eventID=2025011038&notstartStreamAt=9&startStreamAt=3"), "2025011038", 61)).toBe(
      "https://olis.oregonlegislature.gov/liz/mediaplayer?eventID=2025011038&notstartStreamAt=9&startStreamAt=61",
    );
  });
});
