// The OregonAI snapshot (spec #1, module 6; ADR-0004): the slice of OregonAI's executive-regulatory-frameworks
// data that is copied at build time and read from then on, so that nothing calls OregonAI while serving. This
// package parses the snapshot file at the edge into domain types. The script that builds the file from a
// checkout of OregonAI's repository is scripts/snapshot/build.ts, and only that script knows that repository.
import { readFile } from "node:fs/promises";
import type { AgencyId, OrsChapterId, OrsSectionId, SnapshotVersion } from "#/packages/domain/oregonai.ts";
import { snapshotSchema, type SnapshotFile } from "./lib/schema.ts";

export type { SnapshotFile };

/** One row of OregonAI's agency registry. A sub-unit of an Agency (a division with its own OAR chapter) has a row of its own. */
export type Agency = {
  slug: AgencyId;
  /** The name the registry gives the body. */
  name: string;
  /** Other names the same body is known by, including former names. */
  aliases: string[];
  /** The OAR chapter the body's rules are filed under, such as "340". A body that issues no rules has none. */
  oarChapter: string | null;
  /** The number DAS assigns the body in the Oregon Accounting Manual, such as "340". */
  dasAgencyNumber: string | null;
};

export type Snapshot = {
  formatVersion: 1;
  version: SnapshotVersion;
  /** Every row of the registry, by slug. */
  agencies: Agency[];
  /** Every ORS section OregonAI holds, by id. */
  orsSections: OrsSectionId[];
  /**
   * For an ORS chapter, the Agencies whose rules implement its sections, by slug. A chapter that no rule
   * implements has no entry.
   */
  chapterAgencies: ReadonlyMap<OrsChapterId, AgencyId[]>;
};

/** Parses what a snapshot file holds. Throws, naming each problem, if it is not a snapshot. */
export function parseSnapshot(raw: unknown): Snapshot {
  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Not an OregonAI snapshot: ${problems.slice(0, 10).join("; ")}`);
  }
  return parsed.data;
}

/** Reads and parses the snapshot file at this path. */
export async function loadSnapshot(path: string): Promise<Snapshot> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Could not read the OregonAI snapshot at "${path}"`, { cause: error });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`The OregonAI snapshot at "${path}" is not JSON`, { cause: error });
  }
  try {
    return parseSnapshot(raw);
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    throw new Error(`The file at "${path}" is not an OregonAI snapshot. ${problem}`, { cause: error });
  }
}
