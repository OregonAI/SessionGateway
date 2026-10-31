import { z } from "zod";
import type { IndexReader } from "#/packages/database/reader.ts";
import {
  measureIdOf,
  olisPageUrlOf,
  parseMeasureReference,
  type HistoryAction,
  type MeasureLocation,
  type SessionKey,
} from "#/packages/domain/index.ts";
import type { AgendaItem } from "#/packages/domain/schedule.ts";
import type { CommitteeVote, FloorVote, LegislatorVote } from "#/packages/domain/votes.ts";
import { agencyLinksOf, agencyLinksOutput } from "./agency-links.ts";
import { analysisDocumentsOf, analysisDocumentsOutput } from "./analysis.ts";
import { measureListingOutput, listingShown } from "./listing.ts";
import { statuteLinksBySourceOf, versionsWithSameLinksAs } from "./statute-links.ts";
import { statuteLinksBySourceWithTable, statuteLinksBySourceWithTableOutput } from "./statutes-affected-table.ts";
import type { LiveLookup, LiveStatusReader } from "./live-status.ts";

/** The notice every result carries (ADR-0002, spec #1 "What every result must carry"). */
export const NON_OFFICIAL_NOTICE =
  "Not the official record of the Oregon Legislature. This is an unofficial copy of public information from the Legislature's Open Data Service; use source_url for the Legislature's own page.";

const legislatorOutput = z
  .object({
    id: z.string().describe("The Legislator's id, the same for every Legislator Code that names them."),
    name: z.string().describe("The Legislator's first and last name."),
  })
  .nullable()
  .describe("The Legislator the code names, or null when the code could not be resolved.");

/** One Legislator's vote, in a committee vote or a floor vote. */
const legislatorVoteOutput = z.object({
  legislator_code: z.string().describe("The Legislator Code the feed gives this voter, as the feed writes it."),
  legislator: legislatorOutput,
  vote: z.string().describe('The vote in the feed\'s word, such as "Aye", "Nay" or "Excused".'),
});

/** One line of a Measure's history. */
const historyActionOutput = z.object({
  chamber: z.enum(["house", "senate"]).describe("The chamber the action happened in."),
  date: z.string().describe("When the action happened, in Pacific time with its UTC offset."),
  text: z.string().describe("The action as OLIS prints it."),
});

const floorVoteOutput = z.object({
  chamber: z.enum(["house", "senate"]).describe("The chamber that voted."),
  date: z.string().describe("When the chamber voted, in Pacific time with its UTC offset."),
  action: z.string().describe('The history action the vote was taken at, such as "Third reading.  Passed.".'),
  votes: z
    .array(legislatorVoteOutput)
    .describe("Each Legislator's vote, in the order of the ids the feed gives the entries."),
});

const committeeVoteOutput = z.object({
  committee_code: z.string().describe("The code of the committee that voted, such as SLB."),
  meeting_date: z.string().describe("When the committee met, in Pacific time with its UTC offset."),
  votes: z
    .array(legislatorVoteOutput)
    .describe("Each member's vote, in the order of the ids the feed gives the entries."),
});

