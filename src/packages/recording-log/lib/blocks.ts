// The log's text as blocks: a timecode line and the lines that continue it.

export type Block = {
  timecode: string;
  /** The page (1-based) the timecode line is on. */
  page: number;
  /** The text after the timecode and each continuation line, one string for each line. */
  lines: string[];
  /** Where the timecode line starts in the log's text, in UTF-16 code units. */
  start: number;
  /**
   * Where the block's own lines end in the text, after the last line's break: the timecode line and the continuation lines
   * that follow it with nothing between. A continuation line that comes after the page's repeated lines is the block's text
   * (`lines`) and is not in this span.
   */
  end: number;
  /** Whether a line of the page's own (its repeated lines) came between the block's lines: later lines are not in the span. */
  interrupted: boolean;
};

const TIMECODE_LINE = /^(\d{2}:\d{2}:\d{2})(?:\s+(.*))?$/;

/** The lines the log prints at the head of every page, which interrupt a block and do not end it. */
export const COMPLIANCE_LINE = /^This recording log is in compliance with /;
const DATE_LINE = /^\d{2}\/\d{2}\/\d{4}$/;
const PAGE_LINE = /^Page \d+ of \d+$/;
const COMMITTEE_CODE_LINE = /^[A-Z]+$/;

/** The labels that open the log's header and its roster of members and staff: lines under them are not a block's. */
const SECTION_LABEL =
  /^(?:STAFF PRESENT|MEMBERS? PRESENT|MEMBER\(S\) PRESENT|MEMBERS? EXCUSED|MEMBER\(S\) EXCUSED|EXHIBITS|MEASURES\/ISSUES)\b/i;

/**
 * A member of the committee on a line of its own under a block: the roster of members, which the text layer prints
 * where it ends up with no label over it. A title that wraps does not start with "Sen." or "Rep.".
 */
const ROSTER_LINE = /^(?:Sen|Rep)\. /;

export function seconds(timecode: string): number {
  const [hours = 0, minutes = 0, secs = 0] = timecode.split(":").map(Number);
  return hours * 3600 + minutes * 60 + secs;
}

export function readBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let open: Block | null = null;
  let pageStart = 0;
  text.split("\f").forEach((pageText, pageIndex) => {
    const lines = pageText.split("\n");
    let lineStart = pageStart;
    lines.forEach((line, index) => {
      // The line's own break goes with it when it has one: the last line of a page ends at the form feed or the text's end.
      const lineEnd = lineStart + line.length + (index < lines.length - 1 ? 1 : 0);
      const timecoded = TIMECODE_LINE.exec(line);
      if (timecoded !== null) {
        open = {
          timecode: timecoded[1] ?? "",
          page: pageIndex + 1,
          lines: [(timecoded[2] ?? "").trim()],
          start: lineStart,
          end: lineEnd,
          interrupted: false,
        };
        blocks.push(open);
      } else if (SECTION_LABEL.test(line) || ROSTER_LINE.test(line)) {
        open = null;
      } else if (
        COMPLIANCE_LINE.test(line) ||
        DATE_LINE.test(line) ||
        PAGE_LINE.test(line) ||
        (COMMITTEE_CODE_LINE.test(line) && DATE_LINE.test(lines[index + 1] ?? ""))
      ) {
        // Page furniture: the block that was open stays open, and its span stops before this line.
        if (open !== null) open.interrupted = true;
      } else if (open !== null && line.trim() !== "") {
        open.lines.push(line.trim());
        if (!open.interrupted) open.end = lineEnd;
      }
      lineStart = lineEnd;
    });
    pageStart += pageText.length + 1;
  });
  return blocks;
}
