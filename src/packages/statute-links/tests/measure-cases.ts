import {
  amendmentIdOf,
  meetingIdOf,
  postingIdOf,
  versionIdOf,
  type AmendmentHeader,
  type AmendmentPosting,
} from "#/packages/domain/documents.ts";
import { measureIdOf, parseSessionKey, type MeasureKey, type SessionKey } from "#/packages/domain/index.ts";
import { parseOrsChapterId, parseOrsSectionId } from "#/packages/domain/oregonai.ts";
import {
  chapterTarget,
  sectionTarget,
  type StatuteLink,
  type StatuteLinkKind,
  type StatutesAffectedTableOfMeasure,
  type StoredAmendment,
  type StoredVersion,
} from "#/packages/domain/statute-links.ts";
import { readTimestamp } from "#/packages/time/pacific.ts";
import { parseStatutesAffectedTable } from "../index.ts";

// Builders for the Measures the cases of the Statute Links of a Measure are taken from. A case writes what the stored
// documents say as literals (the links a Version's text has, the header a Proposed Amendment's first page prints) and
// these put them in the shapes the Index stores them in. Expected values never come from here.

function sessionOf(text: string): SessionKey {
  const key = parseSessionKey(text);
  if (key === undefined) throw new Error(`not a Session key: ${text}`);
  return key;
}

const session = sessionOf("2025R1");

/** A Measure of the 2025R1 Session, such as `measureOf("SB", 69)`. */
export function measureOf(prefix: string, number: number): MeasureKey {
  return { session, prefix, number };
}

/** A Statute Link as a text prints it: `link("amends", "ors-653.616", "8")`. A chapter's id is `ors-chapter-657b`. */
export function link(kind: StatuteLinkKind, targetId: string, measureSection: string | null): StatuteLink {
  const section = parseOrsSectionId(targetId);
  if (section !== undefined) return { kind, target: sectionTarget(section), measureSection };
  const chapter = parseOrsChapterId(targetId);
  if (chapter === undefined) throw new Error(`not an ORS id: ${targetId}`);
  return { kind, target: chapterTarget(chapter), measureSection };
}

type HeldVersionOptions = {
  /** The links read from the Version's text. A Version with `read: false` has none. */
  links?: readonly StatuteLink[];
  /** False for a Version whose file has no text layer (a scan), which the Index holds and has read nothing of. */
  read?: boolean;
  /** False once two complete pulls in a row have not listed the Version (ADR-0030). */
  listed?: boolean;
};

/** A Version the Index holds, by the description the feed gives it ("Introduced", "A-Engrossed"). */
export function heldVersion(key: MeasureKey, description: string, options: HeldVersionOptions = {}): StoredVersion {
  const read = options.read ?? true;
  return {
    id: versionIdOf(key, description),
    label: description,
    sourceUrl: `https://olis.oregonlegislature.gov/liz/${key.session}/Downloads/MeasureDocument/${key.prefix}${String(key.number)}/${description}`,
    parse: {
      textRead: read,
      amendedVersionHeader: null,
      links: read ? [...(options.links ?? [])] : [],
      relatingClauseEdits: [],
    },
    listed: options.listed ?? true,
  };
}

/** What a Proposed Amendment's first page says it amends: `{ version: "Introduced", measure: SB 69 }`. */
export function headerNaming(version: string, key: MeasureKey): AmendmentHeader {
  return { version, measure: { prefix: key.prefix, number: key.number } };
}

/** One posting of a Proposed Amendment, by the feed's ProposedAmendmentId. */
export type PostingCase = {
  proposedAmendmentId: number;
  committee: { code: string; name: string };
  /** When the meeting started, in Pacific time with its offset. */
  at: string;
  meaning: string;
  /** What the first page of the posted file says it amends: null for a header that could not be read, undefined for no file held. */
  header: AmendmentHeader | null | undefined;
};

/**
 * A Proposed Amendment, from its postings in the order of their meetings. Postings whose files read the same are one file,
 * as the Index stores them, so the amendment has one file for each distinct header (the cases here need no more).
 */
export function proposedAmendment(key: MeasureKey, number: string, postings: readonly PostingCase[]): StoredAmendment {
  const posted = postings.map((posting): AmendmentPosting => {
    const at = readTimestamp(posting.at);
    if (at === undefined) throw new Error(`not a Pacific timestamp: ${posting.at}`);
    return {
      documentId: postingIdOf(key.session, posting.proposedAmendmentId),
      sourceUrl: `https://olis.oregonlegislature.gov/liz/${key.session}/Downloads/ProposedAmendment/${String(posting.proposedAmendmentId)}`,
      meetingId: meetingIdOf(key.session, posting.committee.code, at),
      meetingAt: at,
      committeeCode: posting.committee.code,
      committeeName: posting.committee.name,
      meaning: posting.meaning,
      fetched: posting.header !== undefined,
      listed: true,
    };
  });
  const headers = postings.flatMap((posting) => (posting.header === undefined ? [] : [posting.header]));
  const distinct = new Map(headers.map((header) => [JSON.stringify(header), header]));
  return {
    id: amendmentIdOf(key, number),
    number,
    spellings: [number],
    measureId: measureIdOf(key),
    postings: posted,
    files: [...distinct.values()].map((header) => ({
      postingIds: postings
        .filter((posting) => JSON.stringify(posting.header) === JSON.stringify(header))
        .map((posting) => postingIdOf(key.session, posting.proposedAmendmentId)),
      parse: { textRead: true, amendedVersionHeader: header, links: [], relatingClauseEdits: [] },
    })),
  };
}

/** A link as [kind, target id, measure section], the form a case writes the links it expects in. */
export function tripleOf(statuteLink: StatuteLink): [kind: string, targetId: string, measureSection: string | null] {
  return [statuteLink.kind, statuteLink.target.id, statuteLink.measureSection];
}

/**
 * The Statutes Affected Table as the Index holds it for a Measure, from the rows of the table's text (the lines the PDF.js
 * text of artables2025R1.pdf has, which the parser reads) and the descriptions of the Versions the feed lists for the Measure.
 * Only the rows of the Measure are kept, as the Index keeps them.
 */
export function tableOfMeasure(
  key: MeasureKey,
  rows: readonly string[],
  listedVersions: readonly string[],
): StatutesAffectedTableOfMeasure {
  const parsed = parseStatutesAffectedTable({ text: rows.join("\n"), orsSections: [] });
  const retrievedAt = readTimestamp("2026-08-01T10:00:00-07:00");
  if (retrievedAt === undefined) throw new Error("not a Pacific timestamp");
  return {
    sourceUrl: "https://www.oregonlegislature.gov/AutoPubs/artables2025R1.pdf",
    retrievedAt,
    entries: parsed.entries.filter(
      (entry) => entry.measure.prefix === key.prefix && entry.measure.number === key.number,
    ),
    listedVersions: [...listedVersions],
  };
}
