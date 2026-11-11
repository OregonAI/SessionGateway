import type { PulledEntitySet } from "#/packages/domain/documents.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

/**
 * How many rows the feed counted for one whole entity set of a Session, and how many came. A set is complete when
 * they are the same; the pull is complete when every set it reads is (ADR-0005).
 */
export type SetCount = {
  /** The feed's own name for the set, such as "Measures". */
  entitySet: PulledEntitySet;
  /** The feed's count: `/$count`, or `$inlinecount` when that is the one the rows miss. */
  counted: number;
  /** The rows the pages held. */
  read: number;
};

/**
 * How much of an entity set one read of the Session asks for. The caller decides, and for a Pull that is the ingest
 * worker's register: the client carries the decision out for the set it reads and has no rule of its own about which set
 * is read how.
 */
export type PullRead =
  /** Every row of the Session. */
  | { kind: "whole" }
  /**
   * Only the rows OLIS created or modified after `since` (an Increment's, ADR-0005, ADR-0039): `CreatedDate gt X or
   * ModifiedDate gt X`. A set whose rows carry no such dates cannot be read this way.
   */
  | { kind: "changed_since"; since: Timestamp }
  /**
   * Only the rows whose id is greater than `id` (an Increment's read of a set that has no dates: FloorLetters, ADR-0045).
   * A set without such an id cannot be read this way.
   */
  | { kind: "above_id"; id: number };

export type OlisClientOptions = {
  /** The service root, ending in a slash: https://api.oregonlegislature.gov/odata/odataservice.svc/ */
  baseUrl: string;
  fetch: typeof fetch;
  /**
   * Told, for every entity set that is read (the pull's reads, not the live lookup's), how many rows the feed
   * counted and how many came. When it is given, a set that is short of its count is not an error: it is handed on
   * like any other, so that a pull can read every set and report each short one before it stops. When it is absent,
   * as in the server's client, a short read throws.
   */
  onSetRead?: (count: SetCount) => void;
  /** How documents are fetched. Only the worker's client has them: the server's reads the feed alone. */
  documents?: {
    /** The origin the documents are fetched from: OLIS's own, https://olis.oregonlegislature.gov, except in a test. */
    origin: string;
    /**
     * How long one attempt to fetch a document may go without an answer or without a byte of its body, in milliseconds: the
     * attempt ends on this stall, not on a total time (ticket #167).
     */
    stallMs: number;
    /** Waits between attempts. Passed in, so a test does not wait. */
    pause: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  };
};
