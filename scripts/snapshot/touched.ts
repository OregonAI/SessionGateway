// What the committed 2025R1 fixture (test/fixtures/olis-2025R1) touches, and the trimming of a snapshot
// to it. The snapshot fixture (test/fixtures/oregonai-snapshot/) is the full snapshot cut down to the
// ORS chapters and Agencies the OLIS fixture touches, so the pairing is tested with the data the other
// fixture needs and nothing else.
//
// "Touches" is read from the fixture's own words, and deliberately loosely, so that the trim keeps too
// much rather than too little:
//   - an ORS chapter is touched when any document, or any text of a Measure's row, cites an ORS section
//     in it ("ORS 659A.159", "ORS 418.806 to 418.816", "ORS 409.711 and 418.808") or the chapter itself
//     ("ORS chapter 657B"). This is not the Statute Link parser (ticket #6): it does not tell amends from
//     cites, and it need not.
//   - an Agency is touched when a rule of its implements a section of a touched chapter (the table), or
//     when its name or one of its aliases is written in a document, a Measure's text or a Testimony's
//     Organization.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { orsChapterOf, parseOrsChapterId, parseOrsSectionId } from "#/packages/domain/oregonai.ts";
import { extractPdfText } from "#/packages/pdf-text/index.ts";
import type { SnapshotFile } from "#/packages/oregonai-snapshot/index.ts";

const manifestSchema = z.object({ documents: z.array(z.object({ path: z.string() })) });
const rowsSchema = z.array(z.record(z.string(), z.unknown()));

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Every text the fixture touches ORS chapters and Agencies in: the text of each document, every text
 * value of the Measures rows, and the Organization of each Testimony row.
 */
export async function readFixtureTexts(fixture: string): Promise<string[]> {
  const texts: string[] = [];
  const manifest = manifestSchema.parse(readJson(join(fixture, "manifest.json")));
  for (const document of manifest.documents) {
    const extraction = await extractPdfText(new Uint8Array(readFileSync(join(fixture, document.path))));
    if (extraction.kind !== "read") throw new Error(`The fixture document ${document.path} cannot be read as a PDF`);
    texts.push(extraction.pdf.text);
  }
  for (const row of rowsSchema.parse(readJson(join(fixture, "feed", "Measures.json")))) {
    for (const value of Object.values(row)) if (typeof value === "string") texts.push(value);
  }
  for (const row of rowsSchema.parse(readJson(join(fixture, "feed", "CommitteePublicTestimonies.json")))) {
    const organization = row["Organization"];
    if (typeof organization === "string") texts.push(organization);
  }
  return texts;
}

const section = String.raw`\d{1,3}[A-Z]?\.\d{3}[A-Z]?(?:\s*\([0-9A-Za-z]{1,3}\))*`;
const chapter = String.raw`\d{1,3}[A-Z]?`;
/** "ORS 409.711 and 418.808", "ORS 659A.150 to 659A.186", "ORS 468.130 (2), 468.140". */
const sectionCitation = new RegExp(
  String.raw`\bORS\s+(${section}(?:(?:\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or|to|through)\s+)(?:ORS\s+)?${section})*)`,
  "g",
);
/** "ORS chapter 657B", "ORS chapters 653 and 659A". */
const chapterCitation = new RegExp(
  String.raw`\bORS\s+chapters?\s+(${chapter}(?:\s*(?:,|and|or|to|through)\s*${chapter})*)`,
  "g",
);

/** The ORS chapters the texts cite, as chapter ids, in order. */
export function citedOrsChapters(texts: readonly string[]): string[] {
  const chapters = new Set<string>();
  const add = (name: string): void => {
    const id = parseOrsChapterId(`ors-chapter-${name.toLowerCase()}`);
    if (id !== undefined) chapters.add(id);
  };
  for (const text of texts) {
    for (const match of text.matchAll(sectionCitation)) {
      for (const number of (match[1] ?? "").matchAll(/(\d{1,3}[A-Z]?)\.\d{3}[A-Z]?/g)) add(number[1] ?? "");
    }
    for (const match of text.matchAll(chapterCitation)) {
      for (const number of (match[1] ?? "").matchAll(/\d{1,3}[A-Z]?/g)) add(number[0]);
    }
  }
  return [...chapters].sort(compare);
}

