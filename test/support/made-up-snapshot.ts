// A MADE-UP OregonAI snapshot file for tests that need a snapshot with a version of their own. It is
// valid in every way the worker checks and holds nothing true: the committed fixture
// (test/fixtures/oregonai-snapshot/) is the real data, trimmed.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotFixturePath } from "./oregonai-snapshot.ts";

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

/** The parts of the snapshot file a test changes. */
export type FixtureSnapshot = {
  version: MadeUpSnapshotVersion;
  orsSections: string[];
  agencies: { slug: string; aliases: string[] }[];
};

export type FixtureCopy = {
  path: string;
  /** Rewrites the copy: the made-up version in place of the fixture's, and whatever `change` does to the rest. */
  changeIt: () => void;
  remove: () => void;
};

/**
 * A MADE-UP copy of the committed snapshot fixture in a folder of its own, for a test that pulls twice: the first pull
 * reads it as it is, and `changeIt()` rewrites it with a version of its own (`madeUpSnapshotVersion`'s commit, dated
 * 2026-10-01) and whatever `change` does to the parsed file. Nothing in the rewritten file is true.
 */
export function createFixtureCopy(change: (snapshot: FixtureSnapshot) => void): FixtureCopy {
  const directory = mkdtempSync(join(tmpdir(), "made-up-snapshot-copy-"));
  const path = join(directory, "snapshot.json");
  const original = readFileSync(snapshotFixturePath, "utf8");
  writeFileSync(path, original);
  return {
    path,
    changeIt: () => {
      const snapshot = JSON.parse(original) as FixtureSnapshot;
      snapshot.version = {
        ...snapshot.version,
        commit: madeUpSnapshotVersion.commit,
        commitDate: "2026-10-01T09:00:00-07:00",
      };
      change(snapshot);
      writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`);
    },
    remove: () => {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
