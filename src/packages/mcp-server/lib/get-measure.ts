import { z } from "zod";
import type { IndexReader } from "#/packages/database/reader.ts";
import { measureIdOf, olisPageUrlOf, parseMeasureReference, type SessionKey } from "#/packages/domain/index.ts";

/** The notice every result carries (ADR-0002, spec #1 "What every result must carry"). */
export const NON_OFFICIAL_NOTICE =
  "Not the official record of the Oregon Legislature. This is an unofficial copy of public information from the Legislature's Open Data Service; use source_url for the Legislature's own page.";

export const getMeasureInput = z.object({
  measure: z.string().describe('A Measure\'s id, such as "measure-2025r1-sb69", or its citation, such as "SB 69".'),
});

export const getMeasureOutput = z.object({
  id: z.string().describe("The Measure's id in OregonAI's form."),
  catchline: z.string().nullable().describe("The Measure's catchline, as OLIS publishes it."),
  source_url: z.string().describe("The Measure's page on OLIS."),
  as_of: z.string().describe("When the index was last refreshed, in Pacific time with its UTC offset."),
  notice: z.string().describe("A reminder that this is not the official record."),
});

export type GetMeasureOutput = z.infer<typeof getMeasureOutput>;

export function getMeasure(
  reader: IndexReader,
  session: SessionKey,
  input: z.infer<typeof getMeasureInput>,
): GetMeasureOutput {
  const reference = parseMeasureReference(input.measure, session);
  const measure = reference === undefined ? undefined : reader.findMeasure(reference);
  const asOf = reader.asOf(session);
  if (measure === undefined || asOf === undefined) throw new Error("not found");
  return {
    id: measureIdOf(measure),
    catchline: measure.catchline,
    source_url: olisPageUrlOf(measure),
    as_of: asOf,
    notice: NON_OFFICIAL_NOTICE,
  };
}
