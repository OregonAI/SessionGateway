import { normalizeExtractedText } from "./normalize.ts";

// A Proposed Amendment names the text it amends on its first page, in capitals, after "PROPOSED AMENDMENTS TO":
//   PROPOSED AMENDMENTS TO
//   SENATE BILL 69                       (the Introduced Version)
//   A-ENGROSSED HOUSE BILL 3795          (the A-Engrossed Version)
// The page footer repeats it in mixed case ("Proposed Amendments to SB 69"), which is why the match is
// case-sensitive: a footer is not the header. The Measure's words are a chamber and one to three more words
// ("BILL", "JOINT RESOLUTION") and its number.
const header = /PROPOSED AMENDMENTS TO (?:([A-Z])-ENGROSSED )?(?:SENATE|HOUSE)(?: [A-Z]+){1,3} \d+/;

/**
 * The Version a Proposed Amendment says it amends, in the words the feed describes Versions in
 * ("Introduced", "A-Engrossed"), or undefined when the text has no header that names one. Nothing is
 * guessed: a header the text lacks, or one cut short, names no Version.
 */
export function readAmendedVersionHeader(text: string): string | undefined {
  const named = header.exec(normalizeExtractedText(text));
  if (named === null) return undefined;
  return named[1] === undefined ? "Introduced" : `${named[1]}-Engrossed`;
}
