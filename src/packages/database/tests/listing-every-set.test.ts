// Seam 4 (test/CLAUDE.md): a complete Full pull lists the rows of every entity set it reads, each under that set's name
// (ticket #100, ADR-0030). The record the writer is given has one field for each name in `pulledEntitySets`, and the
// Listing keys the rows of each field. Listing counts per set are the build report's `listed` and `no_longer_listed`
// columns, which no tool shows, so this is where a set that is stored but never listed (or listed under another set's name)
// is seen: the other Listing tests read what the reader hands out, and the reader hands out only some of the sets. One
// MADE UP row in each of the 18 sets (built in made-up-index.ts), pulled once and then missed twice.
import { afterEach, describe, expect, it } from "vitest";
import {
  agendaLink,
  agendaItem,
  analysisLink,
  asOf,
  committee,
  committeeMember,
  committeeVote,
  exhibitLink,
  floorLetterLink,
  floorVote,
  historyAction,
  legislatorRow,
  measure,
  meetingOn,
  openMadeUpIndex,
  postingLink,
  pullOf,
  session,
  sponsor,
  testimonyRecord,
  versionLink,
  type MadeUpIndex,
} from "./made-up-index.ts";

let index: MadeUpIndex;
afterEach(() => {
  index.close();
});

/** One MADE UP row in each entity set. The meeting lists its agenda, which is a column of its CommitteeMeetings row. */
const onePerSet = pullOf({
  Measures: [measure],
  Legislators: [legislatorRow],
  MeasureSponsors: [sponsor],
  MeasureHistoryActions: [historyAction],
  MeasureVotes: [floorVote],
  CommitteeVotes: [committeeVote],
  Committees: [committee],
  CommitteeMeetings: [{ ...meetingOn(10), agenda: agendaLink() }],
  CommitteeAgendaItems: [agendaItem],
  MeasureDocuments: [versionLink()],
  MeasureAnalysisDocuments: [analysisLink()],
  CommitteeMeetingDocuments: [exhibitLink()],
  CommitteeProposedAmendments: [postingLink(1, 10)],
  CommitteePublicTestimonies: [testimonyRecord(1)],
  CommitteeMembers: [committeeMember],
  ConveneTimes: [{ session, at: asOf(1), chamber: "senate" }],
  LegislativeSessions: { session, begin: "2099-01-01", end: null },
  FloorLetters: [floorLetterLink()],
});

/**
 * What the build report's listing columns say after the pull, written out: the entity sets by name in the order the
 * report lists them (sorted as text), and the agenda under the meeting's column. Each holds one row.
 */
const everySet = [
  "CommitteeAgendaItems",
  "CommitteeMeetingDocuments",
  "CommitteeMeetings",
  "CommitteeMeetings.AgendaUrl",
  "CommitteeMembers",
  "CommitteeProposedAmendments",
  "CommitteePublicTestimonies",
  "CommitteeVotes",
  "Committees",
  "ConveneTimes",
  "FloorLetters",
  "LegislativeSessions",
  "Legislators",
  "MeasureAnalysisDocuments",
  "MeasureDocuments",
  "MeasureHistoryActions",
  "MeasureSponsors",
  "MeasureVotes",
  "Measures",
];

describe("a complete Full pull", () => {
  it("lists one row in each of the 18 entity sets, and the meeting's agenda under its own column", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), onePerSet);
    expect(index.writer.listingCounts(session)).toEqual(
      everySet.map((entitySet) => ({ entitySet, listed: 1, noLongerListed: 0 })),
    );
  });

  it("marks the row of every set No longer listed once two complete pulls in a row have missed it", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), onePerSet);
    index.writer.recordFullPull(session, asOf(2), pullOf());
    expect(index.writer.listingCounts(session)).toEqual(
      everySet.map((entitySet) => ({ entitySet, listed: 1, noLongerListed: 0 })),
    );

    index.writer.recordFullPull(session, asOf(3), pullOf());
    expect(index.writer.listingCounts(session)).toEqual(
      everySet.map((entitySet) => ({ entitySet, listed: 0, noLongerListed: 1 })),
    );
  });
});