/** The live status block: the Measure's location, history, schedule and votes from OLIS now, or from the cache. */
const liveStatusOutput = z
  .object({
    source: z
      .enum(["olis", "cache"])
      .describe(
        '"olis" when the values were read from OLIS when this call arrived. "cache" when the live lookup failed and the values are the cache\'s, as of the last full pull.',
      ),
    lookup_failed: z.boolean().describe("True when the live lookup of OLIS failed and the values come from the cache."),
    as_of: z
      .string()
      .describe(
        'What the values are as of, in Pacific time with its UTC offset: the time of the read when source is "olis", and the index\'s as-of time (the last full pull) when source is "cache".',
      ),
    notice: z.string().describe("Says in words where the values in this block come from, and why."),
    location: z
      .object({
        current: z.string().describe("Where the Measure is, as OLIS says it."),
        committee_code: z
          .string()
          .nullable()
          .describe("The committee code OLIS gives with the location, or null. See the top-level location."),
      })
      .describe("The Measure's location (see as_of)."),
    history: z
      .array(historyActionOutput)
      .describe("The Measure's history (see as_of), oldest action first as OLIS prints it."),
    schedule: z
      .array(
        z.object({
          committee_code: z.string().describe("The code of the committee that meets, such as SLB."),
          meeting_date: z.string().describe("When the committee meets, in Pacific time with its UTC offset."),
          meeting_type: z.string().describe('The kind of meeting as OLIS words it, such as "Public Hearing".'),
        }),
      )
      .nullable()
      .describe(
        'The committee meetings still ahead at which the Measure is on the agenda (meeting_date at or after as_of), soonest first, as OLIS lists them now; empty when none is. Null when source is "cache": the cache holds no schedule.',
      ),
    floor_votes: z
      .array(floorVoteOutput)
      .describe("The Measure's floor votes (see as_of), in the order they were taken, as the top-level floor_votes."),
    committee_votes: z
      .array(committeeVoteOutput)
      .describe(
        "The Measure's committee votes (see as_of), in the order the committees met, as the top-level committee_votes, including the note there that a meeting_date can be later than as_of.",
      ),
  })
  .describe(
    "The Measure's current status, read from OLIS when the call arrived. If OLIS could not be read, the same fields come from the cache, and source and notice say so.",
  );

export const getMeasureInput = z.object({
  measure: z.string().describe('A Measure\'s id, such as "measure-2025r1-sb69", or its citation, such as "SB 69".'),
});

export const getMeasureOutput = z.object({
  id: z.string().describe("The Measure's id in OregonAI's form."),
  ...measureListingOutput,
  catchline: z.string().nullable().describe("The Measure's catchline, as OLIS publishes it."),
  digest: z
    .string()
    .nullable()
    .describe(
      "The Measure's digest and summary exactly as OLIS publishes it (the feed's MeasureSummary), with its tabs, newlines and markup: <b> marks new text and [<i>...</i>] marks text deleted from the prior Version. Null when OLIS publishes none.",
    ),
  analysis_documents: analysisDocumentsOutput,
  statute_links_by_source: statuteLinksBySourceWithTableOutput.describe(
    "The Measure's Statute Links by the Version or Proposed Amendment they were read from, each with its measure section.",
  ),
  agency_links: agencyLinksOutput.describe(
    "The Agencies the Measure and its Versions and Proposed Amendments have an Agency Link to, each with its parent and its evidence grouped by kind (a count and a few examples, with the node each sits on), the documents the examples name once, and the units its Fiscal Impact Statements list that are not Agencies. Every link of an Agency, a page at a time, is find_measures with its agency.",
  ),
  source_url: z.string().describe("The Measure's page on OLIS."),
  location: z
    .object({
      current: z
        .string()
        .describe('Where the Measure is, as OLIS says it, such as "In Senate Committee" or "Chapter Number Assigned".'),
      committee_code: z
        .string()
        .nullable()
        .describe(
          'The committee code OLIS gives with the location, such as JWM, or null when it gives none. It is the feed\'s field, not a statement that the Measure is in that committee: OLIS can give a code while `current` says the Measure is elsewhere, such as "At Presidents Desk Upon Adjournment", and none while `current` says "In House Committee". Read `current` for where the Measure is.',
        ),
    })
    .describe("The Measure's current location as of the last full pull (see as_of)."),
  created_at: z.string().describe("When OLIS created the Measure, in Pacific time with its UTC offset."),
  modified_at: z
    .string()
    .nullable()
    .describe("When OLIS last changed the Measure, in Pacific time with its UTC offset."),
  sponsors: z
    .array(
      z.object({
        level: z.enum(["chief", "regular"]).describe("Whether the Legislator is a chief sponsor or a regular one."),
        legislator_code: z.string().describe("The Legislator Code the feed gives this sponsor, as the feed writes it."),
        legislator: legislatorOutput,
      }),
    )
    .describe("The Measure's sponsors who are Legislators, in print order."),
  committee_sponsors: z
    .array(
      z.object({
        committee_code: z.string().describe("The committee's code in the feed, such as HECHS."),
      }),
    )
    .describe(
      "The committees that sponsor the Measure, in print order. A committee is not a Legislator, so it is not among the sponsors.",
    ),
  presession_messages: z
    .array(z.string())
    .describe(
      'The messages of the Measure\'s presession rows as OLIS publishes them, in print order, such as "(Presession filed.)". Empty when OLIS has none. A presession row names no Legislator.',
    ),
  history: z
    .array(historyActionOutput)
    .describe(
      "The Measure's history as of the last full pull (see as_of), oldest action first as OLIS prints it, so the last entry is the latest action.",
    ),
  floor_votes: z
    .array(floorVoteOutput)
    .describe(
      "The Measure's floor votes as of the last full pull (see as_of), in the order they were taken. A Legislator who changed Legislator Code during the Session is one Legislator in every vote.",
    ),
  committee_votes: z
    .array(committeeVoteOutput)
    .describe(
      "The Measure's committee votes as of the last full pull (see as_of), in the order the committees met. A roll that OLIS gives under two reports, as it does for a joint committee, is listed once; two different rolls of one committee at one meeting are two entries. OLIS creates these rows before the meeting is held, so a vote whose meeting_date is later than as_of can already list answers; the feed does not say whether that vote has been taken.",
    ),
  live_status: liveStatusOutput,
  as_of: z.string().describe("When the index was last refreshed, in Pacific time with its UTC offset."),
  notice: z.string().describe("A reminder that this is not the official record."),
});

