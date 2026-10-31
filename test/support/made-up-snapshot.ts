// A MADE-UP OregonAI snapshot file for tests that need a snapshot with a version of their own. It is
// valid in every way the worker checks and holds nothing true: the committed fixture
// (test/fixtures/oregonai-snapshot/) is the real data, trimmed.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type MadeUpSnapshotVersion = { source: string; commit: string; commitDate: string };

export type MadeUpSnapshot = {
  path: string;
  /** Replaces the file with one that has this version. */
  rewrite(version: Partial<MadeUpSnapshotVersion>): void;
  remove(): void;
};

/** The made-up version a snapshot has unless a test gives it another: not any commit of any repository. */
export const madeUpSnapshotVersion: MadeUpSnapshotVersion = {
  source: "executive-regulatory-frameworks",
  commit: "0123456789abcdef0123456789abcdef01234567",
  commitDate: "2026-02-03T04:05:06-08:00",
};

function fileText(version: MadeUpSnapshotVersion): string {
  return `${JSON.stringify(
    {
      formatVersion: 1,
      version,
      agencies: [
        {
          slug: "made-up-agency",
          name: "Made-Up Agency",
          aliases: [],
          oarChapter: "999",
          dasAgencyNumber: null,
          parent: null,
        },
      ],
      orsSections: ["ors-999.001", "ors-999.002"],
      chapterAgencies: { "ors-chapter-999": ["made-up-agency"] },
    },
    null,
    2,
  )}\n`;
}

export function createMadeUpSnapshot(version: Partial<MadeUpSnapshotVersion> = {}): MadeUpSnapshot {
  const directory = mkdtempSync(join(tmpdir(), "made-up-snapshot-"));
  const path = join(directory, "snapshot.json");
  writeFileSync(path, fileText({ ...madeUpSnapshotVersion, ...version }));
  return {
    path,
    rewrite: (replacement) => {
      writeFileSync(path, fileText({ ...madeUpSnapshotVersion, ...replacement }));
    },
    remove: () => {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
