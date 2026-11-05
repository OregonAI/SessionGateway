import { playerUrl } from "./event-id.ts";
import type { RecordingLogLink } from "./types.ts";

/** A Legislator the resolver can name: the Legislator Code the feed gives and the Legislator's name, "First Last". */
export type CommitteeMemberName = { code: string; name: string };

/** The titles a log puts before a Legislator's name: a committee office and the chamber's form of address. */
const TITLE = /^(chair|co-chair|vice-chair|representative|senator|rep\.?|sen\.?)\s+/i;

type Chamber = "House" | "Senate";

/** The chamber a title names, or undefined for a committee office, which is any chamber's. */
function chamberOfTitle(title: string): Chamber | undefined {
  const word = title.toLowerCase();
  if (word.startsWith("rep")) return "House";
  if (word.startsWith("sen")) return "Senate";
  return undefined;
}

/** The chamber of a Legislator Code: the feed's codes begin with "Rep" or "Sen". Undefined for a code that begins with neither. */
function chamberOfCode(code: string): Chamber | undefined {
  const word = code.split(/\s+/)[0]?.toLowerCase();
  if (word === "rep") return "House";
  return word === "sen" ? "Senate" : undefined;
}

/** Lower case, accents folded, periods dropped: "B." and "b" are one token, "Muñoz" and "Munoz" are one. */
function tokensOf(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\./g, "")
    .split(/\s+/)
    .filter((token) => token !== "");
}

/** Whether a logged first name or initial is the start of the Legislator's first name: "b" and "bobby" are both Bobby's. */
function startsFirstName(logged: string, legislator: CommitteeMemberName): boolean {
  return (tokensOf(legislator.name)[0] ?? "").startsWith(logged);
}

/** What a speaker line says of a Legislator: the title's chamber (none for an office), and the name that follows it. */
type NamedSpeaker = { chamber: Chamber | undefined; conflict: boolean; name: string[] };

/**
 * Reads a speaker line's titles and name. Only a line that begins with a title names a Legislator: a witness who shares a
 * member's last name is not that member. The name is what follows the titles up to the first comma. Titles that name both
 * chambers ("Rep. Sen. X") are a conflict and name no one.
 */
function namedSpeaker(speaker: string): NamedSpeaker | null {
  let rest = speaker.trim();
  const chambers = new Set<Chamber>();
  let titled = false;
  for (let found = TITLE.exec(rest); found !== null; found = TITLE.exec(rest)) {
    titled = true;
    const chamber = chamberOfTitle(found[1] ?? "");
    if (chamber !== undefined) chambers.add(chamber);
    rest = rest.slice(found[0].length);
  }
  if (!titled) return null;
  return { chamber: [...chambers][0], conflict: chambers.size > 1, name: tokensOf(rest.split(",")[0] ?? "") };
}

/**
 * The Legislator Code of the Legislator a speaker line names among `candidates`, or null. A candidate fits when:
 * - the title's chamber agrees with the code's ("Rep." and "Representative" a House code, "Sen." and "Senator" a Senate
 *   code; Chair, Co-Chair and Vice-Chair fit either);
 * - the name's last word is the last word of the candidate's name (the feed holds "Finger McDonald" as "McDonald");
 * - the first name or initial the line gives agrees with the candidate's first name. A line gives one when it has more
 *   than one word and its first word is an initial or the first name of some Legislator in `known` (so "Hai Pham" and
 *   "B. Levy" give one, and "Finger McDonald" does not: "Finger" is the compound surname's start);
 * - and, when `needsFirstName`, the line does give one: a surname alone never resolves among everyone.
 * Only a unique fit resolves.
 */
function fitting(
  named: NamedSpeaker,
  candidates: readonly CommitteeMemberName[],
  known: readonly CommitteeMemberName[],
  needsFirstName: boolean,
): CommitteeMemberName[] {
  const last = named.name.at(-1);
  if (last === undefined || named.conflict) return [];
  const first = named.name.length >= 2 ? named.name[0] : undefined;
  const given =
    first !== undefined && (first.length === 1 || known.some((legislator) => startsFirstName(first, legislator)))
      ? first
      : undefined;
  if (needsFirstName && given === undefined) return [];
  return candidates.filter((candidate) => {
    if (tokensOf(candidate.name).at(-1) !== last) return false;
    const chamber = chamberOfCode(candidate.code);
    if (named.chamber !== undefined && chamber !== named.chamber) return false;
    return given === undefined || startsFirstName(given, candidate);
  });
}

/**
 * The Legislator Code of the Legislator a speaker line names ("Co-Chair Helm", "Rep. B. Levy", "Sen. Suzanne Weber,
 * Senate District 16"), or null (owner decision B of ticket #126, ADR-0052). It looks among the Meeting's committee
 * `members` first. When none of them fits it looks among `legislators`, all of the Session's, where a first name or
 * initial must be given. A line that fits two or more members resolves to no one and is not looked up among the rest:
 * the resolver never guesses. See `fitting` for what fits.
 */
