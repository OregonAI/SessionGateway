// Agency Links (GLOSSARY.md, "Agency Link"; ADR-0004, ADR-0027) as the extractor makes them and as the
// store gives them back. The extractor (`agency-links`) and the database both name these types, so they are
// here and the extractor re-exports them, as the Statute Link types are (statute-links.ts).
import type { AmendmentId, DocumentId } from "./documents.ts";
import type { MeasureId, MeasureKey } from "./index.ts";
import type { AgencyId, OrsChapterId } from "./oregonai.ts";
import type { StatuteLink } from "./statute-links.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

/**
 * The four kinds of evidence an Agency Link has, in the order the tools list them: the Statute Links that
 * reach the Agency's statutes first, because they are the answer to spec #1's first acceptance question, then the
 * Fiscal Impact Statement, the text, and Testimony.
 */
export const agencyEvidenceKinds = ["derived", "fiscal-impact-statement", "named-in-text", "testimony"] as const;
export type AgencyEvidenceKind = (typeof agencyEvidenceKinds)[number];

/** Why an Agency Link exists (GLOSSARY.md, "Agency Link"). */
export type AgencyEvidence =
  | {
      kind: "fiscal-impact-statement";
      /** The unit as the statement lists it. */
      unit: string;
    }
  | {
      kind: "named-in-text";
      /** The registry names and aliases found in the text, each once, in the order they first appear. */
      terms: string[];
    }
  | {
      kind: "testimony";
      /** The Testimony row's `Organization`, as it is written there but for stray spaces at either end. */
      organization: string;
    }
  | {
      kind: "derived";
      /** The ORS chapter the Statute Link reaches, whose rules the Agency implements (the Chapter table). */
      chapter: OrsChapterId;
      /** The Statute Link that derived the Agency Link: the one in the lowest measure section among those that reach the chapter. */
      link: StatuteLink;
      /** How many of the document's Statute Links that change the law reach the chapter, the one above included. */
      linksInChapter: number;
      /**
       * Present when the Agency is the parent of the sub-units whose rules implement the chapter and the table does not
       * list it for the chapter itself: the link came through these sub-units (ADR-0029). Absent for an Agency the table
       * lists for the chapter, a sub-unit among them.
       */
      through?: AgencyId[];
    };

/** A connection to one Agency, with the evidence that makes it. */
export type AgencyLink = {
  /** The Agency's registry slug. */
  agency: AgencyId;
  evidence: AgencyEvidence;
};

/** What an Agency Link sits on (GLOSSARY.md: a Measure, a Version or a Proposed Amendment). */
export type LinkedNodeType = "measure" | "version" | "proposed_amendment";

/** A node an Agency Link, or a Statute Link, sits on, with what an agent needs to name it and to read it. */
export type LinkedNode = {
  type: LinkedNodeType;
  /** The Measure's id, the Version's document id, or the amendment's id. */
  id: MeasureId | DocumentId | AmendmentId;
  measure: MeasureKey;
  /** The Version as the feed describes it ("A-Engrossed"), or the amendment's number ("-2"); null for a Measure. */
  label: string | null;
  /** The Measure's page on OLIS, the Version's file, or the file `get_document` serves for the amendment (its latest posting). */
  sourceUrl: string;
};

/** An Agency Link as the store holds it: the link, the document its evidence was read from, and the node it sits on. */
export type StoredAgencyLink = {
  agency: AgencyId;
  evidence: AgencyEvidence;
  /**
   * The document the evidence was read from: the Fiscal Impact Statement, the Version, the posting of the amendment,
   * or the Testimony. `createdAt` is when OLIS created its row (null when the feed gave none).
   */
  document: { id: DocumentId; sourceUrl: string; createdAt: Timestamp | null };
  /**
   * Where the link sits: the Version a Fiscal Impact Statement is placed on (ADR-0013) or the Measure when it is on none;
   * the Version or Proposed Amendment whose text it was read from; the Measure for Testimony.
   */
  node: LinkedNode;
};

/** A unit a Fiscal Impact Statement lists that is not an Agency (GLOSSARY.md, "Unresolved unit"), with the statement. */
export type StoredUnresolvedUnit = {
  unit: string;
  statement: { id: DocumentId; sourceUrl: string };
  /** Where the statement sits, as for an Agency Link. */
  node: LinkedNode;
};

/** A Version or Proposed Amendment with a Statute Link to a section or chapter, and the link. */
export type StoredStatuteLinked = {
  /**
   * The Version's or posting's document the link was read from, with when OLIS created its row (null when the feed gave
   * none). A Proposed Amendment's other postings are other documents: they are here only if their own file holds the link.
   */
  document: { id: DocumentId; sourceUrl: string; createdAt: Timestamp | null };
  node: LinkedNode;
  link: StatuteLink;
};
