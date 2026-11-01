// "Nothing in the server path calls OregonAI" (ticket #10, fourth box; ADR-0004) is a checked fact: the
// dependency-cruiser rules in .dependency-cruiser.cjs that `npm run lint:boundaries` runs. A rule that
// never matches passes for ever, so this test shows each one bites: it copies the source into a
// temporary folder, checks that the copy passes, plants an import that each rule forbids, checks that
// the cruise fails and names the rule, and checks that the copy passes again once the plant is gone.
//
// One cruise serves all the plants (ticket #47). Every plant goes in a file of its own (or, for the two
// existing files a rule is about, in that file beside the plants of other rules), the copy is cruised
// once, and the report is read per plant: a violation of that plant's rule, against that plant's file
// (the file the violation starts from, or a file on the chain of imports that reaches the forbidden
// module). A last case checks the other way: no violation is left that no plant explains, so a rule
// never fires on a file it should not. A rule that stopped biting loses its plant's violation and fails
// its own case. The cruises and the ESLint runs go in child processes at the same time, in copies of
// their own, because each one waits on a child.
//
// Like the build script's test, this is not one of the two seams spec #1 agreed (test/CLAUDE.md): it is
// the only way to see a configuration rule work. The lead's brief for ticket #10 asks for this proof, and
// the test stays provisional until the owner answers the proposal to make the seam standing (a question
// for the owner in the ticket's report); test/CLAUDE.md does not list it.
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A child that hangs is killed after this long, so its case fails and the copies can be removed.
const childProcessTimeout = 60_000;

let cruiseTree: string;
let lintTree: string;

function copyOfTheSource(prefix: string): string {
  const tree = mkdtempSync(join(tmpdir(), prefix));
  for (const entry of ["src", "scripts"]) cpSync(entry, join(tree, entry), { recursive: true });
  for (const file of ["package.json", "tsconfig.json", ".dependency-cruiser.cjs", "eslint.config.js"]) {
    cpSync(file, join(tree, file));
  }
  symlinkSync(join(process.cwd(), "node_modules"), join(tree, "node_modules"));
  return tree;
}

type Finished = { status: number | null; stdout: string; stderr: string };

/** Runs a script of node_modules in a copy and waits for it; the child gets nothing from the environment but PATH. */
function runNode(tree: string, script: string, args: string[]): Promise<Finished> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: tree,
      env: { PATH: process.env["PATH"] ?? "" },
      timeout: childProcessTimeout,
      killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

type Cruise = { status: number | null; output: string };

function cruise(): Promise<Cruise> {
  return runNode(cruiseTree, "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs", ["src"]).then(
    (finished) => ({ status: finished.status, output: `${finished.stdout}${finished.stderr}` }),
  );
}

/** One violation as dependency-cruiser's JSON reporter gives it: `via` is the chain of imports from `from` to `to`. */
type Violation = { rule: string; severity: string; from: string; to: string; via: string[] };

async function violations(): Promise<{ list: Violation[]; output: string }> {
  const finished = await runNode(cruiseTree, "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs", [
    "--output-type",
    "json",
    "src",
  ]);
  const output = `${finished.stdout}${finished.stderr}`;
  try {
    const report = JSON.parse(finished.stdout) as {
      summary: {
        violations: { rule: { name: string; severity: string }; from: string; to: string; via?: { name: string }[] }[];
      };
    };
    const list = report.summary.violations.map((violation) => ({
      rule: violation.rule.name,
      severity: violation.rule.severity,
      from: violation.from,
      to: violation.to,
      via: (violation.via ?? []).map((step) => step.name),
    }));
    return { list, output };
  } catch {
    return { list: [], output }; // the cases that read the list fail with the output
  }
}

/** Puts each file's lines at its top, runs `whileThere`, and puts every file back as it was. */
async function withPlants<T>(lines: Map<string, string[]>, whileThere: () => Promise<T>): Promise<T> {
  const originals = new Map<string, string | undefined>();
  try {
    for (const [file, added] of lines) {
      const path = join(cruiseTree, file);
      let original: string | undefined;
      try {
        original = readFileSync(path, "utf8");
      } catch {
        original = undefined; // a new file
      }
      originals.set(file, original);
      writeFileSync(path, `${added.join("\n")}\n${original ?? ""}`);
    }
    return await whileThere();
  } finally {
    for (const [file, original] of originals) {
      const path = join(cruiseTree, file);
      if (original === undefined) rmSync(path, { force: true });
      else writeFileSync(path, original);
    }
  }
}

/** The file for a plant that goes in a new file: one of its own in the folder, named for what it plants. */
const newFile = (folder: string, name: string): string => `${folder}/planted-${name}.ts`;

