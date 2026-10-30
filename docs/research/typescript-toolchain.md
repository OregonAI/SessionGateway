# TypeScript / Node.js language and toolchain for SessionGateway

Researched 2026-10-29. Every version and date below was read on 2026-10-29 unless another date is given.

> **What was decided (2026-10-29).** ADR-0008 takes this file's picks for Node 26, type stripping, TypeScript 7 with the TypeScript 6 alias, ESLint with typescript-eslint, and Prettier. One change: the release-age window is 14 days, not 7. A later check found that the same alias also makes dependency-cruiser work. Under it, `typescript` resolves to 6.0.3, and dependency-cruiser 18.7.0 cruised 3 modules and caught a planted deep import.

Labels used below:
- **verified**: I read the fact at the cited URL or file, or saw it in command output (`npm view`, `gh`, `curl` of a source repo).
- **inferred**: my reading of verified evidence, not stated by the source.
- **local measurement**: I ran it on this machine (WSL2, Node v24.19.0, npm 11.17.0), plus the official Node v26.13.0 linux-x64 binary (SHA-256 checked against `SHASUMS256.txt`) for the Node 26 smoke tests. Scratch projects live under `<scratch>` (see the appendix). Nothing was installed in or written to the SessionGateway repo.

Scope: language, runtime and toolchain choices for ticket #4 ("sets up the TypeScript project and CI") under the spec in issue #1: one image, two containers (MCP server and ingest worker), one SQLite file in WAL mode, `node:sqlite` with FTS5 and an int8 vector scan, and an in-process bge-small embedder (ADR-0006, ADR-0007). The parked spike (`prototype/scaffold`) is a reference point only. It used `typescript ^7.0.2`, `vitest ^5.0.5`, `zod ^4.6.7`, `@modelcontextprotocol/sdk ^1.32.2`, `tsx ^4.23.15`, `@types/node ^24.19.2` and `engines.node >=24`.

---

## 1. Node.js version

### 1.1 Release lines on 2026-10-29

| Line | Status on 2026-10-29 | Active LTS start | Maintenance start | End of life | Latest release | Status | Source |
|---|---|---|---|---|---|---|---|
| 22.x "Jod" | Maintenance LTS | 2024-10-29 | 2025-10-21 | 2027-04-30 | v22.23.4 (2026-10-20) | verified | `schedule.json` in nodejs/Release; `nodejs.org/dist/index.json` |
| 24.x "Krypton" | **Maintenance LTS** (since 2026-10-20) | 2025-10-28 | 2026-10-20 | **2028-04-30** | v24.22.2 (2026-10-27), bundles npm 11.19.1 | verified | same |
| 26.x "Lithium" | **Active LTS** (since 2026-10-28) | 2026-10-28 | 2027-10-20 | **2029-04-30** | v26.13.0 (2026-10-28), bundles npm 11.20.0 | verified | same; https://nodejs.org/en/blog/release/v26.13.0 |
| 27.x | Alpha. No Current line exists today. | LTS 2027-10-20 | (none) | 2030-04-30 | v27.0.0-alpha.0.0.0 (2026-10-29) | verified | nodejs/Release README; dist index |

