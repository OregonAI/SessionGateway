// The tables whose rows carry the feed's CreatedDate and are hidden until the clock reaches it (ticket #153, ADR-0056),
// in one place: schema step 5 adds the column to them, the reader's rule makes a temp view over each, and the arrangers of
// the tests that make old files (the database package's `tests/arranged-files.ts`, seam 1's `test/support/old-database.ts`)
// take them from here, so a table added to the list is in all four. The sets a document's creation time stands for are not
// here: a Floor Letter has no CreatedDate in the feed, and a document's time is in `document_created`.

/** Each table that holds a row stamped with its own CreatedDate: the Measure's sponsors, history actions and votes, the meetings and their agenda items, and the committees' members. */
export const stampedTables = [
  "sponsor",
  "history_action",
  "floor_vote",
  "committee_vote",
  "meeting",
  "agenda_item",
  "committee_member",
] as const;

export type StampedTable = (typeof stampedTables)[number];

/** `committee_member` has had its `created_at` column since version 1 (the feed's CreatedDate was stored from the start). */
const stampedFromVersionOne: readonly StampedTable[] = ["committee_member"];

/** The tables step 5 gave a `created_at` column to: every stamped table that did not have one. */
export const tablesGivenCreatedAtByStepFive: readonly StampedTable[] = stampedTables.filter(
  (table) => !stampedFromVersionOne.includes(table),
);