// Each plant has a file of its own, so a violation can be read against it, except where the rule is about an
// existing file (the database reader the server uses, the server's entry script): there the plants of different
// rules share the file, and a violation is told apart by its rule. The plants of one rule are all in other files.
//
// [what is planted, the file it goes in, the import, the rule that must name it, the module a network plant
//  reaches (dependency-cruiser's name for it), if the case checks it]
const plants: readonly (readonly [string, string, string, string, string?])[] = [
  [
    "the MCP server imports the snapshot package",
    newFile("src/packages/mcp-server/lib", "snapshot"),
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
    newFile("src/packages/ingest/lib", "snapshot-builder"),
    'export { readErfSnapshot } from "../../../../scripts/snapshot/erf.ts";',
    "production-never-imports-scripts",
  ],
  [
    "production code imports the MCP client SDK, which could speak to OregonAI's gateway",
    newFile("src/packages/mcp-server/lib", "mcp-client"),
    'export { Client } from "@modelcontextprotocol/client";',
    "production-uses-production-dependencies",
  ],
  [
    "production code imports the YAML package the snapshot builder uses",
    newFile("src/packages/ingest/lib", "yaml"),
    'export { parse } from "yaml";',
    "production-uses-production-dependencies",
  ],
  // A network client of the standard library is a way to call OregonAI that no package import shows (F1).
  ...["node:https", "node:http2", "node:net", "node:tls", "node:dgram", "node:dns", "node:dns/promises"].map(
    (module): readonly [string, string, string, string, string?] => [
      `the MCP server imports ${module}`,
      newFile("src/packages/mcp-server/lib", module.replace(/\W+/g, "-")),
      `import * as planted from "${module}";\nexport { planted };`,
      "server-never-uses-network-modules",
      module.replace("node:", ""),
    ],
  ),
  [
    "the MCP server spawns a process, which could run a client of OregonAI",
    newFile("src/packages/mcp-server/lib", "spawn"),
    'export { spawn } from "node:child_process";',
    "server-never-uses-network-modules",
    "child_process",
  ],
  [
    "the server's entry script imports node:https",
    "src/bin/server.ts",
    'export { request as planted } from "node:https";',
    "server-never-uses-network-modules",
    "https",
  ],
  [
    "the database reader the server uses imports node:tls, so the server reaches it through a chain",
    "src/packages/database/reader.ts",
    'export { connect as planted } from "node:tls";',
    "server-never-uses-network-modules",
    "tls",
  ],
];

/** Does the violation start at the file, or reach what is forbidden through it? */
const reportsAgainst = (violation: Violation, file: string): boolean =>
  violation.from === file || violation.via.includes(file);

// The three cruises of the proof run one after another, because they are of one folder: the copy as it is, the
// copy with every plant in it (once as text for the exit status, once as JSON for the violations), and the copy
// again. They start together with the ESLint runs below, which have a copy of their own.
type Planted = { text: Cruise; json: Awaited<ReturnType<typeof violations>> };
let cleanCruise: Promise<Cruise>;
let plantedCruise: Promise<Planted>;
let cleanAgain: Promise<Cruise>;

function startCruises(): void {
  cleanCruise = cruise();
  plantedCruise = cleanCruise.then(() => {
    const lines = new Map<string, string[]>();
    for (const [, file, line] of plants) lines.set(file, [...(lines.get(file) ?? []), line]);
    return withPlants(lines, async () => {
      const [text, json] = await Promise.all([cruise(), violations()]);
      return { text, json };
    });
  });
  cleanAgain = plantedCruise.then(() => cruise());
}

// Each case waits for a cruise or an ESLint run that is a child process, about a second to three here, but over
// 5 s (Vitest's default) on a GitHub Actions runner, so these cases get their own bound.
describe("the rules that keep OregonAI out of the server path", { timeout: childProcessTimeout }, () => {
  it("pass on the source as it is, and cruise a real number of modules", async () => {
    const clean = await cleanCruise;

    expect(clean.output).toContain("no dependency violations found");
    expect(clean.status).toBe(0);
    expect(Number(/(\d+) modules/.exec(clean.output)?.[1])).toBeGreaterThan(30);
  });

  it.for(plants)("fail, naming the rule, when %s", async ([, file, , rule, reached]) => {
    const planted = await plantedCruise;
    // Only an `error` ends the cruise with a failing status, as the text cruise below needs; a rule downgraded to
    // `warn` loses its plant's violation here and fails its own case.
    const against = planted.json.list.filter(
      (violation) => violation.rule === rule && violation.severity === "error" && reportsAgainst(violation, file),
    );

    expect(planted.text.status).not.toBe(0);
    expect(planted.text.output).toContain(rule);
    expect(against, `${rule} against ${file}:\n${planted.json.output}`).not.toHaveLength(0);
    if (reached !== undefined) expect(against.map((violation) => violation.to)).toContain(reached);
  });

  it("fire on no file that no plant explains", async () => {
    const planted = await plantedCruise;
    const unexplained = planted.json.list.filter(
      (violation) => !plants.some(([, file, , rule]) => violation.rule === rule && reportsAgainst(violation, file)),
    );

    expect(planted.json.list, planted.json.output).not.toHaveLength(0);
    expect(unexplained).toEqual([]);
  });

  it("pass again once the planted imports are gone", async () => {
    const clean = await cleanAgain;

    expect(clean.output).toContain("no dependency violations found");
    expect(clean.status).toBe(0);
  });
});

