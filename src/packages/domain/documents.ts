// Documents, committees and meetings as the Session graph holds them, and the one place that mints
// their ids (src/CLAUDE.md, "Shape"). The forms are spec #1's (Implementation Decisions, "Session graph")
// and follow ADR-0004's `{kind}-{session}-{key}` shape for what only SessionGateway holds.

import type { MeasureId, MeasureKey, SessionKey } from "./index.ts";
import type { AgencyId } from "./oregonai.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

/** What a document is, in the glossary's words. */
export const documentKinds = [
  "version",
  "printed_amendment",
  "proposed_amendment",
  "analysis",
  "exhibit",
  "recording_log",
  "testimony",
  "agenda",
] as const;
export type DocumentKind = (typeof documentKinds)[number];

/** The kinds of document a meeting lists: its agenda, Exhibits, Recording Logs and the postings of Proposed Amendments. */
export const meetingDocumentKinds = [
  "agenda",
  "exhibit",
  "recording_log",
  "proposed_amendment",
] as const satisfies readonly DocumentKind[];

/**
 * How a document points at a node: the Measure, committee or meeting it belongs to, the Version an
 * analysis is of or a Printed Amendment amends, the meeting a posting was posted to, the amendment a
 * posting is of.
 */
export const relations = ["measure", "committee", "meeting", "version", "posted_to", "amendment"] as const;
export type Relation = (typeof relations)[number];

/** The id of a document the store holds: what `get_document` takes. */
export type DocumentId = string & { readonly brand: "DocumentId" };
/** The id of a Proposed Amendment: one node per Measure and amendment number, whatever its postings. */
export type AmendmentId = string & { readonly brand: "AmendmentId" };
export type CommitteeId = string & { readonly brand: "CommitteeId" };
export type MeetingId = string & { readonly brand: "MeetingId" };

/** A node a document can point at. A Version is a document, so its id is a DocumentId. */
export type NodeId = MeasureId | AmendmentId | CommitteeId | MeetingId | DocumentId;

/** Lower case, with every run of other characters as one hyphen: "A-Engrossed" is "a-engrossed". */
function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function measureSlug(key: MeasureKey): string {
  return `${key.session.toLowerCase()}-${key.prefix.toLowerCase()}${key.number}`;
}

/**
 * Printed Amendments are the texts of amendments a chamber adopted ("House Amendments to
 * Introduced"); every other MeasureDocuments description names a Version.
 */
export function isPrintedAmendment(versionDescription: string): boolean {
  return /\bamendments\b/i.test(versionDescription);
}

/**
 * The description of the Version a Printed Amendment amends, which its own description names:
 * "Senate Amendments to A-Engrossed" amends "A-Engrossed". Undefined when the description names none.
 */
export function amendedVersionDescriptionOf(printedAmendmentDescription: string): string | undefined {
  const named = /\bamendments\s+to\s+(.+)$/i.exec(printedAmendmentDescription.trim())?.[1]?.trim();
  return named === undefined || named === "" ? undefined : named;
}

/**
 * The description the feed gives a Version, from the letter an amendment number or a header names it by: no
 * letter is the Introduced Version, "A" the "A-Engrossed" one. The one place a Version's description is
 * minted from a letter; `versionRankOf` reads one back.
 */
export function versionDescriptionOfLetter(letter: string | null): string {
  return letter === null ? "Introduced" : `${letter.toUpperCase()}-Engrossed`;
}

/**
 * Where a Version sits in the order Versions are printed in: Introduced first, then A-Engrossed, B-Engrossed and
 * so on by letter, then Enrolled. Undefined for a description that sits nowhere in that chain ("Minority Report
 * A-Engrossed"): nothing is guessed about where it falls (ADR-0013's rule).
 */
export function versionRankOf(description: string): number | undefined {
  if (description === "Introduced") return 0;
  if (description === "Enrolled") return 27;
  const letter = /^([A-Z])-Engrossed$/.exec(description)?.[1];
  return letter === undefined ? undefined : letter.charCodeAt(0) - 64;
}

