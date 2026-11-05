// The arrangement of the seam-4 tests of the Listing (ticket #97, test/CLAUDE.md "Seam 4"): a WAL database in a temp
// directory of its own, the writer's, the reader's and search's entry points opened on it, and builders for what a
// complete Full pull records.
//
// Every value here is MADE UP. None comes from the feed or from the fixture: the Session `2099R1` does not exist,
// SB 9001 and the committee MADE are invented, and so are the texts, the people and the Agency.
import { createHash } from "node:crypto";
import { mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agendaIdOf,
  amendmentIdOf,
  analysisIdOf,
  committeeIdOf,
  exhibitIdOf,
  floorLetterIdOf,
  meetingIdOf,
  postingIdOf,
  recordingLogIdOf,
  testimonyIdOf,
  versionIdOf,
  type AgendaItem,
  type AmendmentId,
  type Committee,
  type CommitteeMember,
  type DocumentId,
  type DocumentLink,
  type Meeting,
  type StoredDocument,
} from "#/packages/domain/documents.ts";
import {
  measureIdOf,
  type HistoryAction,
  type Measure,
  type MeasureKey,
  type SessionKey,
} from "#/packages/domain/index.ts";
import type { LegislatorRow } from "#/packages/domain/legislators.ts";
import type { AgencyId, SnapshotVersion } from "#/packages/domain/oregonai.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import { openIndexReader, type IndexReader } from "../reader.ts";
import { openSearchReader, type SearchIndexReader } from "../search.ts";
import {
  openIndexWriter,
  type CommitteeVoteRecord,
  type FloorVoteRecord,
  type FullPullRecord,
  type IndexWriter,
  type SearchRecord,
  type SponsorRecord,
  type TestimonyRecord,
} from "../writer.ts";

/** MADE UP: a Session that does not exist. */
export const session = "2099R1" as SessionKey;

/** MADE UP: a Measure that does not exist. */
export const measureKey: MeasureKey = { session, prefix: "SB", number: 9001 };
export const measureId = measureIdOf(measureKey);

/** MADE UP: the id of the model the made-up vectors are under. */
export const modelId = "made-up-model";

/** MADE UP: an Agency's slug. */
export const agency = "bureau-of-made-up-things" as AgencyId;

/** MADE UP: the snapshot of the registry an Agency Link was read with. */
export const snapshot: SnapshotVersion = {
  source: "executive-regulatory-frameworks",
  commit: "0123456789abcdef0123456789abcdef01234567",
  commitDate: "2099-01-01T00:00:00-08:00" as Timestamp,
};

/** The made-up pulls' as-of times: pull `n` of a story starts at ten past two in the morning, Pacific, on day `n` of January 2099. */
export function asOf(n: number): Timestamp {
  return `2099-01-${String(n).padStart(2, "0")}T02:10:00-08:00` as Timestamp;
}

/** The index a test opens: the writer, the reader and search on one file, and a way to remove it. */
export type MadeUpIndex = {
  /** The database file, for `arranged-files.ts` to arrange what an entry point cannot. */
  path: string;
  writer: IndexWriter;
  reader: IndexReader;
  search: SearchIndexReader;
  /** Closes the three and removes the file. */
  close(): void;
};

/** Opens the writer first, which creates the schema, and then the two read-only sides. */
export function openMadeUpIndex(): MadeUpIndex {
  const directory = mkdtempDisposableSync(join(tmpdir(), "session-gateway-listing-"));
  const path = join(directory.path, "index.db");
  const writer = openIndexWriter(path);
  const reader = openIndexReader(path);
  const search = openSearchReader(path);
  return {
    path,
    writer,
    reader,
    search,
    close: () => {
      search.close();
      reader.close();
      writer.close();
      directory.remove();
    },
  };
}

/** A complete Full pull's record that reads nothing, with these parts: the rows of an entity set are named for it. */
export function pullOf(parts: Partial<FullPullRecord> = {}): FullPullRecord {
  return {
    Measures: [],
    Legislators: [],
    MeasureSponsors: [],
    MeasureHistoryActions: [],
    MeasureVotes: [],
    CommitteeVotes: [],
    Committees: [],
    CommitteeMeetings: [],
    CommitteeAgendaItems: [],
    MeasureDocuments: [],
    MeasureAnalysisDocuments: [],
    CommitteeMeetingDocuments: [],
    CommitteeProposedAmendments: [],
    CommitteePublicTestimonies: [],
    CommitteeMembers: [],
    ConveneTimes: [],
    LegislativeSessions: undefined,
    FloorLetters: [],
    legislators: [],
    legislatorCodes: [],
    ...parts,
  };
}

/** MADE UP: SB 9001's Measures row. */
export const measure: Measure = {
  ...measureKey,
  catchline: "Relating to made-up things",
  location: { current: "In Senate Committee", committeeCode: "MADE" },
  digest: "Creates a made-up thing.",
  createdAt: "2099-01-01T00:00:00-08:00" as Timestamp,
  modifiedAt: null,
};