export type GetMeasureOutput = z.infer<typeof getMeasureOutput>;

function legislatorVoteShown(cast: LegislatorVote): z.infer<typeof legislatorVoteOutput> {
  return { legislator_code: cast.legislatorCode, legislator: cast.legislator, vote: cast.vote };
}

/** An unknown Measure is an expected outcome, so it is a value; the MCP edge decides it is a tool error. */
export type GetMeasureResult =
  { kind: "found"; measure: GetMeasureOutput } | { kind: "unknown"; reference: string; session: SessionKey };

/** The live block of a call whose lookup answered, or the cache's values when it did not. */
function liveStatusOf(
  live: LiveLookup,
  cached: {
    location: MeasureLocation;
    history: readonly HistoryAction[];
    floorVotes: readonly FloorVote[];
    committeeVotes: readonly CommitteeVote[];
    asOf: string;
  },
): z.infer<typeof liveStatusOutput> {
  switch (live.kind) {
    case "answered":
      return {
        source: "olis",
        lookup_failed: false,
        as_of: live.asOf,
        notice: `Read from OLIS when this call arrived, as of ${live.asOf}.`,
        location: { current: live.location.current, committee_code: live.location.committeeCode },
        history: live.history.map(historyShown),
        schedule: live.schedule.map(scheduledItemShown),
        floor_votes: live.floorVotes.map(floorVoteShown),
        committee_votes: live.committeeVotes.map(committeeVoteShown),
      };
    case "failed":
      return {
        source: "cache",
        lookup_failed: true,
        as_of: cached.asOf,
        notice: `The live lookup of OLIS failed: ${live.reason}. The location, history and votes in this block come from the cache, as of ${cached.asOf}, the index's as-of time, and may be out of date. The cache holds no schedule, so schedule is null.`,
        location: { current: cached.location.current, committee_code: cached.location.committeeCode },
        history: cached.history.map(historyShown),
        schedule: null,
        floor_votes: cached.floorVotes.map(floorVoteShown),
        committee_votes: cached.committeeVotes.map(committeeVoteShown),
      };
    default:
      return live satisfies never;
  }
}

function scheduledItemShown(item: AgendaItem): { committee_code: string; meeting_date: string; meeting_type: string } {
  return { committee_code: item.committeeCode, meeting_date: item.meetingDate, meeting_type: item.meetingType };
}

