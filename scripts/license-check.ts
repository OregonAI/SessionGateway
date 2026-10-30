// Licence check for the supply-chain job in CI (root CLAUDE.md, "Dependencies"; ADR-0008). Every
// package a deployment ships (`npm sbom --omit=dev`) must carry a permissive licence. Dependency-free,
// run by Node 26 as `node scripts/license-check.ts`. It reads only local files, so it needs no network.
//
// A package outside the allowlist needs the owner's approval in its PR, then an entry in `exceptions`
// naming the package, its licence and the reason. The list starts empty.
//
// `npm sbom --omit=dev` (npm 11.20.0) leaves out a production package that a dev dependency also
// depends on: with @modelcontextprotocol/client as a dev dependency, it omitted zod and
// @modelcontextprotocol/core, both of them in the production tree (`npm ls --omit=dev` lists them).
// A check that trusts the list would never see such a package, so this script also walks
// package-lock.json from the root's own dependencies and checks every package the SBOM missed, using
// the licence the lockfile records.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** SPDX identifiers whose licences are permissive enough to ship. */
const allowed: readonly string[] = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD"];

type Exception = { name: string; license: string; reason: string };
const exceptions: readonly Exception[] = [];

type Component = { name: string; version: string; license: string };

/** Whether an SPDX licence expression is allowed: `OR` needs one allowed side, `AND` needs both. */
function expressionAllowed(expression: string): boolean {
  const tokens = expression
    .replace(/([()])/g, " $1 ")
    .split(/\s+/)
    .filter((token) => token !== "");
  let position = 0;
  function parseOr(): boolean {
    let result = parseAnd();
    while (tokens[position] === "OR") {
      position += 1;
      const right = parseAnd();
      result = result || right;
    }
    return result;
  }
  function parseAnd(): boolean {
    let result = parseTerm();
    while (tokens[position] === "AND") {
      position += 1;
      const right = parseTerm();
      result = result && right;
    }
    return result;
  }
  function parseTerm(): boolean {
    const token = tokens[position];
    position += 1;
    if (token === "(") {
      const inner = parseOr();
      position += 1; // the closing parenthesis
      return inner;
    }
    // A "WITH <exception>" clause, an unknown id and NOASSERTION are none of them on the list.
    return token !== undefined && allowed.includes(token) && tokens[position] !== "WITH";
  }
  const result = parseOr();
  return result && position === tokens.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fromSbom(): Component[] {
  const result = spawnSync("npm", ["sbom", "--omit=dev", "--sbom-format", "spdx"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`npm sbom --omit=dev failed (${String(result.status)}): ${result.stderr}`);
  }
  const sbom: unknown = JSON.parse(result.stdout);
  if (!isRecord(sbom) || !Array.isArray(sbom["packages"]) || !Array.isArray(sbom["documentDescribes"])) {
    throw new Error("npm sbom --omit=dev did not print an SPDX document with packages");
  }
  const root = new Set<unknown>(sbom["documentDescribes"]);
  const components: Component[] = [];
  for (const entry of sbom["packages"] as unknown[]) {
    if (!isRecord(entry) || root.has(entry["SPDXID"])) continue;
    const { name, versionInfo, licenseDeclared } = entry;
    if (typeof name !== "string" || typeof versionInfo !== "string") {
      throw new Error("npm sbom --omit=dev listed a package with no name or version");
    }
    components.push({
      name,
      version: versionInfo,
      license: typeof licenseDeclared === "string" ? licenseDeclared : "",
    });
  }
  return components;
}

type LockEntry = {
  name?: string;
  version?: string;
  license?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

/** Every package in package-lock.json reachable from the root's dependencies, as npm resolves them. */
function fromLockfile(): Component[] {
  const lock: unknown = JSON.parse(readFileSync("package-lock.json", "utf8"));
  if (!isRecord(lock) || !isRecord(lock["packages"])) throw new Error("package-lock.json has no packages");
  const packages = lock["packages"] as Record<string, LockEntry | undefined>;
  const root = packages[""];
  if (root === undefined) throw new Error("package-lock.json has no root package");

  /** Where `name` resolves when required from the package at `from`: its own node_modules, then each parent's. */
  function resolve(from: string, name: string): string | undefined {
    let scope = from;
    for (;;) {
      const candidate = scope === "" ? `node_modules/${name}` : `${scope}/node_modules/${name}`;
      if (packages[candidate] !== undefined) return candidate;
      if (scope === "") return undefined;
      const cut = scope.lastIndexOf("node_modules/");
      scope = cut <= 0 ? "" : scope.slice(0, cut - 1);
    }
  }

  const seen = new Set<string>();
  const queue: string[] = [""];
  for (let path = queue.pop(); path !== undefined; path = queue.pop()) {
    const entry = packages[path];
    if (entry === undefined) continue;
    const wanted = [
      ...Object.keys(entry.dependencies ?? {}),
      ...Object.keys(entry.optionalDependencies ?? {}),
      ...Object.keys(entry.peerDependencies ?? {}),
    ];
    for (const name of wanted) {
      const found = resolve(path, name);
      if (found !== undefined && !seen.has(found)) {
        seen.add(found);
        queue.push(found);
      }
    }
  }
  const components: Component[] = [];
  for (const path of seen) {
    const entry = packages[path];
    const name = entry?.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    components.push({ name, version: entry?.version ?? "", license: entry?.license ?? "" });
  }
  return components;
}

const fromSbomList = fromSbom();
const listed = new Set(fromSbomList.map((component) => `${component.name}@${component.version}`));
const missedBySbom = fromLockfile().filter((component) => !listed.has(`${component.name}@${component.version}`));
if (missedBySbom.length > 0) {
  console.log(
    `npm sbom --omit=dev left out ${missedBySbom.length} production package(s); checking them from package-lock.json: ` +
      missedBySbom.map((component) => `${component.name}@${component.version}`).join(", "),
  );
}

const failures: string[] = [];
for (const component of [...fromSbomList, ...missedBySbom]) {
  const label = `${component.name}@${component.version} (${component.license === "" ? "no licence recorded" : component.license})`;
  const exception = exceptions.find(
    (candidate) => candidate.name === component.name && candidate.license === component.license,
  );
  if (exception !== undefined) {
    console.log(`excepted  ${label}: ${exception.reason}`);
  } else if (component.license !== "" && expressionAllowed(component.license)) {
    console.log(`allowed   ${label}`);
  } else {
    failures.push(label);
    console.log(`REJECTED  ${label}`);
  }
}

const checked = fromSbomList.length + missedBySbom.length;
if (checked === 0) {
  console.error("licence check: no production package found, so nothing was checked");
  process.exit(1);
}
if (failures.length > 0) {
  console.error(
    `\nlicence check FAILED: ${failures.length} package(s) outside the allowlist (${allowed.join(", ")}). ` +
      "A package outside it needs the owner's approval, then an entry in `exceptions` in scripts/license-check.ts.",
  );
  process.exit(1);
}
console.log(`\nlicence check passed: ${checked} production package(s), all on the allowlist`);
