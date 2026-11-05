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
import { hearingKindOf } from "#/packages/recording-log/index.ts";
import { statuteLinksOfMeasure } from "#/packages/statute-links/measure.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import type { Outcome } from "./outcome.ts";
import { agencyLinksOf, agencyLinksOutput } from "./agency-links.ts";
import { analysisDocumentsOf, analysisDocumentsOutput } from "./analysis.ts";
import { floorLettersOutput, floorLettersShown } from "./floor-letters.ts";
import { measureListingOutput, listingShown } from "./listing.ts";
import { statuteLinksBySourceWithTable, statuteLinksBySourceWithTableOutput } from "./statutes-affected-table.ts";
import type { LiveLookup, LiveStatusReader } from "./live-status.ts";

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

/** One hearing at which the Measure was taken up (ticket #127): a Recording Log's Agenda item that names it, and the first turn under the item. */
const hearingOutput = z.object({
  meeting_id: z.string().describe("The id of the Meeting the Recording Log belongs to, as meetings gives it."),
  committee_code: z.string().describe("The code of the committee that met, such as HALNRW."),
  meeting_date: z.string().describe("When the Meeting started, in Pacific time with its UTC offset."),
  recording_log_id: z.string().describe("The Recording Log, which get_document takes: it holds every speaker turn."),
  event_id: z.string().describe("The Invintus event ID of the Meeting's recording, from the log's own player links."),
  agenda_item: z
    .string()
    .describe(
      'The Agenda item\'s line as the log has it, such as "HB 3131 - Public Hearing" or "SB 1542 and SB 1543 - Public Hearing": a line that names several Measures is a hearing of each.',
    ),
  kind: z
    .string()
    .describe(
      'What the item is: "Public Hearing", "Work Session", or the line\'s own wording after its Measures ("Informational Meeting").',
    ),
  measure_ids: z
    .array(z.string())
    .describe(
      "Every Measure the Agenda item names that this index holds, in the order the line names them, this Measure among them. The first turn's Measure is the first the line names.",
    ),
  first_turn: z
    .object({
      timecode: z.string().describe('The timecode as logged, such as "01:15:49".'),
      offset_seconds: z.number().describe("The turn's second on the recording's clock."),
      offset_source: z
        .enum(["link", "timecode"])
        .describe("Where the second came from: the log's player link on that line, or the timecode itself."),
      speaker: z.string().describe("The speaker as the log writes it: a name and title."),
      legislator_code: z
        .string()
        .nullable()
        .describe("The Legislator Code of the Legislator the line names, or null for anyone else."),
      legislator: legislatorOutput,
      player_link: z
        .string()
        .describe("The Legislature's own player at this turn's second, built from the log's own player link."),
    })
    .describe("The first turn spoken under the Agenda item, by the recording's clock."),
});

const UNCHANGED_DESCRIPTION =
  '"unchanged" means read the top-level field of the same name: nothing is repeated here. When source is "olis", OLIS gives exactly the top-level value. When source is "cache", nothing was read from OLIS, and the top-level value is the cache\'s, which is all there is.';

/** One value of the live block that is a single thing (the location): the top level's, or OLIS's in full. */
const unchangedStatus = z.object({ status: z.literal("unchanged") });

/**
 * One list of the live block (history, floor votes, committee votes), said against the top level's list:
 * unchanged, the new entries at its end, or OLIS's whole list.
 */
function liveListOutput<Entry extends z.ZodType>(entry: Entry, name: string) {
  return z
    .discriminatedUnion("status", [
      unchangedStatus.describe(`The top-level ${name} is the one to read. ${UNCHANGED_DESCRIPTION}`),
      z
        .object({
          status: z.literal("new_entries"),
          entries: z
            .array(entry)
            .describe(
              `Only the entries OLIS has after the top level's last one, in the top level's order. The full ${name} is the top-level ${name} followed by these entries.`,
            ),
        })
        .describe(
          `OLIS gives the top-level ${name} with new entries after its last one. The top level's entries are not repeated: read them from the top-level ${name} and add these at the end.`,
        ),
      z
        .object({
          status: z.literal("full"),
          entries: z
            .array(entry)
            .describe(
              `OLIS's whole ${name}, in order. It replaces the top-level ${name}. OLIS's list differs from the top level's other than by new entries at the end: an entry changed, missing or reordered, or fewer entries.`,
            ),
        })
        .describe(
          `OLIS's ${name} differs from the top level's other than by new entries at the end (an entry changed, missing or reordered, or fewer entries), so all of it is shown. Use it instead of the top-level ${name}.`,
        ),
    ])
    .describe(
      `The Measure's ${name} (see as_of), said against the top-level ${name}. Read status: "unchanged" (nothing to add), "new_entries" (the top level's entries, then these) or "full" (these entries replace the top level's).`,
    );
}

