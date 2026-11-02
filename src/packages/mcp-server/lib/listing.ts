// How the tools say that a row is one the feed no longer lists (ADR-0005, ADR-0030): the one place that writes it.
// Spec #1 and ADR-0005 say only that such a row leaves search results and stays fetchable by id, so the tools that list
// rows do not hide it; they flag it. The flag is on the item, and a listed item has none, so a list that nothing has
// left is the list it was. `get_measure` and `get_document` say it of the one thing they serve, with the time the feed
// last listed it. Every tool takes its flag, its schema and its description from here, so that they cannot disagree.
import { z } from "zod";
import type { Listing } from "#/packages/domain/documents.ts";

/** The flag's schema, for an item of a list. */
export const noLongerListedOutput = z
  .literal(true)
  .optional()
  .describe(
    "Present, and true, only when the Legislature's feed has stopped listing this row: two complete full pulls in a row did not list it. The row is still shown, as it was last read, and search does not return a document of it. get_document still serves a document of it if this index fetched its file; if it never did, get_document answers with an error that says so, because no pull fetches a file the feed does not list. Absent when the feed lists it.",
  );

/** The flag as an object to spread into an item: nothing for a row the feed lists. */
export function noLongerListedFlag(listing: Listing): { no_longer_listed?: true } {
  return listing.listed ? {} : { no_longer_listed: true };
}

/** The fields of `get_measure` that say whether the feed still lists the Measure. */
export const measureListingOutput = {
  no_longer_listed: noLongerListedOutput.describe(
    "Present, and true, only when the Legislature's feed has stopped listing the Measure: two complete full pulls in a row did not list it. The Measure is still served, as it was last read, with last_listed_at. Absent when the feed lists it.",
  ),
  last_listed_at: z
    .string()
    .optional()
    .describe(
      "Present only with no_longer_listed: when the feed last listed the Measure, the as-of time of the latest complete full pull that did, in Pacific time with its UTC offset.",
    ),
};

/** The fields of a document an Agency Link's evidence was read from, in a list of examples or documents (ADR-0037). */
export const documentListingFields = {
  no_longer_listed: noLongerListedOutput.describe(
    "Present, and true, only when the Legislature's feed has stopped listing the document the evidence was read from: two complete full pulls in a row did not list it. The document is still named, as it was last read. Absent when the feed lists it.",
  ),
  last_listed_at: z
    .string()
    .optional()
    .describe(
      "Present only with no_longer_listed: when the feed last listed the document, the as-of time of the latest complete full pull that did, in Pacific time with its UTC offset.",
    ),
};

/** The fields to spread into a Measure, a document or an example: nothing while the feed lists it. */
export function listingShown(listing: Listing): { no_longer_listed?: true; last_listed_at?: string } {
  return listing.listed ? {} : { ...noLongerListedFlag(listing), last_listed_at: listing.lastListedAt };
}

/** The fields of `get_document` that say whether the feed still lists the document: always present. */
export const documentListingOutput = {
  no_longer_listed: z
    .boolean()
    .describe(
      "True when the Legislature's feed has stopped listing the document: two complete full pulls in a row did not list it. It is then left out of search results, and this call still serves it, as it was fetched. For a Proposed Amendment it is true when none of its postings is listed.",
    ),
  last_listed_at: z
    .string()
    .nullable()
    .describe(
      "When the feed last listed the document: the as-of time of the latest complete full pull that did, in Pacific time with its UTC offset. It is the index's as-of time while the latest pull lists the document. Null while no complete full pull has listed it: this index was built before it kept that, so the document counts as listed (no_longer_listed is false) and the time is not known.",
    ),
};

/** The document's fields to spread into its result. */
export function documentListingShown(listing: Listing): { no_longer_listed: boolean; last_listed_at: string | null } {
  return { no_longer_listed: !listing.listed, last_listed_at: listing.lastListedAt };
}