/** The id of a Version (`version-2025r1-sb69-a-engrossed`) or of a Printed Amendment, by the feed's description. */
export function versionIdOf(key: MeasureKey, versionDescription: string): DocumentId {
  const kind = isPrintedAmendment(versionDescription) ? "printed-amendment" : "version";
  return `${kind}-${measureSlug(key)}-${slug(versionDescription)}` as DocumentId;
}

/** An amendment number read: the letter of the Version it names (null for Introduced) and its digits. */
export type AmendmentNumber = { letter: string | null; digits: string };

const amendmentNumberPattern = /^(?:-\s*)?([A-Za-z])?(\d+)$/;

/**
 * Reads an amendment number as the feed spells it: a number with an optional Version letter, with or without the
 * hyphen before it ("-2", "2", "- 2", "-A3", "A3"; 2025R1's feed writes all of these, some of them for one
 * amendment). Undefined for any other spelling, such as a minority report's "-AMR10". This is the one place an
 * amendment number is parsed: the id (`amendmentIdOf`) and the Version it names (`versionDescriptionOfLetter`)
 * both come from it.
 */
export function parseAmendmentNumber(spelling: string): AmendmentNumber | undefined {
  const parts = amendmentNumberPattern.exec(spelling.trim());
  if (parts?.[2] === undefined) return undefined;
  return { letter: parts[1]?.toUpperCase() ?? null, digits: parts[2] };
}

/**
 * SB 69-2 is `amendment-2025r1-sb69-2`. The feed spells one amendment's number more than one way ("-1", "1" and
 * "- 1" for HB 2344's first), and they are one node: the id has the number's letter and digits and nothing else.
 * A spelling that is not a number with an optional Version letter ("-AMR10") has its words as the id.
 */
export function amendmentIdOf(key: MeasureKey, amendmentNumber: string): AmendmentId {
  const number = parseAmendmentNumber(amendmentNumber);
  const named = number === undefined ? slug(amendmentNumber) : `${number.letter?.toLowerCase() ?? ""}${number.digits}`;
  return `amendment-${measureSlug(key)}-${named}` as AmendmentId;
}

/** One posting of a Proposed Amendment to a meeting, by the feed's `ProposedAmendmentId`. */
export function postingIdOf(session: SessionKey, proposedAmendmentId: number): DocumentId {
  return `posting-${session.toLowerCase()}-${proposedAmendmentId}` as DocumentId;
}

export function analysisIdOf(session: SessionKey, measureAnalysisId: string): DocumentId {
  return `analysis-${session.toLowerCase()}-${measureAnalysisId}` as DocumentId;
}

export function exhibitIdOf(session: SessionKey, committeeMeetingDocumentId: number): DocumentId {
  return `exhibit-${session.toLowerCase()}-${committeeMeetingDocumentId}` as DocumentId;
}

/**
 * A Recording Log is a CommitteeMeetingDocuments row like an Exhibit, but a document of its own kind:
 * the committee's timecoded index of the meeting's recording, not material posted to the record.
 */
export function recordingLogIdOf(session: SessionKey, committeeMeetingDocumentId: number): DocumentId {
  return `recording-log-${session.toLowerCase()}-${committeeMeetingDocumentId}` as DocumentId;
}

export function testimonyIdOf(session: SessionKey, commTestId: number): DocumentId {
  return `testimony-${session.toLowerCase()}-${commTestId}` as DocumentId;
}

const documentIdPattern =
  /^(version|printed-amendment|posting|analysis|exhibit|recording-log|testimony|agenda|amendment)-(\d{4}[a-z]\d)-([a-z0-9]+(?:-[a-z0-9]+)*)$/i;

/**
 * Reads what a caller wrote as the id of a document or of a Proposed Amendment of the deployment's
 * Session. Ids are minted in lower case, so capitals and spaces round the id are forgiven, as for a
 * Measure; the id comes back as minted. An id of another Session, of another kind of node (a Measure)
 * or of no form at all is not one: undefined.
 */
