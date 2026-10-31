// An Agency Link's evidence as the store keeps it: JSON in one column, beside the link's kind. The writer
// turns the evidence into JSON and the reader parses it back, so the two forms are written once, here.
import { z } from "zod";
import type { AgencyEvidence, AgencyEvidenceKind } from "#/packages/domain/agency-links.ts";
import { parseOrsChapterId } from "#/packages/domain/oregonai.ts";
import { statuteLinkOfRow, statuteLinkRow } from "./statute-link-rows.ts";

/** The kinds of evidence that are kept in `agency_link`. Testimony's is the `testimony` table's own `agency_id`. */
export const storedEvidenceKinds = [
  "derived",
  "fiscal-impact-statement",
  "named-in-text",
] as const satisfies readonly AgencyEvidenceKind[];

const derivedJson = z.object({
  chapter: z.string().transform((text, context) => {
    const id = parseOrsChapterId(text);
    if (id === undefined) context.addIssue({ code: "custom", message: `not an ORS chapter id: ${text}` });
    return id ?? z.NEVER;
  }),
  link: statuteLinkRow,
  links_in_chapter: z.number().int(),
});
const fiscalJson = z.object({ unit: z.string() });
const textJson = z.object({ terms: z.array(z.string()) });

/** The JSON the store keeps of evidence of a stored kind. Testimony's evidence is not kept here. */
export function evidenceToJson(evidence: AgencyEvidence): string {
  switch (evidence.kind) {
    case "fiscal-impact-statement":
      return JSON.stringify({ unit: evidence.unit } satisfies z.infer<typeof fiscalJson>);
    case "named-in-text":
      return JSON.stringify({ terms: evidence.terms } satisfies z.infer<typeof textJson>);
    case "derived":
      return JSON.stringify({
        chapter: evidence.chapter,
        link: {
          kind: evidence.link.kind,
          target_type: evidence.link.target.type,
          target_id: evidence.link.target.id,
          measure_section: evidence.link.measureSection,
        },
        links_in_chapter: evidence.linksInChapter,
      });
    case "testimony":
      throw new Error("Testimony evidence is kept in the testimony table, not in agency_link");
    default:
      return evidence satisfies never;
  }
}

/** The evidence a stored row stands for. */
export function evidenceFromJson(kind: (typeof storedEvidenceKinds)[number], json: string): AgencyEvidence {
  const raw: unknown = JSON.parse(json);
  switch (kind) {
    case "fiscal-impact-statement":
      return { kind, unit: fiscalJson.parse(raw).unit };
    case "named-in-text":
      return { kind, terms: textJson.parse(raw).terms };
    case "derived": {
      const stored = derivedJson.parse(raw);
      return {
        kind,
        chapter: stored.chapter,
        link: statuteLinkOfRow(stored.link),
        linksInChapter: stored.links_in_chapter,
      };
    }
    default:
      return kind satisfies never;
  }
}
