// The words of GLOSSARY.md as types, and the one place that mints and parses ids (src/CLAUDE.md,
// "Shape"): the OregonAI forms of ADR-0004, such as `measure-2025r1-sb69`.

/** One Session as OLIS keys it: `2025R1`. */
export type SessionKey = string & { readonly brand: "SessionKey" };

const sessionKeyPattern = /^\d{4}[A-Z]\d$/;

export function parseSessionKey(text: string): SessionKey | undefined {
  return sessionKeyPattern.test(text) ? (text as SessionKey) : undefined;
}

/** What identifies a Measure: its Session, prefix ("SB") and number. */
export type MeasureKey = {
  session: SessionKey;
  prefix: string;
  number: number;
};

export type Measure = MeasureKey & {
  catchline: string | null;
};

/** A Measure's id in OregonAI's form: lower-case Session and prefix, no leading zeros. */
export type MeasureId = string & { readonly brand: "MeasureId" };

export function measureIdOf(key: MeasureKey): MeasureId {
  return `measure-${key.session.toLowerCase()}-${key.prefix.toLowerCase()}${key.number}` as MeasureId;
}

/** The Measure's page on OLIS, built from its keys. It is linked and never fetched (spec #1, "Out of Scope"). */
export function olisPageUrlOf(key: MeasureKey): string {
  return `https://olis.oregonlegislature.gov/liz/${key.session}/Measures/Overview/${key.prefix}${key.number}`;
}

const citationPattern = /^([A-Za-z]+)\s*(\d+)$/;

/** Reads a citation such as "SB 69" as a Measure of the deployment's Session. */
export function parseMeasureReference(text: string, session: SessionKey): MeasureKey | undefined {
  const citation = citationPattern.exec(text.trim());
  if (citation?.[1] === undefined || citation[2] === undefined) return undefined;
  return { session, prefix: citation[1].toUpperCase(), number: Number(citation[2]) };
}
