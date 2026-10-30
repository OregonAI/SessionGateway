// compare_amendment (ticket #13, spec #1 case (b)): a Proposed Amendment against the Version it amends.
import { z } from "zod";
import type { IndexReader } from "#/packages/database/reader.ts";
import { parseAmendmentReference, placeAmendment } from "#/packages/domain/documents.ts";
import { parseMeasureReference, type MeasureKey, type SessionKey } from "#/packages/domain/index.ts";
import type { StoredAmendment, StoredVersion } from "#/packages/domain/statute-links.ts";
import { NON_OFFICIAL_NOTICE } from "./get-measure.ts";

export const compareAmendmentInput = z.object({
  amendment: z
    .string()
    .describe(
      'A Proposed Amendment\'s citation, such as "SB 69-2" or "HB 3795-A3", or its id, such as "amendment-2025r1-sb69-2".',
    ),
});

const postingOutput = z.object({
  id: z.string().describe("The posting's id, which get_document resolves to the file posted to that meeting."),
  source_url: z.string().describe("Where the Legislature publishes the file posted to that meeting."),
  meeting_id: z.string().describe("The id of the meeting the amendment was posted to."),
  meeting_date: z.string().describe("When that meeting starts, in Pacific time with its UTC offset."),
  committee_code: z.string().describe("The code of the committee that met, such as SLB."),
  committee_name: z.string().describe("The committee's name, such as Labor and Business."),
  meaning: z
    .string()
    .nullable()
    .describe(
      "What the committee did with the amendment at that meeting, as the Legislature words it: Proposed, Adopted...",
    ),
  fetched: z
    .boolean()
    .describe(
      "True when this index holds the posted file, so that get_document can read it. The Legislature lists the posting either way.",
    ),
});

const amendedVersionOutput = z.object({
  known: z
    .boolean()
    .describe(
      "True when the Version the amendment amends is known: its header and its number name the same Version, and this index holds it. Nothing is guessed.",
    ),
  id: z
    .string()
    .nullable()
    .describe("The Version's id, which get_document resolves. Null when the Version is not known."),
  label: z
    .string()
    .nullable()
    .describe('The Version, such as "Introduced" or "A-Engrossed". Null when it is not known.'),
  source_url: z.string().nullable().describe("Where the Legislature publishes the Version. Null when it is not known."),
  reason: z.string().describe("How the Version was read, or why it is not known."),
});

export const compareAmendmentOutput = z.object({
  amendment: z
    .object({
      id: z
        .string()
        .describe(
          "The amendment's id: one for the Measure and the amendment number, however many meetings it was posted to.",
        ),
      number: z.string().describe('The amendment\'s number as the Legislature writes it, such as "-2" or "-A3".'),
      measure_id: z.string().describe("The id of the Measure the amendment is to, in OregonAI's form."),
      postings: z
        .array(postingOutput)
        .describe("Each time the amendment was posted to a committee meeting, earliest meeting first."),
    })
    .describe("The Proposed Amendment."),
  amended_version: amendedVersionOutput.describe(
    "The Version the amendment amends, read from the amendment's own header and checked against the letter in its number.",
  ),
  as_of: z.string().describe("When the index was last refreshed, in Pacific time with its UTC offset."),
  notice: z.string().describe("A reminder that this is not the official record."),
});

export type CompareAmendmentOutput = z.infer<typeof compareAmendmentOutput>;

/** An unknown amendment is an expected outcome, so it is a value; the MCP edge decides it is a tool error. */
export type CompareAmendmentResult =
  { kind: "found"; comparison: CompareAmendmentOutput } | { kind: "unknown"; reference: string; session: SessionKey };

function amendmentShown(amendment: StoredAmendment): CompareAmendmentOutput["amendment"] {
  return {
    id: amendment.id,
    number: amendment.number,
    measure_id: amendment.measureId,
    postings: amendment.postings.map((posting) => ({
      id: posting.documentId,
      source_url: posting.sourceUrl,
      meeting_id: posting.meetingId,
      meeting_date: posting.meetingAt,
      committee_code: posting.committeeCode,
      committee_name: posting.committeeName,
      meaning: posting.meaning,
      fetched: posting.fetched,
    })),
  };
}

/** Which Version the amendment amends, from its files' headers, its number and the Versions the store holds. */
function amendedVersionShown(
  amendment: StoredAmendment,
  key: MeasureKey,
  versions: readonly StoredVersion[],
): CompareAmendmentOutput["amended_version"] {
  const placement = placeAmendment(
    key,
    amendment.number,
    amendment.files.map((file) => file.parse.amendedVersionHeader),
    (versionId) => versions.some((version) => version.id === versionId),
  );
  switch (placement.kind) {
    case "version": {
      const version = versions.find((held) => held.id === placement.versionId);
      if (version === undefined) throw new Error(`The Version ${placement.versionId} was placed but is not held`);
      return {
        known: true,
        id: version.id,
        label: version.label,
        source_url: version.sourceUrl,
        reason: placement.reason,
      };
    }
    case "unknown":
      return { known: false, id: null, label: null, source_url: null, reason: placement.reason };
    default:
      return placement satisfies never;
  }
}

export function compareAmendment(
  reader: IndexReader,
  session: SessionKey,
  input: z.infer<typeof compareAmendmentInput>,
): CompareAmendmentResult {
  const id = parseAmendmentReference(input.amendment, session);
  const amendment = id === undefined ? undefined : reader.findAmendment(id);
  if (amendment === undefined) return { kind: "unknown", reference: input.amendment, session };
  const asOf = reader.asOf(session);
  if (asOf === undefined) {
    throw new Error(`The index holds Proposed Amendments of ${session} but no completed full pull to date them by`);
  }
  const measure = parseMeasureReference(amendment.measureId, session);
  if (measure === undefined) {
    throw new Error(`The amendment ${amendment.id} is of ${amendment.measureId}, which is no Measure id of ${session}`);
  }
  return {
    kind: "found",
    comparison: {
      amendment: amendmentShown(amendment),
      amended_version: amendedVersionShown(amendment, measure, reader.findMeasureVersions(measure)),
      as_of: asOf,
      notice: NON_OFFICIAL_NOTICE,
    },
  };
}

/** What an agent is told when no Proposed Amendment matches, so it can correct the call. */
export function unknownAmendmentMessage(reference: string, session: SessionKey): string {
  const lower = session.toLowerCase();
  return `No Proposed Amendment "${reference}" in the ${session} Session. Give an amendment's citation such as SB 69-2 or HB 3795-A3, or its id such as amendment-${lower}-sb69-2.`;
}