// The same proof for the rules ESLint runs (`npm run lint`): code under src/ except the entry scripts has no
// way to a network but the `fetch` it is given (src/CLAUDE.md, "Dependencies are passed in"), and the
// server's one use of node:http is createServer.
// `errors` is the rules of the messages that ESLint reports at error severity (2): only those fail `npm run lint`.
type Lint = { status: number | null; messages: Map<string, string[]>; errors: Map<string, string[]>; output: string };

async function lint(): Promise<Lint> {
  const finished = await runNode(lintTree, "node_modules/eslint/bin/eslint.js", ["--format", "json", "src"]);
  const messages = new Map<string, string[]>();
  const errors = new Map<string, string[]>();
  try {
    const report = JSON.parse(finished.stdout) as {
      filePath: string;
      messages: { ruleId: string | null; severity: number }[];
    }[];
    for (const file of report) {
      const path = file.filePath.slice(lintTree.length + 1);
      const rule = (message: { ruleId: string | null }): string => message.ruleId ?? "(no rule)";
      messages.set(path, file.messages.map(rule));
      errors.set(path, file.messages.filter((message) => message.severity === 2).map(rule));
    }
  } catch {
    // The output stays in `output`, and the assertions on `status`, `messages` and `errors` fail with it.
  }
  return { status: finished.status, messages, errors, output: `${finished.stdout}${finished.stderr}` };
}

/** Writes files that do not exist in the copy, runs ESLint, and removes them again. */
async function lintWithPlants(files: Record<string, string>): Promise<Lint> {
  for (const [file, text] of Object.entries(files)) writeFileSync(join(lintTree, file), text);
  try {
    return await lint();
  } finally {
    for (const file of Object.keys(files)) rmSync(join(lintTree, file), { force: true });
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

let cleanLint: Promise<Lint>;
let plantedLint: Promise<Lint>;
let cleanLintAgain: Promise<Lint>;

function startLints(): void {
  cleanLint = lint();
  plantedLint = cleanLint.then(() =>
    lintWithPlants(Object.fromEntries(lintPlants.map(([, file, text]) => [file, text]))),
  );
  cleanLintAgain = plantedLint.then(() => lint());
}

describe(
  "the rules that keep a network client out of the server path (ESLint)",
  { timeout: childProcessTimeout },
  () => {
    it("pass on the source as it is: the entry script that makes fetch may use it, the server's createServer is allowed", async () => {
      const clean = await cleanLint;

      expect(clean.status, clean.output).toBe(0);
      expect(clean.messages.get("src/bin/ingest.ts")).toEqual([]);
      expect(clean.messages.get("src/packages/mcp-server/http.ts")).toEqual([]);
    });

    // Only an error fails `npm run lint`; a rule downgraded to "warn" still names the plant but lets it through,
    // so each case reads the rule among the file's error-severity messages (ticket #89).
    it.for(lintPlants)(
      "fail, naming the rule at error severity and the file, when %s",
      async ([what, file, , rule]) => {
        const planted = await plantedLint;

        // `status` is not the severity check: the other plants keep the exit non-zero even when one rule is "warn".
        expect(planted.status).not.toBe(0);
        expect(planted.errors.get(file), what).toContain(rule);
      },
    );

    it("pass again once the planted files are gone", async () => {
      const clean = await cleanLintAgain;

      expect(clean.status, clean.output).toBe(0);
    });
  },
);

// The cruises and the ESLint runs start together, each chain in a copy of its own, and the cases above wait for
// their part of it. Nothing is left running when the file ends.
const started: Promise<unknown>[] = [];

beforeAll(() => {
  cruiseTree = copyOfTheSource("oregonai-boundary-cruise-");
  lintTree = copyOfTheSource("oregonai-boundary-lint-");
  startCruises();
  startLints();
  started.push(cleanCruise, plantedCruise, cleanAgain, cleanLint, plantedLint, cleanLintAgain);
  for (const promise of started) promise.catch(() => undefined); // the case that waits on it reports the failure
});

afterAll(async () => {
  await Promise.allSettled(started);
  rmSync(cruiseTree, { recursive: true, force: true });
  rmSync(lintTree, { recursive: true, force: true });
});