export function parseDocumentReference(text: string, session: SessionKey): DocumentId | AmendmentId | undefined {
  const trimmed = text.trim();
  const parts = documentIdPattern.exec(trimmed);
  if (parts?.[1] === undefined || parts[2] === undefined) return undefined;
  if (parts[2].toUpperCase() !== session) return undefined;
  return parts[1].toLowerCase() === "amendment"
    ? (trimmed.toLowerCase() as AmendmentId)
    : (trimmed.toLowerCase() as DocumentId);
}

/** The Version an amendment number names, or undefined for a spelling that is not a number with an optional letter. */
function versionNamedByNumber(spelling: string): string | undefined {
  const number = parseAmendmentNumber(spelling);
  return number === undefined ? undefined : versionDescriptionOfLetter(number.letter);
}

/** "-9", "-9 and --9", "-1, 1 and - 1": the spellings in a sentence. */
function spelled(spellings: readonly string[]): string {
  const last = spellings.at(-1);
  return spellings.length < 2 || last === undefined
    ? spellings.join("")
    : `${spellings.slice(0, -1).join(", ")} and ${last}`;
}

/**
 * What a Proposed Amendment's own header names: the Version it amends and the Measure it is to ("SENATE BILL 69"
 * is the Introduced Version of SB 69; "A-ENGROSSED HOUSE BILL 3795" the A-Engrossed Version of HB 3795).
 */
export type AmendmentHeader = {
  /** In the words the feed describes Versions in: "Introduced", "A-Engrossed". */
  version: string;
  measure: { prefix: string; number: number };
};

/** "SB 69": a Measure as people cite it. */
function citationOf(measure: { prefix: string; number: number }): string {
  return `${measure.prefix} ${measure.number}`;
}

/**
 * Where a Proposed Amendment's Version is, as far as the evidence goes, and why (ADR-0015). `version`: the header
 * and the number name a Version and the store holds it. `not_held`: they name one, but the store does not hold
 * it (its file did not come). The Version is then known by name, and where it sits in the order of printing is
 * known with it. `unknown`: the evidence does not name one.
 */
export type AmendmentPlacement =
  | { kind: "version"; versionId: DocumentId; description: string; reason: string }
  | { kind: "not_held"; description: string; reason: string }
  | { kind: "unknown"; reason: string };

/**
 * Says which Version of the Measure a Proposed Amendment amends. The amendment's own header names it and its
 * number names it, and they must agree; the header must also name the amendment's own Measure, so a file posted
 * under the wrong Measure is not compared. Nothing is guessed (ADR-0013's rule, applied here). `spellings` has the
 * number as each posting writes it. `headers` has what the header of each file the store holds for the amendment
 * names, or null for a header that could not be read. `isHeld` says whether the store holds a Version of the Measure.
 */
