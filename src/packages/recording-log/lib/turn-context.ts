import type { RecordingLogLink } from "./types.ts";

/** A member of the Meeting's committee: the Legislator Code the feed gives and the Legislator's name, "First Last". */
export type CommitteeMemberName = { code: string; name: string };

/** The titles a log puts before a Legislator's name: a committee office and the chamber's form of address. */
const TITLES = /^(?:(?:co-chair|vice-chair|chair|representative|senator|rep\.?|sen\.?)\s+)+/i;

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

/** Whether a logged token stands for a first name: the name itself, or its initial. */
function standsForFirstName(logged: string, firstName: string | undefined): boolean {
  if (firstName === undefined) return false;
  return logged === firstName || (logged.length === 1 && firstName.startsWith(logged));
}

/**
 * The Legislator Code of the committee member a speaker line names, or null. Only a line that begins with a title
 * ("Co-Chair Helm", "Rep. B. Levy", "Sen. Suzanne Weber, Senate District 16") names a Legislator: a witness who shares
 * a member's last name is not that member. The name is what follows the title up to the first comma; its last word is
 * the member's last word, and the words before it must match the first name or its initial only when two members share
 * the last word (the feed holds "Finger McDonald" as "McDonald"). A name that matches no member or more than one is null:
 * the resolver never guesses.
 */
export function legislatorOfSpeaker(speaker: string, members: readonly CommitteeMemberName[]): string | null {
  const titled = TITLES.exec(speaker.trim());
  if (titled === null) return null;
  const name = tokensOf(speaker.trim().slice(titled[0].length).split(",")[0] ?? "");
  const last = name.at(-1);
  if (last === undefined) return null;
  const sameLastName = members.filter((member) => tokensOf(member.name).at(-1) === last);
  if (sameLastName.length <= 1) return sameLastName[0]?.code ?? null;
  const logged = name.at(-2);
  const byFirstName = sameLastName.filter(
    (member) => logged !== undefined && standsForFirstName(logged, tokensOf(member.name)[0]),
  );
  return byFirstName.length === 1 ? (byFirstName[0]?.code ?? null) : null;
}

/** The prefixes of the Measures OLIS lists (domain/citations.ts). */
const MEASURE_AT_START = /^(HB|SB|HJR|SJR|HCR|SCR|HJM|SJM|HR|SR)\s?(\d{1,4})\b/;

/** The Measure an Agenda item line begins with ("HB 2167 - Public Hearing"), or null for an item that names none. */
export function measureOfAgendaItem(text: string | null): { prefix: string; number: number } | null {
  const found = text === null ? null : MEASURE_AT_START.exec(text.trim());
  return found === null ? null : { prefix: found[1] ?? "", number: Number(found[2]) };
}

/**
 * The official player at a second of the recording: the log's own player link for that event, with its second
 * replaced. Its address, clientID and eventID are the log's, never made up; null when the log has no player link for the
 * event.
 */
export function playerLinkOf(
  links: readonly RecordingLogLink[],
  eventId: string,
  offsetSeconds: number,
): string | null {
  for (const link of links) {
    if (!URL.canParse(link.url)) continue;
    const url = new URL(link.url);
    if (!url.pathname.includes("mediaplayer") || url.searchParams.get("eventID") !== eventId) continue;
    url.searchParams.set("startStreamAt", String(offsetSeconds));
    return url.toString();
  }
  return null;
}
