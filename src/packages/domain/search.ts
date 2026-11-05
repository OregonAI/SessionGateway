// The words of search as types: what the index keeps of a document so that it can be found, and the
// passages it is cut into (GLOSSARY.md, "Search"). The functions that make them are in the `search`
// package; the database stores them.
import type { Timestamp } from "#/packages/time/pacific.ts";
import type { AmendmentId, CommitteeId, DocumentId, DocumentKind } from "./documents.ts";
import type { MeasureId } from "./index.ts";

/** What search files a document under. */
export type SearchEntry = {
  /** The id a hit carries: the document's, or for a posting the Proposed Amendment's. */
  nodeId: DocumentId | AmendmentId;
  kind: DocumentKind;
  /** What a hit calls the document: "SB 64 Introduced", "SB 69-2", the Exhibit's title as published. */
  title: string;
  /** The Measure the document belongs to, when it belongs to one. */
  measureId: MeasureId | null;
  /** The committee it was posted to or is of, when it has one. */
  committeeId: CommitteeId | null;
  /** The date a date range selects it by (`DocumentLink.date`). */
  date: Timestamp | null;
  /** True for the lists that are found by their words alone and never embedded. */
  keywordOnly: boolean;
};

/** One slice of a document's text: where it is in the text, and its text. */
export type Passage = {
  /** Where the passage starts in the document's text, in UTF-16 code units. */
  start: number;
  /** Where it ends: the passage is `text.slice(start, end)`. */
  end: number;
  text: string;
  /** The sha256 of the passage's text as UTF-8, in lower-case hex: what its vector is kept under. */
  hash: string;
  /**
   * For a Recording Log's speaker turn (ticket #127): the turn's position in the log's speaker-turn index, which the passage is
   * the lines of. Absent for any other passage.
   */
  turn?: number;
};