export function placeAmendment(
  key: MeasureKey,
  spellings: readonly string[],
  headers: readonly (AmendmentHeader | null)[],
  isHeld: (versionId: DocumentId) => boolean,
): AmendmentPlacement {
  const unknown = (reason: string): AmendmentPlacement => ({ kind: "unknown", reason });
  if (headers.length === 0) {
    return unknown(
      "This index holds no file of the amendment, so its header, which names the Version it amends, cannot be read.",
    );
  }
  const named = headers.filter((header): header is AmendmentHeader => header !== null);
  if (named.length < headers.length) {
    return unknown(
      'The header of the amendment\'s file (the line after "PROPOSED AMENDMENTS TO") could not be read, so which Version it amends is not known.',
    );
  }
  const own = citationOf(key);
  const elsewhere = [...new Set(named.map((header) => citationOf(header.measure)).filter((cited) => cited !== own))];
  if (elsewhere.length > 0) {
    return unknown(
      `The amendment is to ${own}, but a file posted for it has a header that names ${elsewhere.join(" and ")}, so which Version it amends is not known.`,
    );
  }
  const distinct = [...new Set(named.map((header) => header.version))];
  const [fromHeader] = distinct;
  if (fromHeader === undefined || distinct.length > 1) {
    return unknown(
      `The headers of the amendment's files name different Versions (${distinct.join(" and ")}), so which Version it amends is not known.`,
    );
  }
  // Every posting spells the number, and they may spell it differently; the Version they name must be one.
  const fromNumbers = [...new Set(spellings.map(versionNamedByNumber))];
  if (fromNumbers.length > 1) {
    return unknown(
      `The postings of the amendment write its number as ${spelled(spellings)}, which do not name one Version, so which Version it amends is not known.`,
    );
  }
  const [fromNumber] = fromNumbers;
  if (fromNumber === undefined) {
    return unknown(
      `The amendment's number ${spelled(spellings)} is not a number with an optional Version letter (a number alone, as in -2, names Introduced, and a letter before it, as in -A3, names that engrossed Version), so which Version it amends is not known.`,
    );
  }
  if (fromNumber !== fromHeader) {
    return unknown(
      `The amendment's header names the ${fromHeader} Version but its number ${spelled(spellings)} names the ${fromNumber} Version, so which Version it amends is not known.`,
    );
  }
  const versionId = versionIdOf(key, fromHeader);
  if (!isHeld(versionId)) {
    return {
      kind: "not_held",
      description: fromHeader,
      reason: `The amendment's header and number both name the ${fromHeader} Version of ${own}, which this index does not hold.`,
    };
  }
  return {
    kind: "version",
    versionId,
    description: fromHeader,
    reason: `The amendment's header names the ${fromHeader} Version and its number ${spelled(spellings)} agrees.`,
  };
}

const amendmentCitationPattern = /^([A-Za-z]+)\s*(\d+)\s*(-.*)$/;

/**
 * Reads what a caller wrote as a Proposed Amendment of the deployment's Session: its citation ("SB 69-2",
 * "HB 3795-A3") or its id (`amendment-2025r1-sb69-2`). The id comes back as minted, from the citation or from
 * the id in lower case. A document's id, a Measure's, another Session's or no form at all is not one: undefined.
 * The citation's number is read by `parseAmendmentNumber`, so one it cannot read ("SB 69-AMR10") is asked for by id.
 */
export function parseAmendmentReference(text: string, session: SessionKey): AmendmentId | undefined {
  const trimmed = text.trim();
  const citation = amendmentCitationPattern.exec(trimmed);
  if (citation?.[1] !== undefined && citation[2] !== undefined && citation[3] !== undefined) {
    if (parseAmendmentNumber(citation[3]) === undefined) return undefined;
    const key = { session, prefix: citation[1].toUpperCase(), number: Number(citation[2]) };
    return amendmentIdOf(key, citation[3]);
  }
  const reference = parseDocumentReference(trimmed, session);
  return reference?.startsWith("amendment-") === true ? (reference as AmendmentId) : undefined;
}

export function committeeIdOf(session: SessionKey, committeeCode: string): CommitteeId {
  return `committee-${session.toLowerCase()}-${slug(committeeCode)}` as CommitteeId;
}

/** The part of a Timestamp that reads as the feed's wall clock: "2025-01-30-0800". */
function meetingKey(at: Timestamp): string {
  return `${at.slice(0, 10)}-${at.slice(11, 13)}${at.slice(14, 16)}`;
}

/** `meeting-2025r1-slb-2025-01-30-0800`: the committee and the Pacific wall-clock start of the meeting. */
export function meetingIdOf(session: SessionKey, committeeCode: string, at: Timestamp): MeetingId {
  return `meeting-${session.toLowerCase()}-${slug(committeeCode)}-${meetingKey(at)}` as MeetingId;
}

/**
 * The meeting's page on OLIS, built from its committee code and its start time: the form is
 * `/liz/{session}/Committees/{CommitteeCode}/{yyyy-MM-dd-HH-mm}/Agenda`
 * (docs/research/hearing-video.md section 2). It is linked and never fetched (spec #1, "Out of Scope").
 */
export function olisMeetingPageUrlOf(session: SessionKey, committeeCode: string, at: Timestamp): string {
  const time = `${at.slice(0, 10)}-${at.slice(11, 13)}-${at.slice(14, 16)}`;
  return `https://olis.oregonlegislature.gov/liz/${session}/Committees/${committeeCode}/${time}/Agenda`;
}

