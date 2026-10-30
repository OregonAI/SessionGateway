// The glossary's people words as types: a Legislator, the Legislator Codes the feed uses for them,
// and the sponsorships that name them. This entry point also mints the Legislator's id, in the form
// GLOSSARY.md gives (`legislator-2025r1-<name>`).
import type { MeasureKey, SessionKey } from "./index.ts";

/** A Legislator's id: `legislator-2025r1-<name>`. One person has one id across every Legislator Code. */
export type LegislatorId = string & { readonly brand: "LegislatorId" };

/** One Legislators row of the feed, reduced to what names the person. */
export type LegislatorRow = {
  session: SessionKey;
  /** The Legislator Code: the display string the feed uses in votes and sponsorships. */
  code: string;
  firstName: string;
  lastName: string;
};

/** One member of the Legislative Assembly, as a person. */
export type Legislator = {
  id: LegislatorId;
  /** First and last name, as the Legislators row gives them. */
  name: string;
};

export type SponsorLevel = "chief" | "regular";

type SponsorshipFields = {
  /** The feed's `MeasureSponsorId`. */
  id: number;
  measure: MeasureKey;
  level: SponsorLevel;
  /** The feed's `PrintOrder`: the order the sponsors are printed in. */
  printOrder: number;
};

/**
 * One MeasureSponsors row. A Member row names a Legislator by a Legislator Code. A Committee row (a
 * committee sponsors the Measure) names a committee by its code, and a Presession row carries the
 * message OLIS prints in the sponsor line ("(Presession filed.)"): neither names a Legislator.
 */
export type Sponsorship =
  | (SponsorshipFields & { kind: "member"; legislatorCode: string })
  | (SponsorshipFields & { kind: "committee"; committeeCode: string })
  | (SponsorshipFields & { kind: "presession"; message: string });

/** A Measure's sponsor as the server shows it. `legislator` is null while the code is unresolved. */
export type Sponsor = {
  level: SponsorLevel;
  legislatorCode: string;
  legislator: Legislator | null;
};

/** Lower-case ASCII words: accents dropped, anything else that is not a letter or digit a word break. */
function wordsOf(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
}

/**
 * Where the name starts among a code's words (the chamber word already dropped): at the longest
 * run of the last name's first words that the code contains, the earliest such place. A code can
 * write only part of a long last name ("Rep Speaker Quux" for "Quux-Zed"), so a shorter run counts.
 */
function nameStartIn(words: string[], lastName: string[]): number | undefined {
  for (let length = lastName.length; length >= 1; length -= 1) {
    const wanted = lastName.slice(0, length).join(" ");
    for (let start = 0; start + length <= words.length; start += 1) {
      if (words.slice(start, start + length).join(" ") === wanted) return start;
    }
  }
  return undefined;
}

/**
 * Mints a Legislator's id, `legislator-2025r1-<name>`, from a Legislator Code that names the person
 * and the person's last name. The name is the last name and whatever the code adds after it (the
 * initials that tell two Legislators of one last name apart: "Rep Levy B" is `levy-b`), in lower
 * case, hyphenated. The chamber word and a title before the last name ("Speaker" in "Rep Speaker
 * Fahey") are left out, so the id stays with the person when their code changes chamber or office.
 *
 * A code that holds none of the last name has no way to tell a title from a name, so it is an error
 * rather than an id that keeps the title.
 */
export function legislatorIdOf(session: SessionKey, code: string, lastName: string): LegislatorId {
  const words = wordsOf(code).slice(1);
  const start = nameStartIn(words, wordsOf(lastName));
  if (start === undefined) {
    throw new Error(
      `The Legislator Code "${code}" does not contain the last name "${lastName}", so the Legislator's id cannot be made from it`,
    );
  }
  return `legislator-${session.toLowerCase()}-${words.slice(start).join("-")}` as LegislatorId;
}

/** What decides where a sponsor stands in the print order of a Measure's sponsors. */
export type SponsorPrintFields = {
  /** The feed's `PrintOrder`. */
  printOrder: number;
  /** The feed's `MeasureSponsorId`: the order the rows were created in, used only to make the order total. */
  sponsorId: number;
  legislatorCode: string;
  legislatorId: LegislatorId | null;
};

/** The first word of a House member's Legislator Code ("Rep Helm") and of a Senator's ("Sen Meek"), by the Measure prefix's first letter. */
const chamberWordOfPrefix: Record<string, string> = { H: "rep", S: "sen" };

/** 0 for the Measure's own chamber, 1 for the other one, 2 for a code that begins with neither word. */
function chamberRank(measurePrefix: string, code: string): number {
  const word = wordsOf(code)[0];
  if (word === chamberWordOfPrefix[measurePrefix.slice(0, 1)]) return 0;
  return word === "rep" || word === "sen" ? 1 : 2;
}

/**
 * The name a sponsor is sorted by: the name part of their Legislator's id when the code resolved,
 * which leaves out the chamber word and an office title ("Fahey" for "Rep Speaker Fahey"), and
 * otherwise the code without its chamber word.
 */
function sortName(sponsor: SponsorPrintFields): string {
  if (sponsor.legislatorId !== null) return sponsor.legislatorId.split("-").slice(2).join("-");
  return wordsOf(sponsor.legislatorCode).slice(1).join("-");
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * Orders a Measure's sponsors the way OLIS prints them: by `PrintOrder` (chief sponsors come first
 * that way), then, among the sponsors who share one, the Measure's own chamber before the other, then
 * by name. A sponsor added after introduction stands in the printed place and not at the end. OLIS's
 * overview page for HB 3131 and the cache's MeasureSponsors rows both show it (see
 * test/tools/get-measure-sponsors.test.ts).
 */
export function comparePrintOrder(measurePrefix: string): (a: SponsorPrintFields, b: SponsorPrintFields) => number {
  return (a, b) =>
    a.printOrder - b.printOrder ||
    chamberRank(measurePrefix, a.legislatorCode) - chamberRank(measurePrefix, b.legislatorCode) ||
    compareText(sortName(a), sortName(b)) ||
    a.sponsorId - b.sponsorId;
}
