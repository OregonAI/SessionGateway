// compare_amendment (ticket #13, spec #1 case (b)): a Proposed Amendment against the Version it amends.
import { z } from "zod";
import type { IndexReader } from "#/packages/database/reader.ts";
import { parseAmendmentReference } from "#/packages/domain/documents.ts";
import { parseMeasureReference, type MeasureKey, type SessionKey } from "#/packages/domain/index.ts";
import type { StoredAmendment, StoredVersion } from "#/packages/domain/statute-links.ts";
import type { Outcome } from "./outcome.ts";
import {
  amendedVersionOutput,
  fileOutput,
  fileShown,
  maybeParseResultFields,
  noLinks,
  parseResultShown,
  placeStoredAmendment,
  postingOutput,
  postingShown,
  relatingClauseEditOutput,
  relatingClauseEditShown,
} from "./statute-links.ts";

/** The one sentence that says what the comparison does not cover (ADR-0001). Every result carries it. */
export const DELETIONS_NOT_EVALUATED_NOTE =
  "What this amendment deletes from the Version it amends was not evaluated: only the Statute Links in the sections the amendment inserts and its edits to the relating clause are read, so a link of the Version that the amendment does not mention is not shown as removed.";

export const compareAmendmentInput = z.object({
  amendment: z
    .string()
    .describe(
      'A Proposed Amendment\'s citation, such as "SB 69-2" or "HB 3795-A3", or its id, such as "amendment-2025r1-sb69-2".',
    ),
});

const comparedVersionOutput = amendedVersionOutput.extend(maybeParseResultFields);

const comparedFileOutput = fileOutput.extend({
  relating_clause_edits: z
    .array(relatingClauseEditOutput)
    .describe(
      "The amendment's edits to the Measure's relating clause (the words after \"Relating to\"), as the amendment states them, not the clause after the edit.",
    ),
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
  amended_version: comparedVersionOutput.describe(
    "The Version the amendment amends, read from the amendment's own header and checked against the letter in its number.",
  ),
  files: z
    .array(comparedFileOutput)
    .describe("The distinct files posted for the amendment that this index holds, each with what was read of it."),
  deletions_note: z.string().describe("What this comparison does not cover: what the amendment deletes."),
});

export type CompareAmendmentOutput = z.infer<typeof compareAmendmentOutput>;

/** An unknown amendment is an expected outcome, so it is a value; the envelope tells the agent it is a tool error. */
export type CompareAmendmentFault = { kind: "unknown"; reference: string; session: SessionKey };

export type CompareAmendmentOutcome = Outcome<CompareAmendmentOutput, CompareAmendmentFault>;

function amendmentShown(amendment: StoredAmendment): CompareAmendmentOutput["amendment"] {
  return {
    id: amendment.id,
    number: amendment.number,
    measure_id: amendment.measureId,
    postings: amendment.postings.map(postingShown),
  };
}

/** The Version the amendment amends, with its links beside the amendment's. */
function comparedVersionShown(
  amendment: StoredAmendment,
  key: MeasureKey,
  versions: readonly StoredVersion[],
): CompareAmendmentOutput["amended_version"] {
  const { version, shown } = placeStoredAmendment(amendment, key, versions);
  // A Version that is not known has nothing read: there is no comparison.
  if (version === undefined) return { ...shown, text_read: null, not_read_reason: null, statute_links: noLinks };
  return { ...shown, ...parseResultShown(version.parse) };
}

export function compareAmendment(
  reader: IndexReader,
  session: SessionKey,
  input: z.infer<typeof compareAmendmentInput>,
): CompareAmendmentOutcome {
  const id = parseAmendmentReference(input.amendment, session);
  const amendment = id === undefined ? undefined : reader.findAmendment(id);
  if (amendment === undefined) {
    return { kind: "fault", fault: { kind: "unknown", reference: input.amendment, session } };
  }
  const measure = parseMeasureReference(amendment.measureId, session);
  if (measure === undefined) {
    throw new Error(`The amendment ${amendment.id} is of ${amendment.measureId}, which is no Measure id of ${session}`);
  }
  return {
    kind: "answer",
    answer: {
      amendment: amendmentShown(amendment),
      amended_version: comparedVersionShown(amendment, measure, reader.findMeasureVersions(measure)),
      files: amendment.files.map((file) => ({
        ...fileShown(file),
        relating_clause_edits: file.parse.relatingClauseEdits.map(relatingClauseEditShown),
      })),
      deletions_note: DELETIONS_NOT_EVALUATED_NOTE,
    },
  };
}

/** What an agent is told when no Proposed Amendment matches, so it can correct the call. */
export function compareAmendmentFaultMessage(fault: CompareAmendmentFault): string {
  const lower = fault.session.toLowerCase();
  return `No Proposed Amendment "${fault.reference}" in the ${fault.session} Session. Give an amendment's citation such as SB 69-2 or HB 3795-A3, or its id such as amendment-${lower}-sb69-2.`;
}
