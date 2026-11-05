import type { Block } from "./blocks.ts";
import type { Offset } from "./offsets.ts";
import type { FeedAgendaItem, RecordingLogEntry, SpeakerTurn } from "./types.ts";

const MEASURE_ID = /^(?:HB|SB|HJR|SJR|HCR|SCR|HJM|SJM|HR|SR|HM|SM)\s?\d+/;
const HEARING_END = /(?:Public Hearing|Work Session)$/i;
const INFORMATIONAL = /\bInformational\b/i;
/** An agency and a topic, "Department of Energy - Energy Audits": a spaced hyphen and no comma. A speaker's line has a comma or no hyphen. */
const SUBJECT_DASH_TOPIC = /^[^,;]+ - [^,;]+$/;

function isAgendaItem(text: string): boolean {
  return MEASURE_ID.test(text) || HEARING_END.test(text) || INFORMATIONAL.test(text) || SUBJECT_DASH_TOPIC.test(text);
}

function normal(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** The texts a feed item's title can appear as in a log: its Comments in full, its first line, either with the meeting type after a hyphen. */
function feedTexts(item: FeedAgendaItem): string[] {
  const comments = (item.comments ?? "").trim();
  if (comments === "") return [];
  const first = comments.split("\n")[0] ?? comments;
  const titles = [comments, first];
  const withType = item.meetingType === null ? [] : titles.map((title) => `${title} - ${item.meetingType}`);
  return [...titles, ...withType].map(normal);
}

const MEASURE_LINE = /^([A-Z]+)\s?(\d+)\b\s*-?\s*(.*)$/;

/** Whether a log line is one of the Meeting's feed Agenda items: its measure id and action, or its text. */
function matchesFeed(text: string, items: readonly FeedAgendaItem[]): boolean {
  const measure = MEASURE_LINE.exec(text);
  const rest = measure === null ? "" : normal(measure[3] ?? "");
  const line = normal(text);
  return items.some((item) => {
    if (
      measure !== null &&
      item.measurePrefix === measure[1] &&
      item.measureNumber === Number(measure[2]) &&
      (rest === "" || rest === normal(item.meetingType ?? "") || rest === normal(item.action ?? ""))
    ) {
      return true;
    }
    return feedTexts(item).includes(line);
  });
}

const TALLY = /^VOTE:\s*(\d+)\s*[-/]\s*(\d+)\s*[-/]\s*(\d+)/i;

function entryOf(block: Block, text: string, offset: Offset, agendaByText: boolean): RecordingLogEntry | null {
  const timed = { timecode: block.timecode, ...offset };
  if (/^Meeting Called to Order$/i.test(text)) return { kind: "call-to-order", ...timed, text };
  if (/^ROLL CALL$/i.test(text)) return { kind: "roll-call", ...timed, text };
  if (/^Meeting Adjourned$/i.test(text)) return { kind: "adjournment", ...timed, text };
  if (/^Meeting Recessed$/i.test(text)) return { kind: "recess", ...timed, text };
  if (/^Meeting Reconvened$/i.test(text)) return { kind: "reconvene", ...timed, text };
  if (/^MOTION:/i.test(text)) return { kind: "motion", ...timed, text };
  if (/^Motion (?:Passed|Carries|Failed|Fails)\b/i.test(text)) return { kind: "motion-result", ...timed, text };
  if (/^VOTE:/i.test(text)) {
    // The lines under a vote are the names of the ayes, nays and excused: its first line is the vote.
    const first = block.lines[0] ?? text;
    const counts = TALLY.exec(first);
    const tally =
      counts === null ? null : { ayes: Number(counts[1]), nays: Number(counts[2]), excused: Number(counts[3]) };
    return { kind: "vote", ...timed, text: first, tally };
  }
  if (agendaByText && isAgendaItem(text)) return { kind: "agenda-item", ...timed, text, foundBy: "text" };
  return null;
}

export function classify(
  blocks: readonly Block[],
  offsets: readonly Offset[],
  feedItems: readonly FeedAgendaItem[],
): { speakerTurns: SpeakerTurn[]; entries: RecordingLogEntry[] } {
  const speakerTurns: SpeakerTurn[] = [];
  const entries: RecordingLogEntry[] = [];
  let agendaItem: string | null = null;
  const lineOf = (block: Block): string => block.lines.join(" ").trim();
  // The feed decides when it matches any line of the log; the text heuristic is the fallback when it matches none.
  const feedMatches = blocks.map((block) => feedItems.length > 0 && matchesFeed(lineOf(block), feedItems));
  const byFeed = feedMatches.some(Boolean);
  blocks.forEach((block, index) => {
    const offset = offsets[index];
    if (offset === undefined) throw new Error(`recording-log: block at ${block.timecode} has no offset`);
    const text = lineOf(block);
    const entry: RecordingLogEntry | null = feedMatches[index]
      ? { kind: "agenda-item", timecode: block.timecode, ...offset, text, foundBy: "feed" }
      : entryOf(block, text, offset, !byFeed);
    if (entry === null) {
      speakerTurns.push({ timecode: block.timecode, ...offset, speaker: text, agendaItem });
      return;
    }
    if (entry.kind === "agenda-item") agendaItem = entry.text;
    entries.push(entry);
  });
  return { speakerTurns, entries };
}
