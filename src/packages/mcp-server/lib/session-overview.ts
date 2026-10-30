import { z } from "zod";
import type { IndexReader } from "#/packages/database/reader.ts";
import type { SessionKey } from "#/packages/domain/index.ts";
import { NON_OFFICIAL_NOTICE } from "./get-measure.ts";

export const sessionOverviewInput = z.object({});

export const sessionOverviewOutput = z.object({
  session: z.string().describe("The Session this service holds, as OLIS keys it, such as 2025R1."),
  counts: z
    .object({
      measures: z.number().describe("Measures in the Session."),
      committees: z.number().describe("Committees."),
      meetings: z.number().describe("Committee meetings."),
      proposed_amendments: z
        .number()
        .describe(
          "Proposed Amendments, one for each Measure and amendment number however many meetings it was posted to.",
        ),
      documents: z.number().describe("Documents held with their text. A Proposed Amendment has one for each posting."),
      documents_without_text_layer: z
        .number()
        .describe("Documents that are scans or photographs and so have no text to read."),
      documents_by_kind: z
        .object({
          version: z.number(),
          printed_amendment: z.number(),
          proposed_amendment: z.number(),
          analysis: z.number(),
          exhibit: z.number(),
          recording_log: z.number(),
          testimony: z.number(),
          agenda: z.number(),
        })
        .describe("The documents by what they are."),
    })
    .describe("What the index holds."),
  as_of: z.string().describe("When the index was last refreshed, in Pacific time with its UTC offset."),
  snapshot: z
    .object({
      source: z.string().describe("The OregonAI corpus the data was copied from: executive-regulatory-frameworks."),
      commit: z.string().describe("The commit of that corpus's repository the data was copied from."),
      commit_date: z.string().describe("When that commit was made, in Pacific time with its UTC offset."),
    })
    .describe(
      "The OregonAI data this index was built with: the agency registry, the ORS section ids and the table of which Agencies' rules implement each ORS chapter. It was copied at build time and is not looked up again while serving.",
    ),
  notice: z.string().describe("A reminder that this is not the official record."),
});

export type SessionOverviewOutput = z.infer<typeof sessionOverviewOutput>;

export function sessionOverview(reader: IndexReader, session: SessionKey): SessionOverviewOutput {
  const asOf = reader.asOf(session);
  if (asOf === undefined) throw new Error(`The index holds no completed full pull of ${session} to date it by`);
  const snapshot = reader.snapshotVersion(session);
  if (snapshot === undefined) throw new Error(`The index records no OregonAI snapshot for ${session}`);
  const counts = reader.counts(session);
  return {
    session,
    counts: {
      measures: counts.measures,
      committees: counts.committees,
      meetings: counts.meetings,
      proposed_amendments: counts.proposedAmendments,
      documents: counts.documents,
      documents_without_text_layer: counts.documentsWithoutTextLayer,
      documents_by_kind: counts.documentsByKind,
    },
    as_of: asOf,
    snapshot: { source: snapshot.source, commit: snapshot.commit, commit_date: snapshot.commitDate },
    notice: NON_OFFICIAL_NOTICE,
  };
}
