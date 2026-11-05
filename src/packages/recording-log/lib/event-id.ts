import type { RecordingLogLink } from "./types.ts";

/** The player's page on the Legislature's site, with or without the trailing slash. */
const PLAYER_PATH = /^\/liz\/mediaplayer\/?$/;

/** The player link's address as a URL, or null when the annotation is not a player link. */
export function playerUrl(link: RecordingLogLink): URL | null {
  const parsed = URL.parse(link.url);
  return parsed !== null && PLAYER_PATH.test(parsed.pathname) ? parsed : null;
}

/** The distinct `eventID` values of the player links, in the order they first appear. */
export function eventIdsOf(links: readonly RecordingLogLink[]): string[] {
  const ids: string[] = [];
  for (const link of links) {
    const id = playerUrl(link)?.searchParams.get("eventID");
    if (id !== null && id !== undefined && id !== "" && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
