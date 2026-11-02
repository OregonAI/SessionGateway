// How Statute Links are shown to an agent, by compare_amendment and by get_measure (ticket #13): one shape
// for a link, one order, and one way to say that a file's links were not read.
import { z } from "zod";
import type { AmendmentPosting } from "#/packages/domain/documents.ts";
import {
  statuteLinkKinds,
  type AmendmentFile,
  type RelatingClauseEdit,
  type StatuteLink,
  type StatuteLinkKind,
  type StatuteParse,
} from "#/packages/domain/statute-links.ts";
import {
  statuteLinksByKind,
  type PlacedAmendment,
  type StatuteLinksOfMeasure,
  type SupersededAmendment,
  type VersionLinks,
} from "#/packages/statute-links/measure.ts";
import { noLongerListedFlag, noLongerListedOutput } from "./listing.ts";

/** The measure sections a target is linked in: null stands for text with no numbered sections. */
const measureSectionsOutput = z
  .array(z.string().nullable())
  .describe(
    'The numbered sections of the text the target is linked in, as the text prints them, in order: "8" for SECTION 8, "21a" for a section inserted later. A null entry means the text has no numbered sections.',
  );

export const sectionTargetOutput = z.object({
  target_id: z
    .string()
    .describe(
      "The ORS section, in OregonAI's id form (ors-468.130). OregonAI has a page for every section listed here, so looking it up there works.",
    ),
  measure_sections: measureSectionsOutput,
});

export const chapterTargetOutput = z.object({
  target_id: z.string().describe("The ORS chapter, in OregonAI's id form (ors-chapter-657b)."),
  resolvable_on_oregonai: z
    .boolean()
    .describe("False for every chapter: OregonAI has no id for a chapter, so looking it up there fails."),
  measure_sections: measureSectionsOutput,
});

/** The targets one kind of link points at: each once, with every measure section it is linked in. */
export const targetsOutput = z.object({
  sections: z.array(sectionTargetOutput).describe("The ORS sections, in the order of their first measure section."),
  chapters: z.array(chapterTargetOutput).describe("The ORS chapters, in the order of their first measure section."),
});

/**
 * A document's Statute Links, by kind. Each target is listed once under its kind, with the measure sections it
 * is linked in, so that a section a long range cites is not repeated for every link (finding F6). Nothing is left
 * out: a target under two kinds (an amendment that amends a section and also cites it) is under both.
 */
const statuteLinksOutput = z.object(
  Object.fromEntries(statuteLinkKinds.map((kind) => [kind, targetsOutput])) as Record<
    StatuteLinkKind,
    typeof targetsOutput
  >,
);

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

type StatuteLinksOutput = z.infer<typeof statuteLinksOutput>;
type RelatingClauseEditOutput = z.infer<typeof relatingClauseEditOutput>;

/**
 * The links by kind (spec #1, story 24: the changes first, then the mentions, which the order of the keys says), each
 * target once under its kind with the measure sections it is linked in (`statuteLinksByKind` groups them).
 */
export function statuteLinksShown(links: readonly StatuteLink[]): StatuteLinksOutput {
  const byKind = statuteLinksByKind(links);
  const shown = (kind: StatuteLinkKind): z.infer<typeof targetsOutput> => ({
    sections: byKind[kind]
      .filter(({ target }) => target.type === "section")
      .map(({ target, measureSections }) => ({ target_id: target.id, measure_sections: measureSections })),
    chapters: byKind[kind]
      .filter(({ target }) => target.type === "chapter")
      .map(({ target, measureSections }) => ({
        target_id: target.id,
        resolvable_on_oregonai: target.resolvableOnOregonAi,
        measure_sections: measureSections,
      })),
  });
  return Object.fromEntries(statuteLinkKinds.map((kind) => [kind, shown(kind)])) as StatuteLinksOutput;
}

/** The links of a document with none, or one that was not read. */
export const noLinks: StatuteLinksOutput = statuteLinksShown([]);

export function relatingClauseEditShown(edit: RelatingClauseEdit): RelatingClauseEditOutput {
  return {
    deleted: edit.deleted,
    deleted_lines: edit.deletedLines,
    inserted: edit.inserted,
    inserted_sections: edit.insertedSections,
  };
}

