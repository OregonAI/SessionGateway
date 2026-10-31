// Which rows of the feed a full pull listed, by entity set and key: the input of the two-pull rule (ADR-0005,
// ADR-0030). A set's name is the OData entity set's own, as the OLIS client reads it. Everything the index
// keeps from the feed is named here, so that a ticket that makes the pull read another set adds its rows to
// `listedRowsOf` and to nothing else.
import type {
  DocumentId,
  DocumentKind,
  DocumentLink,
  CommitteeMember,
  Committee,
  Meeting,
  AgendaItem,
} from "#/packages/domain/documents.ts";
import { measureIdOf, type HistoryAction, type Measure } from "#/packages/domain/index.ts";
import type { LegislatorRow } from "#/packages/domain/legislators.ts";

/**
 * The SQL term for whether the feed lists a row, over a LEFT JOIN of `feed_row_state` aliased `fr`. The join finds no
 * row for one that no complete full pull has listed (the index was built before the listing was kept, or an
 * increment stored it): such a row is read as listed, not yet checked (ADR-0030).
 */
export const listedOrUnchecked = "COALESCE(fr.listed, 1)";

/** One row of the feed the index keeps: the entity set it came from, its key there, and the document it links, if any. */
export type ListedRow = { entitySet: string; key: string; documentId: DocumentId | null };

/**
 * The entity set of the feed row that links a document of this kind. An agenda is linked by a column of a
 * CommitteeMeetings row, not by a row of its own, so it is named for the column: the meeting stays listed when
 * OLIS stops linking its agenda, and the agenda does not.
 */
export function entitySetOfDocument(kind: DocumentKind): string {
  switch (kind) {
    case "version":
    case "printed_amendment":
      return "MeasureDocuments";
    case "analysis":
      return "MeasureAnalysisDocuments";
    case "proposed_amendment":
      return "CommitteeProposedAmendments";
    case "exhibit":
    case "recording_log":
      return "CommitteeMeetingDocuments";
    case "testimony":
      return "CommitteePublicTestimonies";
    case "agenda":
      return "CommitteeMeetings.AgendaUrl";
    default:
      return kind satisfies never;
  }
}

/** What a full pull read, as far as listing it needs: one field for each kind of row the index keeps. */
export type ListedSources = {
  measures: readonly Measure[];
  legislatorRows: readonly LegislatorRow[];
  sponsors: readonly { id: number }[];
  history: readonly HistoryAction[];
  floorVotes: readonly { id: number }[];
  committeeVotes: readonly { id: number }[];
  committees: readonly Committee[];
  meetings: readonly Meeting[];
  agendaItems: readonly AgendaItem[];
  documentLinks: readonly DocumentLink[];
  committeeMembers: readonly CommitteeMember[];
};

/** Every row the pull listed, once for each key. */
export function listedRowsOf(pulled: ListedSources): ListedRow[] {
  const rows: ListedRow[] = [];
  const add = (entitySet: string, key: string, documentId: DocumentId | null = null): void => {
    rows.push({ entitySet, key, documentId });
  };
  for (const measure of pulled.measures) add("Measures", measureIdOf(measure));
  for (const row of pulled.legislatorRows) add("Legislators", row.code);
  for (const sponsor of pulled.sponsors) add("MeasureSponsors", String(sponsor.id));
  for (const action of pulled.history) add("MeasureHistoryActions", String(action.id));
  for (const entry of pulled.floorVotes) add("MeasureVotes", String(entry.id));
  for (const entry of pulled.committeeVotes) add("CommitteeVotes", String(entry.id));
  for (const committee of pulled.committees) add("Committees", committee.id);
  for (const meeting of pulled.meetings) add("CommitteeMeetings", meeting.id);
  for (const item of pulled.agendaItems) add("CommitteeAgendaItems", String(item.itemId));
  for (const link of pulled.documentLinks) add(entitySetOfDocument(link.kind), link.id, link.id);
  for (const member of pulled.committeeMembers) add("CommitteeMembers", member.key);
  return rows;
}
