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
          version_id: z.string().describe("The Version's id, which get_document resolves."),
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
        "The analysis documents the feed's label does not place on a Version of the Measure. They are listed, never dropped; the reason says what the feed leaves unsaid.",
      ),
  })
  .describe(
    "The Measure's analysis documents held by this index (a document the worker could not fetch is reported in the build report and not listed here, so that every id resolves).",
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

export function analysisDocumentsOf(key: MeasureKey, stored: readonly StoredAnalysis[]): AnalysisDocumentsOutput {
  const groups = new Map<string, { order: number; version: string; documents: StoredAnalysis[] }>();
  const unmapped: AnalysisDocumentsOutput["unmapped"] = [];
  for (const analysis of stored.toSorted(compareEntries)) {
    // The Versions a stored document points at are the Versions the feed listed for the Measure, so
    // they stand for "listed" here exactly as the feed's list did when the worker wrote them.
    const placement = placeAnalysis(key, analysis.versionLabel, (version) => analysis.versionIds.includes(version));
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
  };
}
