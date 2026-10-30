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
 * One MeasureSponsors row. A Member row names a Legislator by a Legislator Code. A Committee row
 * (a committee sponsors the Measure) and a Presession row (the Measure was filed before the Session)
 * name no Legislator.
 */
export type Sponsorship =
  | (SponsorshipFields & { kind: "member"; legislatorCode: string })
  | (SponsorshipFields & { kind: "committee" | "presession" });

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
 * Mints a Legislator's id, `legislator-2025r1-<name>`, from the Legislator Code that names the person
 * and the person's last name. The name is the last name and whatever the code adds after it (the
 * initials that tell two Legislators of one last name apart: "Rep Levy B" is `levy-b`), in lower
 * case, hyphenated. The chamber word and a title before the last name ("Speaker" in "Rep Speaker
 * Fahey") are left out, so the id stays with the person when their code changes chamber or office.
 */
export function legislatorIdOf(session: SessionKey, code: string, lastName: string): LegislatorId {
  const words = wordsOf(code).slice(1);
  const last = wordsOf(lastName);
  let start = 0;
  while (start < words.length && words.slice(start, start + last.length).join(" ") !== last.join(" ")) start += 1;
  const name = (start < words.length ? words.slice(start) : words).join("-");
  return `legislator-${session.toLowerCase()}-${name}` as LegislatorId;
}