/** A meeting's agenda is a document of its own. */
export function agendaIdOf(session: SessionKey, committeeCode: string, at: Timestamp): DocumentId {
  return `agenda-${session.toLowerCase()}-${slug(committeeCode)}-${meetingKey(at)}` as DocumentId;
}

/** A node a document points at, and how, with where the feed said so. */
export type DocumentRelation = {
  relation: Relation;
  to: NodeId;
  /** For a posting: what the committee did with the amendment at that meeting (the feed's `Meaning`). */
  meaning: string | null;
  /** Where the feed said so, such as "CommitteeProposedAmendments 26284". */
  provenance: string;
};

/** What a Position means, in the glossary's words. An id the feed does not list is "unlisted position". */
export type PositionLabel = "support" | "oppose" | "neutral" | "unknown" | "unlisted position";

/** Which side of a Measure a Testimony takes (GLOSSARY.md, "Position"): the feed's id and what it means. */
export type Position = { id: number; label: PositionLabel };

/**
 * The Positions the feed lists, in the order `testimony` lists them: the feed's `PositionOnMeasureId` 3983 is
 * support, 3982 oppose, 3981 neutral and 4022 unknown (docs/research/olis-odata.md, gotcha 3).
 */
export const listedPositions: readonly Position[] = [
  { id: 3983, label: "support" },
  { id: 3982, label: "oppose" },
  { id: 3981, label: "neutral" },
  { id: 4022, label: "unknown" },
];

/** The Position a `PositionOnMeasureId` names. An id the feed does not list keeps its number and is never dropped. */
export function positionOf(id: number): Position {
  return listedPositions.find((position) => position.id === id) ?? { id, label: "unlisted position" };
}

/**
 * What a Testimony row says besides its file (GLOSSARY.md, "Testimony"), every text as the feed writes it:
 * who submitted it, for whom, from where, and on which side of the Measure.
 */
export type TestimonyDetails = {
  /** The feed's `CommTestId`, the key the Testimony's id is minted from. */
  commTestId: number;
  /** The Position of the feed's `PositionOnMeasureId`. */
  position: Position;
  /** The feed's `SubmitterFirstName` and `SubmitterLastName` joined by one space, neither trimmed. */
  submitter: string;
  /** The feed's `BehalfOf`: free text, often the real organization. Null when the feed gives none. */
  behalfOf: string | null;
  /** The feed's `Organization`: free text, often a city. Null when the feed gives none. */
  organization: string | null;
  committeeCode: string;
  /** When the committee met, from the feed's `MeetingDate`. */
  meetingAt: Timestamp;
};

/**
 * One document the feed links, before it is fetched: what the feed says about it, in domain terms.
 * `sourceUrl` is the link as OLIS gives it, percent-encoded; the store keeps it as the document's
 * `source_url`.
 */
export type DocumentLink = {
  id: DocumentId;
  /** The id a request may name instead: the Proposed Amendment a posting is of, else the id itself. */
  nodeId: DocumentId | AmendmentId;
  kind: DocumentKind;
  /** The feed's own name for it: the version description, the analysis type, the amendment number... */
  label: string;
  sourceUrl: string;
  /** When the meeting it was posted to starts, for a posting. */
  postedAt: Timestamp | null;
  /**
   * The date search files it under: the start of the meeting a document is posted to or for (an agenda, an
   * Exhibit, a Recording Log, Testimony, a posting of a Proposed Amendment), else when the feed created the
   * row (a Version, a Printed Amendment, an analysis document). Null when the feed gave none.
   */
  date: Timestamp | null;
  /**
   * When OLIS created the feed's row for the document (its `CreatedDate`), in Pacific time with its offset: the
   * document's created time (GLOSSARY.md, ADR-0028). Not `postedAt`, which is the meeting a posting was posted to.
   * Absent for a kind whose row the client does not read it from (agendas, Exhibits and Recording Logs) and when the
   * row gives none.
   */
  createdAt?: Timestamp;
  /**
   * For an agenda: the meeting row's `AgendaRevisionNumber`, 0 when the feed gives none. An agenda is the one
   * document fetched again when this changes (ADR-0005, ADR-0041).
   */
  agendaRevision?: number;
  /** For an analysis document: the feed's own `Version` label, "" when the feed gives none. */
  versionLabel?: string;
  /** For an analysis document: the feed's own `IsMinority` flag. */
  isMinority?: boolean;
  /** For an Exhibit: the feed's `ExhibitTitle`, which tells one Exhibit from another. Absent when the feed gives none. */
  title?: string;
  /** For Testimony: what the feed's row says besides the file. */
  testimony?: TestimonyDetails;
  relations: DocumentRelation[];
};

