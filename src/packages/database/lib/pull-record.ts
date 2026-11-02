// What a Pull gives the writer to store (ticket #100): the rows it read of each entity set, in the form the database keeps
// them. The record has one field for each name in `pulledEntitySets` (the feed's own set names, `domain`'s one list of
// them), so a set added to that list does not compile here until the record has its rows, and the Listing (`listing.ts`),
// which keys the rows of each field, does not compile until it lists them. The types are here and not in `writer.ts` so
// that the Listing can name the record without a cycle with the writer; `writer.ts` exports them all.
import type {
  AgendaItem,
  Committee,
  CommitteeMember,
  Convening,
  DocumentLink,
  Meeting,
  PulledEntitySet,
  SessionDates,
  TestimonyDetails,
} from "#/packages/domain/documents.ts";
import type { HistoryAction, Measure, MeasureKey } from "#/packages/domain/index.ts";
import type { Legislator, LegislatorId, LegislatorRow, SponsorLevel } from "#/packages/domain/legislators.ts";
import type { AgencyId } from "#/packages/domain/oregonai.ts";
import type { CommitteeVoteEntry, FloorVoteEntry } from "#/packages/domain/votes.ts";

type SponsorRecordFields = {
  id: number;
  measure: MeasureKey;
  level: SponsorLevel;
  printOrder: number;
};

/**
 * One MeasureSponsors row of the feed. A Member row carries the Legislator its code resolved to, if
 * any; a Committee row names a committee and a Presession row carries a message, and neither names a
 * Legislator.
 */
export type SponsorRecord =
  | (SponsorRecordFields & { kind: "member"; legislatorCode: string; legislatorId: LegislatorId | null })
  | (SponsorRecordFields & { kind: "committee"; committeeCode: string })
  | (SponsorRecordFields & { kind: "presession"; message: string });

/** A Legislator Code and the id of the Legislator it names. */
export type LegislatorCodeRecord = { code: string; legislatorId: LegislatorId };

/** What the worker stores of a floor vote entry: the entry and the Legislator its code resolved to, if any. */
export type FloorVoteRecord = FloorVoteEntry & { legislatorId: LegislatorId | null };

/** What the worker stores of a committee vote entry: the entry and the Legislator its code resolved to, if any. */
export type CommitteeVoteRecord = CommitteeVoteEntry & { legislatorId: LegislatorId | null };

/**
 * What a run does with the Agency of a Testimony row. `matched`: the run matched the row's `Organization` with the
 * snapshot the index reports, and stores the result, an Agency or null when the Organization names none. `left_to_full_pull`:
 * the run did not match the row, because an increment's snapshot file is not the one the index reports (ADR-0047). The row's
 * stored Agency stays as it is, and a row new to the index is stored with none. Only an increment gives this to the writer;
 * recording a full pull with it is a bug and throws.
 */
export type TestimonyAgency = { kind: "matched"; agencyId: AgencyId | null } | { kind: "left_to_full_pull" };

/**
 * One CommitteePublicTestimonies row of the feed, with what the run does with the Agency its `Organization` names. The
 * link is the Testimony's document link, which carries what the feed says of it (`testimony`), and the
 * Measure, committee and meeting it points at.
 */
export type TestimonyRecord = {
  link: DocumentLink & { testimony: TestimonyDetails };
  agency: TestimonyAgency;
};