/** Lower case, a line broken at a hyphen mended, runs of white space made one space. */
function normalized(text: string): string {
  return text
    .replace(/-\r?\n/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}]/u.test(character);
}

/** The slugs of the agencies whose name or an alias is written, as whole words, in the texts. */
export function agenciesNamedIn(
  texts: readonly string[],
  agencies: readonly { slug: string; name: string; aliases: readonly string[] }[],
): string[] {
  // A separator no name contains, so that no name is found across the end of one text and the start of the next.
  const haystack = texts.map(normalized).join("\u0000");
  const named = new Set<string>();
  for (const agency of agencies) {
    for (const name of [agency.name, ...agency.aliases]) {
      const needle = normalized(name);
      for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
        if (!isWordCharacter(haystack[at - 1]) && !isWordCharacter(haystack[at + needle.length])) {
          named.add(agency.slug);
          break;
        }
      }
    }
  }
  return [...named].sort(compare);
}

const countsSchema = z.strictObject({
  agencies: z.number().int(),
  orsSections: z.number().int(),
  chaptersWithAgencies: z.number().int(),
});

export type Counts = z.infer<typeof countsSchema>;

/** What was kept of the snapshot and why: written beside the trimmed snapshot (`trim.json`). */
export const trimRecordSchema = z.strictObject({
  /** The fixture the snapshot was trimmed to, as the command line gave it. */
  derivedFrom: z.string(),
  /** Every ORS chapter the fixture cites. */
  orsChaptersCited: z.array(z.string()),
  /** Cited chapters of which the snapshot holds no section, so there is nothing to keep. */
  orsChaptersNotInSnapshot: z.array(z.string()),
  /** The Agencies whose name or alias the fixture's texts contain. */
  agenciesNamedInText: z.array(z.string()),
  kept: countsSchema,
  of: countsSchema,
  /** The SHA-256 of the trimmed snapshot file, so a hand edit shows. */
  snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export type TrimRecord = z.infer<typeof trimRecordSchema>;

function countsOf(file: SnapshotFile): Counts {
  return {
    agencies: file.agencies.length,
    orsSections: file.orsSections.length,
    chaptersWithAgencies: Object.keys(file.chapterAgencies).length,
  };
}

/** The snapshot cut down to what the texts touch, and the parts of the record that follow from it. */
export function trimSnapshot(
  file: SnapshotFile,
  texts: readonly string[],
): { trimmed: SnapshotFile; record: Omit<TrimRecord, "derivedFrom" | "snapshotSha256"> } {
  const cited = citedOrsChapters(texts);
  const chaptersHeld = new Set(
    file.orsSections.map((id) => {
      const parsed = parseOrsSectionId(id);
      if (parsed === undefined) throw new Error(`Not an ORS section id: ${id}`);
      return orsChapterOf(parsed);
    }),
  );
  const keptChapters = new Set(cited.filter((id) => chaptersHeld.has(parseOrsChapterIdOrThrow(id))));
  const chapterAgencies = Object.fromEntries(
    Object.entries(file.chapterAgencies).filter(([id]) => keptChapters.has(id)),
  );
  const named = agenciesNamedIn(texts, file.agencies);
  const keptAgencies = new Set([...named, ...Object.values(chapterAgencies).flat()]);
  const trimmed: SnapshotFile = {
    ...file,
    agencies: file.agencies.filter((agency) => keptAgencies.has(agency.slug)),
    orsSections: file.orsSections.filter((id) => {
      const parsed = parseOrsSectionId(id);
      return parsed !== undefined && keptChapters.has(orsChapterOf(parsed));
    }),
    chapterAgencies,
  };
  return {
    trimmed,
    record: {
      orsChaptersCited: cited,
      orsChaptersNotInSnapshot: cited.filter((id) => !keptChapters.has(id)),
      agenciesNamedInText: named,
      kept: countsOf(trimmed),
      of: countsOf(file),
    },
  };
}

function parseOrsChapterIdOrThrow(id: string): ReturnType<typeof orsChapterOf> {
  const parsed = parseOrsChapterId(id);
  if (parsed === undefined) throw new Error(`Not an ORS chapter id: ${id}`);
  return parsed;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
