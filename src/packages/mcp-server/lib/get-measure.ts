import { z } from "zod";
import type { IndexReader } from "#/packages/database/reader.ts";
import { measureIdOf, olisPageUrlOf, parseMeasureReference, type SessionKey } from "#/packages/domain/index.ts";
import type { LegislatorVote } from "#/packages/domain/votes.ts";

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

export const getMeasureInput = z.object({
  measure: z.string().describe('A Measure\'s id, such as "measure-2025r1-sb69", or its citation, such as "SB 69".'),
});

export const getMeasureOutput = z.object({
  id: z.string().describe("The Measure's id in OregonAI's form."),
  catchline: z.string().nullable().describe("The Measure's catchline, as OLIS publishes it."),
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
    .array(
      z.object({
        chamber: z.enum(["house", "senate"]).describe("The chamber the action happened in."),
        date: z.string().describe("When the action happened, in Pacific time with its UTC offset."),
        text: z.string().describe("The action as OLIS prints it."),
      }),
    )
    .describe(
      "The Measure's history as of the last full pull (see as_of), oldest action first as OLIS prints it, so the last entry is the latest action.",
    ),
  floor_votes: z
    .array(
      z.object({
        chamber: z.enum(["house", "senate"]).describe("The chamber that voted."),
        date: z.string().describe("When the chamber voted, in Pacific time with its UTC offset."),
        action: z.string().describe('The history action the vote was taken at, such as "Third reading.  Passed.".'),
        votes: z.array(legislatorVoteOutput).describe("Each Legislator's vote, in the feed's order."),
      }),
    )
    .describe(
      "The Measure's floor votes as of the last full pull (see as_of), in the order they were taken. A Legislator who changed Legislator Code during the Session is one Legislator in every vote.",
    ),
  committee_votes: z
    .array(
      z.object({
        committee_code: z.string().describe("The code of the committee that voted, such as SLB."),
        meeting_date: z.string().describe("When the committee met, in Pacific time with its UTC offset."),
        votes: z.array(legislatorVoteOutput).describe("Each member's vote, in the feed's order."),
      }),
    )
    .describe(
      "The Measure's committee votes as of the last full pull (see as_of), in the order the committees met. A roll that OLIS gives under two reports, as it does for a joint committee, is listed once; two different rolls of one committee at one meeting are two entries. OLIS creates these rows before the meeting is held, so a vote whose meeting_date is later than as_of can already list answers; the feed does not say whether that vote has been taken.",
    ),
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

export function getMeasure(
  reader: IndexReader,
  session: SessionKey,
  input: z.infer<typeof getMeasureInput>,
): GetMeasureResult {
  const key = parseMeasureReference(input.measure, session);
  const measure = key === undefined ? undefined : reader.findMeasure(key);
  if (measure === undefined) return { kind: "unknown", reference: input.measure, session };
  const asOf = reader.asOf(session);
  if (asOf === undefined) {
    throw new Error(`The index holds Measures of ${session} but no completed full pull to date them by`);
  }
  return {
    kind: "found",
    measure: {
      id: measureIdOf(measure),
      catchline: measure.catchline,
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
      history: reader.findHistory(measure).map((action) => ({
        chamber: action.chamber,
        date: action.date,
        text: action.text,
      })),
      floor_votes: reader.findFloorVotes(measure).map((vote) => ({
        chamber: vote.chamber,
        date: vote.date,
        action: vote.action,
        votes: vote.votes.map(legislatorVoteShown),
      })),
      committee_votes: reader.findCommitteeVotes(measure).map((vote) => ({
        committee_code: vote.committeeCode,
        meeting_date: vote.meetingDate,
        votes: vote.votes.map(legislatorVoteShown),
      })),
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
