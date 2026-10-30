// "Nothing in the server path calls OregonAI" (ticket #10, fourth box; ADR-0004) is a checked fact: the
// dependency-cruiser rules in .dependency-cruiser.cjs that `npm run lint:boundaries` runs. A rule that
// never matches passes for ever, so this test shows each one bites: it copies the source into a
// temporary folder, checks that the copy passes, plants an import that each rule forbids, checks that
// the cruise fails and names the rule, and checks that the copy passes again once the plant is gone.
//
// Like the build script's test, this is not one of the two seams spec #1 agreed (test/CLAUDE.md): it is
// the only way to see a configuration rule work. It is recorded as a decision in the ticket's report.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tree: string;

beforeAll(() => {
  tree = mkdtempSync(join(tmpdir(), "oregonai-boundary-"));
  for (const entry of ["src", "scripts"]) cpSync(entry, join(tree, entry), { recursive: true });
  for (const file of ["package.json", "tsconfig.json", ".dependency-cruiser.cjs"]) cpSync(file, join(tree, file));
  symlinkSync(join(process.cwd(), "node_modules"), join(tree, "node_modules"));
});

afterAll(() => {
  rmSync(tree, { recursive: true, force: true });
});

type Cruise = { status: number | null; output: string };

function cruise(): Cruise {
  const finished = spawnSync(process.execPath, ["node_modules/dependency-cruiser/bin/dependency-cruiser.mjs", "src"], {
    cwd: tree,
    env: { PATH: process.env["PATH"] ?? "" },
    encoding: "utf8",
  });
  return { status: finished.status, output: `${finished.stdout}${finished.stderr}` };
}

/** Adds a line to the top of a copied file, runs the cruise, and puts the file back as it was. */
function cruiseWithPlant(file: string, line: string): Cruise {
  const path = join(tree, file);
  let original: string | undefined;
  try {
    original = readFileSync(path, "utf8");
  } catch {
    original = undefined; // a new file
  }
  writeFileSync(path, `${line}\n${original ?? ""}`);
  try {
    return cruise();
  } finally {
    if (original === undefined) rmSync(path);
    else writeFileSync(path, original);
  }
}

// [what is planted, the file it goes in, the import, the rule that must name it]
const plants: readonly (readonly [string, string, string, string])[] = [
  [
    "the MCP server imports the snapshot package",
    "src/packages/mcp-server/lib/planted.ts",
    'export { loadSnapshot } from "#/packages/oregonai-snapshot/index.ts";',
    "server-never-reaches-the-oregonai-snapshot",
  ],
  [
    "the database reader the server uses imports the snapshot package, so the server reaches it through a chain",
    "src/packages/database/reader.ts",
    'export { loadSnapshot as planted } from "#/packages/oregonai-snapshot/index.ts";',
    "server-never-reaches-the-oregonai-snapshot",
  ],
  [
    "the server's entry script imports the snapshot package",
    "src/bin/server.ts",
    'export { loadSnapshot as planted } from "#/packages/oregonai-snapshot/index.ts";',
    "server-never-reaches-the-oregonai-snapshot",
  ],
  [
    "production code imports the snapshot builder",
    "src/packages/ingest/lib/planted.ts",
    'export { readErfSnapshot } from "../../../../scripts/snapshot/erf.ts";',
    "production-never-imports-scripts",
  ],
  [
    "production code imports the MCP client SDK, which could speak to OregonAI's gateway",
    "src/packages/mcp-server/lib/planted.ts",
    'export { Client } from "@modelcontextprotocol/client";',
    "production-uses-production-dependencies",
  ],
  [
    "production code imports the YAML package the snapshot builder uses",
    "src/packages/ingest/lib/planted.ts",
    'export { parse } from "yaml";',
    "production-uses-production-dependencies",
  ],
];

describe("the rules that keep OregonAI out of the server path", () => {
  it("pass on the source as it is, and cruise a real number of modules", () => {
    const clean = cruise();

    expect(clean.output).toContain("no dependency violations found");
    expect(clean.status).toBe(0);
    expect(Number(/(\d+) modules/.exec(clean.output)?.[1])).toBeGreaterThan(30);
  });

  it.for(plants)("fail, naming the rule, when %s", ([, file, line, rule]) => {
    const planted = cruiseWithPlant(file, line);

    expect(planted.status).not.toBe(0);
    expect(planted.output).toContain(rule);
  });

  it("pass again once the planted imports are gone", () => {
    const clean = cruise();

    expect(clean.output).toContain("no dependency violations found");
    expect(clean.status).toBe(0);
  });
});
