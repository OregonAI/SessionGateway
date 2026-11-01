// The FloorLetters set (ticket #64, ADR-0045): letters sent to a chamber's floor, each a file at `FloorLetterUrl`
// and a row that may name a Measure. The set has no CreatedDate and no ModifiedDate (docs/research/olis-odata.md
// section 8), so an increment cannot ask for what changed since a time: it asks for the ids above the highest one the
// index holds, which OLIS numbers in order (ADR-0005).
import { z } from "zod";
import { measureIdOf, type SessionKey } from "#/packages/domain/index.ts";
import { floorLetterIdOf, type DocumentLink, type DocumentRelation } from "#/packages/domain/documents.ts";
import { feedChamber } from "./chamber.ts";
import { sourceUrlOf } from "./documents.ts";
import { readEntitySet } from "./feed.ts";
import type { OlisClientOptions } from "./options.ts";
import { feedTimestamp } from "./timestamps.ts";

// MeasurePrefix and MeasureNumber are null on a letter that names no Measure, as on FloorLetterId 4220
// (olis-odata.md section 2). The title and the description are read as text the feed may leave out.
const floorLetterRow = z.looseObject({
  SessionKey: z.string(),
  FloorLetterId: z.number().int(),
  MeasurePrefix: z.string().nullish(),
  MeasureNumber: z.number().int().nullish(),
  LetterDate: feedTimestamp,
  Chamber: feedChamber,
  LetterTitle: z.string().nullish(),
  LetterDescription: z.string().nullish(),
  FloorLetterUrl: z.string(),
});

/** An OData string literal: single quotes doubled. */
function literal(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

/** What a hit and `get_document` call a letter: its title, else its description, else what it is. */
function labelOf(title: string | null, description: string | null): string {
  const named = [title, description].find((text) => text !== null && text.trim() !== "");
  return named?.trim() ?? "Floor Letter";
}

/**
 * The Session's Floor Letters, as document links that carry their row. With `aboveId`, only the letters whose
 * `FloorLetterId` is greater (an increment's read); without it, the whole set, counted with `$count` like every set a
 * full pull reads. A row of another Session is never taken for this one.
 */
export async function readFloorLetters(
  options: OlisClientOptions,
  session: SessionKey,
  aboveId: number | undefined,
  signal: AbortSignal,
): Promise<DocumentLink[]> {
  const terms = [`SessionKey eq ${literal(session)}`, ...(aboveId === undefined ? [] : [`FloorLetterId gt ${aboveId}`])];
  const rows = await readEntitySet(options, "FloorLetters", terms.join(" and "), floorLetterRow, signal);
  return rows
    .filter((row) => row.SessionKey === session && (aboveId === undefined || row.FloorLetterId > aboveId))
    .map((row): DocumentLink => {
      const id = floorLetterIdOf(session, row.FloorLetterId);
      const title = row.LetterTitle ?? null;
      const description = row.LetterDescription ?? null;
      const relations: DocumentRelation[] = [];
      if (row.MeasurePrefix !== null && row.MeasurePrefix !== undefined && typeof row.MeasureNumber === "number") {
        relations.push({
          relation: "measure",
          to: measureIdOf({ session, prefix: row.MeasurePrefix, number: row.MeasureNumber }),
          meaning: null,
          provenance: `FloorLetters ${row.FloorLetterId}`,
        });
      }
      return {
        id,
        nodeId: id,
        kind: "floor_letter",
        label: labelOf(title, description),
        sourceUrl: sourceUrlOf(row.FloorLetterUrl),
        postedAt: null,
        date: row.LetterDate,
        floorLetter: {
          floorLetterId: row.FloorLetterId,
          chamber: row.Chamber,
          letterDate: row.LetterDate,
          title,
          description,
        },
        relations,
      };
    });
}
