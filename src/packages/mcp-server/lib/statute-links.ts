// How Statute Links are shown to an agent, by compare_amendment and by get_measure (ticket #13): one shape
// for a link, one order, and one way to say that a file's links were not read.
import { z } from "zod";
import type {
  RelatingClauseEdit,
  StatuteLink,
  StatuteLinkKind,
  StatuteParse,
} from "#/packages/domain/statute-links.ts";

export const statuteLinkOutput = z.object({
  kind: z
    .enum(["amends", "repeals", "adds-to", "cites"])
    .describe(
      "What the text does to the target: amends it, repeals it, adds a section to it (a chapter), or only cites it. A citation is not a change.",
    ),
  target_id: z
    .string()
    .describe(
      "The ORS section or chapter, in OregonAI's id form: ors-468.130 for a section, ors-chapter-657b for a chapter.",
    ),
  target_type: z.enum(["section", "chapter"]).describe("Whether the target is an ORS section or a whole chapter."),
  resolvable_on_oregonai: z
    .boolean()
    .describe(
      "True for a section, which OregonAI has a page for. False for a chapter, which OregonAI has no id for, so looking it up there fails.",
    ),
  measure_section: z
    .string()
    .nullable()
    .describe(
      'The numbered section of the text the link is read in, as the text prints it: "8" for SECTION 8, "21a" for a section inserted later. Null when the text has no numbered sections.',
    ),
});

export const relatingClauseEditOutput = z.object({
  deleted: z.string().nullable().describe("The words the amendment quotes as deleted, or null when it quotes none."),
  deleted_lines: z
    .array(z.string())
    .describe('The lines it deletes without quoting their words, as it names them: "line 3", "the rest of the line".'),
  inserted: z.string().nullable().describe("The words it inserts, or null when it only deletes."),
  inserted_sections: z
    .array(z.string())
    .describe("The ORS sections the inserted words name, with ranges expanded, each once, in order."),
});

export type StatuteLinkOutput = z.infer<typeof statuteLinkOutput>;
export type RelatingClauseEditOutput = z.infer<typeof relatingClauseEditOutput>;

/** The order links are listed in, from spec #1 (story 24): the changes first, then the mentions. */
const kindOrder: Record<StatuteLinkKind, number> = { amends: 0, repeals: 1, "adds-to": 2, cites: 3 };

/** "8" before "10" before "21a"; a link with no measure section last. */
function compareMeasureSections(a: string | null, b: string | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return a.localeCompare(b, "en", { numeric: true });
}

/**
 * The links in the order they are shown: by kind (amends, repeals, adds-to, cites), then by measure section,
 * and within those in the order the text names them.
 */
export function statuteLinksShown(links: readonly StatuteLink[]): StatuteLinkOutput[] {
  return links
    .toSorted(
      (a, b) => kindOrder[a.kind] - kindOrder[b.kind] || compareMeasureSections(a.measureSection, b.measureSection),
    )
    .map((link) => ({
      kind: link.kind,
      target_id: link.target.id,
      target_type: link.target.type,
      resolvable_on_oregonai: link.target.resolvableOnOregonAi,
      measure_section: link.measureSection,
    }));
}

export function relatingClauseEditShown(edit: RelatingClauseEdit): RelatingClauseEditOutput {
  return {
    deleted: edit.deleted,
    deleted_lines: edit.deletedLines,
    inserted: edit.inserted,
    inserted_sections: edit.insertedSections,
  };
}

/** Why a file's Statute Links are an empty list, when they are empty because the file was not read. */
export function notReadReasonOf(parse: StatuteParse): string | null {
  return parse.textRead
    ? null
    : "This index did not read the file for Statute Links: it has no text layer (a scan or a photograph), or the index has not read it yet. The empty list does not mean the document has none.";
}
