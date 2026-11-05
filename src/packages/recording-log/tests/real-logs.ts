import type {
  AgendaItemEntry,
  OffsetSource,
  RecordingLogEntry,
  RecordingLogLink,
  SpeakerTurn,
  TimedEntry,
} from "../index.ts";

// Helpers for the seam-2 rows (#125). The rows quote the research cache (.cache/olis-2025R1/video-research/dl/logs/,
// not committed: the Acceptable Use Agreement grants no redistribution license; it is not in CI, so each quote is
// inline). The text is what the pdf-text package extracts; the links are what pdf.js's getAnnotations() gives for the
// quoted lines' rows, as [page, rect, startStreamAt]. The link address of every row is the one these logs use, with the
// meeting's own eventID.

/** [page, rect, startStreamAt]: one real player-link annotation, in the form the rows quote it. */
export type QuotedLink = readonly [page: number, rect: readonly [number, number, number, number], seconds: number];

const PLAYER = "https://olis.oregonlegislature.gov/liz/mediaplayer?clientID=4879615486";

/** The player-link annotations of the quoted rows. */
export function playerLinks(eventId: string, quoted: readonly QuotedLink[]): RecordingLogLink[] {
  return quoted.map(([page, rect, seconds]) => ({
    page,
    rect,
    url: `${PLAYER}&eventID=${eventId}&startStreamAt=${seconds}`,
  }));
}

/** [timecode, offsetSeconds, offsetSource, speaker, agendaItem] */
export type ExpectedTurn = readonly [string, number, OffsetSource, string, string | null];

export function turnsOf(expected: readonly ExpectedTurn[]): SpeakerTurn[] {
  return expected.map(([timecode, offsetSeconds, offsetSource, speaker, agendaItem]) => ({
    timecode,
    offsetSeconds,
    offsetSource,
    speaker,
    agendaItem,
  }));
}

/** An entry that is not a vote, read from a link. */
export function e(
  kind: Exclude<TimedEntry["kind"], "agenda-item">,
  timecode: string,
  offsetSeconds: number,
  text: string,
  offsetSource: OffsetSource = "link",
): RecordingLogEntry {
  return { kind, timecode, offsetSeconds, offsetSource, text };
}

/** An Agenda item line, and how the parser found it: in the feed's Agenda items, or by the text heuristic. */
export function agendaItem(
  timecode: string,
  offsetSeconds: number,
  text: string,
  foundBy: AgendaItemEntry["foundBy"] = "text",
  offsetSource: OffsetSource = "link",
): RecordingLogEntry {
  return { kind: "agenda-item", timecode, offsetSeconds, offsetSource, text, foundBy };
}

export function vote(
  timecode: string,
  offsetSeconds: number,
  text: string,
  [ayes, nays, excused]: readonly [number, number, number],
): RecordingLogEntry {
  return { kind: "vote", timecode, offsetSeconds, offsetSource: "link", text, tally: { ayes, nays, excused } };
}