- **Did Node 26 enter LTS in October 2026?** Yes. The v26.13.0 release notes say: "This release marks the transition of Node.js 26.x into Long Term Support (LTS) with the codename 'Lithium'. It will continue to receive updates through to the end of April 2029." (verified, https://nodejs.org/en/blog/release/v26.13.0)
- **The nodejs/Release README's status column is stale.** It still lists 24.x as "Active LTS" and 26.x as "Current". It was last changed on 2026-10-21 (`gh api repos/nodejs/Release/commits?path=README.md`), before both transitions. Its own date columns, `schedule.json`, the dist index and the v26.13.0 notes all agree on the table above. (verified)
- **Production guidance:** "Production applications should only use _Active LTS_ or _Maintenance LTS_ releases." (verified, https://nodejs.org/en/about/previous-releases)
- **New schedule from Node 27:** "Starting with Node.js 27, every release line goes through the 'Alpha' phase before its first 'Current' release, and every release line is promoted to LTS." Alpha releases "are intended for library authors and CI pipelines, not for production use." Lines up to and including 26 keep the old schedule. (verified, nodejs/Release README)
- **This machine runs v24.19.0.** That is behind both 24.22.2 and 26.13.0. (local measurement, `node --version`)
- Since Node 25, "the official binaries for Linux are linked against libatomic, which may need to be installed separately depending on your Linux distribution". (verified, v26.13.0 release notes) Official Docker images exist for `24.22.2-*-slim` and `26-*-slim`. (verified, Docker Hub tags API `library/node`)

### 1.2 Native TypeScript type stripping

| Fact | Node 24 | Node 26 | Status | Source |
|---|---|---|---|---|
| Stability | "Stability: 2 - Stable". History: v24.12.0 "Type stripping is now stable"; v24.3.0 no experimental warning; v23.6.0 enabled by default; added v22.6.0 | Stable (v25.2.0 and v24.12.0) | verified | https://nodejs.org/docs/latest-v24.x/api/typescript.html; https://nodejs.org/docs/latest-v26.x/api/typescript.html |
| Flag needed | None. `--no-strip-types` turns it off. | None | verified | same |
| Non-erasable syntax (`enum`, `namespace` with runtime code, parameter properties, import aliases) | Errors unless `--experimental-transform-types` is passed | `--experimental-transform-types` was **removed in v26.0.0**, so these always error | verified | same |
| Decorators | "will result in a parser error" | same | verified | same |
| `tsconfig.json` | "Node.js ignores `tsconfig.json` files and therefore features that depend on settings within `tsconfig.json`, such as paths or converting newer JavaScript syntax to older standards, are intentionally unsupported." | same | verified | same |
| `paths` | "`tsconfig` "paths" won't be transformed and therefore produce an error. The closest feature available is subpath imports with the limitation that they need to start with `#`." | same | verified | v24 page |
| Import extensions | "file extensions are mandatory in `import` statements and `import()` expressions: `import './file.ts'`" | same | verified | v24 page |
| Type-only imports | Need the `type` keyword. Without it they are treated as value imports and fail at runtime. `verbatimModuleSyntax` enforces this in `tsc`. | same | verified | v24 page |
| Other limits | `.tsx` unsupported. TypeScript under `node_modules` is refused. No type checking is done. | same | verified | v24 page |
| Stack traces | "Since inline types are replaced by whitespace, source maps are unnecessary for correct line numbers in stack traces" | same | verified | v26 page |
| Node's recommended tsconfig | TS "5.8 or newer" with `noEmit` (optional), `target: esnext`, `module: nodenext`, `rewriteRelativeImportExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax` | same | verified | both pages |
| Compile cache | The module compile cache applies "whenever Node.js compiles a CommonJS, an ECMAScript Module, or a TypeScript module" | n/a | verified | `doc/api/module.md` at v24.22.2, "Module compile cache" |

### 1.3 Node 26 smoke test (local measurement)

On v26.13.0 each of these ran without error. They are single runs, so they show that things work but are not timings.
- transformers.js 4.3.2 with `Xenova/bge-small-en-v1.5` q8 embedded queries (peak RSS 192 MB; v24.19.0 gave 190 MB). `onnxruntime-node` ships N-API binaries (`bin/napi-v6/linux/x64`).
- `node:sqlite`: SQLite 3.54.0, FTS5 table created and queried.
- Type stripping: a 200-module `.ts` project ran, and so did a `using` declaration.

Dependency engine ranges allow Node 26: vitest 5.0.5 `^22.12.0 || ^24.0.0 || >=26.0.0`, eslint 10.13.0 `^20.19.0 || ^22.13.0 || >=24`, better-sqlite3 13.0.3 `>=22`, typescript-eslint 8.72.1 `>=21.1.0`, oxlint 1.90.0 `>=22.12.0`. (verified, `npm view <pkg> engines`)

---

## 2. TypeScript version

### 2.1 Release state

| Fact | Status | Source |
|---|---|---|
| dist-tags: `latest` 7.0.2, `beta` 7.1.0-beta, `rc` 7.0.1-rc, `next` 7.1.0-dev.20261029.1 | verified | `npm view typescript dist-tags` |
| Dates: 6.0.2 2026-03-23, **6.0.3 2026-04-16** (last 6.x), 7.0.1-rc 2026-06-18, **7.0.2 2026-07-08**, 7.1.0-beta 2026-10-20 | verified | `npm view typescript time` |
| TypeScript 6.0 is "the last release based on the current JavaScript codebase". No maintenance period for 6.x is stated in the 6.0, 7.0 or 7.1 beta posts. | verified | https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/ (2026-03-23); .../announcing-typescript-7-0/ (2026-07-08); .../announcing-typescript-7-1-beta/ (2026-10-20) |
| 7.1: RC "in about a month from now" (from 2026-10-20), stable "shortly thereafter". 7.1 is stricter on distributive type parameters. | verified | 7.1 beta post |
| The `typescript@7.0.2` package has no `main`. `exports["."]` is `./lib/version.cjs`, and the API sits under `./unstable/{sync,async,ast,fs,...}`. The only bin is `tsc`; there is no `tsserver`. Platform binaries come as `@typescript/typescript-<os>-<arch>` optional dependencies. | verified | `npm view typescript@7.0.2 exports bin optionalDependencies` |
| `typescript@7.1.0-beta` drops the `unstable/` prefix: `./sync`, `./async`, `./ast`, `./fs`, `./vscode`. | verified | `npm view typescript@7.1.0-beta exports` |
| Experimental `--checkers` (default 4 type-checking workers) and `--builders` flags | verified | 7.0 post |

### 2.2 What 7.0 changed or removed

TypeScript 6.0 deprecated these options (`ignoreDeprecations: "6.0"` silenced them), and 7.0 rejects them (verified, 6.0 and 7.0 posts). I checked five of them against `tsc` 7.0.2 (local measurement):

| Option | TS 7.0.2 result (local measurement) | Replacement per the 7.0 post |
|---|---|---|
| `baseUrl` | `error TS5102: Option 'baseUrl' has been removed` with a hint to use `"paths": {"*": ["./*"]}` | relative `paths` |
| `moduleResolution: node10` (or `node`) | `error TS5108` | `nodenext` or `bundler` |
| `target: es5` | `error TS5108` | ES2015 is the minimum |
| `downlevelIteration` | `error TS5102` | none |
| `esModuleInterop: false` (also `allowSyntheticDefaultImports: false`) | `error TS5108` | always on |

The post also lists these as unsupported: `module` `amd`/`umd`/`systemjs`/`none`, `moduleResolution: classic`, `alwaysStrict: false`, the `module` keyword for namespaces, `asserts` on imports (use `with`), `/// <reference no-default-lib>`, and file arguments to `tsc` when a `tsconfig.json` exists (TS5112, use `--ignoreConfig`). TS 6.0 already rejected `outFile`. (verified, 6.0 and 7.0 posts)

New defaults in 6.0 and 7.0: `strict: true`, `module: esnext`, `target` es2025 (the TS 7 `--help --all` output shows "default: es2025"), `types: []` (so `@types/node` must be listed), `rootDir: ./`, `noUncheckedSideEffectImports: true`, `libReplacement: false`. 7.0 adds `stableTypeOrdering: true`, which "cannot be turned off". (verified, posts; local measurement for the target default)

`tsc --init` writes the same option set in 6.0.3 and 7.0.2 (local measurement). The set is listed in §3.

### 2.3 The JS API, and which tools still need TypeScript 6

- "While TypeScript 7.0 is here, it does not ship with an API. We expect TypeScript 7.1 to ship with a new (and different) API." The post publishes `@typescript/typescript6` (bin `tsc6`, re-exports the 6.0 API) and recommends npm aliases. Its `package.json` snippet is `"@typescript/native": "npm:typescript@^7.0.2"` and `"typescript": "npm:@typescript/typescript6@^6.0.2"`. (verified, 7.0 post, section "Running side by side with TypeScript 6.0")
- `@typescript/typescript6@6.0.2` (2026-07-06) depends on `@typescript/old: npm:typescript@^6`, which resolves to 6.0.3. (verified, `npm view`)

| Tool | Needs the TS 6 JS API? | Status | Source |
|---|---|---|---|
| **typescript-eslint 8.72.1** (2026-10-26) | **Yes.** Its peer range is `typescript >=4.8.4 <6.1.0`, and its docs say "The version range of TypeScript currently supported is `>=4.8.4 <6.1.0`". A maintainer (2026-07-08): "typescript-eslint isn't compatible with TS 7 at this time, because there is no TS 7 API at this time." TS 7.1 support is in open PR #12803 ("add projectService.EXPERIMENTAL_backend for TypeScript 7.1 native parser support over IPC", updated 2026-10-26). The maintainer said on 2026-09-29: "we're not expecting performance to be significantly better with TS7 than TS6 at least for this initial IPC-based version." | verified | `npm view typescript-eslint peerDependencies`; https://typescript-eslint.io/users/dependency-versions; issues #12518, #10940; PR #12803 |
| Vitest 5.0.5 | No. It does not depend on `typescript` at all. Its experimental `typecheck` mode shells out to a checker binary (`'tsc' \| 'vue-tsc' \| string`). | verified (deps); inferred (that a TS 7 `tsc` binary works for `typecheck`, untested) | `npm view vitest@5.0.5 dependencies peerDependencies`; https://vitest.dev/config/typecheck |
| tsx 4.23.15 | No. Its only dependency is `esbuild ~0.28.0`, and it "does not type check your code". | verified | `npm view tsx`; tsx `docs/typescript.md` |
| oxlint + oxlint-tsgolint 7.0.2005 | No. It is built on typescript-go and "tracks TypeScript v7.0.2". | verified | https://oxc.rs/blog/2026-07-22-type-aware-linting-stable |
| Editors | VS Code: the TS 7 server comes from the `TypeScriptTeam.native-preview` extension, and the post says built-in support "will ship as part of VS Code itself" (July 2026). Whether that has shipped by VS Code 1.144 (2026-10-28) is **unverified**: the 1.144 notes don't mention it. Volar-based tools (Vue, Svelte, Astro, MDX) "will likely need TypeScript 6.0 for now". | verified / unverified | 7.0 post; https://code.visualstudio.com/updates |

**Side-by-side install (local measurement, npm 11.17.0).**
- The blog's exact layout (`typescript` → `@typescript/typescript6`, `@typescript/native` → `typescript@^7.0.2`) gave `node_modules/.bin/tsc` → 7.0.2 and `require('typescript').version` → 6.0.3, which is correct.
- A different alias layout (`typescript@^7.0.2` plus `ts6: npm:@typescript/typescript6`) linked `.bin/tsc` to **6.0.3**, because the hoisted `@typescript/old` won the bin link. This matches closed typescript-go issue #4567 "`tsc` incorrectly points to v6 rather than v7".
- With the blog layout, ESLint 10.13.0 and typescript-eslint 8.72.1 `strictTypeChecked` ran typed rules correctly, and `tsc` 7.0.2 checked the same tsconfig.

---

## 3. tsconfig for a Node ESM service

"TS team stance" below comes from what `tsc --init` writes in 6.0.3 and 7.0.2 (local measurement). It enables `module: nodenext`, `target: esnext`, `types: []`, `sourceMap`, `declaration`, `declarationMap`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `strict`, `jsx: react-jsx`, `verbatimModuleSyntax`, `isolatedModules`, `noUncheckedSideEffectImports`, `moduleDetection: force` and `skipLibCheck`. It lists `noImplicitReturns`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` and `noPropertyAccessFromIndexSignature` commented out under "Style Options". Each "Catches" entry comes from the TSConfig reference source (`microsoft/TypeScript-Website` `packages/tsconfig-reference/copy/en/options/<name>.md`).

| Option | What it catches | TS team stance | Status | Source |
|---|---|---|---|---|
| `strict` | Turns on the strict family, including `useUnknownInCatchVariables` (catch variables typed `unknown`, TS 4.4) | On in `tsc --init`; the default in 6.0 and 7.0 | verified | 6.0/7.0 posts; TS 4.4 release notes |
| `noUncheckedIndexedAccess` | Adds `undefined` to index-signature and array element reads (`row[0]`, `map[key]`) | On in `tsc --init` | verified | reference; `tsc --init` |
| `exactOptionalPropertyTypes` | `x?: T` no longer accepts an explicit `undefined`, so absent and `undefined` stay distinct | On in `tsc --init` | verified | reference; `tsc --init` |
| `noImplicitOverride` | Requires `override` so subclasses can't silently drift from a renamed base method | Commented out ("Style Options") | verified | reference; `tsc --init` |
| `noFallthroughCasesInSwitch` | Non-empty `case` without `break`, `return` or `throw` | Commented out ("Style Options") | verified | same |
| `noPropertyAccessFromIndexSignature` | Dot access to keys that only an index signature covers; forces `obj["key"]` to show uncertainty | Commented out ("Style Options") | verified | same |
| `verbatimModuleSyntax` | Imports without `type` are kept and `type` imports are dropped ("what you see is what you get"). This is required for Node type stripping. | On in `tsc --init`; Node recommends it | verified | reference; Node TS docs |
| `isolatedModules` | Code a single-file transpiler can't handle (type re-exports, `const enum` use, non-module namespaces) | On in `tsc --init` | verified | reference |
| `erasableSyntaxOnly` (TS 5.8+) | `enum`, runtime `namespace`/`module`, parameter properties, `import =`/`export =`, `<T>x` assertions | "Typically, you will want to combine this flag with the `--verbatimModuleSyntax`"; Node recommends it | verified | TS 5.8 release notes; reference; Node TS docs |
| `rewriteRelativeImportExtensions` (TS 5.7+) | Rewrites relative `.ts`/`.mts`/`.cts` specifiers to `.js` on emit | Node recommends it for projects that emit | verified | reference; Node TS docs |
| `allowImportingTsExtensions` | Lets `tsc` type-check `import './x.ts'` | Node docs name it for `.ts` specifiers | verified | Node TS docs |
| `module`/`moduleResolution: nodenext` | Node's ESM/CJS resolution rules, including mandatory extensions in ESM. `module: nodenext` implies `moduleResolution: nodenext` and the floating `target: esnext`. `node20` is the frozen alternative and implies `es2023`. | `nodenext` in `tsc --init` and in the modules guide for code "compiling and running the outputs in Node.js" | verified | TS modules guide "Choosing Compiler Options"; TS 5.9 release notes |
| `libReplacement` | Turns off lookup of `@typescript/lib-*` packages | Default `false` in 6.0/7.0, so it needs no setting | verified | 6.0/7.0 posts; TS 5.8 notes |
| `noUncheckedSideEffectImports` | `import "typo"` that resolves to nothing | Default on in 6.0/7.0 | verified | reference; posts |
| `@tsconfig/node24@24.0.5` | lib `es2024` plus five ESNext libs, `module nodenext` with **`moduleResolution node16`**, `target es2024`, `types ["node"]`, `strict`, `esModuleInterop`, `skipLibCheck` | Community base (2026-08-15). The node16/nodenext pairing passed both `tsc` 7.0.2 and `tsc6` (local measurement). | verified | `npm pack @tsconfig/node24@24.0.5` |
| `@tsconfig/node26@26.0.1` | lib `["es2025","ESNext.Collection","ESNext.Temporal"]`, `module nodenext`, `target es2025`, `types ["node"]`, `esModuleInterop`, `skipLibCheck` (no `strict`: it relies on the 6.0/7.0 default) | Community base (2026-08-15) | verified | `npm pack @tsconfig/node26@26.0.1` |
| `@tsconfig/strictest@2.0.8` | Adds the Style Options plus `noImplicitReturns`, `noUnused*`, `allowUnreachableCode: false`, `allowUnusedLabels: false` | Community base (2025-11-13) | verified | tsconfig/bases `strictest.json` |

**Findings that change the textbook config (local measurement, `tsc` 7.0.2 and `tsc6` 6.0.3 both):**
1. **`rewriteRelativeImportExtensions` conflicts with `#` subpath imports.** With it on, `import { g } from '#/m0.ts'` fails with `TS2877: This import uses a '.ts' extension ... but will not be rewritten during emit because it is not a relative path`, even when `noEmit` is set. With it off (`noEmit` + `allowImportingTsExtensions`) both checkers pass and Node runs the file. `import '#/m0.js'` passes `tsc` but fails in Node (`ERR_MODULE_NOT_FOUND`), because Node doesn't map `.js` to `.ts`.
2. **`target` below `esnext` downlevels `using`.** At `target: es2024`, `tsc` 7.0.2 emitted 70 lines with `__addDisposableResource`/`__disposeResources` helpers for a 5-line function. At `esnext` it emitted 8 lines with native `using`. Explicit Resource Management is Stage 4 with expected publication year 2027 (verified, tc39/proposals `finished-proposals.md`), so it is outside `es2025`.
3. With `types: ["node"]` and `@types/node@26.6.6`, `using db = new DatabaseSync(...)` type-checks. `using stmt = db.prepare(...)` fails with `TS2741: Property '[Symbol.dispose]' is missing in type 'StatementSync'`, because the types lag the runtime (§6, §7).

---

## 4. Running and building

| Approach | Pros | Cons | Status | Source |
|---|---|---|---|---|
| **Node type stripping** (`node src/bin/server.ts`) | No build step, so the image runs the reviewed source. Stable since 24.12.0. No source maps needed. No extra runtime dependency. The runtime image needs no TypeScript toolchain. | Erasable syntax only. `.ts` extensions in every import. Ignores tsconfig (no `paths`, no downlevel). No type check, so CI must run `tsc`. Startup cost (next row). | verified (Node TS docs); inferred (image contents) | §1.2 |
| Startup cost of stripping | 200 modules / 317 KB of TS: compiled JS 42–43 ms per start, `.ts` 113–116 ms per start. With `NODE_COMPILE_CACHE` set and warm: `.ts` 42 ms, JS 39 ms. | Matters only for process start; both containers are long-lived. | local measurement (15 runs each, Node 24.19.0) | `tsprobe2/strip` |
| **tsc build** (emit `dist/`) | Plain JS at runtime. Works with any Node. Can downlevel. | Adds a build step and a second tree whose stack traces point at `dist/`. Needs `rewriteRelativeImportExtensions`. `#` subpath imports then need per-condition mapping to `dist/` (finding 1 in §3). TS 7.0.2 emits fine (local measurement). | verified / local measurement | TS modules guide; §3 |
| **tsx** | Watch mode. Accepts extensionless specifiers. Reads tsconfig `paths`. | esbuild-based and "behaves more like a bundler", so code that runs under tsx may not run under plain `node`. The TS team says to configure tsx projects as a bundler. Its own FAQ on production: "Deciding whether to use _tsx_ in production depends on your specific needs and risk tolerance" and esbuild "technically hasn't reached a stable release yet". | verified | TS modules guide "I'm using tsx"; tsx `docs/faq.md` |

**Subpath imports vs tsconfig `paths`**

| Fact | Status | Source |
|---|---|---|
| `paths` is a `tsc`-only alias. Node type stripping errors on it, and TS 7 removed `baseUrl`. | verified | Node TS docs; 7.0 post |
| `package.json` `"imports"` entries "must always start with `#`". Patterns with `*` work as in `"exports"`. Node v24.14.0: "Allow subpath imports that start with `#/`." | verified | https://nodejs.org/docs/latest-v24.x/api/packages.html#subpath-imports |
| TS 6.0: "Subpath imports starting with `#/` are supported under `nodenext` and `bundler`." | verified | 6.0 post |
| `"imports": {"#/*": "./src/*"}` with `import '#/m0.ts'`: resolved by `tsc` 7.0.2, `tsc6`, Node 24.19 and 26.13, and Vitest 5.0.5. That holds only with `rewriteRelativeImportExtensions` off. | local measurement | `tsprobe2/strip` |

---

## 5. Lint and format

### 5.1 Versions

| Tool | Version (date) | State | Status | Source |
|---|---|---|---|---|
| ESLint | **10.13.0** (2026-10-16). 10.0.0 was 2026-02-06. | v10 is Current. **v9 reached end of life on 2026-08-06**, and no line is in Maintenance. v10 removed eslintrc entirely; flat config only. Config lookup now starts at each linted file's directory. | verified | `npm view eslint`; https://eslint.org/version-support/; https://eslint.org/blog/2026/02/eslint-v10.0.0-released/ |
| typescript-eslint | **8.72.1** (2026-10-26) | Supports ESLint `^8.57.0 \|\| ^9.0.0 \|\| ^10.0.0` and TS `<6.1.0` (§2.3). `strict*` configs are "not considered "stable" under Semantic Versioning". Typed linting uses `parserOptions.projectService: true`. `tseslint.config()` is `@deprecated` in favour of ESLint's `defineConfig()`. | verified | https://typescript-eslint.io/users/configs; `typescript-eslint/dist/config-helper.d.ts` |
| Biome | **2.6.4** (2026-10-28) | Type-aware rules live in the `types` domain and run Biome's own inference engine, which "doesn't rely on the TypeScript compiler". `noFloatingPromises`, `noMisusedPromises`, `useExhaustiveSwitchCases`, `useStrictBooleanExpressions` and `useAwaitThenable` are all **nursery** ("experimental and the behavior can change at any time"). The 2025-06-17 v2 post said `noFloatingPromises` caught "about 75% of the cases" typescript-eslint catches. | verified | https://biomejs.dev/linter/domains/; .../rules/no-floating-promises/; https://biomejs.dev/blog/biome-v2/ |
| oxlint + oxlint-tsgolint | **1.90.0** (2026-10-27) + **7.0.2005** (2026-10-22) | Type-aware linting announced **stable** (blog dated 2026-07-22). Built on typescript-go, needs TS 7.0+, and rejects TS 6-deprecated options. The blog covers "59 of typescript-eslint's 61 type-aware rules"; the tsgolint README leaves `naming-convention` and `prefer-destructuring` unchecked. It reports "12 to 18 times faster than ESLint with typescript-eslint" across four repos. | verified | https://oxc.rs/docs/guide/usage/linter/type-aware.html; https://oxc.rs/blog/2026-07-22-type-aware-linting-stable; tsgolint README |
| Prettier | **3.9.10** (2026-10-10); `next` is 4.0.0-alpha.13 | Stable line | verified | `npm view prettier` |
| oxfmt | 0.75.0 | Pre-1.0 | verified | `npm view oxfmt` |
| ESLint on formatting | Formatting rules deprecated in v8.53.0: "We recommend you use a source code formatter instead." | | verified | https://eslint.org/blog/2023/10/deprecating-formatting-rules/ |

### 5.2 Rules that matter for an async I/O service

Preset membership comes from each rule's `meta.docs.recommended` in `@typescript-eslint/eslint-plugin` 8.72.1 (verified, read from the installed package). "recommended" on a type-aware rule means `recommended-type-checked`. Every rule in the oxlint column is checked off in the tsgolint README (verified).

| Rule | Catches | typescript-eslint preset | Biome 2.6.4 | oxlint |
|---|---|---|---|---|
| `no-floating-promises` | Un-awaited promise whose rejection is lost (crashes Node under the default `--unhandled-rejections=throw`) | recommended-TC | nursery `noFloatingPromises` | yes |
| `no-misused-promises` | Async callback passed where a void return is expected (`forEach`, event handlers), or a promise in a condition | recommended-TC | nursery `noMisusedPromises` | yes |
| `await-thenable`, `require-await` | `await` on a non-promise; `async` without `await` | recommended-TC | nursery `useAwaitThenable` | yes |
| `return-await` | `return promise` inside `try` skips the `catch` | strict-TC (`error-handling-correctness-only`) | n/a | yes |
| `switch-exhaustiveness-check` | Missing `case` for a union member | **in no preset** | nursery `useExhaustiveSwitchCases` | yes |
| `no-unnecessary-condition` | Conditions the types say are always true or false (dead guards, stale `?.`) | strict-TC | `noUnnecessaryConditions` (types domain) | yes |
| `strict-boolean-expressions` | `if (count)` where 0, `""` or NaN is valid data | **in no preset** | nursery `useStrictBooleanExpressions` | yes |
| `only-throw-error`, `prefer-promise-reject-errors` | Throwing or rejecting non-`Error` values (no stack, no `cause`) | recommended-TC | n/a | yes |
| `use-unknown-in-catch-callback-variable` | `.catch((e) => …)` typed `any` | strict-TC | n/a | yes |
| `no-explicit-any`, `no-unsafe-{assignment,member-access,call,return,argument}` | `any` leaking from `JSON.parse`, `fetch().json()` or untyped libraries | recommended / recommended-TC | n/a | yes |
| `no-deprecated`, `no-misused-spread` | Use of `@deprecated` APIs; spreading strings or promises | strict-TC | n/a | yes |

**Probe (local measurement).** I seeded one file with five bugs: a floating promise, an `async` without `await`, a non-exhaustive switch, a nullable-number condition, and `throw 'nope'`.
- typescript-eslint `strictTypeChecked` plus `switch-exhaustiveness-check` and `strict-boolean-expressions` flagged all 5.
- oxlint `--type-aware` with the matching rules flagged all 5, in 0.09 s, with no `typescript` package installed.
- Biome 2.6.4 with the `types` domain flagged 3 of 5. I enabled no Biome equivalent for `only-throw-error`, and Biome has no `require-await` equivalent.

This is a one-file smoke test, not a coverage comparison.

---

## 6. Language idioms for correctness

| Idiom | What the source says | Status | Source |
|---|---|---|---|
| `unknown` at I/O boundaries | "`unknown` is the type-safe counterpart of `any`… no operations are permitted on an `unknown` without first asserting or narrowing". `catch` variables are `unknown` under `strict` (TS 4.4). | verified | TS 3.0 and 4.4 release notes |
| Runtime schema parsing with **zod 4** | zod **4.6.7** (2026-10-12, MIT, ESM). Exports `.`, `./v3`, `./v4`, `./mini`, among others. `.parse()` "will throw a `ZodError`". `.safeParse()`: "The result type is a discriminated union." Parsing returns a typed copy, and `z.infer`/`z.input`/`z.output` give the static types. | verified | `npm view zod@4.6.7`; https://zod.dev/basics |
| zod 4 JSON Schema | `z.toJSONSchema()` targets draft-2020-12 by default (also draft-07 and openapi-3.0). It throws on unrepresentable types (bigint, date, transform, …) unless `unrepresentable` is set; `io: "input"` describes the input side. `z.fromJSONSchema()` "is not considered part of Zod's stable API". The MCP spec's `inputSchema`/`outputSchema` default to 2020-12 when there is no `$schema`. `@modelcontextprotocol/sdk` 1.32.2 converts zod 4 schemas with zod's own `toJSONSchema` (`io: 'input'`). | verified | https://zod.dev/json-schema; https://modelcontextprotocol.io/specification/latest/server/tools; `dist/esm/server/zod-json-schema-compat.js` in the 1.32.2 tarball |
| "Parse, don't validate" | "the difference between validation and parsing lies almost entirely in how information is preserved". Advice: "Use a data structure that makes illegal states unrepresentable" and "Push the burden of proof upward as far as possible, but no further." (Alexis King, 2019-11-05) | verified | https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/ |
| Discriminated unions + `never` | "you can use narrowing and rely on `never` turning up to do exhaustive checking in a `switch` statement" | verified | TS handbook, Narrowing, "Exhaustiveness checking" |
| Branded ids | zod `.brand()`: "branded types do not affect the runtime result of `.parse`. It is a static-only construct." A direction parameter (`"in"`/`"out"`/`"inout"`) chooses which side is branded. The plain-TS form `string & { readonly __brand: "MeasureId" }` is a community pattern, not handbook guidance. | verified (zod) / inferred (plain TS) | https://zod.dev/api "Branded types" |
| `satisfies`, `as const`, `readonly` | `satisfies` (TS 4.9) checks against a type while keeping the most specific inferred type. `as const` (TS 3.4): "no literal types in that expression should be widened". | verified | TS 4.9 and 3.4 release notes |
| No `enum`/`namespace` | Both are rejected by `erasableSyntaxOnly` and by Node stripping (§1.2, §3). Handbook: "In modern TypeScript, you may not need an enum when an object with `as const` could suffice." | verified | TS handbook, Enums, "Objects vs Enums" |
| `using` / `await using` | Node 24.0.0 ships V8 13.6 with "Explicit resource management". `using` and `await using` ran on 24.19.0 and 26.13.0 (local measurement). `DatabaseSync[Symbol.dispose]` is "No longer experimental" since v24.2.0. `StatementSync[Symbol.dispose]` was added in **v24.22.0**: it is absent on 24.19.0 and present on 26.13.0 (local measurement). `@types/node@26.6.6` does not declare it yet (§3, finding 3). Native `using` needs `target: esnext` (§3, finding 2). | verified / local measurement | https://nodejs.org/en/blog/release/v24.0.0; Node 24 sqlite docs |
| Error `cause` | `new Error(message, { cause })`; `error.cause` "Added in: v16.9.0" and is printed recursively by `util.inspect()`. | verified | https://nodejs.org/docs/latest-v24.x/api/errors.html |
| Throwing | Node: synchronous APIs `throw`, and Promise APIs reject. `--unhandled-rejections` default is `throw` (an unhandled rejection exited with code 1 in a local run). The TS team closed typed and checked exceptions (#13219, 2023-04-19): "we don't think that the JavaScript runtime or overall ecosystem provide a platform on which to build this feature", so a thrown error's type is never in a signature. | verified / local measurement | Node errors docs; Node `cli.md` v24.22.2; https://github.com/microsoft/TypeScript/issues/13219 |
| Typed results | zod offers `safeParse` as a discriminated-union result. neverthrow ("Encode failure into your program") is at 8.2.0, last published 2025-02-21. The **MCP spec** splits errors in two: protocol errors (unknown tool, malformed request, server error) go back as JSON-RPC errors, and "Tool Execution Errors" (API failures, input validation, business logic) go back "in tool results with `isError: true`". Ticket #4 already requires `isError` for an unknown Measure. | verified | zod basics; `npm view neverthrow`; MCP tools spec "Error Handling"; issue #4 |
| `AbortSignal` timeouts for `fetch` | `fetch` is "No longer experimental" since v21.0.0. `AbortSignal.timeout(delay)` was added in v17.3.0, and `AbortSignal.any(signals)` in v20.3.0. The abort reason is "a "TimeoutError" DOMException" (WHATWG DOM; confirmed locally: `reason.name === 'TimeoutError'`). | verified / local measurement | Node globals docs; https://dom.spec.whatwg.org/ |

---

## 7. `node:sqlite`

| Fact | Status | Source |
|---|---|---|
| Node 24: "Stability: 1.2 - Release candidate", since **v24.15.0**. Node 26: 1.2 RC since v25.7.0. | verified | https://nodejs.org/docs/latest-v24.x/api/sqlite.html; .../latest-v26.x/api/sqlite.html |
| What 1.2 means: it sits under "Stability: 1 - Experimental. The feature is not subject to semantic versioning rules… Use of the feature is not recommended in production environments." For 1.2 the docs add: "No further breaking changes are anticipated but may still occur". | verified | https://nodejs.org/docs/latest-v24.x/api/documentation.html |
| No flag needed since v23.4.0 / v22.13.0. No warning was printed on v24.19.0 or v26.13.0. | verified / local measurement | sqlite docs history |
| Synchronous only: "All APIs exposed by this class execute synchronously". `sqlite.backup()` is the one Promise API. | verified | sqlite docs |
| `DatabaseSync` options and defaults: `readOnly` false, **`timeout` 0** (busy timeout in ms), `enableForeignKeyConstraints` true, `enableDoubleQuotedStringLiterals` false, `allowExtension` false (needed for `loadExtension`), `defensive` **true** (default since v24.14.0), `readBigInts` false, `returnArrays` false, `allowBareNamedParameters` true, `allowUnknownNamedParameters` false, `limits`. | verified | sqlite docs |
| Bundled SQLite: 3.53.3 in v24.19.0 (local measurement); 3.53.4 in the v24.22.2 source; 3.54.0 in v26.13.0. | verified / local measurement | `deps/sqlite/sqlite3.h` at v24.22.2 and v26.13.0 |
| FTS5 compiled in (`SQLITE_ENABLE_FTS5`, also FTS3, RTREE, MATH_FUNCTIONS, SESSION, DBSTAT_VTAB). `pragma compile_options` agreed, and an FTS5 table worked. | verified / local measurement | `deps/sqlite/sqlite.gyp` at v24.22.2 |
| WAL: "All processes using a database must be on the same host computer; WAL does not work over a network filesystem." "readers do not block writers and a writer does not block readers"; "there can only be one writer at a time". WAL mode persists across connections. | verified | https://sqlite.org/wal.html §1, §2.2, §3.3 |
| WAL read-only access works if the `-shm` and `-wal` files "already exist and are readable", or the directory is writable, or the database is opened `immutable` (since 3.22.0). | verified | sqlite.org/wal.html §5 |
| Checkpoint starvation: with "always at least one active reader… the WAL file will grow without bound". SQLITE_BUSY can still occur in WAL mode (exclusive locking, the last connection closing, recovery). | verified | sqlite.org/wal.html §6, §9 |
| Two processes, one file: a writer (`timeout: 5000`, WAL, 40 transactions of 100 rows plus FTS5 inserts) and a separate `readOnly: true` reader ran together. The reader did 27,427 read pairs with 0 errors, worst read 3.9 ms, and saw all 4,000 rows. | local measurement (same host, ext4, not containers) | `walprobe/` |
| Two **containers** with a bind mount on one Linux host share the kernel and page cache, so WAL's shared-memory requirement should hold. Docker Desktop file sharing on Windows or macOS is a network-style filesystem and is not safe. | inferred | wal.html §1 |

**better-sqlite3, for comparison**

| Fact | Status | Source |
|---|---|---|
| 13.0.3 (2026-08-05), MIT, `engines.node >=22`, depends on `node-addon-api`. | verified | `npm view better-sqlite3@13.0.3` |
| Prebuilt `.node` binaries ship **inside the npm tarball** for darwin-arm64/x64, linux-arm64/x64, linuxmusl-arm64/x64 and win32-arm64/x64. There is no install script (`gypfile: false`), so it works with `npm ci --ignore-scripts`. | verified | `npm pack better-sqlite3@13.0.3` file list; `npm view ... scripts gypfile` |
| SQLite 3.53.4 with FTS5, JSON1, RTREE and MATH_FUNCTIONS. `timeout` defaults to 5000 ms. | verified | better-sqlite3 `docs/compilation.md`, `docs/api.md` |
| Trade-off: it is a third-party native addon, but it is semver-stable and a long-lived project. `node:sqlite` adds no dependency but is still in the Experimental family. | inferred | above |

---

## 8. Package hygiene

| Item | Fact | Status | Source |
|---|---|---|---|
| ESM-only | `"type": "module"` makes `.js` files ESM. All the dependencies checked here (zod 4, Vitest, ESLint 10) are fine in ESM. | verified (field) | Node packages docs |
| `engines` | Advisory: "Unless the user has set the `engine-strict` config flag, this field is advisory only and will only produce warnings when your package is installed as a dependency." | verified | npm 11.17.0 `docs/content/configuring-npm/package-json.md` |
| `devEngines` | npm-native. It runs "before `install`, `ci`, and `run` commands". Keys: `cpu`, `os`, `libc`, `runtime`, `packageManager`, each with `name`, `version`, `onFail` (`warn`/`error`/`ignore`, default `error`). | verified | same file |
| `packageManager` / Corepack | Node 24 docs: Corepack is "Stability: 1 - Experimental" and "**Corepack will no longer be distributed starting with Node.js v25.**" The v26 Corepack doc page returns 404. npm's docs do not define a top-level `packageManager` field. | verified | https://nodejs.org/docs/latest-v24.x/api/corepack.html; v26 URL 404 |
| CI Node version | `actions/setup-node` v7.1.0 (2026-10-08): `node-version-file` accepts `package.json`, `.nvmrc`, `.node-version`, `.tool-versions` and `mise.toml`. In `package.json` it reads `volta.node`, then `devEngines.runtime`, then `engines.node`. npm caching switches on automatically when `devEngines.packageManager` or `packageManager` is `npm`. The docs advise `package-manager-cache: false` for privileged or publishing workflows. | verified | setup-node `README.md`, `docs/advanced-usage.md`; `gh api .../releases/latest` |
| Release-age gate | **`min-release-age`** (days; added in npm **11.10.0**, 2026-02-11, PR #8965): "only versions that were available more than the given number of days ago will be installed". `min-release-age-exclude` exempts named packages. `before` (exact date) is older. | verified | npm 11.17.0 `docs/content/using-npm/config.md`; npm/cli `CHANGELOG.md` |
| Install-script policy | npm 11.17 has an `allowScripts` field in `package.json` (`npm approve-scripts`). "In the current release, this field is advisory". `strict-allow-scripts` makes it an error. **npm 12** (12.0.0, 2026-07-08; `latest` 12.2.1): "Dependency lifecycle scripts are now blocked by default unless allowed by the root package's `allowScripts` policy". npm 12 needs Node `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0`. Node 24.22.2 and 26.13.0 bundle npm 11.x. | verified | npm 11.17 `npm-approve-scripts.md`, `config.md`; npm/cli CHANGELOG 12.0.0; dist index |
| `onnxruntime-node` postinstall | `node ./script/install` fetches extra execution-provider libraries (CUDA, TensorRT) per platform. The CPU `libonnxruntime.so.1` and `onnxruntime_binding.node` are already in the package, so `--ignore-scripts` should leave CPU inference working. | verified (script, file list) / inferred (behaviour) | `script/install.js` in the bench install |
| `npm ci` | Requires a lockfile. Exits on a mismatch with `package.json`. Removes `node_modules`. "It will never write to `package.json` or any of the package-locks". | verified | npm 11.17 `npm-ci.md` |

---

## 9. Noticed in passing (outside this file's scope; for the MCP research)

- **MCP TypeScript SDK v2 is the stable line.** The repo README says v2 (`@modelcontextprotocol/server`, `@modelcontextprotocol/client`) is "the stable release line, implementing the 2026-07-28 MCP spec". v1.x (`@modelcontextprotocol/sdk`) "continues to receive bug fixes and security updates for at least six months after the v2 release (2026-07-27)". `@modelcontextprotocol/server` is at 2.4.0 (2026-10-23), depends on `zod ^4.2.0`, and needs Node `>=20`. The spike's `@modelcontextprotocol/sdk@1.32.2` has `LATEST_PROTOCOL_VERSION = '2025-11-25'`. (verified, typescript-sdk `README.md`; `npm view`; 1.32.2 `dist/esm/types.js`)

---

## Recommendations for SessionGateway

| Choice | Pick | Reason | Risk |
|---|---|---|---|
| Node line | **Node 26 LTS (≥26.13.0)**, pinned through `devEngines.runtime` and `engines.node`, with an official `node:26` slim image pinned by digest | Active LTS since 2026-10-28 and supported to 2029-04-30, a year past Node 24 (2028-04-30, already Maintenance). Every dependency's `engines` allows it. The embedder, `node:sqlite`/FTS5, type stripping and `using` all ran on 26.13.0. It has `StatementSync[Symbol.dispose]`, which this machine's 24.19.0 lacks. | Only one day into LTS. The dev machine (24.19.0) must upgrade. If an organization adopting the code mandates Node 24, everything here also works on ≥24.22.0. |
| TypeScript | **`tsc` from TS 7.0.x for type checking**, plus `@typescript/typescript6` aliased as `typescript` only for typescript-eslint, using the 7.0 post's exact layout: `"@typescript/native": "npm:typescript@^7.0.2"`, `"typescript": "npm:@typescript/typescript6@^6.0.2"` | 7.0.2 is `latest`, and a 7-clean tsconfig is required either way. This is the TS team's documented path for typed linting today. Drop the alias when typescript-eslint ships TS 7.1 support (PR #12803; 7.1 RC expected about late November). | Two checkers (6.0.3 for lint, 7.0.2 for `tsc`) could disagree on edge cases. Another alias layout linked `tsc` to 6.0.3, so CI should assert `tsc --version` starts with `Version 7.`. If the alias is unwanted, use TS 6.0.3 alone with the same tsconfig. |
| tsconfig | Write it out; no `extends`. `module: nodenext`, `target: esnext`, `lib` as `@tsconfig/node26` (`es2025`, `ESNext.Collection`, `ESNext.Temporal`), `types: ["node"]`, `noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `isolatedModules`, `moduleDetection: force`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, `skipLibCheck`. **Leave out `rewriteRelativeImportExtensions`.** | This is the `tsc --init` set plus the Style Options (cheap for new code) plus Node's stripping requirements. `esnext` keeps `using` native. Leaving out `rewriteRelativeImportExtensions` is what makes `#/` imports type-check (§3, finding 1). | `exactOptionalPropertyTypes` and `noPropertyAccessFromIndexSignature` can cause friction with library types (inferred). Leaving out `rewriteRelativeImportExtensions` closes the easy path to a later `tsc` emit; adding emit would mean remapping imports. |
| Run and build | **Node type stripping in both containers, in dev and in scripts** (`node src/bin/server.ts`, `node src/bin/ingest.ts`). No tsx, no build step. `tsc` runs only as the CI type gate. Set `NODE_COMPILE_CACHE` to a writable path. Runtime image built from `npm ci --omit=dev --ignore-scripts`. | Stable feature. The image runs the reviewed source. Line numbers are exact without source maps. No TypeScript toolchain in the image. With the cache, startup cost is negligible (§4). | Code must stay erasable, and the lint rules plus `erasableSyntaxOnly` enforce that. Type errors never block a run, only CI. |
| Internal imports | Relative `./x.ts` imports, with **`"imports": {"#/*": "./src/*"}`** allowed for cross-module paths | Node (≥24.14), TS (≥6.0), Vitest 5 and typescript-eslint all resolve it (§4). tsconfig `paths` is not an option. | `#/` breaks in old Node/TS versions; both are pinned above it. |
| Lint | **ESLint 10.13 + typescript-eslint 8.72 `strictTypeChecked`**, with `projectService: true` (`allowDefaultProject` for `eslint.config.js`), configured through ESLint's `defineConfig`, plus `switch-exhaustiveness-check` and `strict-boolean-expressions` switched on (they are in no preset) | It catches the async and `any` bug classes in §5.2 with the TS compiler's own types. It is the mainstream, documented setup an organization adopting the code will know. | `strict*` configs can change in minor releases (pin and review bumps). Needs the TS 6 alias until typescript-eslint supports 7.1. **Alternative:** oxlint 1.90 + tsgolint (stable, TS 7-native, no alias, 12–18× faster) if the alias proves a nuisance. Its rules are listed by name and there is no shared preset. |
| Format | **Prettier 3.9** | ESLint recommends a separate formatter. Prettier is the stable, most-adopted one. Biome's type-aware rules are still nursery, so Biome doesn't replace the linter. | Prettier 4 is in alpha; pin `^3`. |
| Idioms | `unknown` plus zod 4 parsing at every boundary (OLIS JSON, PDF metadata, MCP inputs), with zod schemas as the single source of MCP `inputSchema`/`outputSchema` (2020-12). Branded ids (`MeasureId`, …) via `.brand()`. Discriminated unions with `never` checks for document and link kinds. `as const` objects instead of enums. `satisfies` for tables. `using` for `DatabaseSync`. `new Error(msg, { cause })`. `AbortSignal.any([AbortSignal.timeout(ms), shutdown])` on every `fetch`. | All are in the cited docs. They map directly onto ticket #4's tests (an unknown Measure gives `isError`). | `using stmt = db.prepare()` needs a local type augmentation until `@types/node` declares `StatementSync[Symbol.dispose]`. |
| Errors | Throw for bugs and infrastructure failures. Return discriminated-union results for expected domain outcomes (unknown or ambiguous citation, a removed row) across module seams. Map results to `isError` and throws to JSON-RPC errors only at the MCP edge. No Result library. | The MCP spec mandates exactly this split at the tool boundary. TS can't type throws (#13219), so expected failures belong in return types. | Two styles to keep apart; lint rules `only-throw-error` and `no-floating-promises` guard the throwing side. |
| SQLite | **`node:sqlite`**, as the spec decides, behind the storage module. The writer opens with `timeout: 5000`, `PRAGMA journal_mode=WAL`, `synchronous=NORMAL`. The server opens `readOnly: true, timeout: 5000`. Mount the volume read-write for both (the `-shm` file must be writable or already exist). The ingest worker checkpoints periodically. | No native dependency. FTS5 is built in. The two-process WAL pattern ran clean locally. The storage seam keeps a swap local. | Stability 1.2 is still in the Experimental family ("not recommended in production"), and an adopter's policy may reject it. Fallback: **better-sqlite3 13** (MIT, prebuilt binaries in the tarball, FTS5, `timeout` default 5000). The default `timeout: 0` means instant SQLITE_BUSY if it is forgotten. |
| Package hygiene | `"private": true`, `"type": "module"`. `engines.node` and `devEngines.runtime` `>=26.13.0 <27`. `devEngines.packageManager` `npm >=11.10.0`. Committed `package-lock.json`. `npm ci` everywhere. `.npmrc` `min-release-age=7`. `allowScripts` recorded with `npm approve-scripts`. No `packageManager` field, no Corepack, no `.nvmrc` (CI uses `node-version-file: package.json`). | npm-native fields only: Corepack is gone from Node 25+. The release-age window blunts compromised fresh releases. `allowScripts` is the npm 12 default anyway. | A 7-day window delays urgent fixes (use `min-release-age-exclude` or `--before` overrides). `allowScripts` is advisory in npm 11. |

---

## Unverified or open

1. Whether VS Code 1.144 bundles the TS 7 language server by default (the 1.144 notes are silent).
2. Whether Vitest's experimental `typecheck` mode works with a TS 7 `tsc` binary (not tried; this plan doesn't use it).
3. Behaviour of a `:ro` bind mount for the server container: the `-shm` file must already exist, and concurrency under a read-only mount was not tested.
4. That CPU inference works after `npm ci --ignore-scripts` with `onnxruntime-node` (inferred from its install script, not run).
5. The real-container cold start with `NODE_COMPILE_CACHE` in a read-only image (only measured on the host).
6. typescript-eslint's TS 7.1 backend timing (PR #12803 is open) and TS 7.1 stable date ("shortly after" an RC due about late November).

## Appendix: local measurement files

All under `<scratch>`:
- `tsprobe/`: wrong-alias layout (`.bin/tsc` → 6.0.3) and TS 6.0.3 `tsc --init`.
- `tsprobe2/`: blog alias layout (`tsc` 7.0.2, `typescript` 6.0.3), ESLint 10.13.0, typescript-eslint 8.72.1, oxlint 1.90.0 + tsgolint 7.0.2005, Biome 2.6.4, Vitest 5.0.5, `@types/node` 26.6.6.
  - `init7/`: TS 7 `tsc --init` output.
  - `dep/`: removed-option errors.
  - `base24/`: `@tsconfig/node24` check.
  - `lint/`: the five-bug probe for all three linters.
  - `strip/`: 200-module startup timing, `#/` and `.ts` import and TS2877 tests, Vitest subpath test.
  - `usingt/`: `using` emit at `es2024` vs `esnext`.
  - `libt/`: `using` with `node:sqlite` types.
- `rules.mjs`: dumps typescript-eslint rule preset membership.
- `walprobe/`: two-process WAL writer and read-only reader (`writer.mjs`, `reader.mjs`).
- `node26dl/node-v26.13.0-linux-x64/`: official Node 26.13.0 binary used for the Node 26 smoke tests (tarball deleted after a verified SHA-256 extract).
- The embedder smoke test reused `scripts/query-only.mjs`, `bench/` and `hfcache/` from the embeddings research.