/** The live status block: what OLIS says now about the Measure's location, history, schedule and votes, against what the top level shows. */
const liveStatusOutput = z
  .object({
    source: z
      .enum(["olis", "cache"])
      .describe(
        '"olis" when the values were read from OLIS when this call arrived. "cache" when the live lookup failed: then nothing was read from OLIS, and location, history and votes are the top level\'s, as of the last full pull.',
      ),
    lookup_failed: z.boolean().describe("True when the live lookup of OLIS failed and the values come from the cache."),
    as_of: z
      .string()
      .describe(
        'What the values are as of, in Pacific time with its UTC offset: the time of the read when source is "olis", and the index\'s as-of time (the last full pull) when source is "cache".',
      ),
    notice: z.string().describe("Says in words where the values in this block come from, and why."),
    location: z
      .discriminatedUnion("status", [
        unchangedStatus.describe(`The top-level location is the one to read. ${UNCHANGED_DESCRIPTION}`),
        z
          .object({
            status: z.literal("full"),
            current: z.string().describe("Where the Measure is, as OLIS says it."),
            committee_code: z
              .string()
              .nullable()
              .describe("The committee code OLIS gives with the location, or null. See the top-level location."),
          })
          .describe("OLIS's location differs from the top level's: this is OLIS's, and replaces it."),
      ])
      .describe(
        'The Measure\'s location (see as_of), said against the top-level location. "unchanged": read the top level\'s. "full": this is where OLIS says the Measure is now.',
      ),
    history: liveListOutput(historyActionOutput, "history"),
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
        'The committee meetings still ahead at which the Measure is on the agenda (meeting_date at or after as_of), soonest first, as OLIS lists them now; empty when none is. The top level has no schedule, so this is always shown in full. Null when source is "cache": the cache holds no schedule.',
      ),
    floor_votes: liveListOutput(floorVoteOutput, "floor_votes"),
    committee_votes: liveListOutput(committeeVoteOutput, "committee_votes"),
  })
  .describe(
    'The Measure\'s current status, read from OLIS when the call arrived, and only what the top level does not already show: a value OLIS gives as the top level does is "unchanged", a list that adds entries at its end shows only those, and any other difference is shown in full. If OLIS could not be read, source and notice say so and every value is "unchanged", which then means nothing was read: the top level\'s values are the cache\'s.',
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
  floor_letters: floorLettersOutput,
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
  hearings: z
    .array(hearingOutput)
    .describe(
      "The hearings at which the Measure was taken up, earliest Meeting first: every Agenda item of a Recording Log with a speaker-turn index that names the Measure (public hearings and work sessions alike, each labelled by kind; a line that names several Measures counts for each), with the first turn under that item and a link into the official player at it. A log's items come in the order of the recording. Empty when no log the index holds names the Measure.",
    ),
  live_status: liveStatusOutput,
});

export type GetMeasureOutput = z.infer<typeof getMeasureOutput>;

function legislatorVoteShown(cast: LegislatorVote): z.infer<typeof legislatorVoteOutput> {
  return { legislator_code: cast.legislatorCode, legislator: cast.legislator, vote: cast.vote };
}

/** An unknown Measure is an expected outcome, so it is a value; the envelope tells the agent it is a tool error. */
export type GetMeasureFault = { kind: "unknown"; reference: string; session: SessionKey };

export type GetMeasureOutcome = Outcome<GetMeasureOutput, GetMeasureFault>;