/** MADE UP: a Legislators row, and SB 9001's Member sponsor, history action and votes by the Legislator Code it names. */
export const legislatorRow: LegislatorRow = { session, code: "Rep Upp", firstName: "Maude", lastName: "Upp" };

export const sponsor: SponsorRecord = {
  kind: "member",
  id: 5001,
  measure: measureKey,
  level: "chief",
  printOrder: 1,
  legislatorCode: legislatorRow.code,
  legislatorId: null,
};

export const historyAction: HistoryAction = {
  id: 6001,
  measure: measureKey,
  chamber: "senate",
  date: "2099-01-02T00:00:00-08:00" as Timestamp,
  text: "Introduction and first reading. Referred to President's desk.",
};

export const floorVote: FloorVoteRecord = {
  id: 7001,
  measure: measureKey,
  legislatorCode: legislatorRow.code,
  vote: "Aye",
  historyId: historyAction.id,
  chamber: "senate",
  date: "2099-01-03T00:00:00-08:00" as Timestamp,
  action: "Third reading. Passed.",
  legislatorId: null,
};

export const committeeVote: CommitteeVoteRecord = {
  id: 8001,
  measure: measureKey,
  legislatorCode: legislatorRow.code,
  vote: "Aye",
  reportId: 1,
  committeeCode: "MADE",
  meetingDate: "2099-01-10T08:00:00-08:00" as Timestamp,
  legislatorId: null,
};

/** MADE UP: a CommitteeMembers row of the committee MADE, kept by the whole row. */
export const committeeMember: CommitteeMember = {
  session,
  key: '[["CommitteeCode","MADE"],["LegislatorCode","Rep Upp"]]',
  committeeCode: "MADE",
  legislatorCode: legislatorRow.code,
  title: "Chair",
  createdAt: "2099-01-01T00:00:00-08:00" as Timestamp,
  modifiedAt: null,
};

/** MADE UP: SB 9001's Introduced Version, as the feed links it. */
export function versionLink(label = "Introduced"): DocumentLink & { id: DocumentId } {
  const id = versionIdOf(measureKey, label);
  return {
    id,
    nodeId: id,
    kind: "version",
    label,
    sourceUrl: `https://made-up.example/${id}.pdf`,
    postedAt: null,
    date: "2099-01-01T00:00:00-08:00" as Timestamp,
    relations: [{ relation: "measure", to: measureId, meaning: null, provenance: "MADE UP MeasureDocuments row" }],
  };
}

/** MADE UP: the committee MADE and the meeting it holds on day `day` of January 2099. */
export const committee: Committee = {
  session,
  code: "MADE",
  id: committeeIdOf(session, "MADE"),
  name: "Committee on Made-up Things",
};

export function meetingOn(day: number): Meeting {
  const at = `2099-01-${String(day).padStart(2, "0")}T08:00:00-08:00` as Timestamp;
  return {
    session,
    committeeCode: committee.code,
    id: meetingIdOf(session, committee.code, at),
    committeeId: committee.id,
    at,
    status: "Scheduled",
    agenda: null,
  };
}

/** MADE UP: SB 9001's analysis document, placed on its Introduced Version. */
export function analysisLink(): DocumentLink & { id: DocumentId } {
  const id = analysisIdOf(session, "1");
  return {
    id,
    nodeId: id,
    kind: "analysis",
    label: "Staff Measure Summary",
    sourceUrl: `https://made-up.example/${id}.pdf`,
    postedAt: null,
    date: "2099-01-01T00:00:00-08:00" as Timestamp,
    versionLabel: "Introduced",
    isMinority: false,
    relations: [
      { relation: "measure", to: measureId, meaning: null, provenance: "MADE UP MeasureAnalysisDocuments row" },
      { relation: "committee", to: committee.id, meaning: null, provenance: "MADE UP MeasureAnalysisDocuments row" },
    ],
  };
}

/** MADE UP: a document the meeting on day 10 lists (an Exhibit, a Recording Log, the agenda). */
function meetingDocumentLink(
  id: DocumentId,
  kind: "exhibit" | "recording_log" | "agenda",
  label: string,
): DocumentLink & { id: DocumentId } {
  const meeting = meetingOn(10);
  return {
    id,
    nodeId: id,
    kind,
    label,
    sourceUrl: `https://made-up.example/${id}.pdf`,
    postedAt: null,
    date: meeting.at,
    relations: [
      { relation: "meeting", to: meeting.id, meaning: null, provenance: "MADE UP CommitteeMeetingDocuments row" },
      { relation: "committee", to: committee.id, meaning: null, provenance: "MADE UP CommitteeMeetingDocuments row" },
    ],
  };
}

export function exhibitLink(): DocumentLink & { id: DocumentId } {
  return meetingDocumentLink(exhibitIdOf(session, 1), "exhibit", "Meeting Material");
}

export function recordingLogLink(): DocumentLink & { id: DocumentId } {
  return meetingDocumentLink(recordingLogIdOf(session, 2), "recording_log", "Recording Log");
}

