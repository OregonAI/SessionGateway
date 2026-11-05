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

/**
 * The shape of a person's name as a log prints it: two to four words, each beginning with a capital letter and made of
 * letters, apostrophes, hyphens and periods ("Betsy Imholt", "Rep. Hai Pham", "E. Werner Reschke"). A word such as "of",
 * "and" or a number is not a name's.
 */
const PERSON_NAME = String.raw`\p{Lu}[\p{L}'\u2019.-]*(?:\s+\p{Lu}[\p{L}'\u2019.-]*){1,3}`;
/** What a witness's line gives after the name: a comma and a title, "Betsy Imholt, Director, Department of Revenue". */
const NAME_COMMA_TITLE = new RegExp(String.raw`^${PERSON_NAME},\s+\S`, "u");
const NAME_DASH_RIGHT = new RegExp(String.raw`^(${PERSON_NAME}) - ([^,;]+)$`, "u");
/** A word that makes text read like an organisation (or the witness's own "Self"). */
const ORGANISATION_WORD =
  /\b(?:Self|Association|Alliance|Coalition|Council|Chamber|Federation|League|Society|Union|Bureau|Foundation|Institute|Center|Centre|Group|Network|Company|Corporation|Corp|Inc|LLC|Partners|Partnership|Trust|Fund|Club|Church|School|University|College|Hospital|Authority|Department|Agency|Board|Commission|Office|Services|Farm|Farms)\b/;

/**
 * Whether a line is shaped like a person, so the text heuristic never takes it as an Agenda item (owner decision A of
 * ticket #126): "Name, Title" ("Pat Poe, Informational Services Director"), or "Name - Organization" where the right side
 * reads like an organisation or is "Self" ("Jane Doe - Self"). The name on the left holds no organisation word itself, so
 * an agency and its topic ("Oregon Health Authority - Budget Update") is not a person, and the right side of an Agenda
 * item ("Public Hearing", "Organizational Meeting") is not an organisation.
 */
function isPersonShaped(text: string): boolean {
  if (NAME_COMMA_TITLE.test(text)) return true;
  const dashed = NAME_DASH_RIGHT.exec(text);
  const [, name = "", right = ""] = dashed ?? [];
  return dashed !== null && !ORGANISATION_WORD.test(name) && ORGANISATION_WORD.test(right);
}

/** The text heuristic's verdict on one line: an Agenda item unless the line is shaped like a person. */
function isAgendaItemByText(text: string): boolean {
  return !isPersonShaped(text) && isAgendaItem(text);
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

function entryOf(block: Block, text: string, offset: Offset): RecordingLogEntry | null {
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
  if (isAgendaItemByText(text)) return { kind: "agenda-item", ...timed, text, foundBy: "text" };
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
  // Each line is decided on its own (owner decision A of ticket #126): the feed wins when it matches the line, and
  // otherwise the text heuristic decides that line.
  const feedMatches = blocks.map((block) => feedItems.length > 0 && matchesFeed(lineOf(block), feedItems));
  blocks.forEach((block, index) => {
    const offset = offsets[index];
    if (offset === undefined) throw new Error(`recording-log: block at ${block.timecode} has no offset`);
    const text = lineOf(block);
    const entry: RecordingLogEntry | null =
      feedMatches[index] === true
        ? { kind: "agenda-item", timecode: block.timecode, ...offset, text, foundBy: "feed" }
        : entryOf(block, text, offset);
    if (entry === null) {
      speakerTurns.push({ timecode: block.timecode, ...offset, speaker: text, agendaItem });
      return;
    }
    if (entry.kind === "agenda-item") agendaItem = entry.text;
    entries.push(entry);
  });
  return { speakerTurns, entries };
}
