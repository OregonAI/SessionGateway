# SessionGateway

An MCP server holding a cited, searchable copy of one Oregon legislative Session. Spec #1 says what to build, and its sub-issues #3–#25 are the tickets. `docs/adr/` says why; `GLOSSARY.md` gives the words.

Each top-level folder has its own CLAUDE.md with the rules for that area: `src/` (production code), `test/` (seam 1 and the shared harness), `test/fixtures/`, `docs/` and `.github/`. Read the one for a folder before planning work in it. Packages are deep modules: see `src/packages/README.md` before adding or importing one. Explore and Plan subagents load no CLAUDE.md, so when you delegate to one, paste the rules it needs into its prompt.

## Building a ticket

1. Branch from `main`, one ticket per branch and per PR. The repo squash-merges, so a branch is rebased onto `main` when `main` moves and is never stacked on another ticket's branch. A human merges.
2. Build with `/implement`, test-first with `/tdd`. Spec #1 has already agreed the seams (`test/CLAUDE.md`), so the loop starts at those without asking again. A test anywhere else is a new seam: propose it in a comment on the ticket, and leave that part unbuilt until it is answered.
3. Every commit message names the ticket (`#N`), so `/code-review` finds the ticket without asking.
4. Open the PR with `/pr`, with `Closes #N` in the body.

## Done

A ticket is done when all of these hold:

- Every behaviour box in the ticket maps to a test that went red before the code turned it green, and the PR names the test for each box. Other boxes (a file committed, a note written) name the file or CI run that shows them.
- `npm run check` exits 0, and the PR pastes its summary: each step's result and the test totals. CI runs the same command.
- New domain words are in `GLOSSARY.md`. A decision that passes `/domain-modeling`'s three ADR tests is a new ADR (`docs/CLAUDE.md`).
- `/code-review` against `main` has run, and each finding is fixed or answered in the PR.

## Commands

`package.json` is the source of truth for every script.

- `npm ci`: the only way to install.
- `npm run check`: the whole gate. It runs `format:check`, `lint`, `typecheck`, `guard:tsc`, `lint:boundaries`, `fixture:verify` and `test`, keeps going after a failure, prints each step's result, and exits 1 if any failed. CI runs the same command.
- `npx vitest run <file>`: one test file, for the inner loop.
- `npm run format`: rewrites src, test and scripts with Prettier. `test/fixtures/` is never formatted.
- `npm run license:check`: the licence allowlist over the production tree (CI's supply-chain job; it needs no network).

## Toolchain

ADR-0008 records the picks and why:
- Node 26 runs the `.ts` source directly, with no build step.
- `tsc` from TypeScript 7 does type checking.
- TypeScript 6 is aliased as `typescript`, only for typescript-eslint and dependency-cruiser.
- ESLint, Prettier, Vitest, zod, pino and MCP SDK v2. (pino logs from `src/bin/server.ts`: where the server listens, the errors the Node adapter reports and the live lookups that fail and fall back to the cache, as JSON lines on stdout. A failed start-up, and the ingest worker, which logs nothing yet, leave Node's own uncaught-error text on stderr.)

`npm run check` fails unless `tsc --version` reports 7.x and the boundary check cruised more than 0 modules. A boundary check that cruised nothing checked nothing. `scripts/guard.ts` runs both commands and reads their output.

## Dependencies

Whoever adopts this code inherits every dependency, so the tree stays small and reviewed.

- `.npmrc` sets `min-release-age=14`, so npm resolves only versions published at least 14 days ago. A security fix is the one exception: take it deliberately and say so in the PR.
- `.npmrc` sets `strict-allow-scripts=true`, so `npm ci` fails while any dependency's install script is neither approved nor denied in `package.json` `allowScripts`. Read the script, then record the decision with `npm approve-scripts <pkg>` (pinned to the version you read) or `npm deny-scripts <pkg>`, and list each decision in the PR. Deny a script that only fetches something the service doesn't use, such as onnxruntime-node's, which downloads CUDA files.
- A `node:` built-in comes before a package. Justify each new runtime dependency in its PR: what it does, its license, and why no built-in fits.
- Licenses must be permissive (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD). CI checks `npm sbom --omit=dev` output against that list. A package outside the list needs the owner's approval in its PR, then an entry in the check's exceptions list naming the package, its license and the reason. The embedder ticket will need one: transformers.js depends on sharp, whose `@img/sharp-libvips-*` binaries are LGPL-3.0-or-later.

## Agent skills

### Issue tracker

GitHub Issues on OregonAI/SessionGateway, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage roles, each label string equal to the role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