export function agendaLink(): DocumentLink & { id: DocumentId } {
  const meeting = meetingOn(10);
  return meetingDocumentLink(agendaIdOf(session, committee.code, meeting.at), "agenda", "Agenda");
}

/** MADE UP: a Floor Letter that names SB 9001. */
export function floorLetterLink(): DocumentLink & { id: DocumentId } {
  const id = floorLetterIdOf(session, 1);
  const letterDate = "2099-01-05T00:00:00-08:00" as Timestamp;
  return {
    id,
    nodeId: id,
    kind: "floor_letter",
    label: "Letter",
    sourceUrl: `https://made-up.example/${id}.pdf`,
    postedAt: null,
    date: letterDate,
    floorLetter: {
      floorLetterId: 1,
      chamber: "senate",
      letterDate,
      title: "A made-up letter",
      description: null,
    },
    relations: [{ relation: "measure", to: measureId, meaning: null, provenance: "MADE UP FloorLetters row" }],
  };
}

/** MADE UP: the one agenda item of the meeting on day 10, about SB 9001. */
export const agendaItem: AgendaItem = {
  itemId: 7001,
  meetingId: meetingOn(10).id,
  measure: measureKey,
  meetingType: "Public Hearing",
  action: null,
  printOrder: "1",
  comments: null,
  boardName: null,
  executiveAppointee: null,
};

/** MADE UP: the Proposed Amendment SB 9001-1, and its posting number `postingNumber` to the meeting on day `day`. */
export const amendmentId: AmendmentId = amendmentIdOf(measureKey, "-1");

export function postingLink(postingNumber: number, day: number): DocumentLink & { id: DocumentId } {
  const id = postingIdOf(session, postingNumber);
  const meeting = meetingOn(day);
  return {
    id,
    nodeId: amendmentId,
    kind: "proposed_amendment",
    label: "-1",
    sourceUrl: `https://made-up.example/${id}.pdf`,
    postedAt: meeting.at,
    date: meeting.at,
    relations: [
      { relation: "measure", to: measureId, meaning: null, provenance: "MADE UP CommitteeProposedAmendments row" },
      {
        relation: "posted_to",
        to: meeting.id,
        meaning: "Proposed",
        provenance: "MADE UP CommitteeProposedAmendments row",
      },
      { relation: "amendment", to: amendmentId, meaning: null, provenance: "MADE UP CommitteeProposedAmendments row" },
    ],
  };
}

/** MADE UP: Testimony number `commTestId` on SB 9001, from a submitter that names the made-up Agency. */
export function testimonyRecord(commTestId: number): TestimonyRecord & { link: { id: DocumentId } } {
  const id = testimonyIdOf(session, commTestId);
  const meeting = meetingOn(10);
  return {
    link: {
      id,
      nodeId: id,
      kind: "testimony",
      label: "Testimony",
      sourceUrl: `https://made-up.example/${id}.pdf`,
      postedAt: null,
      date: meeting.at,
      testimony: {
        commTestId,
        position: { id: 3983, label: "support" },
        submitter: `Made Up Person ${commTestId}`,
        behalfOf: null,
        organization: "Bureau of Made-up Things",
        committeeCode: committee.code,
        meetingAt: meeting.at,
      },
      relations: [
        { relation: "measure", to: measureId, meaning: null, provenance: "MADE UP CommitteePublicTestimonies row" },
        {
          relation: "committee",
          to: committee.id,
          meaning: null,
          provenance: "MADE UP CommitteePublicTestimonies row",
        },
      ],
    },
    agency: { kind: "matched", agencyId: agency },
  };
}

/** MADE UP: the text a made-up document has, and what search keeps of it: one passage that is the whole text. */
export function searchRecordOf(link: DocumentLink, text: string, keywordOnly = false): SearchRecord {
  const hash = createHash("sha256").update(text).digest("hex");
  return {
    entry: {
      nodeId: link.nodeId,
      kind: link.kind,
      title: link.label,
      measureId,
      committeeId: null,
      date: link.date,
      keywordOnly,
    },
    passages: [{ start: 0, end: text.length, text, hash }],
    citations: [],
    // One made-up vector of 384 int8 values, the length of the real model's.
    vectors: { modelId, rows: [{ hash, vector: new Int8Array(384).fill(1) }] },
  };
}

/** MADE UP: a stored document of this link, with this text. */
export function storedOf(link: DocumentLink, text: string): StoredDocument {
  return {
    ...link,
    retrievedAt: "2099-01-01T01:00:00-08:00" as Timestamp,
    contentHash: createHash("sha256").update(`file ${link.id}`).digest("hex"),
    textHash: createHash("sha256").update(text).digest("hex"),
    pageCount: 1,
    hasTextLayer: true,
    text,
  };
}

/** Stores a made-up document the way the worker does, searchable by its words. */
export function storeMadeUpDocument(index: MadeUpIndex, link: DocumentLink, text: string): void {
  index.writer.storeDocument(session, storedOf(link, text), searchRecordOf(link, text));
}
