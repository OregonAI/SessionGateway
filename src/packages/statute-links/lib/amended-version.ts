import { versionDescriptionOfLetter, type AmendmentHeader } from "#/packages/domain/documents.ts";
import { normalizeExtractedText } from "./normalize.ts";

// A Proposed Amendment names the text it amends on its first page, in capitals, after "PROPOSED AMENDMENTS TO":
//   PROPOSED AMENDMENTS TO
//   SENATE BILL 69                       (the Introduced Version of SB 69)
//   A-ENGROSSED HOUSE BILL 3795          (the A-Engrossed Version of HB 3795)
// The page footer repeats it in mixed case ("Proposed Amendments to SB 69"), which is why the match is
// case-sensitive: a footer is not the header. The Measure's words are a chamber and one to three more words
// ("BILL", "JOINT RESOLUTION") and its number. Oregon's prefixes are those words' initials (SENATE BILL is SB,
// HOUSE JOINT RESOLUTION is HJR), so a header that reads anything else names a Measure that is not found.
const header = /PROPOSED AMENDMENTS TO (?:([A-Z])-ENGROSSED )?((?:SENATE|HOUSE)(?: [A-Z]+){1,3}) (\d+)/;

/**
 * What a Proposed Amendment's header names: the Version it says it amends, in the words the feed describes
 * Versions in ("Introduced", "A-Engrossed"), and the Measure it says it is to (prefix and number). Undefined
 * when the text has no header that names both. Nothing is guessed: a header the text lacks, or one cut short,
 * names nothing.
 */
export function readAmendedVersionHeader(text: string): AmendmentHeader | undefined {
  const named = header.exec(normalizeExtractedText(text));
  if (named?.[2] === undefined || named[3] === undefined) return undefined;
  const prefix = named[2]
    .split(" ")
    .map((word) => word.slice(0, 1))
    .join("");
  return { version: versionDescriptionOfLetter(named[1] ?? null), measure: { prefix, number: Number(named[3]) } };
}