/** What a document or an amendment points at, with the document whose feed row says so. */
export type RelatedNode = {
  relation: Relation;
  to: NodeId;
  meaning: string | null;
  /** The document that carries the relation: for a posting, the one with the text posted to that meeting. */
  documentId: DocumentId;
};

/**
 * The OData entity sets a full pull reads, by the feed's own names (docs/research/olis-odata.md): the one list that
 * the OLIS client reads them by, the build report names them by and the listing of rows keys them by, so that a
 * misspelling is a compile error and not a join that finds nothing.
 */
export const pulledEntitySets = [
  "Measures",
  "Legislators",
  "MeasureSponsors",
  "MeasureHistoryActions",
  "MeasureVotes",
  "CommitteeVotes",
  "Committees",
  "CommitteeMeetings",
  "CommitteeAgendaItems",
  "MeasureDocuments",
  "MeasureAnalysisDocuments",
  "CommitteeMeetingDocuments",
  "CommitteeProposedAmendments",
  "CommitteePublicTestimonies",
  "CommitteeMembers",
  "ConveneTimes",
  "LegislativeSessions",
] as const;
export type PulledEntitySet = (typeof pulledEntitySets)[number];

/**
 * What the listing of rows keys a row by: an entity set, or a column of one row that the index keeps as a row of its
 * own. A meeting's agenda is the `AgendaUrl` column of its CommitteeMeetings row, so it stays listed or not apart from
 * the meeting (ADR-0030).
 */
export type ListedSet = PulledEntitySet | "CommitteeMeetings.AgendaUrl";

/**
 * Whether the feed still lists a row the index keeps, and when it last did (ADR-0005, ADR-0030). A row is no
 * longer listed once two complete full pulls in a row have not listed it. It leaves search and stays fetchable
 * by id; nothing is deleted.
 */
export type Listing =
  /**
   * `lastListedAt` is the as-of time of the latest complete full pull that listed the row, or null for a row no
   * complete pull has checked yet: the index was built before the listing was kept, or an increment stored it. Such
   * a row is read as listed (ADR-0030).
   */
  | { listed: true; lastListedAt: Timestamp | null }
  /** Two complete full pulls in a row have not listed the row. `lastListedAt` is the latest pull that did. */
  | { listed: false; lastListedAt: Timestamp };

/** What `get_document` resolves an id to: a document, and the nodes it (or the amendment's postings) point at. */
export type DocumentView = {
  /** The document whose text is served: the id asked for, or an amendment's latest posting. */
  document: Omit<StoredDocument, "relations" | "textHash" | "date">;
  related: RelatedNode[];
  /**
   * Whether the feed lists the document. For a Proposed Amendment it lists the amendment while it lists any of
   * its postings, and `lastListedAt` is the latest any posting was listed.
   */
  listing: Listing;
};

/** A document with its extracted text, as the store keeps it and the server reads it. */
export type StoredDocument = DocumentLink & {
  retrievedAt: Timestamp;
  /** The sha256 of the file OLIS served, in lower-case hex. */
  contentHash: string;
  /**
   * The sha256 of the extracted text, as the store keeps it, in lower-case hex. Two files with the same
   * words can differ in bytes (a PDF's modification date, ADR-0010), so this and not `contentHash` says
   * whether two documents read the same.
   */
  textHash: string;
  pageCount: number;
  /** False when extraction found nothing but whitespace: a scan or a photograph. */
  hasTextLayer: boolean;
  /** The text exactly as the extractor read it, with a form feed between pages. */
  text: string;
};