/** Why a file's Statute Links are an empty list, when they are empty because the file was not read. */
function notReadReasonOf(parse: StatuteParse): string | null {
  return parse.textRead
    ? null
    : "This index did not read the file for Statute Links: it has no text layer (a scan or a photograph), or the index has not read it yet. The empty list does not mean the document has none.";
}

const textReadDescription =
  "True when this index read the document's text for Statute Links. False when it did not (no text layer, or not read yet): statute_links is then empty, and that does not mean the document has none.";

/**
 * What was read of one document (a Version, or a file posted for a Proposed Amendment), as three fields. The one
 * block every tool that shows a reading takes its fields from, with `parseResultShown` as the one renderer.
 */
const parseResultFields = {
  text_read: z.boolean().describe(textReadDescription),
  not_read_reason: z
    .string()
    .nullable()
    .describe("Why the text was not read. Null when text_read is true, or when there was no document to read."),
  statute_links: statuteLinksOutput.describe(
    "The document's Statute Links, by kind (amends, repeals, adds-to, cites), each target once with the measure sections it is linked in. For a Proposed Amendment they are the links in the sections it inserts: a link of the Version that the amendment deletes is not among them.",
  ),
};

/** The same fields for a Version that may not be known: nothing was read then, so text_read is null. */
export const maybeParseResultFields = {
  ...parseResultFields,
  text_read: z.boolean().nullable().describe(`${textReadDescription} Null when the Version is not known.`),
};

