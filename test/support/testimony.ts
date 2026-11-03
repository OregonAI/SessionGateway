// Made-up CommitteePublicTestimonies rows for the seam-1 tests of `testimony` that need a Measure with more
// rows, or other values, than the committed fixture has. A test that uses one says in its comment that the row
// is made up. A row is shaped like the fixture's (feed/CommitteePublicTestimonies.json, SB 983's CommTestId
// 212098), and is filed under SB 983 and HRULES's meeting of 2025-06-05 unless a test says otherwise.
type Row = Record<string, unknown>;

export type MadeUpTestimony = {
  commTestId: number;
  /** The feed's PositionOnMeasureId. 3983 (support) unless given. */
  positionId?: number;
  firstName?: string;
  lastName?: string;
  behalfOf?: string | null;
  organization?: string | null;
  documentDescription?: string;
  measure?: { prefix: string; number: number };
};

export function madeUpTestimonyRow(testimony: MadeUpTestimony): Row {
  const measure = testimony.measure ?? { prefix: "SB", number: 983 };
  return {
    CommTestId: testimony.commTestId,
    SubmitterFirstName: testimony.firstName ?? "Made",
    SubmitterLastName: testimony.lastName ?? `Up ${testimony.commTestId}`,
    BehalfOf: testimony.behalfOf ?? null,
    Organization: testimony.organization === undefined ? "Made Up Town" : testimony.organization,
    DocumentDescription: testimony.documentDescription ?? "Testimony",
    CreatedDate: "2025-06-05T17:31:25.087",
    ModifiedDate: "2025-06-05T17:31:25.087",
    PdfCreatedFlag: "Y",
    PositionOnMeasureId: testimony.positionId ?? 3983,
    SessionKey: "2025R1",
    CommitteeCode: "HRULES",
    MeetingDate: "2025-06-05T08:00:00",
    MeasurePrefix: measure.prefix,
    MeasureNumber: measure.number,
    DocumentUrl: "https://olis.oregonlegislature.gov/liz/2025R1",
    FirstName: null,
    LastName: null,
    ExecApptId: null,
    Topic: null,
  };
}

/** Where the fake OLIS serves the file of a Testimony row, as the worker asks for it. */
export function testimonyDownloadPath(commTestId: number): string {
  return `/liz/2025R1/Downloads/PublicTestimonyDocument/${commTestId}`;
}

/**
 * A made-up Testimony row for HB 3131 that the feed does not list, for the tests of the worker's schedule and of its
 * stop (ingest-schedule.test.ts, entry-scripts.test.ts): the test serves a file for it at `testimonyDownloadPath`.
 */
export function madeUpHb3131TestimonyRow(commTestId: number, createdDate: string): Row {
  return {
    SessionKey: "2025R1",
    CommTestId: commTestId,
    SubmitterFirstName: "Made",
    SubmitterLastName: `Up ${commTestId}`,
    PositionOnMeasureId: 3983,
    CommitteeCode: "HALNRW",
    MeetingDate: "2025-01-22T08:00:00",
    DocumentDescription: "Testimony",
    MeasurePrefix: "HB",
    MeasureNumber: 3131,
    DocumentUrl: "https://olis.oregonlegislature.gov/liz/2025R1",
    CreatedDate: createdDate,
    ModifiedDate: null,
  };
}