export function legislatorOfSpeaker(
  speaker: string,
  members: readonly CommitteeMemberName[],
  legislators: readonly CommitteeMemberName[] = [],
): string | null {
  const named = namedSpeaker(speaker);
  if (named === null) return null;
  const known = [...members, ...legislators];
  const inCommittee = fitting(named, members, known, false);
  if (inCommittee.length > 0) return inCommittee.length === 1 ? (inCommittee[0]?.code ?? null) : null;
  const inSession = fitting(named, legislators, known, true);
  return inSession.length === 1 ? (inSession[0]?.code ?? null) : null;
}

/** The prefixes of the Measures OLIS lists (domain/citations.ts). */
const MEASURE_PREFIX = "HB|SB|HJR|SJR|HCR|SCR|HJM|SJM|HR|SR";
/** A Measure as an Agenda line names it, with the letter of an amendment after it ("HB 4076 A"): its prefix and number. */
const MEASURE_AT_START = new RegExp(String.raw`^(${MEASURE_PREFIX})\s?(\d{1,4})\b(?:\s+[A-Z](?![\p{L}\d]))?`, "u");
/** What a line puts between the Measures it names: "SB 1542 and SB 1543", "SB 1538, SB 1581, and SB 1596". */
const MEASURE_SEPARATOR = /^(?:\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*)/;

/** The Measures a line begins with, each once in the order named, and the rest of the line after them. */
function leadingMeasures(text: string | null): { measures: { prefix: string; number: number }[]; rest: string } {
  const measures: { prefix: string; number: number }[] = [];
  let rest = text?.trim() ?? "";
  for (;;) {
    const found = MEASURE_AT_START.exec(rest);
    if (found === null) break;
    const measure = { prefix: found[1] ?? "", number: Number(found[2]) };
    if (!measures.some((seen) => seen.prefix === measure.prefix && seen.number === measure.number)) {
      measures.push(measure);
    }
    rest = rest.slice(found[0].length);
    const separator = MEASURE_SEPARATOR.exec(rest);
    if (separator === null) break;
    rest = rest.slice(separator[0].length);
  }
  return { measures, rest };
}

/**
 * The Measures an Agenda item line names, in the order it names them: the list the line begins with ("SB 1542 and SB 1543 -
 * Public Hearing", "HB 4079 A and HB 4160 A - Public Hearing", "SB 1538, SB 1581, and SB 1596 - Public Hearing"), each
 * once. A Measure named further into the line ("Nuclear Energy Study (HB 4046, 2026) - Informational Meeting") is not in the
 * list: that line is a topic, not that Measure's hearing. Empty for an item that begins with none (owner decision of
 * 2026-11-05, ticket #127).
 */
export function measuresOfAgendaItem(text: string | null): { prefix: string; number: number }[] {
  return leadingMeasures(text).measures;
}

/** The Measure an Agenda item line begins with ("HB 2167 - Public Hearing"), or null for an item that names none. */
export function measureOfAgendaItem(text: string | null): { prefix: string; number: number } | null {
  return measuresOfAgendaItem(text)[0] ?? null;
}

/**
 * What kind of hearing an Agenda item line is: "Public Hearing" or "Work Session" when the line says so, otherwise the
 * line's own wording after the Measures it names and the hyphen ("Informational Meeting"), and the whole line when it has no
 * wording after them.
 */
export function hearingKindOf(text: string): string {
  const line = text.trim();
  if (/\bpublic hearing\b/i.test(line)) return "Public Hearing";
  if (/\bwork session\b/i.test(line)) return "Work Session";
  const wording = leadingMeasures(line)
    .rest.replace(/^\s*-\s*/, "")
    .replace(/\.$/, "")
    .trim();
  return wording === "" ? line : wording;
}

/** The `startStreamAt` parameter of a query string: at its start or after an `&`, up to the next `&`. */
const START_STREAM_AT = /(^|&)startStreamAt=[^&]*/;

/**
 * The official player at a second of the recording: the log's own player link for that event, with its `startStreamAt`
 * replaced and every other byte of the link as the log has it. A link is a player link by event-id.ts's rule (the
 * Legislature's `/liz/mediaplayer` page) and is the event's when its `eventID` is the event ID. Null when the log has no
 * such link. A link without a `startStreamAt` gets one at the end of its query.
 */
export function playerLinkOf(
  links: readonly RecordingLogLink[],
  eventId: string,
  offsetSeconds: number,
): string | null {
  const link = links.find((candidate) => playerUrl(candidate)?.searchParams.get("eventID") === eventId);
  if (link === undefined) return null;
  const hash = link.url.indexOf("#");
  const address = hash === -1 ? link.url : link.url.slice(0, hash);
  const fragment = hash === -1 ? "" : link.url.slice(hash);
  const mark = address.indexOf("?");
  const path = mark === -1 ? address : address.slice(0, mark);
  const query = mark === -1 ? "" : address.slice(mark + 1);
  const second = `startStreamAt=${offsetSeconds}`;
  const rewritten = START_STREAM_AT.test(query)
    ? query.replace(START_STREAM_AT, (_, before: string) => `${before}${second}`)
    : query === ""
      ? second
      : `${query}&${second}`;
  return `${path}?${rewritten}${fragment}`;
}
