// What the seam-4 tests of the database's schema store to have a row to find again: a full pull of 2025R1 that read
// nothing, at a Pacific time. It leaves the Session's `index_state` row and the listing's first pull, and a reader
// answers `lastFullPull` with the time.
import { parseSessionKey } from "#/packages/domain/index.ts";
import { readTimestamp } from "#/packages/time/pacific.ts";
import type { FullPullRecord } from "../writer.ts";
import { pullOf } from "./made-up-index.ts";

export const session = parseSessionKey("2025R1") ?? failed("2025R1 is a Session key");

export const pulledAt =
  readTimestamp("2025-03-01T10:00:00-08:00") ?? failed("a Pacific time with an offset is a Timestamp");

/** What a reader answers for `lastFullPull(session)` after the pull, written out and not computed from `pulledAt`. */
export const pulledAtText = "2025-03-01T10:00:00-08:00";

export const nothingPulled: FullPullRecord = pullOf();

function failed(message: string): never {
  throw new Error(message);
}
