// How the tools show a Floor Letter (ticket #64, ADR-0045): a document that carries its row. `get_document` shows the
// row beside the letter's text, and `get_measure` lists the letters whose row names the Measure. The schemas and the
// shaping are here, so the two tools say the same fields the same way.
import { z } from "zod";
import type { FloorLetterDetails, FloorLetterEntry } from "#/packages/domain/documents.ts";
import { noLongerListedFlag, noLongerListedOutput } from "./listing.ts";

const rowFields = {
  chamber: z.enum(["house", "senate"]).describe("The chamber the letter was sent to."),
  letter_date: z
    .string()
    .describe(
      "The letter's date as the Legislature gives it (LetterDate), in Pacific time with its UTC offset: the only date a floor letter has.",
    ),
  title: z
    .string()
    .nullable()
    .describe("The letter's title as the Legislature publishes it, or null when it gives none."),
  description: z
    .string()
    .nullable()
    .describe("The Legislature's description of the letter, or null when it gives none."),
};

/** The `floor_letter` field of `get_document`: present only on a Floor Letter. */
export const floorLetterDocumentOutput = z
  .object({
    floor_letter_id: z.number().describe("The Legislature's own number for the letter (FloorLetterId)."),
    ...rowFields,
  })
  .optional()
  .describe(
    "Present only when the document is a floor letter: what the Legislature's row for it says. The Measure it names, if any, is in related.",
  );

export function floorLetterDocumentShown(details: FloorLetterDetails): z.infer<typeof floorLetterDocumentOutput> {
  return {
    floor_letter_id: details.floorLetterId,
    chamber: details.chamber,
    letter_date: details.letterDate,
    title: details.title,
    description: details.description,
  };
}

/** The `floor_letters` field of `get_measure`. */
export const floorLettersOutput = z
  .array(
    z.object({
      id: z.string().describe("The letter's document id, for get_document."),
      source_url: z.string().describe("Where the Legislature publishes the letter."),
      ...rowFields,
      fetched: z
        .boolean()
        .describe("Whether this index holds the letter's file. The Legislature lists the letter either way."),
      has_text_layer: z
        .boolean()
        .nullable()
        .describe(
          "False when the file has no text to read, as with a scan: get_document then serves no text. Null while this index does not hold the file.",
        ),
      no_longer_listed: noLongerListedOutput,
    }),
  )
  .describe(
    "The floor letters whose row names the Measure, oldest letter_date first. A letter that names no Measure is under no Measure: search finds it with kind floor_letter.",
  );

export function floorLettersShown(entries: readonly FloorLetterEntry[]): z.infer<typeof floorLettersOutput> {
  return entries.map((entry) => ({
    id: entry.id,
    source_url: entry.sourceUrl,
    chamber: entry.chamber,
    letter_date: entry.letterDate,
    title: entry.title,
    description: entry.description,
    fetched: entry.fetched,
    has_text_layer: entry.hasTextLayer,
    ...noLongerListedFlag(entry.listed),
  }));
}
