// The words of GLOSSARY.md as types, and the one place that mints and parses ids (src/CLAUDE.md,
// "Shape"): the OregonAI forms of ADR-0004, such as `measure-2025r1-sb69`.

import type { Timestamp } from "#/packages/time/pacific.ts";

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

/** Where a Measure is now, as the feed's Measures row says it (GLOSSARY.md, "Location"). */
export type MeasureLocation = {
  /** The feed's `CurrentLocation`, such as "In Senate Committee" or "Chapter Number Assigned". */
  current: string;
  /**
   * The feed's `CurrentCommitteeCode`, as it gives it: null when it gives none. It does not say the Measure is
   * in that committee, because the feed keeps it for some Measures at the President's desk and gives none for one
   * in a House committee (docs/research/olis-votes.md §6); `current` says where the Measure is.
   */
  committeeCode: string | null;
};

export type Measure = MeasureKey & {
  catchline: string | null;
  location: MeasureLocation;
  /**
   * The digest and summary of what the Measure does, as the feed's `MeasureSummary` gives it: the
   * Legislature's own text, unchanged, with its tabs, newlines and markup (`<b>` for new text,
   * `[<i>...</i>]` for text deleted from the prior Version; olis-odata.md gotcha 8).
   */
  digest: string | null;
  /** When OLIS created the Measure's row, in Pacific time with its offset. */
  createdAt: Timestamp;
  /** When OLIS last changed it, if it ever did. */
  modifiedAt: Timestamp | null;
};

/** The two chambers of the Legislative Assembly. */
export type Chamber = "house" | "senate";

/** One line of a Measure's history: something that happened to it, in one chamber, at one time. */
export type HistoryAction = {
  /** The feed's `MeasureHistoryId`. */
  id: number;
  measure: MeasureKey;
  chamber: Chamber;
  /** When the action happened, in Pacific time with its offset (not when OLIS recorded it). */
  date: Timestamp;
  /** The action as OLIS prints it, spaces included. */
  text: string;
};

/** Orders history actions oldest first: by when they happened, then by the feed's id. */
export function compareHistoryActions(a: HistoryAction, b: HistoryAction): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.id - b.id;
}

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
const measureIdPattern = /^measure-(\d{4}[a-z]\d)-([a-z]+)(\d+)$/i;

/**
 * Reads a Measure id ("measure-2025r1-sb69") or a citation ("SB 69") as a Measure of the
 * deployment's Session. An id that names another Session is not a Measure of this deployment.
 */
export function parseMeasureReference(text: string, session: SessionKey): MeasureKey | undefined {
  const trimmed = text.trim();
  const id = measureIdPattern.exec(trimmed);
  if (id?.[1] !== undefined && id[2] !== undefined && id[3] !== undefined) {
    if (id[1].toUpperCase() !== session) return undefined;
    return { session, prefix: id[2].toUpperCase(), number: Number(id[3]) };
  }
  const citation = citationPattern.exec(trimmed);
  if (citation?.[1] === undefined || citation[2] === undefined) return undefined;
  return { session, prefix: citation[1].toUpperCase(), number: Number(citation[2]) };
}

/**
 * The citation a Measure id stands for: "SB 69" for `measure-2025r1-sb69`. The id is minted by
 * `measureIdOf`, so it always has this form.
 */
export function citationOfMeasureId(id: MeasureId): string {
  const parts = measureIdPattern.exec(id);
  if (parts?.[2] === undefined || parts[3] === undefined) throw new Error(`Not a Measure id: ${id}`);
  return `${parts[2].toUpperCase()} ${Number(parts[3])}`;
}
