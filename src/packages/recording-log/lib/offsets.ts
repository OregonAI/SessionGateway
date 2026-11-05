import { playerUrl } from "./event-id.ts";
import type { Block } from "./blocks.ts";
import { seconds } from "./blocks.ts";
import type { OffsetSource, RecordingLogLink } from "./types.ts";

/** Two links are on one line of the page when their rects start this close together (PDF points). */
const SAME_LINE = 0.5;

/** The seconds from a player link's `startStreamAt`, or null when it has none or it is not a whole number. */
function startStreamAt(link: RecordingLogLink): number | null {
  const value = playerUrl(link)?.searchParams.get("startStreamAt");
  return value !== null && value !== undefined && /^\d+$/.test(value) ? Number(value) : null;
}

/**
 * The log prints two links on every timecode line (one over the timecode, one over the text after it) and one on
 * each line that continues a block. So the lines of a page with two links are its timecode lines, top to bottom.
 * Returns each of the page's timecode lines' `startStreamAt`, or null when the page's rows cannot be matched to its
 * timecode lines (a different count, or a row without a `startStreamAt`).
 */
function pageOffsets(links: readonly RecordingLogLink[], timecodeLines: number): number[] | null {
  const rows: RecordingLogLink[][] = [];
  const ordered = links
    .filter((link) => playerUrl(link) !== null)
    .toSorted((a, b) => b.rect[1] - a.rect[1] || a.rect[0] - b.rect[0]);
  for (const link of ordered) {
    const row = rows.find((candidate) => Math.abs((candidate[0]?.rect[1] ?? 0) - link.rect[1]) < SAME_LINE);
    if (row === undefined) rows.push([link]);
    else row.push(link);
  }
  const timecodeRows = rows.filter((row) => row.length >= 2);
  if (timecodeRows.length !== timecodeLines) return null;
  const offsets = timecodeRows.map((row) => (row[0] === undefined ? null : startStreamAt(row[0])));
  return offsets.every((offset) => offset !== null) ? offsets : null;
}

export type Offset = { offsetSeconds: number; offsetSource: OffsetSource };

/** The offset of every block, in order: from its link where the page's links can be matched, else from its timecode. */
export function offsetsOf(blocks: readonly Block[], links: readonly RecordingLogLink[]): Offset[] {
  const pages = [...new Set(blocks.map((block) => block.page))];
  const byPage = new Map<number, number[] | null>(
    pages.map((page) => [
      page,
      pageOffsets(
        links.filter((link) => link.page === page),
        blocks.filter((block) => block.page === page).length,
      ),
    ]),
  );
  const taken = new Map<number, number>();
  return blocks.map((block): Offset => {
    const index = taken.get(block.page) ?? 0;
    taken.set(block.page, index + 1);
    const fromLink = byPage.get(block.page)?.[index];
    return fromLink === undefined
      ? { offsetSeconds: seconds(block.timecode), offsetSource: "timecode" }
      : { offsetSeconds: fromLink, offsetSource: "link" };
  });
}
