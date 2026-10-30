// How Statute Links are shown to an agent, by compare_amendment and by get_measure (ticket #13): one shape
// for a link, one order, and one way to say that a file's links were not read.
import { z } from "zod";
import {
  placeAmendment,
  versionRankOf,
  type AmendmentPlacement,
  type AmendmentPosting,
} from "#/packages/domain/documents.ts";
import type { MeasureKey } from "#/packages/domain/index.ts";
import {
  statuteLinkKinds,
  type AmendmentFile,
  type RelatingClauseEdit,
  type StatuteLink,
  type StatuteLinkKind,
  type StatuteParse,
  type StoredAmendment,
  type StoredVersion,
} from "#/packages/domain/statute-links.ts";

export const statuteLinkOutput = z.object({
  kind: z
    .enum(statuteLinkKinds)
    .describe(
      "What the text does to the target: amends it, repeals it, adds a section to it (a chapter), or only cites it. A citation is not a change.",
    ),
  target_id: z
    .string()
    .describe(
      "The ORS section or chapter, in OregonAI's id form: ors-468.130 for a section, ors-chapter-657b for a chapter.",
    ),
  target_type: z.enum(["section", "chapter"]).describe("Whether the target is an ORS section or a whole chapter."),
  resolvable_on_oregonai: z
    .boolean()
    .describe(
      "True for a section, which OregonAI has a page for. False for a chapter, which OregonAI has no id for, so looking it up there fails.",
    ),
  measure_section: z
    .string()
    .nullable()
    .describe(
      'The numbered section of the text the link is read in, as the text prints it: "8" for SECTION 8, "21a" for a section inserted later. Null when the text has no numbered sections.',
    ),
});

export const relatingClauseEditOutput = z.object({
  deleted: z.string().nullable().describe("The words the amendment quotes as deleted, or null when it quotes none."),
  deleted_lines: z
    .array(z.string())
    .describe('The lines it deletes without quoting their words, as it names them: "line 3", "the rest of the line".'),
  inserted: z.string().nullable().describe("The words it inserts, or null when it only deletes."),
  inserted_sections: z
    .array(z.string())
    .describe("The ORS sections the inserted words name, with ranges expanded, each once, in order."),
});

export type StatuteLinkOutput = z.infer<typeof statuteLinkOutput>;
export type RelatingClauseEditOutput = z.infer<typeof relatingClauseEditOutput>;

/** The order links are listed in, from spec #1 (story 24): the changes first, then the mentions. */
const kindOrder: Record<StatuteLinkKind, number> = { amends: 0, repeals: 1, "adds-to": 2, cites: 3 };

/** "8" before "10" before "21a"; a link with no measure section last. */
function compareMeasureSections(a: string | null, b: string | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return a.localeCompare(b, "en", { numeric: true });
}

/**
 * The links in the order they are shown: by kind (amends, repeals, adds-to, cites), then by measure section,
 * and within those in the order the text names them.
 */
export function statuteLinksShown(links: readonly StatuteLink[]): StatuteLinkOutput[] {
  return links
    .toSorted(
      (a, b) => kindOrder[a.kind] - kindOrder[b.kind] || compareMeasureSections(a.measureSection, b.measureSection),
    )
    .map((link) => ({
      kind: link.kind,
      target_id: link.target.id,
      target_type: link.target.type,
      resolvable_on_oregonai: link.target.resolvableOnOregonAi,
      measure_section: link.measureSection,
    }));
}

export function relatingClauseEditShown(edit: RelatingClauseEdit): RelatingClauseEditOutput {
  return {
    deleted: edit.deleted,
    deleted_lines: edit.deletedLines,
    inserted: edit.inserted,
    inserted_sections: edit.insertedSections,
  };
}

/** Why a file's Statute Links are an empty list, when they are empty because the file was not read. */
export function notReadReasonOf(parse: StatuteParse): string | null {
  return parse.textRead
    ? null
    : "This index did not read the file for Statute Links: it has no text layer (a scan or a photograph), or the index has not read it yet. The empty list does not mean the document has none.";
}

