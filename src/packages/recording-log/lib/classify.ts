import type { Block } from "./blocks.ts";
import type { Offset } from "./offsets.ts";
import type { RecordingLogEntry, SpeakerTurn } from "./types.ts";

const MEASURE_ID = /^(?:HB|SB|HJR|SJR|HCR|SCR|HJM|SJM|HR|SR|HM|SM)\s?\d+/;
const HEARING_END = /(?:Public Hearing|Work Session)$/i;
const INFORMATIONAL = /\bInformational\b/i;
/** An agency and a topic, "Department of Energy - Energy Audits": a spaced hyphen and no comma. A speaker's line has a comma or no hyphen. */
const SUBJECT_DASH_TOPIC = /^[^,;]+ - [^,;]+$/;

function isAgendaItem(text: string): boolean {
  return MEASURE_ID.test(text) || HEARING_END.test(text) || INFORMATIONAL.test(text) || SUBJECT_DASH_TOPIC.test(text);
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
  if (isAgendaItem(text)) return { kind: "agenda-item", ...timed, text };
  return null;
}

export function classify(
  blocks: readonly Block[],
  offsets: readonly Offset[],
): { speakerTurns: SpeakerTurn[]; entries: RecordingLogEntry[] } {
  const speakerTurns: SpeakerTurn[] = [];
  const entries: RecordingLogEntry[] = [];
  let agendaItem: string | null = null;
  blocks.forEach((block, index) => {
    const offset = offsets[index];
    if (offset === undefined) return;
    const text = block.lines.join(" ").trim();
    const entry = entryOf(block, text, offset);
    if (entry === null) {
      speakerTurns.push({ timecode: block.timecode, ...offset, speaker: text, agendaItem });
      return;
    }
    if (entry.kind === "agenda-item") agendaItem = entry.text;
    entries.push(entry);
  });
  return { speakerTurns, entries };
}
