// Reading a stored document for Agency Links (spec #1, module 5; ADR-0027). The extractor is `agency-links`; this
// is only what the worker does with it: which function reads which kind of document, with the snapshot's registry.
import { derivedAgencyLinks, fiscalImpactAgencyLinks, textAgencyLinks } from "#/packages/agency-links/index.ts";
import type { AgencyReadRecord, UnreadAgencyDocument } from "#/packages/database/writer.ts";
import type { StatuteLink } from "#/packages/domain/statute-links.ts";
import type { Snapshot } from "#/packages/oregonai-snapshot/index.ts";

/**
 * What reading one stored document for Agency Links comes to. A file with no text layer gives nothing and is
 * still recorded as read: its text is empty and will not change (ADR-0005).
 */
export function agencyReadOf(
  document: UnreadAgencyDocument,
  stored: { text: string; hasTextLayer: boolean },
  statuteLinks: readonly StatuteLink[],
  snapshot: Snapshot,
): AgencyReadRecord {
  const none: AgencyReadRecord = { documentId: document.documentId, links: [], unresolvedUnits: [] };
  if (!stored.hasTextLayer) return none;
  switch (document.readAs) {
    case "fiscal_impact_statement": {
      const read = fiscalImpactAgencyLinks(stored.text, snapshot.agencies);
      switch (read.kind) {
        case "units":
          return { documentId: document.documentId, links: read.links, unresolvedUnits: read.unresolvedUnits };
        case "no-unit-line":
        case "unbounded-unit-line":
          return none;
        default:
          return read satisfies never;
      }
    }
    case "version":
    case "proposed_amendment":
      return {
        documentId: document.documentId,
        links: [
          ...textAgencyLinks(stored.text, snapshot.agencies),
          ...derivedAgencyLinks(statuteLinks, snapshot.chapterAgencies),
        ],
        unresolvedUnits: [],
      };
    default:
      return document.readAs satisfies never;
  }
}
