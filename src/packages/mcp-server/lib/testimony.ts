import { z } from "zod";
import type { IndexReader } from "#/packages/database/reader.ts";
import { measureIdOf, parseMeasureReference, type SessionKey } from "#/packages/domain/index.ts";
import { NON_OFFICIAL_NOTICE } from "./get-measure.ts";

export const testimonyInput = z.object({
  measure: z.string().describe('A Measure\'s id, such as "measure-2025r1-hb3131", or its citation, such as "HB 3131".'),
});

/**
 * The positions a Testimony row can take, by the feed's `PositionOnMeasureId` (docs/research/olis-odata.md
 * gotcha 3), in the order the tool lists them. An id not listed here is shown under its number.
 */
const listedPositions = [
  { id: 3983, label: "support" },
  { id: 3982, label: "oppose" },
  { id: 3981, label: "neutral" },
  { id: 4022, label: "unknown" },
] as const;

const UNLISTED_POSITION_LABEL = "unlisted position";

const positionCountOutput = z.object({
  position_id: z.number().describe("The feed's PositionOnMeasureId: 3983, 3982, 3981, 4022, or another number."),
  position: z
    .string()
    .describe(
      'What the id means: "support" (3983), "oppose" (3982), "neutral" (3981), "unknown" (4022). Any other id is labelled "unlisted position" and shown under its number.',
    ),
  count: z.number().describe("How many of the Measure's Testimony rows take this position."),
});

export const testimonyOutput = z.object({
  measure_id: z.string().describe("The Measure's id in OregonAI's form."),
  total: z.number().describe("How many Testimony rows OLIS lists for the Measure, on every page."),
  position_counts: z
    .array(positionCountOutput)
    .describe(
      "The Measure's rows by position: the four listed positions in the order support, oppose, neutral, unknown, each with its count (0 when none), then any other position id found, in numeric order.",
    ),
  as_of: z.string().describe("When the index was last refreshed, in Pacific time with its UTC offset."),
  notice: z.string().describe("A reminder that this is not the official record."),
});

export type TestimonyOutput = z.infer<typeof testimonyOutput>;

/** An unknown Measure is an expected outcome, so it is a value; the MCP edge decides it is a tool error. */
export type TestimonyResult =
  { kind: "found"; testimony: TestimonyOutput } | { kind: "unknown_measure"; reference: string; session: SessionKey };

export function testimony(
  reader: IndexReader,
  session: SessionKey,
  input: z.infer<typeof testimonyInput>,
): TestimonyResult {
  const key = parseMeasureReference(input.measure, session);
  if (key === undefined || reader.findMeasure(key) === undefined) {
    return { kind: "unknown_measure", reference: input.measure, session };
  }
  const asOf = reader.asOf(session);
  if (asOf === undefined) {
    throw new Error(`The index holds Testimony of ${session} but no completed full pull to date it by`);
  }
  const entries = reader.findTestimony(key);
  const countByPosition = new Map<number, number>();
  for (const entry of entries) countByPosition.set(entry.positionId, (countByPosition.get(entry.positionId) ?? 0) + 1);
  const unlisted = [...countByPosition.keys()]
    .filter((id) => !listedPositions.some((position) => position.id === id))
    .sort((a, b) => a - b);
  return {
    kind: "found",
    testimony: {
      measure_id: measureIdOf(key),
      total: entries.length,
      position_counts: [
        ...listedPositions.map((position) => ({
          position_id: position.id,
          position: position.label,
          count: countByPosition.get(position.id) ?? 0,
        })),
        ...unlisted.map((id) => ({
          position_id: id,
          position: UNLISTED_POSITION_LABEL,
          count: countByPosition.get(id) ?? 0,
        })),
      ],
      as_of: asOf,
      notice: NON_OFFICIAL_NOTICE,
    },
  };
}
