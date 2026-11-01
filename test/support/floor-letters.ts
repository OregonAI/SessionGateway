// MADE-UP FloorLetters rows and files for seam-1 tests (ticket #64). The 2025R1 fixture holds no FloorLetters file, so
// the fake OLIS serves the set empty; a test gives it these rows (`madeUpRows`) and their PDFs (`madeUpDocuments`).
// A row has the shape of the real one docs/research/olis-odata.md section 2 quotes (FloorLetterId 4220): FloorLetterId,
// MeasurePrefix and MeasureNumber (null when the letter names no Measure), LetterDate, Chamber, LetterDescription,
// LetterTitle and FloorLetterUrl, with the SessionKey every set is filtered by. Every value here is made up.
import type { SystemOptions } from "./system.ts";
import { madeUpPdf } from "./made-up-pdf.ts";

type Row = Record<string, unknown>;

export type MadeUpFloorLetter = {
  floorLetterId: number;
  /** The Measure the letter names, or null for a letter that names none. */
  measure: { prefix: string; number: number } | null;
  /** The feed's LetterDate: a Pacific date and time with no offset, as the feed writes it. */
  letterDate: string;
  chamber: "H" | "S";
  title: string;
  description: string;
  /** The lines of the letter's one page, or an empty list for a scan with no text layer. */
  lines: readonly string[];
};

/** Where OLIS serves a floor letter's file (olis-odata.md section 4): `/liz/{session}/Downloads/FloorLetter/{id}`. */
export function floorLetterPath(floorLetterId: number): string {
  return `/liz/2025R1/Downloads/FloorLetter/${floorLetterId}`;
}

export function floorLetterSourceUrl(floorLetterId: number): string {
  return `https://olis.oregonlegislature.gov${floorLetterPath(floorLetterId)}`;
}

/** The FloorLetters row of a made-up letter, as the feed writes one. */
export function madeUpFloorLetterRow(letter: MadeUpFloorLetter): Row {
  return {
    SessionKey: "2025R1",
    FloorLetterId: letter.floorLetterId,
    MeasureNumber: letter.measure?.number ?? null,
    MeasurePrefix: letter.measure?.prefix ?? null,
    LetterDate: letter.letterDate,
    Chamber: letter.chamber,
    LetterDescription: letter.description,
    LetterTitle: letter.title,
    FloorLetterUrl: floorLetterSourceUrl(letter.floorLetterId),
  };
}

/** The PDF of a made-up letter: one page with its lines, or one blank page (a scan has no text to read). */
export function madeUpFloorLetterPdf(letter: MadeUpFloorLetter): Uint8Array {
  return madeUpPdf([letter.lines]);
}

/** The fake OLIS options that serve these letters, rows and files, from the start. */
export function withFloorLetters(letters: readonly MadeUpFloorLetter[]): NonNullable<SystemOptions["olis"]> {
  return {
    madeUpRows: { FloorLetters: letters.map(madeUpFloorLetterRow) },
    madeUpDocuments: Object.fromEntries(
      letters.map((letter) => [floorLetterPath(letter.floorLetterId), madeUpFloorLetterPdf(letter)]),
    ),
  };
}
