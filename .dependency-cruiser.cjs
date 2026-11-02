// @ts-check
// Deep-module enforcement for dependency-cruiser.
//
// Each package under the packages root is a DEEP MODULE: a lot of behaviour
// behind a small interface. A package's PUBLIC SURFACE is its ENTRY POINTS:
// the files at the package root. Implementation lives in SUBFOLDERS and is
// private (by convention `lib/` for implementation and `tests/` for tests,
// though any subfolder is private). A package may expose several small entry
// points (index.ts, client.ts, server.ts, …); prefer that over one giant
// barrel index.
//
// The only thing you should ever need to edit here is PACKAGES_ROOT.

/** Where packages live. One immediate child dir per package (flat, no nesting). */
const PACKAGES_ROOT = "src/packages";

// --- derived patterns (no need to edit) -------------------------------------
const R = PACKAGES_ROOT;
/**
 * A package's private internals: anything nested inside a package subfolder.
 * The package's root files are its entry points and are NOT matched here:
 * they stay importable from outside.
 */
const PACKAGE_INTERNALS = `^${R}/[^/]+/[^/]+/`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "entrypoint-boundary-from-app",
      comment:
        "App/root code may import a package's entry points (its root files), but nothing inside its subfolders.",
      severity: "error",
      from: { pathNot: `^${R}/` }, // importer is NOT inside any package
      to: { path: PACKAGE_INTERNALS },
    },
    {
      name: "entrypoint-boundary-across-packages",
      comment:
        "A package's own files import each other freely, but may reach OTHER packages only through their entry points, never their internals.",
      severity: "error",
      // importer is inside a package ($1), but is not a test file
      from: { path: `^${R}/([^/]+)/`, pathNot: `^${R}/[^/]+/tests/` },
      to: {
        path: PACKAGE_INTERNALS,
        pathNot: `^${R}/$1/`, // same package → intra-package freedom
      },
    },
    {
      name: "tests-through-entrypoints",
      comment:
        "A package's tests exercise it through its entry points like everyone else: they may import any package's entry points and their own tests/ fixtures, but never any package's internals, not even their own.",
      severity: "error",
      from: { path: `^${R}/([^/]+)/tests/` }, // a test file, in package $1
      to: {
        path: PACKAGE_INTERNALS,
        pathNot: `^${R}/$1/tests/`, // own tests/ fixtures → allowed
      },
    },
    {
      name: "tests-folder-is-private",
      comment:
        "A package's tests/ folder is reachable only from tests: nothing else may import fixtures.",
      severity: "error",
      from: { pathNot: `^${R}/[^/]+/tests/` }, // importer is not itself a test
      to: { path: `^${R}/[^/]+/tests/` },
    },
    {
      name: "no-circular",
      comment: "No dependency cycles. Scope to `^${R}/` if you want to allow cycles outside packages.",
      severity: "error",
      from: {},
      to: { circular: true },
    },

    // --- Layering ---------------------------------------------------------------
    // Interface-hiding controls HOW you import (through the entry points). Layering controls WHICH
    // packages may depend on which (ADR-0009).
    {
      name: "server-reads-only",
      comment:
        "The MCP server opens the database read-only (ADR-0009): its code and its entry script may import database/reader.ts, never database/writer.ts. A server that cannot reach the writer cannot write by mistake. The package's own tests are not the server: a seam-4 test arranges an Index through the writer and reads it through the reader (test/CLAUDE.md, ticket #98).",
      severity: "error",
      from: { path: `^(${R}/mcp-server/|src/bin/server\\.ts$)`, pathNot: `^${R}/mcp-server/tests/` },
      to: { path: `^${R}/database/writer\\.ts$` },
    },
    {
      name: "worker-writes-only",
      comment:
        "The ingest worker is the only writer (ADR-0009): its code and its entry script may import database/writer.ts, never database/reader.ts.",
      severity: "error",
      from: { path: `^(${R}/ingest/|src/bin/ingest\\.ts$)` },
      to: { path: `^${R}/database/reader\\.ts$` },
    },

    // --- Nothing calls OregonAI while serving (ADR-0004) -------------------------------------------
    // OregonAI's data reaches the service one way: scripts/snapshot/build.ts reads a checkout of
    // OregonAI's repository at build time, and the worker copies the file it wrote. These rules make
    // the other ways impossible to add without a failing check.
    {
      name: "server-never-reaches-the-oregonai-snapshot",
      comment:
        "The MCP server and its entry script get what they know of OregonAI from the database (the snapshot version is stored with the full pull), never from the snapshot package, directly or through any chain of imports. Only the worker reads the snapshot file.",
      severity: "error",
      from: { path: `^(${R}/mcp-server/|src/bin/server\\.ts$)` },
      to: { path: `^${R}/oregonai-snapshot/`, reachable: true },
    },
    {
      name: "server-never-uses-network-modules",
      comment:
        "The MCP server, its entry script and every module they reach, directly or through any chain of imports, import none of the Node built-ins that can open a connection or run a client: https, http2, net, tls, dgram, dns, child_process. node:http stays, because http.ts needs createServer. The ESLint rules in eslint.config.js cover the rest of the way to a network: no global fetch or WebSocket under src/ outside the entry scripts, and nothing but createServer from node:http (ADR-0012).",
      severity: "error",
      from: { path: `^(${R}/mcp-server/|src/bin/server\\.ts$)` },
      // A core module's path is its bare name (`https`, or `dns/promises`), and no file of this repository
      // is called that, since the paths of files start with src/ or scripts/.
      to: { path: "^(node:)?(https|http2|net|tls|dgram|dns|child_process)(/promises)?$", reachable: true },
    },
    {
      name: "production-never-imports-scripts",
      comment:
        "The snapshot builder (scripts/snapshot/) is the only code that knows OregonAI's repository, and the registry it reads is parsed there by a YAML package the service does not ship. Nothing under src/ may import anything from scripts/, so the builder cannot become part of the server path.",
      severity: "error",
      from: { path: "^src/", pathNot: `^${R}/[^/]+/tests/` },
      to: { path: "^scripts/" },
    },
    {
      name: "production-uses-production-dependencies",
      comment:
        "Code under src/ imports only packages that are in dependencies, never one that is in devDependencies. The MCP client SDK, the package built to speak to a gateway such as OregonAI's, is a devDependency for the tests, so the server cannot use it.",
      severity: "error",
      from: { path: "^src/", pathNot: `^${R}/[^/]+/tests/` },
      to: { dependencyTypes: ["npm-dev"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
  },
};
