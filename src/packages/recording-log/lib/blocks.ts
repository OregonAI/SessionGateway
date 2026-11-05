// The log's text as blocks: a timecode line and the lines that continue it.

export type Block = {
  timecode: string;
  /** The page (1-based) the timecode line is on. */
  page: number;
  /** The text after the timecode and each continuation line, one string for each line. */
  lines: string[];
};

const TIMECODE_LINE = /^(\d{2}:\d{2}:\d{2})(?:\s+(.*))?$/;

/** The lines the log prints at the head of every page, which interrupt a block and do not end it. */
const COMPLIANCE_LINE = /^This recording log is in compliance with /;
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
  text.split("\f").forEach((pageText, pageIndex) => {
    const lines = pageText.split("\n");
    lines.forEach((line, index) => {
      const timecoded = TIMECODE_LINE.exec(line);
      if (timecoded !== null) {
        open = { timecode: timecoded[1] ?? "", page: pageIndex + 1, lines: [(timecoded[2] ?? "").trim()] };
        blocks.push(open);
      } else if (SECTION_LABEL.test(line) || ROSTER_LINE.test(line)) {
        open = null;
      } else if (
        COMPLIANCE_LINE.test(line) ||
        DATE_LINE.test(line) ||
        PAGE_LINE.test(line) ||
        (COMMITTEE_CODE_LINE.test(line) && DATE_LINE.test(lines[index + 1] ?? ""))
      ) {
        // Page furniture: the block that was open stays open.
      } else if (open !== null && line.trim() !== "") {
        open.lines.push(line.trim());
      }
    });
  });
  return blocks;
}