/** True when two values shown to an agent are the same in every field. */
function sameShown(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

type LiveListShown<Entry> = z.infer<ReturnType<typeof liveListOutput<z.ZodType<Entry>>>>;

/** A list said against the top level's: unchanged, the entries after the top level's last one, or all of it. */
function listAgainst<Entry>(top: readonly Entry[], live: readonly Entry[]): LiveListShown<Entry> {
  if (live.length === top.length && sameShown(top, live)) return { status: "unchanged" };
  if (live.length > top.length && sameShown(top, live.slice(0, top.length))) {
    return { status: "new_entries", entries: live.slice(top.length) };
  }
  return { status: "full", entries: [...live] };
}

/** The live block of a call whose lookup answered, or a block that repeats nothing when it did not. */
function liveStatusOf(
  live: LiveLookup,
  top: {
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
        notice: `Read from OLIS when this call arrived, as of ${live.asOf}. A value marked unchanged is the top level's; a list marked new_entries shows only what follows the top level's last entry; a value marked full is OLIS's, whole.`,
        location:
          live.location.current === top.location.current && live.location.committeeCode === top.location.committeeCode
            ? { status: "unchanged" }
            : { status: "full", current: live.location.current, committee_code: live.location.committeeCode },
        history: listAgainst(top.history.map(historyShown), live.history.map(historyShown)),
        schedule: live.schedule.map(scheduledItemShown),
        floor_votes: listAgainst(top.floorVotes.map(floorVoteShown), live.floorVotes.map(floorVoteShown)),
        committee_votes: listAgainst(
          top.committeeVotes.map(committeeVoteShown),
          live.committeeVotes.map(committeeVoteShown),
        ),
      };
    case "failed":
      return {
        source: "cache",
        lookup_failed: true,
        as_of: top.asOf,
        notice: `The live lookup of OLIS failed: ${live.reason}. The location, history and votes come from the cache, as of ${top.asOf}, the index's as-of time, and may be out of date; they are the top level's, so this block repeats none of them and marks each unchanged. The cache holds no schedule, so schedule is null.`,
        location: { status: "unchanged" },
        history: { status: "unchanged" },
        schedule: null,
        floor_votes: { status: "unchanged" },
        committee_votes: { status: "unchanged" },
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

/** `asOf` is the index's As of that the envelope read for the call, which dates the live block when the lookup fails. */
export async function getMeasure(
  reader: IndexReader,
  liveStatus: LiveStatusReader,
  session: SessionKey,
  input: z.infer<typeof getMeasureInput>,
  asOf: Timestamp,
): Promise<GetMeasureOutcome> {
  const key = parseMeasureReference(input.measure, session);
  const measure = key === undefined ? undefined : reader.findMeasure(key);
  if (measure === undefined) return { kind: "fault", fault: { kind: "unknown", reference: input.measure, session } };
  const versions = reader.findMeasureVersions(measure);
  const history = reader.findHistory(measure);
  const floorVotes = reader.findFloorVotes(measure);
  const committeeVotes = reader.findCommitteeVotes(measure);
  // The Measure is in the index, so OLIS is asked about it; a reference the index does not know never reaches OLIS.
  const live = await liveStatus.lookup(measure);
  const statuteLinks = statuteLinksOfMeasure({
    measure,
    versions,
    amendments: reader.findMeasureAmendments(measure),
    table: reader.statutesAffectedTableOf(measure),
  });
  return {
    kind: "answer",
    answer: {
      id: measureIdOf(measure),
      ...listingShown(measure.listing),
      catchline: measure.catchline,
      digest: measure.digest,
      analysis_documents: analysisDocumentsOf(
        measure,
        reader.analysisDocuments(measure),
        reader.analysisNotHeld(measure),
      ),
      floor_letters: floorLettersShown(reader.findFloorLetters(measure)),
      statute_links_by_source: statuteLinksBySourceWithTable(statuteLinks),
      agency_links: agencyLinksOf(reader.findAgencyLinks(session, { measure }), reader.findUnresolvedUnits(measure), {
        parents: reader.agencyParents(),
        supersededAmendments: statuteLinks.supersededAmendments,
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
      hearings: reader.turnHearingsOf(measureIdOf(measure)).map((hearing) => ({
        meeting_id: hearing.meeting,
        committee_code: hearing.committeeCode,
        meeting_date: hearing.at,
        recording_log_id: hearing.recordingLog,
        event_id: hearing.eventId,
        agenda_item: hearing.agendaItem,
        kind: hearingKindOf(hearing.agendaItem),
        measure_ids: hearing.measureIds,
        first_turn: {
          timecode: hearing.firstTurn.timecode,
          offset_seconds: hearing.firstTurn.offsetSeconds,
          offset_source: hearing.firstTurn.offsetSource,
          speaker: hearing.firstTurn.speaker,
          legislator_code: hearing.firstTurn.legislatorCode,
          legislator: hearing.firstTurn.legislator,
          player_link: hearing.firstTurn.playerLink,
        },
      })),
      live_status: liveStatusOf(live, { location: measure.location, history, floorVotes, committeeVotes, asOf }),
    },
  };
}

/** What an agent is told when a call to get_measure is a fault. */
export function getMeasureFaultMessage(fault: GetMeasureFault): string {
  return unknownMeasureMessage(fault.reference, fault.session);
}

/** What an agent is told when no Measure matches, so it can correct the call. */
export function unknownMeasureMessage(reference: string, session: SessionKey): string {
  const example = measureIdOf({ session, prefix: "SB", number: 69 });
  return `No Measure "${reference}" in the ${session} Session. Give a Measure id such as ${example} or a citation such as SB 69.`;
}