/**
 * One Testimony row of a Measure as the server reads it: what the feed says, the Agency its `Organization`
 * names (matched at ingest, where the registry is), and what the store holds of its file. The text itself is
 * never in it; `get_document` serves that.
 */
export type TestimonyEntry = TestimonyDetails & {
  id: DocumentId;
  sourceUrl: string;
  /** The feed's `DocumentDescription`: "Testimony", "Letter", "Report", "Photo"... */
  documentDescription: string;
  committeeId: CommitteeId;
  /** The registry slug of the Agency the row's `Organization` names, or null when it names none. */
  agencyId: AgencyId | null;
  /** Whether the store holds the file. The feed lists the Testimony either way. */
  fetched: boolean;
  /** False once two complete full pulls in a row have not listed the row (ADR-0030). The row is kept and shown. */
  listed: boolean;
  /** False when the file has no text layer; null while the store does not hold the file. */
  hasTextLayer: boolean | null;
  /** The sha256 of the file's extracted text (`StoredDocument.textHash`); null while the store does not hold the file. */
  textHash: string | null;
};

export type Meeting = {
  session: SessionKey;
  committeeCode: string;
  id: MeetingId;
  committeeId: CommitteeId;
  at: Timestamp;
  /** What the feed's `MeetingStatus` says, as it writes it: "Scheduled", "Cancelled", "No Meeting Scheduled". */
  status: string;
  /** The meeting's agenda, when the feed links one. */
  agenda: DocumentLink | null;
};

/** A floor convening the feed schedules (a ConveneTimes row): a chamber convening on a day. Its day is a day the Session meets (ADR-0042). */
export type Convening = {
  session: SessionKey;
  /** When the chamber convenes, with the Pacific offset. */
  at: Timestamp;
  /** The feed's `Chamber`: "H" or "S". */
  chamber: string;
};

/** The Session's own row of LegislativeSessions: the dates the Session is in progress between (ADR-0042). */
export type SessionDates = {
  session: SessionKey;
  /** The Pacific date (YYYY-MM-DD) the Session begins on. */
  begin: string;
  /** The Pacific date (YYYY-MM-DD) it ends on, or null while the feed gives none (2025R1's row has none). */
  end: string | null;
};

/** A meeting as a list shows it: when, whose and what the feed says of its status, without its contents. */
export type MeetingHeader = {
  id: MeetingId;
  committee: { id: CommitteeId; code: string; name: string };
  at: Timestamp;
  status: string;
  /** False once two complete full pulls in a row have not listed the meeting (ADR-0030). */
  listed: boolean;
};

/** A Proposed Amendment posted to a meeting: the node, and the posting with the text posted there. */
export type PostedAmendment = {
  id: AmendmentId;
  /** The amendment's number as the feed writes it, trimmed: "-1", "-A3". */
  number: string;
  measureId: MeasureId;
  /** What the committee did with it at that meeting: Proposed, Adopted... */
  meaning: string | null;
  /** The posting: the document with the file posted to this meeting. */
  documentId: DocumentId;
  sourceUrl: string;
  /** Whether the store holds the posting's file. The feed lists the posting either way. */
  fetched: boolean;
  /** False once two complete full pulls in a row have not listed the posting (ADR-0030). */
  listed: boolean;
};

/** One posting of a Proposed Amendment, as the amendment's own view lists it: where it was posted and what the committee did. */
export type AmendmentPosting = {
  documentId: DocumentId;
  sourceUrl: string;
  meetingId: MeetingId;
  /** When the meeting starts, in Pacific time with its offset. */
  meetingAt: Timestamp;
  committeeCode: string;
  committeeName: string;
  /** What the committee did with the amendment at that meeting (the feed's `Meaning`): Proposed, Adopted... */
  meaning: string | null;
  /** Whether the store holds the posting's file. The feed lists the posting either way. */
  fetched: boolean;
  /** False once two complete full pulls in a row have not listed the posting (ADR-0030). */
  listed: boolean;
};

