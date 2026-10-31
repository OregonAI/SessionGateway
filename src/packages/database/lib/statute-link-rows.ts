// A stored Statute Link row as a domain StatuteLink. The reader shows links by file and the writer reads a
// document's links to derive Agency Links from them, so the one reading of a row is here, and the one reading of a
// stored target, which the reader's Statutes Affected Table entries use too.
import { z } from "zod";
import {
  statuteLinkKinds,
  storedStatuteTarget,
  type StatuteLink,
  type StatuteTarget,
} from "#/packages/domain/statute-links.ts";

/** The columns of a `statute_link` row that make a StatuteLink. */
export const statuteLinkRow = z.object({
  kind: z.enum(statuteLinkKinds),
  target_type: z.enum(["section", "chapter"]),
  target_id: z.string(),
  measure_section: z.string().nullable(),
});

/** The target a stored row names. The store holds only ids that read, so one that does not is a bug in whatever wrote it. */
export function storedTargetOf(type: StatuteTarget["type"], id: string, what: string): StatuteTarget {
  const target = storedStatuteTarget(type, id);
  if (target === undefined) throw new Error(`The store holds ${what} ${id}, which is no ORS ${type} id`);
  return target;
}

/** The StatuteLink a stored row stands for. A target id that is not an ORS id is a corrupt store, so it throws. */
export function statuteLinkOfRow(stored: z.infer<typeof statuteLinkRow>): StatuteLink {
  return {
    kind: stored.kind,
    target: storedTargetOf(stored.target_type, stored.target_id, "a Statute Link to"),
    measureSection: stored.measure_section,
  };
}
