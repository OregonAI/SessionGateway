import { z } from "zod";

/**
 * One source document from a legislative session: a measure version, an
 * amendment, testimony, a committee meeting record, a vote, a journal entry.
 * This is the ingest contract — every data-source adapter emits these as JSONL.
 */
export const documentSchema = z.object({
  id: z.string().min(1),
  session: z.string().min(1),
  type: z.enum(["measure", "amendment", "testimony", "meeting", "vote", "journal", "other"]),
  measure: z.string().optional(),
  title: z.string().min(1),
  date: z.iso.date().optional(),
  sourceUrl: z.url(),
  text: z.string(),
});

export type SessionDocument = z.infer<typeof documentSchema>;
export type DocumentType = SessionDocument["type"];

/** "sb 5", "SB5", "S.B. 5" → "SB5", so measure filters match however they are typed. */
export function normalizeMeasure(measure: string): string {
  return measure.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
