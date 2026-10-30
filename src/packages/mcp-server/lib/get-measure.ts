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
  created_at: z.string().describe("When OLIS created the Measure, in Pacific time with its UTC offset."),
  modified_at: z
    .string()
    .nullable()
    .describe("When OLIS last changed the Measure, in Pacific time with its UTC offset."),
  sponsors: z
    .array(
      z.object({
        level: z.enum(["chief", "regular"]).describe("Whether the Legislator is a chief sponsor or a regular one."),
        legislator_code: z.string().describe("The Legislator Code the feed gives this sponsor, as the feed writes it."),
        legislator: z
          .object({
            id: z.string().describe("The Legislator's id, the same for every Legislator Code that names them."),
            name: z.string().describe("The Legislator's first and last name."),
          })
          .nullable()
          .describe("The Legislator the code names, or null when the code could not be resolved."),
      }),
    )
    .describe("The Measure's sponsors who are Legislators, in print order."),
  as_of: z.string().describe("When the index was last refreshed, in Pacific time with its UTC offset."),
  notice: z.string().describe("A reminder that this is not the official record."),
});

export type GetMeasureOutput = z.infer<typeof getMeasureOutput>;

/** An unknown Measure is an expected outcome, so it is a value; the MCP edge decides it is a tool error. */
export type GetMeasureResult =
  { kind: "found"; measure: GetMeasureOutput } | { kind: "unknown"; reference: string; session: SessionKey };

export function getMeasure(
  reader: IndexReader,
  session: SessionKey,
  input: z.infer<typeof getMeasureInput>,
): GetMeasureResult {
  const key = parseMeasureReference(input.measure, session);
  const measure = key === undefined ? undefined : reader.findMeasure(key);
  if (measure === undefined) return { kind: "unknown", reference: input.measure, session };
  const asOf = reader.asOf(session);
  if (asOf === undefined) {
    throw new Error(`The index holds Measures of ${session} but no completed full pull to date them by`);
  }
  return {
    kind: "found",
    measure: {
      id: measureIdOf(measure),
      catchline: measure.catchline,
      source_url: olisPageUrlOf(measure),
      created_at: measure.createdAt,
      modified_at: measure.modifiedAt,
      sponsors: reader.findSponsors(measure).map((sponsor) => ({
        level: sponsor.level,
        legislator_code: sponsor.legislatorCode,
        legislator: sponsor.legislator,
      })),
      as_of: asOf,
      notice: NON_OFFICIAL_NOTICE,
    },
  };
}

/** What an agent is told when no Measure matches, so it can correct the call. */
export function unknownMeasureMessage(reference: string, session: SessionKey): string {
  const example = measureIdOf({ session, prefix: "SB", number: 69 });
  return `No Measure "${reference}" in the ${session} Session. Give a Measure id such as ${example} or a citation such as SB 69.`;
}
