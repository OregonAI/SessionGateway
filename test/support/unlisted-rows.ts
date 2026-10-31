// How a seam-1 test makes OLIS stop listing a row, and list it again. The fake OLIS serves the rows whose
// `SessionKey` matches the pull's `$filter SessionKey eq '2025R1'` and counts the same rows, so a row whose
// `SessionKey` names another Session is, to the worker, a row OLIS no longer lists for this one: the pull's
// count and its pages both leave it out, as live OLIS would after it deleted the row. `amendRows` is the
// fake's way of changing a row after the pull, so no method of the fake is added for it.
import type { FakeOlis } from "./fake-olis.ts";

type Row = Record<string, unknown>;

/** The Session the row is moved to. No pull of 2025R1 reads it. */
const ELSEWHERE = "2025R1-not-listed";

/**
 * From now on OLIS does not list the rows of `entitySet` that `matches` for the Session. `matches` must not
 * look at `SessionKey`, so that `listAgain` can find the row once it has moved.
 */
export function stopListing(olis: FakeOlis, entitySet: string, matches: (row: Row) => boolean): void {
  olis.amendRows(entitySet, matches, { SessionKey: ELSEWHERE });
}

/** From now on OLIS lists the rows of `entitySet` that `matches` for the Session again. */
export function listAgain(olis: FakeOlis, entitySet: string, matches: (row: Row) => boolean): void {
  olis.amendRows(entitySet, matches, { SessionKey: "2025R1" });
}