/** What each entity set contributes to a record, in the form the database keeps it. */
type RowsOfSet = {
  Measures: readonly Measure[];
  /** The feed's Legislators rows, one for each Legislator Code, as the pull read them: the rows the index keeps and lists. */
  Legislators: readonly LegislatorRow[];
  /** The MeasureSponsors rows, with the Legislator each Member row's code resolved to. */
  MeasureSponsors: readonly SponsorRecord[];
  MeasureHistoryActions: readonly HistoryAction[];
  MeasureVotes: readonly FloorVoteRecord[];
  CommitteeVotes: readonly CommitteeVoteRecord[];
  Committees: readonly Committee[];
  /** The committee meetings. A meeting's status is the feed's latest, and its agenda is the document its row links, if any. */
  CommitteeMeetings: readonly Meeting[];
  /** The agenda items of every meeting. An item's action is the feed's latest. */
  CommitteeAgendaItems: readonly AgendaItem[];
  /** The Versions and Printed Amendments of the Measures. */
  MeasureDocuments: readonly DocumentLink[];
  MeasureAnalysisDocuments: readonly DocumentLink[];
  /** The Exhibits and Recording Logs of the meetings. */
  CommitteeMeetingDocuments: readonly DocumentLink[];
  /** The postings of Proposed Amendments. */
  CommitteeProposedAmendments: readonly DocumentLink[];
  /**
   * The Testimony rows of the feed, each with the Agency its `Organization` names. They are listed here, and not only as
   * document links, so the server can say who testified before every file is fetched.
   */
  CommitteePublicTestimonies: readonly TestimonyRecord[];
  /** The CommitteeMembers rows, every one: the set's declared key is not unique (`CommitteeMember.key` is the whole row). */
  CommitteeMembers: readonly CommitteeMember[];
  /** The ConveneTimes rows: the days with a floor convening. A full pull reads them whole; an increment does not read them (ADR-0042). */
  ConveneTimes: readonly Convening[];
  /** The Session's LegislativeSessions row, or undefined when the feed has none or the run did not read it. */
  LegislativeSessions: SessionDates | undefined;
  FloorLetters: readonly DocumentLink[];
};

/**
 * The rows a Pull read, with one field for each entity set the feed has under the feed's own name for it. A name added to
 * `pulledEntitySets` that `RowsOfSet` above has no entry for fails on the next line with "Type 'Name' cannot be used to
 * index type 'RowsOfSet'": add the set to `RowsOfSet`, with the type of its rows. The places that build or key a record
 * (the Listing's table in `listing.ts`, the register and `readFeed` in `ingest`) then fail, each saying which set it lacks.
 */
export type PulledRows = { readonly [Name in PulledEntitySet]: RowsOfSet[Name] };

/**
 * Everything a full pull read, ready to store: the rows of each entity set, and the Legislators the resolver named. A ticket
 * that makes the pull read another entity set adds the name to `pulledEntitySets`, and the compiler asks for its rows here
 * and not in a parameter of `recordFullPull`.
 */
export type FullPullRecord = PulledRows & {
  /** The Legislators the resolver can name. */
  legislators: readonly Legislator[];
  /** Every Legislator Code the resolver can resolve, with the id of the Legislator it names (the live lookup resolves codes OLIS sends later). */
  legislatorCodes: readonly LegislatorCodeRecord[];
};

/**
 * Every document the feed links in what a pull read, whether or not its file is fetched yet: the links of the five sets
 * that link documents, each meeting's agenda (a column of its row), and the Floor Letters. What each meeting lists (its
 * agenda, Exhibits, Recording Logs and the postings of Proposed Amendments) and which analysis documents each Measure has
 * are stored from these before any file is fetched, so a file that fails to come is still listed (ADR-0011, "Order of a
 * pull"). The worker fetches the files in this order.
 *
 * The fetch order is the worker's (ADR-0011), and the list is here, in `database`, all the same: the writer stores what each
 * meeting lists, the analysis documents, the Versions and the Floor Letters from the same links, so `writer.ts` and the
 * worker both call this one function, and the list of documents a record holds is written once (ADR-0050).
 */
export function documentLinksOf(pulled: PulledRows): DocumentLink[] {
  return [
    ...pulled.MeasureDocuments,
    ...pulled.MeasureAnalysisDocuments,
    ...pulled.CommitteeProposedAmendments,
    ...pulled.CommitteeMeetingDocuments,
    ...pulled.CommitteePublicTestimonies.map((testimony) => testimony.link),
    ...pulled.CommitteeMeetings.flatMap((meeting) => (meeting.agenda === null ? [] : [meeting.agenda])),
    ...pulled.FloorLetters,
  ];
}
