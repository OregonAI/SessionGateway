// The analysis documents of a Measure as get_measure shows them: grouped by the Version each is of,
// with the ones the feed's label cannot place on a Version listed apart, and saying why.
import { z } from "zod";
import { placeAnalysis, type StoredAnalysis } from "#/packages/domain/analysis.ts";
import type { MeasureKey } from "#/packages/domain/index.ts";

const analysisEntry = z.object({
  id: z.string().describe("The document's id, which get_document resolves."),
  type: z
    .string()
    .describe("What it is, as the Legislature names it: Fiscal Impact Statement, Revenue Impact Statement..."),
  version_label: z
    .string()
    .describe(
      'The Legislature\'s own label for the Version it is of, as the feed writes it: "INTRO", "A", "B*"... Blank when the feed gives none.',
    ),
  committee_id: z.string().nullable().describe("The committee that issued it, when the feed names one."),
  source_url: z.string().describe("Where the Legislature publishes the document."),
});

export const analysisDocumentsOutput = z
  .object({
    by_version: z
      .array(
        z.object({
          version_id: z
            .string()
            .describe(
              "The Version's id. get_document resolves it when this index holds the Version's file, and has no document for it when the Legislature's file could not be fetched.",
            ),
          version: z.string().describe("The Version: Introduced, A-Engrossed, B-Engrossed..."),
          documents: z
            .array(analysisEntry)
            .describe(
              "The Version's Fiscal Impact Statements, then revenue impact statements, staff measure summaries and budget reports.",
            ),
        }),
      )
      .describe(
        "The analysis documents the feed places on a Version of the Measure, in the order the Versions were printed.",
      ),
    unmapped: z
      .array(analysisEntry.extend({ unmapped_reason: z.string().describe("Why the document is on no Version.") }))
      .describe(
        "The analysis documents the feed's label does not place on a Version of the Measure, and the ones the feed flags as a minority report's. They are listed, never dropped; the reason says what the feed leaves unsaid.",
      ),
    not_held: z
      .number()
      .int()
      .describe(
        "How many analysis documents the Legislature lists for the Measure that this index has not fetched, so that they are in neither list above and have no id here. The next refresh tries them again. 0 when the index holds every one.",
      ),
  })
  .describe(
    "The Measure's analysis documents held by this index, so that every id listed resolves in get_document, with a count of the ones the Legislature lists and the index does not hold.",
  );

export type AnalysisDocumentsOutput = z.infer<typeof analysisDocumentsOutput>;
type Entry = z.infer<typeof analysisEntry>;

/** The order the ticket and spec #1 name them in; a type the feed adds later follows, by name. */
const typeOrder = ["Fiscal Impact Statement", "Revenue Impact Statement", "Staff Measure Summary", "Budget Report"];

function typeRank(type: string): number {
  const rank = typeOrder.indexOf(type);
  return rank === -1 ? typeOrder.length : rank;
}

function compareEntries(a: StoredAnalysis, b: StoredAnalysis): number {
  return (
    typeRank(a.type) - typeRank(b.type) ||
    a.type.localeCompare(b.type) ||
    // The ids differ only in the feed's number, which is compared as a number.
    a.id.localeCompare(b.id, "en", { numeric: true })
  );
}

function entryOf(analysis: StoredAnalysis): Entry {
  return {
    id: analysis.id,
    type: analysis.type,
    version_label: analysis.versionLabel,
    committee_id: analysis.committeeId,
    source_url: analysis.sourceUrl,
  };
}

export function analysisDocumentsOf(
  key: MeasureKey,
  stored: readonly StoredAnalysis[],
  notHeld: number,
): AnalysisDocumentsOutput {
  const groups = new Map<string, { order: number; version: string; documents: StoredAnalysis[] }>();
  const unmapped: AnalysisDocumentsOutput["unmapped"] = [];
  for (const analysis of stored.toSorted(compareEntries)) {
    // The worker pointed the document at a Version only when its label named one the feed lists for the
    // Measure. So the Version it is pointed at is the one "listed" Version here, and the others are not:
    // this replays the worker's placement from what it stored, and cannot disagree with it.
    const placement = placeAnalysis(key, analysis, (version) => version === analysis.placedVersionId);
    switch (placement.kind) {
      case "version": {
        const group = groups.get(placement.versionId) ?? {
          order: placement.order,
          version: placement.description,
          documents: [],
        };
        group.documents.push(analysis);
        groups.set(placement.versionId, group);
        break;
      }
      case "unmapped":
        unmapped.push({ ...entryOf(analysis), unmapped_reason: placement.reason });
        break;
      default:
        placement satisfies never;
    }
  }
  return {
    by_version: [...groups.entries()]
      .toSorted(([, a], [, b]) => a.order - b.order)
      .map(([versionId, group]) => ({
        version_id: versionId,
        version: group.version,
        documents: group.documents.map(entryOf),
      })),
    unmapped,
    not_held: notHeld,
  };
}
