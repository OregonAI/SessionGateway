// "Nothing in the server path calls OregonAI" (ticket #10, fourth box; ADR-0004) is a checked fact: the
// dependency-cruiser rules in .dependency-cruiser.cjs that `npm run lint:boundaries` runs. A rule that
// never matches passes for ever, so this test shows each one bites: it copies the source into a
// temporary folder, checks that the copy passes, plants an import that each rule forbids, checks that
// the cruise fails and names the rule, and checks that the copy passes again once the plant is gone.
//
// Like the build script's test, this is not one of the two seams spec #1 agreed (test/CLAUDE.md): it is
// the only way to see a configuration rule work. The lead's brief for ticket #10 asks for this proof, and
// the test stays provisional until the owner answers the proposal to make the seam standing (a question
// for the owner in the ticket's report); test/CLAUDE.md does not list it.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tree: string;

beforeAll(() => {
  tree = mkdtempSync(join(tmpdir(), "oregonai-boundary-"));
  for (const entry of ["src", "scripts"]) cpSync(entry, join(tree, entry), { recursive: true });
  for (const file of ["package.json", "tsconfig.json", ".dependency-cruiser.cjs", "eslint.config.js"]) {
    cpSync(file, join(tree, file));
  }
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
  // A network client of the standard library is a way to call OregonAI that no package import shows (F1).
  ...["node:https", "node:http2", "node:net", "node:tls", "node:dgram", "node:dns", "node:dns/promises"].map(
    (module): readonly [string, string, string, string] => [
      `the MCP server imports ${module}`,
      "src/packages/mcp-server/lib/planted.ts",
      `import * as planted from "${module}";\nexport { planted };`,
      "server-never-uses-network-modules",
    ],
  ),
  [
    "the MCP server spawns a process, which could run a client of OregonAI",
    "src/packages/mcp-server/lib/planted.ts",
    'export { spawn } from "node:child_process";',
    "server-never-uses-network-modules",
  ],
  [
    "the server's entry script imports node:https",
    "src/bin/server.ts",
    'export { request as planted } from "node:https";',
    "server-never-uses-network-modules",
  ],
  [
    "the database reader the server uses imports node:tls, so the server reaches it through a chain",
    "src/packages/database/reader.ts",
    'export { connect as planted } from "node:tls";',
    "server-never-uses-network-modules",
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

// The same proof for the rules ESLint runs (`npm run lint`): code under src/ except the entry scripts has no
// way to a network but the `fetch` it is given (src/CLAUDE.md, "Dependencies are passed in"), and the
// server's one use of node:http is createServer.
type Lint = { status: number | null; messages: Map<string, string[]>; output: string };

function lint(): Lint {
  const finished = spawnSync(process.execPath, ["node_modules/eslint/bin/eslint.js", "--format", "json", "src"], {
    cwd: tree,
    env: { PATH: process.env["PATH"] ?? "" },
    encoding: "utf8",
  });
  const messages = new Map<string, string[]>();
  try {
    const report = JSON.parse(finished.stdout) as { filePath: string; messages: { ruleId: string | null }[] }[];
    for (const file of report) {
      messages.set(
        file.filePath.slice(tree.length + 1),
        file.messages.map((message) => message.ruleId ?? "(no rule)"),
      );
    }
  } catch {
    // The output stays in `output`, and the assertions on `status` and `messages` fail with it.
  }
  return { status: finished.status, messages, output: `${finished.stdout}${finished.stderr}` };
}

/** Writes files that do not exist in the copy, runs ESLint, and removes them again. */
function lintWithPlants(files: Record<string, string>): Lint {
  for (const [file, text] of Object.entries(files)) writeFileSync(join(tree, file), text);
  try {
    return lint();
  } finally {
    for (const file of Object.keys(files)) rmSync(join(tree, file), { force: true });
  }
}

// [what is planted, the file it goes in, its text, the ESLint rule that must name it]
const lintPlants: readonly (readonly [string, string, string, string])[] = [
  [
    "the MCP server calls the global fetch",
    "src/packages/mcp-server/lib/planted-fetch.ts",
    'export function planted(): Promise<Response> {\n  return fetch("https://corpus.oregonai.example/mcp", { method: "POST" });\n}\n',
    "no-restricted-globals",
  ],
  [
    "the database reader the server uses calls the global fetch",
    "src/packages/database/lib/planted-fetch.ts",
    'export function planted(): Promise<Response> {\n  return fetch("https://corpus.oregonai.example/mcp");\n}\n',
    "no-restricted-globals",
  ],
  [
    "the MCP server opens a WebSocket",
    "src/packages/mcp-server/lib/planted-socket.ts",
    'export function planted(): WebSocket {\n  return new WebSocket("wss://corpus.oregonai.example/mcp");\n}\n',
    "no-restricted-globals",
  ],
  [
    "the MCP server reaches fetch through globalThis",
    "src/packages/mcp-server/lib/planted-global-this.ts",
    'export function planted(): Promise<Response> {\n  return globalThis.fetch("https://corpus.oregonai.example/mcp");\n}\n',
    "no-restricted-properties",
  ],
  [
    "the MCP server loads node:https at run time",
    "src/packages/mcp-server/lib/planted-builtin.ts",
    'export const planted = process.getBuiltinModule("node:https");\n',
    "no-restricted-properties",
  ],
  [
    "the MCP server imports request from node:http",
    "src/packages/mcp-server/lib/planted-http-request.ts",
    'export { request as planted } from "node:http";\n',
    "@typescript-eslint/no-restricted-imports",
  ],
  [
    "the MCP server imports the whole of node:http",
    "src/packages/mcp-server/lib/planted-http-namespace.ts",
    'import * as http from "node:http";\nexport const planted = http;\n',
    "@typescript-eslint/no-restricted-imports",
  ],
];

describe("the rules that keep a network client out of the server path (ESLint)", () => {
  it("pass on the source as it is: the entry script that makes fetch may use it, the server's createServer is allowed", () => {
    const clean = lint();

    expect(clean.status, clean.output).toBe(0);
    expect(clean.messages.get("src/bin/ingest.ts")).toEqual([]);
    expect(clean.messages.get("src/packages/mcp-server/http.ts")).toEqual([]);
  });

  it("fail, naming the rule and the file, for each way to a network that is planted", () => {
    const planted = lintWithPlants(Object.fromEntries(lintPlants.map(([, file, text]) => [file, text])));

    expect(planted.status).not.toBe(0);
    for (const [what, file, , rule] of lintPlants) {
      expect(planted.messages.get(file), what).toContain(rule);
    }
  });

  it("pass again once the planted files are gone", () => {
    const clean = lint();

    expect(clean.status, clean.output).toBe(0);
  });
});
