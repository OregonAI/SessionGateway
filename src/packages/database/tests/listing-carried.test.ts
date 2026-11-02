// Seam 4 (test/CLAUDE.md): everything the reader hands out carries its Listing (ticket #97): every row, Document,
// amendment and Agency Link, so that a tool never has to remember to ask. One table of the kinds of thing the reader
// hands out, each with the complete pull that lists it and the reader's entry point that returns it; the same three
// stories are told of each: listed by pull 1 and missed by pull 2 (still listed), missed by pull 3 as well (No longer
// listed, last listed by pull 1), and stored by an Increment that no complete pull has listed (listed, no last listing).
// Each case has a database of its own. Every value is MADE UP (made-up-index.ts).
import { afterEach, describe, expect, it } from "vitest";
import type { Listing } from "#/packages/domain/documents.ts";
import type { FullPullRecord } from "../writer.ts";
import type { IndexReader } from "../reader.ts";
import {
  agendaItem,
  agendaLink,
  amendmentId,
  analysisLink,
  asOf,
  committee,
  exhibitLink,
  floorLetterLink,
  measure,
  measureKey,
  meetingOn,
  openMadeUpIndex,
  postingLink,
  pullOf,
  recordingLogLink,
  session,
  storeMadeUpDocument,
  testimonyRecord,
  versionLink,
  type MadeUpIndex,
} from "./made-up-index.ts";

let index: MadeUpIndex;
afterEach(() => {
  index.close();
});

const version = versionLink();
const analysis = analysisLink();
const testimony = testimonyRecord(1);
const posting = postingLink(1, 10);
const meeting = meetingOn(10);
const context = { Committees: [committee], CommitteeMeetings: [meeting] };

/** A kind of thing the reader hands out: the pull that lists it, the files its read needs, and the read. */
type Handout = {
  name: string;
  pull: FullPullRecord;
  /** Files the index must hold for the reader to hand the thing out. */
  files?: { link: typeof version; text: string }[];
  read: (reader: IndexReader) => Listing | undefined;
};

const handouts: Handout[] = [
  {
    name: "a Measure",
    pull: pullOf({ Measures: [measure] }),
    read: (reader) => reader.findMeasure(measureKey)?.listing,
  },
  {
    name: "a Document",
    pull: pullOf({ MeasureDocuments: [version] }),
    files: [{ link: version, text: "A made-up Version." }],
    read: (reader) => reader.findDocument(version.id)?.listing,
  },
  {
    name: "a Version of a Measure",
    pull: pullOf({ MeasureDocuments: [version] }),
    files: [{ link: version, text: "A made-up Version." }],
    read: (reader) => reader.findMeasureVersions(measureKey)[0]?.listing,
  },
  {
    name: "an analysis document",
    pull: pullOf({ ...context, MeasureAnalysisDocuments: [analysis] }),
    files: [{ link: analysis, text: "A made-up analysis." }],
    read: (reader) => reader.analysisDocuments(measureKey)[0]?.listing,
  },
  {
    name: "a Testimony row",
    pull: pullOf({ ...context, CommitteePublicTestimonies: [testimony] }),
    read: (reader) => reader.findTestimony(measureKey)[0]?.listing,
  },
  {
    name: "a Floor Letter",
    pull: pullOf({ FloorLetters: [floorLetterLink()] }),
    read: (reader) => reader.findFloorLetters(measureKey)[0]?.listing,
  },
  {
    name: "a meeting",
    pull: pullOf(context),
    read: (reader) => reader.findMeetings(session, {})[0]?.listing,
  },
  {
    name: "an agenda item",
    pull: pullOf({ ...context, CommitteeAgendaItems: [agendaItem] }),
    read: (reader) => reader.meetingContents(meeting.id).agendaItems[0]?.listing,
  },
  {
    name: "a meeting's agenda",
    pull: pullOf({ ...context, CommitteeMeetings: [{ ...meeting, agenda: agendaLink() }] }),
    read: (reader) => reader.meetingContents(meeting.id).agenda?.listing,
  },
  {
    name: "an Exhibit",
    pull: pullOf({ ...context, CommitteeMeetingDocuments: [exhibitLink()] }),
    read: (reader) => reader.meetingContents(meeting.id).exhibits[0]?.listing,
  },
  {
    name: "a Recording Log",
    pull: pullOf({ ...context, CommitteeMeetingDocuments: [recordingLogLink()] }),
    read: (reader) => reader.meetingContents(meeting.id).recordingLogs[0]?.listing,
  },
  {
    name: "a Posting as a meeting lists it",
    pull: pullOf({ ...context, CommitteeProposedAmendments: [posting] }),
    read: (reader) => reader.meetingContents(meeting.id).amendments[0]?.listing,
  },
  {
    name: "a Posting as its Proposed Amendment lists it",
    pull: pullOf({ ...context, CommitteeProposedAmendments: [posting] }),
    read: (reader) => reader.findAmendment(amendmentId)?.postings[0]?.listing,
  },
  {
    name: "a Proposed Amendment",
    pull: pullOf({ ...context, CommitteeProposedAmendments: [posting] }),
    read: (reader) => reader.findAmendment(amendmentId)?.listing,
  },
  {
    name: "a Proposed Amendment of a Measure",
    pull: pullOf({ ...context, CommitteeProposedAmendments: [posting] }),
    read: (reader) => reader.findMeasureAmendments(measureKey)[0]?.listing,
  },
];

function storeFiles(handout: Handout): void {
  for (const file of handout.files ?? []) storeMadeUpDocument(index, file.link, file.text);
}

describe.each(handouts)("$name", (handout) => {
  it("carries its Listing: listed after one miss, No longer listed after two, with pull 1's As of as its last listing", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), handout.pull);
    storeFiles(handout);
    expect(handout.read(index.reader)).toEqual({ listed: true, lastListedAt: asOf(1) });

    index.writer.recordFullPull(session, asOf(2), pullOf());
    expect(handout.read(index.reader)).toEqual({ listed: true, lastListedAt: asOf(1) });

    index.writer.recordFullPull(session, asOf(3), pullOf());
    expect(handout.read(index.reader)).toEqual({ listed: false, lastListedAt: asOf(1) });
  });

  it("is listed with no last listing when an Increment stored it and no complete pull has listed it", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullOf());
    index.writer.recordIncrement(session, asOf(2), handout.pull);
    storeFiles(handout);
    expect(handout.read(index.reader)).toEqual({ listed: true, lastListedAt: null });
  });
});
