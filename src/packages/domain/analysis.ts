// Analysis documents (Fiscal Impact Statements, revenue impact statements, staff measure summaries,
// budget reports) and the one reading of the feed's `Version` label that says which Version of its
// Measure each is of. The ingest worker reads the label through `placeAnalysis` to write the Version
// a document points at (what `get_document` lists), and `get_measure` reads it through the same
// function to group the documents, so the two tools can never disagree. docs/adr/0012 has the labels
// of the 2025R1 feed and what each one is read as.

import type { MeasureKey } from "./index.ts";
import { versionIdOf, type CommitteeId, type DocumentId } from "./documents.ts";

/** Where an analysis document belongs among its Measure's Versions, or why it belongs on none. */
export type AnalysisPlacement =
  | {
      kind: "version";
      versionId: DocumentId;
      /** The Version as the feed describes Versions: "Introduced", "A-Engrossed". */
      description: string;
      /** Introduced is 0, A-Engrossed 1, B-Engrossed 2...: the order the Versions were printed in. */
      order: number;
    }
  | { kind: "unmapped"; reason: string };

/** The Version a label names, whether or not the Measure has it. Undefined for a label that names none. */
function versionNamedBy(label: string): { description: string; order: number } | undefined {
  if (label === "INTRO") return { description: "Introduced", order: 0 };
  if (/^[A-Z]$/.test(label)) return { description: `${label}-Engrossed`, order: label.charCodeAt(0) - 64 };
  return undefined;
}

/** Why a label that names no Version is placed on none. Agents read it, so it says what the feed does not. */
function reasonForUnreadLabel(label: string): string {
  if (label === "") return "The feed gives this document no Version label.";
  if (/^MR[A-Z]$/.test(label)) {
    return `The feed's label "${label}" reads as a minority report. The feed lists a minority report as a Version of some Measures and not of others, and does not say which text this document is of.`;
  }
  if (/^[A-Z]\*$/.test(label)) {
    return `The feed's label "${label}" is a Version letter followed by an asterisk, and the feed does not say what the asterisk means.`;
  }
  return `The feed's label "${label}" is not one this service reads as a Version.`;
}

/**
 * Places an analysis document on a Version from the feed's label for it ("" when the feed gives none).
 * Only the unambiguous labels name a Version: "INTRO" is Introduced and a single letter is that
 * letter's Engrossed Version ("A" is A-Engrossed). A blank label, and the ones more than one Version
 * could answer ("B*", "MRA"; docs/research/olis-odata.md gotcha 9), name none, and neither does a label
 * for a Version the feed does not list for the Measure: an edge to a document that is not there is
 * worse than none. Nothing is guessed. `isListed` says whether the Measure has a Version.
 */
export function placeAnalysis(
  key: MeasureKey,
  label: string,
  isListed: (versionId: DocumentId) => boolean,
): AnalysisPlacement {
  const named = versionNamedBy(label);
  if (named === undefined) return { kind: "unmapped", reason: reasonForUnreadLabel(label) };
  const versionId = versionIdOf(key, named.description);
  if (!isListed(versionId)) {
    return {
      kind: "unmapped",
      reason: `The feed's label "${label}" names the ${named.description} Version, but the feed lists no ${named.description} Version of ${key.prefix} ${key.number}.`,
    };
  }
  return { kind: "version", versionId, description: named.description, order: named.order };
}

/** One analysis document the store holds, with what `get_measure` needs to place and show it. */
export type StoredAnalysis = {
  id: DocumentId;
  /** The feed's `DocumentType`: "Fiscal Impact Statement", "Revenue Impact Statement"... */
  type: string;
  /** The feed's own `Version` label, "" when it gives none. */
  versionLabel: string;
  sourceUrl: string;
  /** The committee that issued it, when the feed names one. */
  committeeId: CommitteeId | null;
  /** The Versions the document points at, which are the Versions the feed listed for its Measure. */
  versionIds: DocumentId[];
};