export const postingOutput = z.object({
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

export function postingShown(posting: AmendmentPosting): z.infer<typeof postingOutput> {
  return {
    id: posting.documentId,
    source_url: posting.sourceUrl,
    meeting_id: posting.meetingId,
    meeting_date: posting.meetingAt,
    committee_code: posting.committeeCode,
    committee_name: posting.committeeName,
    meaning: posting.meaning,
    fetched: posting.fetched,
  };
}

/** The Version a Proposed Amendment amends, as far as the evidence goes (ADR-0015). */
export const amendedVersionOutput = z.object({
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

/** The Version an amendment amends, from its files' headers, its number and the Versions the store holds. */
export function placeStoredAmendment(
  amendment: StoredAmendment,
  key: MeasureKey,
  versions: readonly StoredVersion[],
): { placement: AmendmentPlacement; version: StoredVersion | undefined; shown: z.infer<typeof amendedVersionOutput> } {
  const placement = placeAmendment(
    key,
    amendment.spellings,
    amendment.files.map((file) => file.parse.amendedVersionHeader),
    (versionId) => versions.some((version) => version.id === versionId),
  );
  switch (placement.kind) {
    case "version": {
      const version = versions.find((held) => held.id === placement.versionId);
      if (version === undefined) throw new Error(`The Version ${placement.versionId} was placed but is not held`);
      return {
        placement,
        version,
        shown: {
          known: true,
          id: version.id,
          label: version.label,
          source_url: version.sourceUrl,
          reason: placement.reason,
        },
      };
    }
    case "not_held":
    case "unknown":
      return {
        placement,
        version: undefined,
        shown: { known: false, id: null, label: null, source_url: null, reason: placement.reason },
      };
    default:
      return placement satisfies never;
  }
}

/** What was read of one file posted for a Proposed Amendment: postings whose files read the same are one entry. */
export const fileOutput = z.object({
  posting_ids: z
    .array(z.string())
    .describe(
      "The postings (ids that get_document resolves) whose files read the same. Postings of one amendment usually share one file, or hold files that differ only in how the PDF was saved; when a committee posted a revised text, each distinct reading is listed on its own. Files that were not read (text_read false) are never listed together unless they are the same file.",
    ),
  text_read: z
    .boolean()
    .describe(
      "True when this index read the file's text for Statute Links. False when it did not (no text layer, or not read yet): statute_links is then empty, and that does not mean the amendment has none.",
    ),
  not_read_reason: z.string().nullable().describe("Why the file was not read. Null when text_read is true."),
  statute_links: z
    .array(statuteLinkOutput)
    .describe(
      "The Statute Links in the sections the amendment inserts, by kind (amends, repeals, adds-to, cites) and then by measure section. A link of the Version that the amendment deletes is not among them.",
    ),
});

export function fileShown(file: AmendmentFile): z.infer<typeof fileOutput> {
  return {
    posting_ids: file.postingIds,
    text_read: file.parse.textRead,
    not_read_reason: notReadReasonOf(file.parse),
    statute_links: statuteLinksShown(file.parse.links),
  };
}

const versionEntryOutput = z.object({
  id: z.string().describe("The Version's id, which get_document resolves."),
  label: z.string().describe('The Version as the Legislature describes it: "Introduced", "A-Engrossed", "Enrolled"...'),
  source_url: z.string().describe("Where the Legislature publishes the Version."),
  text_read: z
    .boolean()
    .describe(
      "True when this index read the Version's text for Statute Links. False when it did not (no text layer, or not read yet): statute_links is then empty, and that does not mean the Version has none.",
    ),
  not_read_reason: z.string().nullable().describe("Why the text was not read. Null when text_read is true."),
  statute_links: z
    .array(statuteLinkOutput)
    .describe("The Version's Statute Links, by kind (amends, repeals, adds-to, cites) and then by measure section."),
});

/** A Version named in superseded_amendments: the one the amendment amends (which may not be held), or the one that replaces it. */
const amendedVersionRefOutput = z.object({
  id: z
    .string()
    .nullable()
    .describe(
      "The Version's id, which get_document resolves. Null when this index does not hold the Version the amendment names: its file did not come.",
    ),
  label: z.string().describe('The Version as the Legislature describes it: "Introduced", "A-Engrossed"...'),
  source_url: z
    .string()
    .nullable()
    .describe("Where the Legislature publishes the Version. Null when this index does not hold it."),
});

const laterVersionRefOutput = z.object({
  id: z.string().describe("The Version's id, which get_document resolves."),
  label: z.string().describe('The Version as the Legislature describes it: "B-Engrossed", "Enrolled"...'),
  source_url: z.string().describe("Where the Legislature publishes the Version."),
});

export const statuteLinksBySourceOutput = z.object({
  versions: z
    .array(versionEntryOutput)
    .describe(
      "The Measure's Versions that this index holds, in the order they were printed (a Version with no place in that order, such as a minority report's, comes last), each with the Statute Links read from its text. A Printed Amendment is not a Version and is not read.",
    ),
  proposed_amendments: z
    .array(
      z.object({
        id: z.string().describe("The amendment's id, which compare_amendment takes."),
        number: z.string().describe('The amendment\'s number as the Legislature writes it, such as "-2" or "-A3".'),
        amended_version: amendedVersionOutput.describe("The Version the amendment amends, or why it is not known."),
        postings: z
          .array(postingOutput)
          .describe(
            "Each time the amendment was posted to a committee meeting, earliest meeting first, with what the committee did (meaning).",
          ),
        files: z
          .array(fileOutput)
          .describe(
            "The distinct readings of the files posted for the amendment, each with its Statute Links by measure section.",
          ),
      }),
    )
    .describe(
      "The Proposed Amendments whose Statute Links apply now: the ones with no Version held later than the one they amend, and the ones whose Version cannot be named. The Version an amendment amends is the one its header and number name, whether or not this index holds it. Ordered by amendment number.",
    ),
  superseded_amendments: z
    .array(
      z.object({
        id: z.string().describe("The amendment's id, which compare_amendment takes."),
        number: z.string().describe("The amendment's number."),
        amended_version: amendedVersionRefOutput.describe(
          "The Version the amendment amends, as its header and number name it, whether or not this index holds it.",
        ),
        later_version: laterVersionRefOutput.describe("The next Version after it that this index holds."),
      }),
    )
    .describe(
      "The Proposed Amendments left out of proposed_amendments because this index holds a Version later than the one they amend.",
    ),
  note: z.string().describe("Says when a Proposed Amendment's Statute Links are listed here and where the rest are."),
});

export type StatuteLinksBySourceOutput = z.infer<typeof statuteLinksBySourceOutput>;

/** What `note` says. */
export const SUPERSEDED_AMENDMENTS_NOTE =
  "A Proposed Amendment's Statute Links are listed under proposed_amendments only while this index holds no Version later than the one the amendment amends, because the next Version's own Statute Links replace them. The amendments left out are in superseded_amendments, and compare_amendment still answers for each. An amendment whose Version cannot be named stays in proposed_amendments.";

/** A Version in the order they were printed in; one with no place in that order after the others, by name. */
function compareVersions(a: StoredVersion, b: StoredVersion): number {
  const left = versionRankOf(a.label) ?? Number.POSITIVE_INFINITY;
  const right = versionRankOf(b.label) ?? Number.POSITIVE_INFINITY;
  return left === right ? a.label.localeCompare(b.label) : left < right ? -1 : 1;
}

/**
 * The next Version after the one at `rank` that the store holds, or undefined if it holds none. A Version with
 * no place in the order of printing is later than none.
 */
function nextVersionAfter(rank: number, versions: readonly StoredVersion[]): StoredVersion | undefined {
  return versions
    .filter((version) => (versionRankOf(version.label) ?? Number.NEGATIVE_INFINITY) > rank)
    .toSorted(compareVersions)[0];
}

/**
 * The Version an amendment's evidence names, held or not, and where it sits in the order of printing. Undefined
 * when the evidence names none, or a Version that sits nowhere in that order.
 */
function namedVersionOf(placement: AmendmentPlacement): { description: string; rank: number } | undefined {
  switch (placement.kind) {
    case "version":
    case "not_held": {
      const rank = versionRankOf(placement.description);
      return rank === undefined ? undefined : { description: placement.description, rank };
    }
    case "unknown":
      return undefined;
    default:
      return placement satisfies never;
  }
}

/**
 * The Measure's Statute Links by the Version or Proposed Amendment they were read from. A Proposed Amendment's
 * links are listed while the store holds no Version later than the one it amends, and not after: the next
 * Version's own links replace them (ADR-0001, ADR-0015). The Version an amendment amends is the one its header
 * and number name, whether or not the store holds that Version's file. One whose Version is not known stays listed.
 */
export function statuteLinksBySourceOf(
  key: MeasureKey,
  versions: readonly StoredVersion[],
  amendments: readonly StoredAmendment[],
): StatuteLinksBySourceOutput {
  const current: StatuteLinksBySourceOutput["proposed_amendments"] = [];
  const superseded: StatuteLinksBySourceOutput["superseded_amendments"] = [];
  for (const amendment of amendments) {
    const { placement, version, shown } = placeStoredAmendment(amendment, key, versions);
    const named = namedVersionOf(placement);
    const later = named === undefined ? undefined : nextVersionAfter(named.rank, versions);
    if (named !== undefined && later !== undefined) {
      superseded.push({
        id: amendment.id,
        number: amendment.number,
        amended_version: {
          id: version?.id ?? null,
          label: named.description,
          source_url: version?.sourceUrl ?? null,
        },
        later_version: { id: later.id, label: later.label, source_url: later.sourceUrl },
      });
      continue;
    }
    current.push({
      id: amendment.id,
      number: amendment.number,
      amended_version: shown,
      postings: amendment.postings.map(postingShown),
      files: amendment.files.map(fileShown),
    });
  }
  return {
    versions: versions.toSorted(compareVersions).map((version) => ({
      id: version.id,
      label: version.label,
      source_url: version.sourceUrl,
      text_read: version.parse.textRead,
      not_read_reason: notReadReasonOf(version.parse),
      statute_links: statuteLinksShown(version.parse.links),
    })),
    proposed_amendments: current,
    superseded_amendments: superseded,
    note: SUPERSEDED_AMENDMENTS_NOTE,
  };
}