function floorVoteShown(vote: FloorVote): z.infer<typeof floorVoteOutput> {
  return {
    chamber: vote.chamber,
    date: vote.date,
    action: vote.action,
    votes: vote.votes.map(legislatorVoteShown),
  };
}

function committeeVoteShown(vote: CommitteeVote): z.infer<typeof committeeVoteOutput> {
  return {
    committee_code: vote.committeeCode,
    meeting_date: vote.meetingDate,
    votes: vote.votes.map(legislatorVoteShown),
  };
}

function historyShown(action: HistoryAction): z.infer<typeof historyActionOutput> {
  return { chamber: action.chamber, date: action.date, text: action.text };
}

export async function getMeasure(
  reader: IndexReader,
  liveStatus: LiveStatusReader,
  session: SessionKey,
  input: z.infer<typeof getMeasureInput>,
): Promise<GetMeasureResult> {
  const key = parseMeasureReference(input.measure, session);
  const measure = key === undefined ? undefined : reader.findMeasure(key);
  if (measure === undefined) return { kind: "unknown", reference: input.measure, session };
  const asOf = reader.asOf(session);
  if (asOf === undefined) {
    throw new Error(`The index holds Measures of ${session} but no completed full pull to date them by`);
  }
  const versions = reader.findMeasureVersions(measure);
  const history = reader.findHistory(measure);
  const floorVotes = reader.findFloorVotes(measure);
  const committeeVotes = reader.findCommitteeVotes(measure);
  // The Measure is in the index, so OLIS is asked about it; a reference the index does not know never reaches OLIS.
  const live = await liveStatus.lookup(measure);
  const listing = reader.measureListing(measure);
  const statuteLinksBySource = statuteLinksBySourceOf(measure, versions, reader.findMeasureAmendments(measure));
  // The table's blocks are set beside the Versions first; same_links_as keeps each Version's own block (ADR-0036).
  const withTable = statuteLinksBySourceWithTable(
    statuteLinksBySource,
    versions,
    reader.statutesAffectedTableOf(measure),
  );
  return {
    kind: "found",
    measure: {
      id: measureIdOf(measure),
      ...listingShown(listing),
      catchline: measure.catchline,
      digest: measure.digest,
      analysis_documents: analysisDocumentsOf(
        measure,
        reader.analysisDocuments(measure),
        reader.analysisNotHeld(measure),
      ),
      statute_links_by_source: { ...withTable, versions: versionsWithSameLinksAs(withTable.versions) },
      agency_links: agencyLinksOf(reader.findAgencyLinks(session, { measure }), reader.findUnresolvedUnits(measure), {
        parents: reader.agencyParents(),
        supersededAmendments: new Set(statuteLinksBySource.superseded_amendments.map((amendment) => amendment.id)),
      }),
      source_url: olisPageUrlOf(measure),
      location: { current: measure.location.current, committee_code: measure.location.committeeCode },
      created_at: measure.createdAt,
      modified_at: measure.modifiedAt,
      sponsors: reader.findSponsors(measure).map((sponsor) => ({
        level: sponsor.level,
        legislator_code: sponsor.legislatorCode,
        legislator: sponsor.legislator,
      })),
      committee_sponsors: reader
        .findCommitteeSponsors(measure)
        .map((committeeCode) => ({ committee_code: committeeCode })),
      presession_messages: reader.findPresessionMessages(measure),
      history: history.map(historyShown),
      floor_votes: floorVotes.map(floorVoteShown),
      committee_votes: committeeVotes.map(committeeVoteShown),
      live_status: liveStatusOf(live, { location: measure.location, history, floorVotes, committeeVotes, asOf }),
      as_of: asOf,
      notice: NON_OFFICIAL_NOTICE,
    },
  };
}

/** What an agent is told when no Measure matches, so it can correct the call. */
export function unknownMeasureMessage(reference: string, session: SessionKey): string {
  const example = measureIdOf({ session, prefix: "SB", number: 69 });
  return `No Measure "${reference}" in the ${session} Session. Give a Measure id such as ${example} or a citation such as SB 69.`;
}
