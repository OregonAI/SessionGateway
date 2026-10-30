import type { IndexReader } from "#/packages/database/reader.ts";
import type { Committee } from "#/packages/domain/documents.ts";
import { parseMeasureReference, type MeasureKey, type SessionKey } from "#/packages/domain/index.ts";
import { unknownMeasureMessage } from "./get-measure.ts";

/**
 * The arguments `meetings` and `search` both narrow by: a Measure (its id or its citation), a committee (its code or
 * its id) and a range of Pacific dates. One place reads them, so the two tools never disagree about what a reference
 * names or what is an error.
 */
export type FilterArguments = {
  measure?: string | undefined;
  committee?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
};

/** Why the arguments cannot be met. These are expected outcomes, so they are values; the MCP edge decides they are tool errors. */
export type FilterFault =
  | { kind: "unknown_measure"; reference: string; session: SessionKey }
  | { kind: "unknown_committee"; reference: string; session: SessionKey }
  | { kind: "backwards_range"; from: string; to: string };

/** The Measure and the committee the arguments name, when they name any and the index holds them. */
export type CheckedFilters = { kind: "ok"; measure?: MeasureKey; committee?: Committee };

/** Checks the arguments against the index: a range that runs backwards first, then the Measure, then the committee. */
export function checkFilters(
  reader: IndexReader,
  session: SessionKey,
  input: FilterArguments,
): CheckedFilters | FilterFault {
  if (input.from !== undefined && input.to !== undefined && input.from > input.to) {
    return { kind: "backwards_range", from: input.from, to: input.to };
  }
  const measure = input.measure === undefined ? undefined : parseMeasureReference(input.measure, session);
  if (input.measure !== undefined && (measure === undefined || reader.findMeasure(measure) === undefined)) {
    return { kind: "unknown_measure", reference: input.measure, session };
  }
  const committee = input.committee === undefined ? undefined : reader.findCommittee(session, input.committee);
  if (input.committee !== undefined && committee === undefined) {
    return { kind: "unknown_committee", reference: input.committee, session };
  }
  return {
    kind: "ok",
    ...(measure === undefined ? {} : { measure }),
    ...(committee === undefined ? {} : { committee }),
  };
}

/** What an agent is told when no committee matches, so it can correct the call. */
function unknownCommitteeMessage(reference: string, session: SessionKey): string {
  return `No committee "${reference}" in the ${session} Session. Give a committee code such as SLB or a committee id such as committee-${session.toLowerCase()}-slb.`;
}

/** What an agent is told when a date range ends before it starts. */
function backwardsRangeMessage(from: string, to: string): string {
  return `The date range runs backwards: from ${from} is after to ${to}. Give a from that is on or before to.`;
}

/** What an agent is told when the arguments cannot be met. */
export function filterFaultMessage(fault: FilterFault): string {
  switch (fault.kind) {
    case "unknown_measure":
      return unknownMeasureMessage(fault.reference, fault.session);
    case "unknown_committee":
      return unknownCommitteeMessage(fault.reference, fault.session);
    case "backwards_range":
      return backwardsRangeMessage(fault.from, fault.to);
    default:
      return fault satisfies never;
  }
}
