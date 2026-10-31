// How a list tool says that a row it lists is one the feed no longer lists (ADR-0005, ADR-0030). Spec #1 and
// ADR-0005 say only that such a row leaves search results and stays fetchable by id, so the tools that list rows
// do not hide it; they flag it. The flag is on the item, and a listed item has none, so a list that nothing has
// left is the list it was.
import { z } from "zod";

/** The flag's schema, for an item of a list. */
export const noLongerListedOutput = z
  .literal(true)
  .optional()
  .describe(
    "Present, and true, only when the Legislature's feed has stopped listing this row: two complete full pulls in a row did not list it. The row is still shown, as it was last read, and search does not return a document of it. get_document still serves a document of it if this index fetched its file; if it never did, get_document answers with an error that says so, because no pull fetches a file the feed does not list. Absent when the feed lists it.",
  );

/** The flag as an object to spread into an item: nothing for a row the feed lists. */
export function noLongerListedFlag(listed: boolean): { no_longer_listed?: true } {
  return listed ? {} : { no_longer_listed: true };
}