/** A document the feed lists for a meeting, by what the feed calls it. */
export type MeetingDocument = {
  id: DocumentId;
  /** The feed's type for it: "Meeting Material", "Preliminary SMS", "Witness Registration"... */
  label: string;
  sourceUrl: string;
  /** The Measure the feed files it under, when it names one. */
  measureId: MeasureId | null;
  /** The feed's title for it, as published, when it gives one (an Exhibit has one). */
  title: string | null;
  /** Whether the store holds the file. The feed lists the document either way. */
  fetched: boolean;
  /** False once two complete full pulls in a row have not listed the document (ADR-0030). */
  listed: boolean;
};

/**
 * What the feed lists for a meeting: its agenda document, its agenda items in print order, the Proposed
 * Amendments posted to it by Measure and number, its Exhibits and its Recording Logs. The feed has a
 * Recording Log for most meetings and more than one for a few. A document is listed whether or not its
 * file has been fetched (`fetched`): the feed is read before the files are (ADR-0011, "Order of a pull"),
 * and a fetch can fail.
 */
export type MeetingContents = {
  /** The agenda document, when the feed links one. */
  agenda: MeetingDocument | null;
  agendaItems: ListedAgendaItem[];
  amendments: PostedAmendment[];
  exhibits: MeetingDocument[];
  recordingLogs: MeetingDocument[];
};

/**
 * One line of a meeting's agenda: a Measure heard, or something else the committee did (an
 * appointment, an introduction). Every text is as the feed publishes it; `comments` can hold HTML.
 */
export type AgendaItem = {
  /** The feed's `CommitteeAgendaItemId`. */
  itemId: number;
  meetingId: MeetingId;
  /** The Measure the item is about, when it is about one. */
  measure: MeasureKey | null;
  /** "Public Hearing", "Work Session", "Public Hearing and Work Session"... */
  meetingType: string | null;
  /** What the committee did: "Heard", "Heard and Reported Out with Amendments"... Null until it has. */
  action: string | null;
  /** The item's place on the agenda, as the feed writes it ("1", "10"). */
  printOrder: string | null;
  comments: string | null;
  /** For an executive appointment: the board and the appointee. */
  boardName: string | null;
  executiveAppointee: string | null;
};

/** An agenda item as the server reads it, with whether the feed still lists it (ADR-0030). */
export type ListedAgendaItem = AgendaItem & { listed: boolean };

export type Committee = {
  session: SessionKey;
  code: string;
  id: CommitteeId;
  name: string;
};

/**
 * One row of the feed's CommitteeMembers. The set's declared key is (CommitteeCode, CreatedDate, Title), which is
 * not unique: Rep Helm and Rep Owens are two rows with one key (docs/research/olis-odata.md section 8, gotcha 5).
 * So a row is told apart by all of its properties, and no tool shows the set yet.
 */
export type CommitteeMember = {
  session: SessionKey;
  /** The whole row as a string: every property the feed sent, in a fixed order. Two rows are one only if this is. */
  key: string;
  committeeCode: string;
  /**
   * As the feed writes it. It names a Legislator, or on a task force a person who is not one ("Shanbo Zhang"),
   * so a code that matches no Legislators row is reported as unresolved and is not an error.
   */
  legislatorCode: string;
  /** "Chair", "Co-Chair", "Member"... */
  title: string;
  createdAt: Timestamp;
  modifiedAt: Timestamp | null;
};

/** What the index holds of a Session. */
export type IndexCounts = {
  measures: number;
  committees: number;
  meetings: number;
  /** Proposed Amendments as nodes: one per Measure and amendment number, however many postings. */
  proposedAmendments: number;
  /** Documents the store holds, one per file fetched (a Proposed Amendment has one for each posting). */
  documents: number;
  documentsWithoutTextLayer: number;
  documentsByKind: Record<DocumentKind, number>;
};
