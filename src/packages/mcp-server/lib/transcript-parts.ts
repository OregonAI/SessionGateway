// Pages a Recording Log's machine transcript with the log's text (ticket #134, ADR-0055, owner decision 1 of 2026-11-05). A part
// of the log carries the transcript of the turns in that part, and a part's text and the transcript passages it carries together
// are at most `PART_SIZE_CHARACTERS`, so that transcript text never makes a part larger than a part of any other document.
//
// The log's text is cut at the ends of lines, as `splitIntoParts` cuts it, and the parts joined are the text exactly. Walking
// the text a line at a time, each turn's passages come right after the line the turn starts on (where the worker cut the text
// around the turn, `TranscriptOfLog.turnTextOffsets`), and the words that are no turn's come after the passages of the turn they
// follow in time (before the first turn: at the start of the log). A part is closed before the next line, or between two
// passages, when what comes next would take it over the size. The first passage of a turn is never parted from the turn's line.
// A turn whose passages do not fit in what is left of its part carries on in the parts after it, split between passages and
// never inside one; those parts begin with the rest of its passages, and the text after the turn's line follows them.
import type { ShownTranscriptPassage, TranscriptOfLog } from "#/packages/domain/transcripts.ts";
import { PART_SIZE_CHARACTERS } from "./parts.ts";

/** What one part of the log carries of its transcript. */
export type PagedTranscript = {
  modelId: string;
  madeAt: string;
  /**
   * One for each turn, in the order of the log's speaker-turn index: the passages of the turn in this part, which is empty for a
   * turn whose lines are in this part and that has none, or undefined for a turn that is not listed in this part.
   */
  turns: (ShownTranscriptPassage[] | undefined)[];
  /** The passages that are no turn's and come in this part, in order. */
  other: ShownTranscriptPassage[];
};

export type LogPart = { text: string; transcript: PagedTranscript };

type Item = { passage: ShownTranscriptPassage; turn: number | null };
type Anchor = { offset: number; order: number; turn: number | null; items: Item[] };
type Slot = { textStart: number; textEnd: number; used: number; items: Item[]; turnsListed: Set<number> };

/** The lines of a text with their breaks, each at most a part long: a longer line is cut as `splitIntoParts` cuts one. */
function chunksOf(text: string): { offset: number; length: number }[] {
  const chunks: { offset: number; length: number }[] = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    let end = newline === -1 ? text.length : newline + 1;
    if (end - start > PART_SIZE_CHARACTERS) {
      end = start + PART_SIZE_CHARACTERS;
      // Never cut a surrogate pair in two.
      const last = text.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    }
    chunks.push({ offset: start, length: end - start });
    start = end;
  }
  return chunks.length === 0 ? [{ offset: 0, length: 0 }] : chunks;
}

/**
 * The parts of a Recording Log with its transcript: each part's text, and the transcript it carries. `turns` are the log's turns
 * in the order of its speaker-turn index, which is the order `transcript.turns` follows.
 */
export function splitLogWithTranscript(
  text: string,
  turns: readonly { offsetSeconds: number }[],
  transcript: TranscriptOfLog,
): LogPart[] {
  // Where each turn's passages are anchored: its own lines, or for a turn the text could not place the lines of the turn before it.
  let placed = 0;
  const turnOffsets = turns.map((_, index) => {
    placed = transcript.turnTextOffsets[index] ?? placed;
    return placed;
  });
  const anchors: Anchor[] = [
    { offset: 0, order: -1, turn: null, items: [] },
    ...turns.map((_, index): Anchor => ({
      offset: turnOffsets[index] ?? 0,
      order: index,
      turn: index,
      items: (transcript.turns[index] ?? []).map((passage) => ({ passage, turn: index })),
    })),
  ];
  // Words that are no turn's follow the turn that began at or before them, and come before the first turn when none did.
  for (const passage of transcript.other) {
    let owner = 0;
    turns.forEach((turn, index) => {
      if (turn.offsetSeconds <= passage.startSeconds) owner = index + 1;
    });
    anchors[owner]?.items.push({ passage, turn: null });
  }
  anchors.sort((a, b) => a.offset - b.offset || a.order - b.order);

  const slots: Slot[] = [];
  let current: Slot = { textStart: 0, textEnd: 0, used: 0, items: [], turnsListed: new Set() };
  const close = (at: number): void => {
    current.textEnd = at;
    slots.push(current);
    current = { textStart: at, textEnd: at, used: 0, items: [], turnsListed: new Set() };
  };
  let next = 0;
  const arrive = (arriving: Anchor[], offset: number, length: number): void => {
    // The first passage of the first anchor that has one is never parted from the line: the two are taken together.
    const bound = arriving.flatMap((anchor) => anchor.items)[0];
    const together = length + (bound?.passage.text.length ?? 0);
    if (current.used > 0 && current.used + together > PART_SIZE_CHARACTERS) close(offset);
    current.used += length;
    for (const anchor of arriving) {
      if (anchor.turn !== null) current.turnsListed.add(anchor.turn);
      for (const item of anchor.items) {
        const size = item.passage.text.length;
        if (item !== bound && current.used > 0 && current.used + size > PART_SIZE_CHARACTERS) close(offset + length);
        current.used += size;
        current.items.push(item);
        if (item.turn !== null) current.turnsListed.add(item.turn);
      }
    }
  };
  for (const chunk of chunksOf(text)) {
    const arriving: Anchor[] = [];
    while (next < anchors.length && (anchors[next]?.offset ?? 0) <= chunk.offset + Math.max(chunk.length - 1, 0)) {
      const anchor = anchors[next];
      if (anchor !== undefined) arriving.push(anchor);
      next += 1;
    }
    if (arriving.length === 0) {
      if (current.used > 0 && current.used + chunk.length > PART_SIZE_CHARACTERS) close(chunk.offset);
      current.used += chunk.length;
    } else {
      arrive(arriving, chunk.offset, chunk.length);
    }
  }
  // An anchor whose offset is past the text (none is, but nothing is dropped if one were) comes after the last line.
  if (next < anchors.length) arrive(anchors.slice(next), text.length, 0);
  current.textEnd = text.length;
  slots.push(current);

  return slots.map((slot) => ({
    text: text.slice(slot.textStart, slot.textEnd),
    transcript: {
      modelId: transcript.modelId,
      madeAt: transcript.madeAt,
      turns: turns.map((_, index) =>
        slot.turnsListed.has(index)
          ? slot.items.filter((item) => item.turn === index).map((item) => item.passage)
          : undefined,
      ),
      other: slot.items.filter((item) => item.turn === null).map((item) => item.passage),
    },
  }));
}
