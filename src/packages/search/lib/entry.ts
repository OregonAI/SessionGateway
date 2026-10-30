import type { CommitteeId, DocumentLink } from "#/packages/domain/documents.ts";
import { citationOfMeasureId, type MeasureId } from "#/packages/domain/index.ts";
import type { SearchEntry } from "#/packages/domain/search.ts";

/**
 * Whether a document is found by its words alone and never by meaning (ADR-0006: they are lists, and
 * embedding a list adds noise): an agenda, a Recording Log, and a witness-registration list. The feed
 * labels a witness-registration list "Witness Registration" in the `DocumentType` of its
 * CommitteeMeetingDocuments row (2,368 of the 2025R1 cache's 16,115 rows), and 45 more rows that the
 * feed files under "Meeting Material" or "Presentation" are titled "witness registration" by the
 * committee's staff, so a title that says so counts too (measured 2026-10-30, ADR-0025).
 */
export function isKeywordOnly(link: Pick<DocumentLink, "kind" | "label" | "title">): boolean {
  switch (link.kind) {
    case "agenda":
    case "recording_log":
      return true;
    case "exhibit":
      return link.label === "Witness Registration" || /witness\s+registration/i.test(link.title ?? "");
    case "version":
    case "printed_amendment":
    case "proposed_amendment":
    case "analysis":
    case "testimony":
      return false;
    default:
      return link.kind satisfies never;
  }
}

/** What a hit calls a document that has no title of its own: the Measure's citation and the feed's label. */
function titleOf(link: DocumentLink, measure: MeasureId | null, committeeName: string | undefined): string {
  const citation = measure === null ? "" : citationOfMeasureId(measure);
  const joined = (...parts: (string | undefined)[]): string =>
    parts
      .filter((part) => part !== undefined && part !== "")
      .join(" ")
      .trim();
  switch (link.kind) {
    case "version":
    case "printed_amendment":
    case "testimony":
      return joined(citation, link.label);
    case "analysis": {
      const version =
        link.versionLabel === undefined || link.versionLabel === "" ? undefined : `(${link.versionLabel})`;
      return joined(citation, link.label, version);
    }
    case "proposed_amendment":
      // The label is the amendment's number, "-2" or "-A3", so the title is the citation the committee uses.
      return `${citation}${link.label}`;
    case "exhibit":
    case "recording_log":
      return link.title ?? joined(committeeName, link.label);
    case "agenda":
      return joined(committeeName, link.label);
    default:
      return link.kind satisfies never;
  }
}

/**
 * What search keeps of a document, from the feed's own listing of it: the id a hit carries, what it is
 * called, which Measure and committee it belongs to, its date, and whether it is keyword-only.
 * `committeeNames` is the Session's committees' names by id.
 */
export function searchEntryOf(link: DocumentLink, committeeNames: ReadonlyMap<CommitteeId, string>): SearchEntry {
  const measureId = (link.relations.find((relation) => relation.relation === "measure")?.to ??
    null) as MeasureId | null;
  const committeeId = (link.relations.find((relation) => relation.relation === "committee")?.to ??
    null) as CommitteeId | null;
  return {
    nodeId: link.nodeId,
    kind: link.kind,
    title: titleOf(link, measureId, committeeId === null ? undefined : committeeNames.get(committeeId)),
    measureId,
    committeeId,
    date: link.date,
    keywordOnly: isKeywordOnly(link),
  };
}