export function parseResultShown(parse: StatuteParse): z.infer<z.ZodObject<typeof parseResultFields>> {
  return {
    text_read: parse.textRead,
    not_read_reason: notReadReasonOf(parse),
    statute_links: statuteLinksShown(parse.links),
  };
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
  no_longer_listed: noLongerListedOutput,
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
    ...noLongerListedFlag(posting.listing),
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

/** The Version a Proposed Amendment amends, as the entry point placed it from the amendment's headers, number and the Versions held. */
export function amendedVersionShown({ placement, version }: PlacedAmendment): z.infer<typeof amendedVersionOutput> {
  return version === undefined
    ? { known: false, id: null, label: null, source_url: null, reason: placement.reason }
    : { known: true, id: version.id, label: version.label, source_url: version.sourceUrl, reason: placement.reason };
}

/** What was read of one file posted for a Proposed Amendment: postings whose files read the same are one entry. */
export const fileOutput = z.object({
  posting_ids: z
    .array(z.string())
    .describe(
      "The postings (ids that get_document resolves) whose files read the same. Postings of one amendment usually share one file, or hold files that differ only in how the PDF was saved; when a committee posted a revised text, each distinct reading is listed on its own. Files that were not read (text_read false) are never listed together unless they are the same file.",
    ),
  ...parseResultFields,
});

export function fileShown(file: AmendmentFile): z.infer<typeof fileOutput> {
  return { posting_ids: file.postingIds, ...parseResultShown(file.parse) };
}

export const versionEntryOutput = z.object({
  id: z.string().describe("The Version's id, which get_document resolves."),
  label: z.string().describe('The Version as the Legislature describes it: "Introduced", "A-Engrossed", "Enrolled"...'),
  source_url: z.string().describe("Where the Legislature publishes the Version."),
  no_longer_listed: noLongerListedOutput,
  same_links_as: z
    .string()
    .optional()
    .describe(
      "Present when this Version's reading (text_read, not_read_reason and statute_links) is exactly that of the Version before it in print order, whose id this is. The reading is then left out, and is that Version's: shown in its entry, or, when that Version says same_links_as too, in the entry its same_links_as names. The Version's own Statutes Affected Table block and no_longer_listed are shown either way, whatever the Version before it has. Only a Version that was read can have the links of another.",
    ),
  text_read: parseResultFields.text_read.optional(),
  not_read_reason: parseResultFields.not_read_reason.optional(),
  statute_links: parseResultFields.statute_links.optional(),
});

type VersionEntry = z.infer<typeof versionEntryOutput>;

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

/**
 * The `versions` field of the Statute Links by source, for a Version entry of whatever shape. One place says what the
 * field is, so that a tool that adds to the entry (the Statutes Affected Table's block, ticket #22) extends the entry and
 * keeps the field's description.
 */
export function versionsOutputOf<Entry extends z.ZodType>(entry: Entry): z.ZodArray<Entry> {
  return z
    .array(entry)
    .describe(
      "The Measure's Versions that this index holds, in the order they were printed (a Version with no place in that order, such as a minority report's, comes last), each with the Statute Links read from its text, or with same_links_as when the text was read and its Statute Links are exactly those of the Version before it (an Enrolled Version that repeats the last Engrossed one). Each Version shows its own Statutes Affected Table block and its own no_longer_listed either way. A Printed Amendment is not a Version and is not read.",
    );
}

export const statuteLinksBySourceOutput = z.object({
  versions: versionsOutputOf(versionEntryOutput),
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

type StatuteLinksBySourceOutput = z.infer<typeof statuteLinksBySourceOutput>;

/** What `note` says. */
const SUPERSEDED_AMENDMENTS_NOTE =
  "A Proposed Amendment's Statute Links are listed under proposed_amendments only while this index holds no Version later than the one the amendment amends, because the next Version's own Statute Links replace them. The amendments left out are in superseded_amendments, and compare_amendment still answers for each. An amendment whose Version cannot be named stays in proposed_amendments.";

/** A Proposed Amendment whose Statute Links apply now, with the postings and files it was read from. */
function currentAmendmentShown(placed: PlacedAmendment): StatuteLinksBySourceOutput["proposed_amendments"][number] {
  const { amendment } = placed;
  return {
    id: amendment.id,
    number: amendment.number,
    amended_version: amendedVersionShown(placed),
    postings: amendment.postings.map(postingShown),
    files: amendment.files.map(fileShown),
  };
}

/** A Superseded amendment, with the Version it amends (which may not be held) and the Version that replaces it. */
function supersededAmendmentShown(
  superseded: SupersededAmendment,
): StatuteLinksBySourceOutput["superseded_amendments"][number] {
  const { amendment, amendedVersion, laterVersion } = superseded;
  return {
    id: amendment.id,
    number: amendment.number,
    amended_version: {
      id: amendedVersion.held?.id ?? null,
      label: amendedVersion.description,
      source_url: amendedVersion.held?.sourceUrl ?? null,
    },
    later_version: { id: laterVersion.id, label: laterVersion.label, source_url: laterVersion.sourceUrl },
  };
}

/** The Proposed Amendments of a Measure, those whose Statute Links apply now and those a later Version replaces (ADR-0015). */
export function amendmentsShown(
  links: Pick<StatuteLinksOfMeasure, "currentAmendments" | "supersededAmendments">,
): Pick<StatuteLinksBySourceOutput, "proposed_amendments" | "superseded_amendments" | "note"> {
  return {
    proposed_amendments: links.currentAmendments.map(currentAmendmentShown),
    superseded_amendments: links.supersededAmendments.map(supersededAmendmentShown),
    note: SUPERSEDED_AMENDMENTS_NOTE,
  };
}

/**
 * One Version's entry in the order they were printed in, with its reading or as `same_links_as` the Version before it
 * (ADR-0036): the entry point says which Versions repeat the one before. A Version that does leaves its reading out, so that
 * an Enrolled Version that repeats the last Engrossed one is not listed twice (15,145 characters of SB 69's answer). `block`
 * is what a tool sets beside the Version, the Statutes Affected Table's block (ticket #22) among it; it is kept either way, as
 * is the no_longer_listed flag of ticket #18, because they are the Version's own whatever the Version before it has.
 */
export function versionEntryShown<Block extends object>(entry: VersionLinks, block: Block): VersionEntry & Block {
  const { version, sameLinksAs } = entry;
  const own = {
    id: version.id,
    label: version.label,
    source_url: version.sourceUrl,
    ...noLongerListedFlag(version.listing),
  };
  return sameLinksAs === undefined
    ? { ...own, ...parseResultShown(version.parse), ...block }
    : { ...own, ...block, same_links_as: sameLinksAs.id };
}
