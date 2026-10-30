// What the sponsor tests share (seam 1): the feed's MeasureSponsors and Legislators rows in their own
// shape, which a test adds to what the fake OLIS serves, and the shape of a sponsor in get_measure's
// result. A change to either shape is made here.
import type { ToolOutcome } from "./mcp-clients.ts";

/** A row of the feed, as `FakeOlisOptions.strayRows` takes it. */
export type FeedRow = Record<string, unknown>;

type MemberSponsorRowOptions = {
  /** The Measure the row is for. SB 69 is the default: the fixture holds it, and it has no Member sponsor of its own. */
  measure?: { prefix: string; number: number };
  session?: string;
  /** When the feed created the row. The fake OLIS hides a row created after its clock. */
  createdDate?: string;
};

/** A Member row of MeasureSponsors in the feed's own shape. */
export function memberSponsorRow(
  id: string,
  code: string,
  level: "Chief" | "Regular",
  printOrder: string,
  options: MemberSponsorRowOptions = {},
): FeedRow {
  return {
    MeasureSponsorId: id,
    SessionKey: options.session ?? "2025R1",
    MeasurePrefix: options.measure?.prefix ?? "SB",
    MeasureNumber: options.measure?.number ?? 69,
    SponsorType: "Member",
    LegislatoreCode: code,
    CommitteeCode: null,
    SponsorLevel: level,
    PrintOrder: printOrder,
    PresessionFiledMessage: null,
    CreatedDate: options.createdDate ?? "2024-12-30T16:16:37",
    ModifiedDate: null,
  };
}

/** A Legislators row in the feed's own shape. */
export function legislatorRow(session: string, code: string, firstName: string, lastName: string): FeedRow {
  return {
    SessionKey: session,
    LegislatorCode: code,
    FirstName: firstName,
    LastName: lastName,
    Title: "Representative",
    Chamber: "H",
    CreatedDate: "2024-11-06T11:52:47",
    ModifiedDate: null,
  };
}

/** One entry of get_measure's `sponsors`, as an agent reads it. */
export type ToolSponsor = {
  level: string;
  legislator_code: string;
  legislator: { id: string; name: string } | null;
};

/** The `sponsors` of a get_measure outcome, or undefined when the call gave none. */
export function sponsorsOf(outcome: Pick<ToolOutcome, "structured"> | undefined): ToolSponsor[] | undefined {
  return outcome?.structured?.["sponsors"] as ToolSponsor[] | undefined;
}
