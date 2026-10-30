# Adoption readiness and agent instruction files for SessionGateway

Researched 2026-10-29 (some web reads and local runs crossed into 2026-10-30 UTC). Every version and date below was read on that day unless another date is given.

> **What was decided (2026-10-29).** Four of this file's recommendations were overruled:
> - The licence is MIT, to match `corpus-toolkit`, not Apache-2.0.
> - Agent instructions are plain `CLAUDE.md` files, because Claude Code is the only agent that will drive this code. There is no `AGENTS.md` and no Copilot copy.
> - The release-age window is 14 days, not 7.
> - Lint is ESLint on TypeScript 7 with the TypeScript 6 alias, not TypeScript 6 alone (ADR-0008).
>
> Repo visibility (row 1) is still open.

Labels used below:
- **verified**: I read the fact at the cited URL or file, or saw it in a command's output.
- **inferred**: my reading or arithmetic on verified evidence; the source does not say it.
- **local measurement**: I ran it on this machine (WSL2, Node v24.19.0, npm 11.17.0, Claude Code 2.1.310). Scratch projects are under `<scratch>/research/` (`npm-scripts-test/`, `npm-age-test/`); nothing was written to the SessionGateway repo.
- **unverified**: seen only in a search-result snippet, or the source doesn't settle it.

Scope: (A) what makes a TypeScript/Node codebase safe for an organization to adopt and run (supply chain, CI, containers, configuration, licensing, maintainability), and (B) how to write agent instruction files so Claude Code and GitHub Copilot build SessionGateway test-first. "An organization adopting the code" means a government IT organization that runs its own GitHub Enterprise and cloud, whose developers may use Copilot, Claude Code or other agents, and whose main language may be C#. The last section picks one option per choice.

---

## 0. Where the repo and toolchain stand today

| Fact | Status | Source |
|---|---|---|
| `OregonAI/SessionGateway` is **private**. The OregonAI org is on the **free** plan. | verified | `gh api repos/OregonAI/SessionGateway --jq .visibility`; `gh api orgs/OregonAI --jq .plan.name` |
| Rulesets can't be read or set on the repo: "Upgrade to GitHub Pro or make this repository public to enable this feature" (HTTP 403). | verified | `gh api repos/OregonAI/SessionGateway/rulesets` |
| The repo has no licence. Of the org's repos, only `corpus-toolkit` has a LICENSE file (MIT, "Copyright (c) 2026 the repository contributors"), and it also has an `AGENTS.md`. | verified | `gh repo list OregonAI --json name,licenseInfo`; `gh api repos/OregonAI/corpus-toolkit/contents/LICENSE` |
| `CLAUDE.md` is 390 bytes. It holds only the mattpocock-skills pointers to `docs/agents/issue-tracker.md`, `triage-labels.md` and `domain.md`. There is no `AGENTS.md`, `.github/` or `package.json` on `main` yet. | verified | `CLAUDE.md`; `ls` of the repo |
| `.gitignore` lists `node_modules/ dist/ coverage/ data/*.db data/*.db-* .env .cache/`, and not `CLAUDE.local.md`. | verified | `.gitignore` |
| ADR-0007 names deploy-specific values: the box's LAN address, "platform-deploy's reconcile loop", `deployed.txt`, "a path on the existing Cloudflare tunnel". The spec gives the tunnel path as `/session-gateway/mcp`, with the name "still to be settled". | verified | `docs/adr/0007-run-on-the-deploy-box.md`; `gh issue view 1` (Implementation Decisions) |
| Ticket #4 sets up "the TypeScript project and CI", and requires "CI runs the tests on every PR". Ticket #25 needs "the image builds with code and the embedding model only" and "killing the worker container does not interrupt the server". | verified | `gh issue view 4`; `gh issue view 25` |
| The machine runs Node **24.19.0** (2026-08-03, npm 11.17.0). The latest 24.x is 24.22.2 (2026-10-27). **24.22.1 (2026-10-20) was a security release.** | verified | `node --version`; https://nodejs.org/dist/index.json (`security: true` on v24.22.1) |
| Node 24 "Krypton" entered maintenance 2026-10-20 and reaches end of life 2028-04-30. Node 26 became **Active LTS on 2026-10-28** (26.13.0 "Lithium", bundling npm 11.20.0), goes to maintenance 2027-10-20, and reaches end of life 2029-04-30. | verified | https://raw.githubusercontent.com/nodejs/Release/main/schedule.json; https://nodejs.org/dist/index.json |
| On Node 24, end of life comes before the 2029R1 session, which runs early 2029. On Node 26 it comes during that session. | inferred | dates above; ADR-0003 (one Session per deployment) |

---

# Part A: safe to adopt and run

## 1. npm supply chain

### 1.1 Installs from the lockfile

| Fact | Status | Source |
|---|---|---|
| `npm ci` requires an existing `package-lock.json`, "will exit with an error" if the lock and `package.json` disagree, deletes `node_modules` first, and "will never write to `package.json` or any of the package-locks". | verified | `npm help ci` (npm 11.17.0 docs, `docs/content/commands/npm-ci.md`) |
| OpenSSF's npm guide: "Developers should declare and commit a lockfile", and in CI "only run npm commands that treat the lockfile as read-only". The guide is v1.1, and its repository has been archived (read-only) since 2023-10-09. | verified | https://github.com/ossf/package-manager-best-practices/blob/main/published/npm.md |
| npm 12 removed `npm shrinkwrap`, and `npm-shrinkwrap.json` "is no longer loaded or honored". | verified | https://github.com/npm/cli/releases/tag/v12.0.0 |
| npm `latest` is 12.2.1 and the v11 line is at 11.21.1. Node 24.22.2 bundles npm 11.19.1 and Node 26.13.0 bundles 11.20.0, so **Node's bundled npm is still 11.x**. npm 12 needs Node `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0`. | verified | `npm view npm dist-tags`; `npm view npm@12 engines`; https://nodejs.org/dist/index.json |

### 1.2 Release-age gate (delay brand-new versions)

| Fact | Status | Source |
|---|---|---|
| npm has `min-release-age` (days): "only versions that were available more than the given number of days ago will be installed". It was added in **npm 11.10.0 (2026-02-11)**. `min-release-age-exclude` (globs) was added in v12.0.0-pre.1 and is present in 11.17. `before` takes an absolute date and wins over `min-release-age` within the same config source. | verified | `npm help config` (npm 11.17.0); `gh api repos/npm/cli/releases` (v11.10.0: "add min-release-age (#8965)"; v12.0.0-pre.1: "add min-release-age-exclude config") |
| `min-release-age` is documented for `npm install` and `npm update`, not for `npm ci`. It governs resolving new versions; `npm ci` installs whatever the lockfile already pins. | verified (doc presence) / inferred (meaning) | `grep '#### \`min-release-age\`'` in `npm-install.md`, `npm-update.md` (present) and `npm-ci.md` (absent) |
| With `--min-release-age=7` on 2026-10-30 UTC, `@typescript-eslint/utils` resolved to **8.72.0** (published 2026-10-19), skipping 8.72.1 (published 2026-10-26). | local measurement | `npm-age-test/`: `npm install --package-lock-only --min-release-age=7 @typescript-eslint/utils`; `npm view @typescript-eslint/utils time` |
| A project `.npmrc` containing `min-release-age=7` is honoured: `npm config get min-release-age` returns 7. | local measurement | `npm-scripts-test/proj` |
| npm 11.18.0 warns "when min-release-age blocks an audit fix". | verified | `gh api repos/npm/cli/releases` (v11.18.0, #9564) |
| pnpm: `minimumReleaseAge` is in **minutes**, with **default 1440** in the current docs. `minimumReleaseAgeExclude` works by package name. pnpm latest is 12.16.1. | verified | https://pnpm.io/settings/dependency-resolution; `npm view pnpm version` |
| Dependabot `cooldown` takes `default-days`, `semver-major-days`, `semver-minor-days`, `semver-patch-days`, and `include`/`exclude` lists of up to 150 entries each. It applies "only ... for *version* updates, not *security* updates". npm is supported. | verified | https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference |
| Whether Dependabot reads a repo's `.npmrc` `min-release-age` is not documented on the pages I read. | unverified | same page |

### 1.3 Install scripts (the Shai-Hulud vector)

| Fact | Status | Source |
|---|---|---|
| Shai-Hulud (GitHub blog, 2025-09-22) spread through "compromised maintainer accounts" and injected malicious install scripts. GitHub removed 500+ packages. | verified | https://github.blog/security/supply-chain-security/our-plan-for-a-more-secure-npm-supply-chain/ |
| npm 11 has an `allowScripts` policy in `package.json`, maintained with `npm approve-scripts` / `npm deny-scripts`. Approvals are pinned to `pkg@version` by default. `strict-allow-scripts=true` turns unreviewed scripts "from a warning into a hard error". `--dangerously-allow-all-scripts` bypasses the policy. `--ignore-scripts` overrides all of them. | verified | `npm help approve-scripts`; `npm help config` (`allow-scripts`, `strict-allow-scripts`, `dangerously-allow-all-scripts`) |
| npm 11.17's own docs disagree: `approve-scripts` says the field "is advisory: install scripts still run by default", and `deny-scripts` says a deny "only affects how installs of denied packages are reported". `strict-allow-scripts` says denied entries "are always silently skipped". | verified (the conflict) | `npm-approve-scripts.md`, `npm-deny-scripts.md`, `config.md` in npm 11.17.0 |
| What npm 11.17.0 actually did, with a local tarball dependency whose `postinstall` writes a file: (1) no policy: the script **ran**, with an `allow-scripts` warning; (2) `--strict-allow-scripts`: the install **failed, exit 1**, and the script did not run; (3) a `false` entry from `npm deny-scripts`: the script was **skipped**; (4) `strict-allow-scripts=true` set in the project `.npmrc`: exit 1. | local measurement | `npm-scripts-test/proj` |
| **npm 12.0.0 (2026-07-08)** blocks dependency lifecycle scripts by default unless `allowScripts` allows them, and changes the `allow-git` and `allow-remote` defaults to `none`. GitHub's changelog adds that implicit node-gyp builds "no longer run unless explicitly allowed". | verified | https://github.com/npm/cli/releases/tag/v12.0.0; https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/ |
| `allow-git`, `allow-remote`, `allow-file` and `allow-directory` (`all`/`none`/`root`) exist in npm 11.17, defaulting to `all`. | verified | `npm help config` |
| pnpm: build scripts of packages not listed in `allowBuilds` "are disallowed by default", and `strictDepBuilds` defaults to true. | verified | https://pnpm.io/settings/build |
| `onnxruntime-node` (pulled in by `@huggingface/transformers` 4.3.2, which ADR-0006 depends on) has `"postinstall": "node ./script/install"`. On `linux/x64` the script installs the **`cuda12`** manifest of files "not bundled in the package", which includes `libonnxruntime_providers_cuda.so` (272 MB in the earlier bench). The CPU runtime `libonnxruntime.so.1` is bundled. | verified | `npm view onnxruntime-node@1.30.0 scripts`; `tmp/bench/node_modules/onnxruntime-node/script/install-metadata.js` (`'linux/x64': ['cuda12']`); `docs/research/embeddings-and-storage.md` §1.1 |
| Denying `onnxruntime-node`'s script should leave CPU inference working, while removing a network download at install time and about 272 MB. This is not yet tested in an image. | inferred | the two rows above |

### 1.4 Audit, signatures, SBOM

| Fact | Status | Source |
|---|---|---|
| `npm audit` exits non-zero at or above `audit-level` (`info` … `critical`, `none`). | verified | `npm help config` (`audit-level`) |
| `npm audit signatures` verifies registry signatures "and will also verify the provenance attestations of downloaded packages". `--json --include-attestations` adds the Sigstore bundles. | verified | `npm help audit` (Audit Signatures) |
| `npm sbom` emits SPDX or CycloneDX (`--sbom-format`), and `--sbom-type` can be `application`. On a lockfile-only tree it produced **CycloneDX 1.5** with a licence id on each component (e.g. `"license":{"id":"MIT"}`). | verified; local measurement | `npm help sbom`; `npm sbom --package-lock-only --sbom-format=cyclonedx --sbom-type=application --omit=dev` in `npm-age-test/` |
| npm 12 changed CycloneDX `name`/`bom-ref`/`purl` to come from each package's `package.json`. | verified | https://github.com/npm/cli/releases/tag/v12.0.0 |
| `provenance` in npm applies to **publishing** a package from CI. SessionGateway publishes an image, not an npm package, so npm provenance doesn't apply. Image provenance is covered in §3. | verified (scope of flag) / inferred (applicability) | `npm help config` (`provenance`) |

### 1.5 Registry-side changes after Shai-Hulud (what an adopting org inherits)

| Change | Status | Source |
|---|---|---|
| The plan (2025-09-22): publishing limited to local 2FA, short-lived granular tokens and trusted publishing; classic tokens and TOTP 2FA deprecated. | verified | github.blog plan (above) |
| All classic tokens permanently revoked on 2025-12-09; `npm login` issues a two-hour session token. | unverified (search snippet) | https://github.blog/changelog/2025-12-09-npm-classic-tokens-revoked-session-based-auth-and-cli-token-management-now-available/ |
| Bypass-2FA granular tokens lose sensitive account actions (expected early August 2026) and direct publishing (expected around January 2027). | verified | https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/ |
| These changes protect packages SessionGateway *consumes*. They reduce, but don't remove, the chance that a dependency ships a malicious version, which is why the release-age gate and the script policy still matter. | inferred | |

### 1.6 Dependency PR review

| Fact | Status | Source |
|---|---|---|
| Dependabot `groups`: `patterns`/`exclude-patterns`, `update-types` (`major`/`minor`/`patch`), `dependency-type` (`development`/`production`, npm supported), and `applies-to` (`version-updates` default, or `security-updates`). | verified | dependabot-options-reference (above) |
| Dependabot supports `npm` (v7–v12), `github-actions` (version and security updates), `docker` and `docker-compose` (version updates only). | verified | https://docs.github.com/en/code-security/dependabot/ecosystems-supported-by-dependabot/supported-ecosystems-and-repositories |
| `actions/dependency-review-action` fails a PR that adds vulnerable dependencies or disallowed licences. Options include `fail-on-severity`, `allow-licenses`, `fail-on-scopes` (default `runtime`) and `show-openssf-scorecard`. **Private repos need GitHub Advanced Security.** On GHES it needs GHAS plus GitHub Connect, and **the licence options are unsupported there**. The current major is v5, on node24 (runner ≥ 2.327.1). | verified | https://github.com/actions/dependency-review-action |

---

## 2. GitHub Actions and repository security

### 2.1 Pinning third-party actions

| Fact | Status | Source |
|---|---|---|
| GitHub says to "pin references to actions to a commit SHA". A tag "can be moved or deleted if a bad actor gains access to the repository storing the action". | verified | https://docs.github.com/en/actions/reference/security/secure-use |
| **Workflow dependency lockfiles** (`.github/workflows/actions.lock`, generated by the `gh actions-lock` extension, never hand-edited) pin every action, including transitive ones in the same repo, and are called "the strongest protection available", superseding SHA pinning. They don't pin reusable workflow calls (`jobs.<id>.uses`). | verified | https://docs.github.com/en/actions/concepts/security/workflow-dependency-lockfiles |
| Lockfiles entered **public preview on 2026-10-14** for GitHub Enterprise Cloud (including data residency), Team and Free. Dependabot regenerates the lock entry in its PR. A "Require lockfile" policy is also in preview. GHES isn't mentioned. | verified | https://github.blog/changelog/2026-10-14-github-actions-workflow-lockfiles-in-public-preview/ |
| A repo or org setting, "Require actions to be pinned to a full-length commit SHA", blocks unpinned actions. Reusable workflows can still be referenced by tag. Locked dependencies satisfy the setting. `!` patterns block actions within an allow list. | verified | https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository |
| OpenSSF Scorecard's Pinned-Dependencies check covers workflows, Dockerfiles ("pin dependencies by hash") and scripts. A GitHub Actions tag counts as pinned "when it is backed by a published immutable release". | verified | https://github.com/ossf/scorecard/blob/main/docs/checks.md |
| SHA pins work on every GitHub product. Lockfiles are a 15-day-old preview with no stated GHES support, so an adopting org on GHES may not be able to use them. | inferred | the rows above |

### 2.2 Token scope and checkout

| Fact | Status | Source |
|---|---|---|
| Set `GITHUB_TOKEN` to read-only for repository contents by default, and raise permissions per job only as needed. The repo setting offers "read and write access for all permissions (the permissive setting)" or "just read access for the `contents` and `packages` permissions (the restricted setting)". | verified | secure-use (above); managing-github-actions-settings (above) |
| Avoid `pull_request_target` unless needed, and such workflows "must not explicitly check out untrusted code". Pass untrusted input through an environment variable, not an inline expression. | verified | secure-use (above) |
| `actions/checkout`: `persist-credentials` defaults to `true`. Since v6 the credential is stored "in a separate file under `$RUNNER_TEMP` instead of directly in `.git/config`". The latest major is **v7**, which refuses fork-PR checkout under `pull_request_target`/`workflow_run` unless `allow-unsafe-pr-checkout: true`. It needs a node24 runner (≥ v2.327.1). | verified | https://github.com/actions/checkout |
| Scorecard's Token-Permissions check (High risk) wants read-only top-level permissions, and Dangerous-Workflow (Critical) flags untrusted checkouts and script injection. | verified | Scorecard checks.md (above) |

### 2.3 OpenSSF Scorecard checks that bear on adoption

| Check (risk) | What it looks for | Status | Source |
|---|---|---|---|
| Branch-Protection (High) | required reviews, no force push, status checks | verified | Scorecard checks.md |
| Code-Review (High) | human review before merge; bot reviews don't count | verified | same |
| Dependency-Update-Tool (High) | Dependabot or Renovate enabled | verified | same |
| Pinned-Dependencies (Medium) | hashes or versions for actions, Dockerfiles, scripts | verified | same |
| SAST (Medium) | CodeQL, SonarCloud and similar | verified | same |
| SBOM (Medium) | SBOM in source or release artifacts | verified | same |
| Security-Policy (Medium) | `SECURITY.md` with reporting contacts | verified | same |
| License (Low), CI-Tests (Low), Vulnerabilities (High, via OSV), Signed-Releases (High), Token-Permissions (High), Dangerous-Workflow (Critical) | as named | verified | same |

### 2.4 Code scanning and secret scanning: availability

| Feature | Public repo | Private repo | GHES | Status | Source |
|---|---|---|---|---|---|
| CodeQL default setup (covers JavaScript/TypeScript) | yes | needs **GitHub Code Security** | site admin must enable code scanning; licence terms not stated on the page read | verified | https://docs.github.com/en/code-security/code-scanning/enabling-code-scanning/configuring-default-setup-for-code-scanning; https://docs.github.com/en/enterprise-server@latest/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning (GHES 3.22) |
| Secret scanning | "runs automatically for free" | needs **GitHub Secret Protection** | needs Secret Protection on the enterprise | verified | https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning |
| Repo-level push protection | requires Secret Protection to be enabled, and is off by default. *User* push protection is on by default for pushes to public repos on github.com. | same | not stated | verified | https://docs.github.com/en/code-security/secret-scanning/introduction/about-push-protection |
| Rulesets / branch protection | yes on Free (per the 403 text) | needs Pro/Team/Enterprise | yes | verified | `gh api .../rulesets` 403 message; https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets |
| Dependency review action | yes | needs GHAS | needs GHAS + GitHub Connect; no licence checks | verified | dependency-review-action README |

**Consequence (inferred):** while SessionGateway stays private on the org's free plan, it can't have branch protection, secret scanning, CodeQL default setup or dependency review. All of these come free the day it goes public. ADR-0002 already commits public-record fixtures, and the org's corpus repos are public (`gh repo list OregonAI`).

---

## 3. Containers

### 3.1 Practices and their sources

| Practice | Status | Source |
|---|---|---|
| Set `NODE_ENV=production` at run time. | verified | https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md |
| npm's `omit` defaults to `dev` when `NODE_ENV=production`. Omitted packages are still resolved into the lockfile. | verified | `npm help config` (`omit`) |
| "Node.js was not designed to run as PID 1." Use `docker run --init` or put Tini in the image. Compose `init: true` "runs an init process (PID 1) inside the container that forwards signals and reaps processes". | verified | docker-node BestPractices; https://docs.docker.com/reference/compose-file/services/ |
| `CMD ["node", "…"]` rather than `npm start`, so `SIGTERM` reaches Node directly. | verified | docker-node BestPractices |
| The official images include a `node` user (uid 1000). Use `USER node` or `-u node`. "If a service can run without privileges, use `USER`." | verified | docker-node BestPractices; https://docs.docker.com/build/building/best-practices/ |
| Use a multi-stage build to drop npm and Yarn from the final image. Yarn is already gone from the Node 26+ images. | verified | docker-node BestPractices |
| Set memory limits (`-m`, or compose `mem_limit`). | verified | docker-node BestPractices; compose reference |
| Pin the base image by digest "to fully secure your supply chain integrity". Rebuild regularly with `--pull`. | verified | Docker build best practices (above) |
| `ENV` values persist in their layer "and its value can be dumped", so secrets don't belong in `ENV`. | verified | Docker build best practices |
| Compose has `read_only` (read-only filesystem), `tmpfs`, `cap_drop`, `security_opt` (`no-new-privileges`), `healthcheck`, `stop_grace_period` and `restart`. | verified | compose services reference |
| Build attestations: provenance at `mode=min` is added by default; `--provenance=mode=max` and `--sbom=true` are opt-in; both attach to the image index. | verified | https://docs.docker.com/build/metadata/attestations/ |
| GitHub artifact attestations reach SLSA Build L2, or L3 from a reusable workflow, and are verified with `gh attestation verify`. Private repos use GitHub's Sigstore instance, which has no public transparency log. | verified | https://docs.github.com/en/actions/concepts/security/artifact-attestations |

### 3.2 Base images

| Option | Free? | Non-root default | Shell / npm in runtime | Signed / SBOM | Node 26 | Status | Source |
|---|---|---|---|---|---|---|---|
| `node:24-trixie-slim` / `node:26-…-slim` (Docker Official Image) | yes | no (a `node` user exists) | yes / yes unless stripped by multi-stage | not stated on the page read | `lts` and `latest` tags point at 26 | verified | https://hub.docker.com/_/node |
| `node:*-alpine` | yes | no | yes | – | yes | verified; musl libc, and the page warns software "will often run into issues" | same |
| `gcr.io/distroless/nodejs24-debian13`, `nodejs26-debian13` (`:nonroot`, `:debug-nonroot`) | yes | `nonroot` tag (not explained on the page) | no shell (`debug` adds busybox) / no npm | cosign keyless signatures | yes | verified | https://github.com/GoogleContainerTools/distroless |
| Docker Hardened Images `dhi.io/node` | Community tier free, "free to use, share, and build on under Apache 2.0", but `docker login dhi.io` is required | yes | distroless variants offered | signed SBOMs, SLSA Build L3 provenance, VEX | the catalog page shows 26.x (FIPS shown, Alpine 3.24 path) | verified (partial: variants and free-tier coverage of the Node image not stated) | https://docs.docker.com/dhi/; https://docs.docker.com/dhi/get-started/; https://hub.docker.com/hardened-images/catalog/dhi/node |
| Chainguard `cgr.dev/chainguard/node` | "a starter image for free"; "access to a specific tag requires contacting Chainguard" | yes (`node`) | `-dev` adds shell and apk | Sigstore signatures, SBOM, SLSA L3 | not stated | verified | https://images.chainguard.dev/directory/image/node/overview |

### 3.3 SessionGateway-specific container facts

| Fact | Status | Source |
|---|---|---|
| SQLite WAL: "All processes using a database must be on the same host computer; WAL does not work over a network filesystem." A read-only opener needs existing `-shm`/`-wal` files, write access to the directory, or `immutable`. | verified | https://www.sqlite.org/wal.html |
| ADR-0007's two containers sharing one SQLite file therefore have to be **co-located on one host and one local volume**. An adopting org's cloud must not put the database on an SMB/NFS share. On Kubernetes that means one pod with both containers. On a managed container platform it means one replica with local storage. Azure Files or a bucket mount (the kind ADR-0007 rejected for Cloud Run) won't work. | inferred | SQLite WAL text; ADR-0007 |
| The server container only reads, but still needs write access to the database directory, or to existing `-shm`/`-wal` files, so its volume mount can't simply be `:ro`. | inferred | SQLite WAL §5 |
| transformers.js 4.3.2 defaults: `allowRemoteModels: true` (fetches from the Hugging Face Hub at run time) and `cacheDir` = `.cache` "relative to the library's installed location". With a read-only root filesystem and no network, the model has to be baked in, with `allowRemoteModels=false` and `localModelPath` set. | verified (defaults) / inferred (consequence) | `tmp/bench/node_modules/@huggingface/transformers/src/env.js` lines 203–267 |
| `onnxruntime-node` ships glibc Linux binaries, and the earlier bench ran on Debian-family glibc. Debian-based slim or distroless images avoid the musl caveat that Alpine carries. | inferred | §1.3 row on onnxruntime; Docker Hub Alpine note |
| Distroless has no shell, so `HEALTHCHECK CMD curl …` can't work. A healthcheck has to be exec-form `node` running a small script. | inferred | distroless README ("vector form is required for any ENTRYPOINT") |
| The prototype Dockerfile (on the `prototype/scaffold` branch) already used `node:24-slim`, a multi-stage build, `npm ci --ignore-scripts`, `npm ci --omit=dev`, `USER node` and `CMD ["node", …]`. It used no digest pins and no init. | verified | `git show prototype/scaffold:Dockerfile` |

---

## 4. Configuration and portability

| Fact | Status | Source |
|---|---|---|
| Config is "everything that is likely to vary between deploys" and requires "strict separation of config from code". The litmus test: the codebase "could be made open source at any moment, without compromising any credentials". Config values "are never grouped together as 'environments'". | verified | https://12factor.net/config |
| "A twelve-factor app never concerns itself with routing or storage of its output stream"; each process writes its event stream "unbuffered, to `stdout`". | verified | https://12factor.net/logs |
| `zod` is a **peer dependency** of `@modelcontextprotocol/sdk` 1.32.2 (`"zod": "^3.25 \|\| ^4.0"`), so the project installs zod regardless. zod latest is 4.6.7 (MIT). | verified | `npm view @modelcontextprotocol/sdk@1.32.2 peerDependencies`; `npm view zod` |
| Using zod to validate `process.env` at startup costs no new dependency. | inferred | the row above |
| Node 24 has `--env-file`, `--env-file-if-exists`, `process.loadEnvFile()` and `util.parseEnv()` built in, so a dotenv package isn't needed for local runs. | local measurement | `node --help`; `node -e "typeof process.loadEnvFile"` |
| MCP Streamable HTTP: servers "**MUST** validate the `Origin` header on all incoming connections to prevent DNS rebinding attacks" (403 if invalid), "**SHOULD** bind only to localhost" when local, and "**SHOULD** implement proper authentication". | verified | https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http (current spec; `/specification/latest` redirects to 2026-07-28) |
| MCP tools: servers "**MUST** validate all tool inputs, implement proper access controls, rate limit tool invocations, sanitize tool outputs". Input-validation failures are tool execution errors with `isError: true`; unknown tools and malformed requests are JSON-RPC protocol errors. | verified | https://modelcontextprotocol.io/specification/2026-07-28/server/tools |
| For a public, no-login server (spec user story 59), allowed origins and rate limits become deployment config, not constants. | inferred | spec; MCP rows above |
| pino latest is **10.4.0** (MIT, 2026-10-02). Its default destination is `pino.destination(1)` (stdout). The README: "it's highly recommended that sending, alert triggering, reformatting, and all forms of log processing are conducted in a separate process or thread". Transports run in worker threads from v7. | verified | `npm view pino`; https://raw.githubusercontent.com/pinojs/pino/main/docs/api.md (line 641); pino README; docs/transports.md |
| OpenTelemetry JS status: Traces **Stable**, Metrics **Stable**, Logs **Development**. It "supports all active or maintenance LTS versions of Node.js". `@opentelemetry/sdk-node` is 0.300.0 and `@opentelemetry/api` 1.10.0. | verified | https://opentelemetry.io/docs/languages/js/; `npm view` |
| Zero-code instrumentation: `NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register"`, filtered by `OTEL_NODE_ENABLED_INSTRUMENTATIONS`. The package must be installed in the image. ESM behaviour with `--require` is not covered on the pages read. | verified / unverified (ESM) | `npm view @opentelemetry/auto-instrumentations-node@0.82.0 readme` |

**Host-specific values found in the current design, and where they belong (inferred from ADR-0007 and the spec):**

| Value | Where it is today | Belongs in |
|---|---|---|
| Deploy box address, 2 cores / 14 GB | ADR-0007 | platform-deploy (or the adopter's own deploy repo). Never in `src/`. |
| Cloudflare tunnel and path `/session-gateway/mcp` | ADR-0007, spec | tunnel config in platform-deploy; the app reads its mount path from an env var |
| Reconcile loop, `deployed.txt` | ADR-0007, #25 | platform-deploy. The app can report its own commit (build arg → OCI label `org.opencontainers.image.revision`, inferred) so any platform can see it. |
| Session key (`2025R1`, `2027R1`) | spec ("named by its `SessionKey` in configuration") | env var, already decided |
| OLIS base URL | spec (fake OLIS in tests) | env var; tests point it at the fake |
| Data directory (database, PDFs), model directory, OregonAI snapshot path | ADR-0007, ADR-0004 | env vars, with the volume layout described in a sample compose file |
| GPU-desktop backfill | ADR-0007 | run-book step: "build the database anywhere, copy it to the volume" |

---

## 5. Licensing and governance

### 5.1 MIT vs Apache-2.0

| Aspect | MIT | Apache-2.0 | Status | Source |
|---|---|---|---|---|
| Summary | "short and simple permissive license with conditions only requiring preservation of copyright and license notices" | "main conditions require preservation of copyright and license notices"; "Contributors provide an express grant of patent rights" | verified | https://choosealicense.com/licenses/mit/; https://choosealicense.com/licenses/apache-2.0/ |
| Patent use | not listed | listed. §3 grants a perpetual patent licence, which terminates for anyone who sues alleging infringement. | verified | same |
| Extra conditions | none | "State changes" (§4b: modified files carry notices) | verified | same |
| Trademark | not addressed | §6 grants no trademark rights | verified | same |
| Org precedent | `corpus-toolkit` is MIT | none | verified | `gh api repos/OregonAI/corpus-toolkit/contents/LICENSE` |
| A LICENSE can't come from an org's `.github` defaults; each repo needs its own. | verified | https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file |
| The committed fixtures are public records (ADR-0002), not project code. A code licence doesn't relicense them, so a README or NOTICE line should say so. | inferred | ADR-0002; spec "Fixtures" |

### 5.2 Checking dependency licences

| Tool | Version, last publish | State | Status | Source |
|---|---|---|---|---|
| `license-checker` | 25.0.1, 2019-01-10 | unmaintained; the fork's README says it "hasn't been maintained for quite some time" | verified | `npm view license-checker time`; https://github.com/RSeidelsohn/license-checker-rseidelsohn |
| `license-checker-rseidelsohn` | 5.0.1 (2026-05-27); 6.0.0-rc.1 (2026-07-15) | `--onlyAllow` / `--failOn` exit 1, `--production`. The README calls 6.0.0 "the final release" and moves development to `@lizenz/checker`. Needs Node ≥ 24, npm ≥ 11. | verified | `npm view`; README |
| `@lizenz/checker` | 0.0.2 (2026-08-26) | pre-1.0 successor | verified | `npm view @lizenz/checker` |
| `actions/dependency-review-action` `allow-licenses` | v5 | PR-diff only; GHAS on private repos; **not on GHES** | verified | README |
| `npm sbom` | built in | licence ids per component (CycloneDX 1.5). The licence is self-declared from each `package.json`, not a file scan. | verified / local measurement | §1.4 |
| `@cyclonedx/cyclonedx-npm` | 6.0.1 (2026-08-11) | standalone CycloneDX generator | verified | `npm view` |

### 5.3 Repository governance files

| Fact | Status | Source |
|---|---|---|
| `SECURITY.md` should give "supported versions of your project and how to report a vulnerability". | verified | https://docs.github.com/en/code-security/getting-started/adding-a-security-policy-to-your-repository |
| An org's public `.github` repo can supply default `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md` and issue/PR templates. A repo's own file overrides the default. OregonAI has a public `.github` repo. | verified | community-health doc (above); `gh repo list OregonAI` |
| `CODEOWNERS` lives in `.github/`, the root or `docs/`, searched in that order, and must be under 3 MB. With "Require review from Code Owners", any one owner's approval suffices. | verified | https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners |
| Rulesets layer (the most restrictive rule wins), "anyone with read access … can view its active rulesets", and bypass can be granted to specific actors. Org-wide rulesets need the Enterprise plan. | verified | about-rulesets (above) |

### 5.4 Public Oregon statewide guidance

| What the public source says | Status | Source |
|---|---|---|
| Statewide policy **107-004-052** "Cyber and Information Security" (effective 2026-02-17, reviewed 2025-12-02) applies to executive-branch agencies under ORS 276A.230, with listed exclusions. Its exhibits include the Statewide IT Control Standards. | verified | https://www.oregon.gov/eis/Documents/107-004-052%20Cyber%20Info%20Security%2020251202-policy.pdf |
| The **Statewide IT Control Standards** (January 2024, approved 2024-01-29/31) align with "the moderate control families of" NIST SP 800-53 Rev 5. Agencies must make sure "third parties acting on behalf of agencies have formal agreements that guarantee compliance". Deviations need agency-head sign-off. | verified | https://www.oregon.gov/eis/cyber-security-services/Documents/eis-css-statewide-information-technology(IT)-control-standards.pdf (text extracted with `pdftotext` to `tmp/research/dl-oregon/`) |
| **SA-11** developers must "perform unit, integration, system, and regression testing", "produce evidence", and run "a verifiable flaw remediation process". **SA-11(1)** requires static code analysis with documented results. **SA-15** requires a documented development process that "documents the specific tool options and tool configurations". | verified | same PDF, pp. 48 |
| **RA-5**: scan monthly; remediate High within 30 days, Moderate within 90, Low within 180. **RA-5(11)**: "Establish a public reporting channel for receiving reports of vulnerabilities". **SI-2**: apply security updates for High+ within **7** calendar days, Medium within 15, others within 30. RA-5 and SI-2 give different clocks for High findings; the document doesn't reconcile them. | verified | same PDF, pp. 44, 54 |
| **CM-7(5)**: keep "a current inventory of all software assets that are authorized to execute" and use deny-all, permit-by-exception. | verified | same PDF, p. 19 |
| The CSS "guidance for state agencies" page links the program plan, IT control standards and incident response plan. For software security assessments it recommends OWASP ASVS. **No open-source or supply-chain document is linked.** | verified | https://www.oregon.gov/eis/cyber-security-services/Pages/guidance-for-state-agencies.aspx |
| Draft policy **107-004-010** "IT Asset Inventory and Management (Software)", posted for comment with filename date 2026-04-06 and no effective date: agencies keep a software inventory submitted by Dec 31, and keep lifecycle plans that don't override "vendor-declared sunset dates or end-of-support (EOS) milestones" (it points to the CIS end-of-support list). The draft says nothing about open source. | verified | https://www.oregon.gov/eis/Documents/107-004-010_software_draft%2020260406%20for%20comment.pdf |
| **I found no current Oregon statewide policy on open-source software.** Bills in 2003 and 2007 proposed one; none were confirmed enacted in the results. | verified (absence in the sources searched) / unverified (2003–2007 bill outcomes) | web search, 2026-10-29 |
| Mapping to this repo: CodeQL ↔ SA-11(1); committed tool configs (`tsconfig`, lint, `.npmrc`, workflows) ↔ SA-15; SBOM per image ↔ CM-7(5) and the software inventory; `SECURITY.md` + private vulnerability reporting ↔ RA-5(11); Node end of life ↔ the 107-004-010 lifecycle plans. | inferred | rows above |

---

## 6. Maintainability for handover

### 6.1 Documents a new team needs

| Document | What the source says | Status | Source |
|---|---|---|---|
| ADRs | an ADR "captures a single AD and its rationale". The repo has ADR-0001 to ADR-0007. | verified | https://adr.github.io/; `docs/adr/` |
| Glossary | already exists (`GLOSSARY.md`); `docs/agents/domain.md` tells agents to use its terms | verified | repo |
| README run-book | none yet. The spec and #25 ask for written "steps to switch to a new Session". | verified (gap) | `gh issue view 25` |
| `CONTRIBUTING.md` | can be an org default from `.github` | verified | community-health doc |

### 6.2 Making the code readable to developers whose main language is C#

| Point | Status | Source |
|---|---|---|
| TypeScript is "*structural*, not nominal": a value fits a type if it has the properties. C# and Java are "*mandatory OOP*"; "singletons and static classes are unnecessary in TypeScript"; "'Free' functions … tend to be the preferred model". | verified | https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes-oop.html |
| Types are "not reified" and "fully erased": no runtime reflection or generic type info, so runtime validation (zod at boundaries) does the job C# readers expect from the type system. | verified (erasure) / inferred (consequence) | same |
| `isolatedDeclarations` (TS 5.5) requires "sufficient annotation on exports". typescript-eslint `explicit-module-boundary-types`: explicit return and argument types "makes it clear to any calling code" and "can help improve code readability". Both give a C#-like explicit signature at module edges. | verified / inferred (C# link) | https://www.typescriptlang.org/tsconfig/#isolatedDeclarations; https://typescript-eslint.io/rules/explicit-module-boundary-types/ |
| `erasableSyntaxOnly` forbids `enum`, runtime `namespace`, parameter properties and `import =`. Node's built-in type stripping (stable since **v24.12.0**) doesn't support those constructs and does no type checking. C# developers reach for `enum` first, so the repo should name the replacement (string-literal unions) once. | verified / inferred (C# habit) | https://www.typescriptlang.org/tsconfig/ (erasableSyntaxOnly); https://nodejs.org/docs/latest-v24.x/api/typescript.html |
| One error convention at the MCP boundary: tool execution errors use `isError: true`, and protocol errors are JSON-RPC errors (spec decision "Errors are reported as MCP errors (`isError`)"). | verified | MCP tools spec; `gh issue view 1` |
| No clever type-level code (conditional/mapped types beyond what libraries need), one module per spec module, and names from `GLOSSARY.md`. | inferred (no primary source found) | |

### 6.3 Toolchain facts that bear on ticket #4

| Fact | Status | Source |
|---|---|---|
| TypeScript `latest` is **7.0.2** (2026-07-08; 7.1.0-beta on 2026-10-20). 6.0.3 (2026-04-16) is the last 6.x. | verified | `npm view typescript dist-tags time` |
| typescript-eslint 8.72.1 has peer `typescript: ">=4.8.4 <6.1.0"`, so **type-aware ESLint doesn't support TS 7 yet**. | verified | `npm view typescript-eslint peerDependencies` |
| Biome 2.6.4 (MIT OR Apache-2.0) parses TypeScript itself; it isn't a typescript-eslint peer. | verified (licence, version) / inferred (TS 7 independence) | `npm view @biomejs/biome` |
| `strict` shows "Default: `true`" in the current tsconfig reference. `noUncheckedIndexedAccess` (4.1) adds `undefined` to index-signature reads. | verified | https://www.typescriptlang.org/tsconfig/ |
| `node:sqlite` is "Stability: 1.2 – Release candidate" in both the Node 24 and Node 26 docs. | verified | https://nodejs.org/docs/latest-v24.x/api/sqlite.html; https://nodejs.org/docs/latest-v26.x/api/sqlite.html |
| vitest 5.0.5, `@modelcontextprotocol/sdk` 1.32.2 (engines `node >=18`), tsx 4.23.15. | verified | `npm view` |

---

# Part B: instruction files for AI coding agents

## 7. Claude Code memory files

All rows are from https://code.claude.com/docs/en/memory unless another source is given; all **verified**.

| Topic | Fact |
|---|---|
| Locations | Managed policy (`/etc/claude-code/CLAUDE.md` on Linux/WSL), user `~/.claude/CLAUDE.md`, project `./CLAUDE.md` or `./.claude/CLAUDE.md`, local `./CLAUDE.local.md` ("add to `.gitignore`"). `CLAUDE.local.md` is current, not deprecated. |
| Discovery | Loads `CLAUDE.md`/`CLAUDE.local.md` from the working directory and every directory above it, concatenated root-first. Subdirectory files load "once Claude reads, writes, or edits another file in that subdirectory". |
| Imports | `@path` (relative to the importing file), recursive to "a maximum depth of four hops". Imports inside code spans and fences are skipped. External imports (outside the working directory) need a one-time approval. "Imports … don't reduce its context cost." |
| Rules | `.claude/rules/**/*.md`. Without `paths:` frontmatter a rule loads at launch "with the same priority as `.claude/CLAUDE.md`". With `paths:` (a glob list) it loads when Claude reads, writes or edits a matching file. `paths` is the only frontmatter field read. User rules live in `~/.claude/rules/`. Symlinks are supported, and outside targets need approval. |
| Size | "target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence." Files over 4 MiB are skipped. Subdirectory files and path-scoped rules are truncated at 40,000 characters (200K window) or 150,000 (1M window, post-4.6 models). |
| In vs out | Keep "build commands, conventions, project layout, 'always do X' rules"; move multi-step procedures to skills and area-specific rules to path-scoped rules. `/doctor` "cuts content Claude can derive from the codebase, such as directory layouts, dependency lists, and architecture overviews, and keeps pitfalls, rationale, and conventions that differ from tool defaults". |
| HTML comments | Block-level `<!-- … -->` are stripped before injection (maintainer notes cost no tokens). |
| AGENTS.md | Read natively from **v2.1.277**, **but by default only when there is no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md`** in the working directory or above it. A `CLAUDE.md` containing `@AGENTS.md` works in every version and never double-loads. The `claude-md-and-agents-md` setting is honoured only in `~/.claude/settings.json`, `--settings` or managed settings, "and ignores it in project and local settings files". `AGENTS.local.md`, `AGENTS.override.md` and `.agents/` are not read. |
| Symlink option | `ln -s AGENTS.md CLAUDE.md` works, but on Windows "Git checks a committed symlink out as a plain text file unless `core.symlinks` is enabled", so "use the `@AGENTS.md` import instead". |
| Subagents | Non-fork subagents load "every level of the CLAUDE.md hierarchy the main conversation loads", including project rules and any AGENTS.md loaded as project instructions. **The built-in Explore and Plan agents skip this.** `omitClaudeMd: true` drops it for a custom agent. Auto memory isn't loaded. (https://code.claude.com/docs/en/sub-agents) |
| Compaction | Project-root CLAUDE.md is re-read after `/compact`. Nested files and path rules reload on demand. |
| Enforcement | "Claude treats them as context, not enforced configuration. To block an action regardless of what Claude decides, use a PreToolUse hook." |

**Anthropic on what belongs in the file and on enforcement** (https://code.claude.com/docs/en/best-practices, **verified**):
- Test before writing a line: "Could it find this by reading the code? Would it actually go and look? If both are yes, leave it out."
- What to keep: "the exact test, typecheck, and lint commands, and how to run a single test file"; "places where the code is misleading"; "decisions that aren't in the repo"; "anything you've had to correct twice".
- "If your repo already has one of these [checks], the single most useful line in your `CLAUDE.md` is the command that runs it."
- On verification: "Give Claude something it can run that comes back pass or fail", and ask for *evidence* ("the command it ran and its output").
- Deterministic vs non-deterministic: `CLAUDE.md` and skills are advisory; "Hooks, a deny rule, or a managed setting" are enforced. The Stop-hook example `pnpm tsc --noEmit 1>&2 || exit 2` blocks finishing until typecheck passes, with a block cap of eight in a row. The PostToolUse `Edit|Write` example formats each edited file.
- "Old advice" retired: IMPORTANT and ALL CAPS ("piling on emphasis mostly makes Claude over-apply the rule"), and describing "your architecture and file layout in `CLAUDE.md`".
- TDD: the old engineering post `anthropic.com/engineering/claude-code-best-practices`, with its "write tests, commit; code, iterate, commit" workflow, now **308-redirects** to the best-practices page, which no longer has a TDD section. What remains is "write a failing test that reproduces it, then fix it" and, for unattended runs, "a failing test it has to turn green". The hooks reference has a `TaskCompleted` example that runs `npm test` and exits 2 so a task can't be marked done while tests fail. (WebFetch of the old URL; `code.claude.com/docs/llms-full.txt` grep; https://code.claude.com/docs/en/hooks)
- Hook exit codes: `PostToolUse` exit 2 "Shows stderr to Claude; the tool already ran" (can't block); `Stop`, `SubagentStop` and `TaskCompleted` exit 2 block. Hooks from settings files run only after workspace trust is accepted. (https://code.claude.com/docs/en/hooks)

## 8. Cross-tool instruction files

### 8.1 Who reads what

GitHub's support matrix (https://docs.github.com/en/copilot/reference/custom-instructions-support, **verified**):

| Surface | `.github/copilot-instructions.md` | `.github/instructions/**/*.instructions.md` (`applyTo`) | `AGENTS.md` / `CLAUDE.md` |
|---|---|---|---|
| GitHub.com Copilot Chat | yes | no | no |
| GitHub.com cloud agent (formerly "coding agent") | yes | yes | AGENTS.md, CLAUDE.md, GEMINI.md |
| GitHub.com code review | yes | yes | AGENTS.md, CLAUDE.md, GEMINI.md, REVIEW.md |
| VS Code chat / agent mode | yes | yes | AGENTS.md |
| VS Code code review | yes | no | no |
| **Visual Studio chat and code review** | yes | chat only | **no** |
| JetBrains chat | yes | yes | no in the matrix (but see below) |
| Copilot CLI | yes | yes | AGENTS.md, CLAUDE.md, GEMINI.md |

| Further fact | Status | Source |
|---|---|---|
| Copilot: "the nearest `AGENTS.md` file in the directory tree will take precedence"; "Alternatively, you can use a single `CLAUDE.md` or `GEMINI.md` file stored in the root". The page doesn't say what happens when both exist. | verified | https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions |
| `excludeAgent: "code-review"` or `"cloud-agent"` in instruction frontmatter. When a path-specific and the repository-wide file both match, "the instructions from both files are used". | verified | same |
| Copilot code review reads instructions **from the PR's head branch** and reads `REVIEW.md`, `GEMINI.md` and `CLAUDE.md` (changelog 2026-07-17; AGENTS.md support 2026-06-18). | verified (07-17); unverified (06-18, snippet) | https://github.blog/changelog/2026-07-17-copilot-code-review-customization-and-configurability-improvements/ |
| The JetBrains changelog (2026-03-11): "We have added support for `AGENTS.md` and `CLAUDE.md` instruction files". This contradicts the matrix's JetBrains-chat row. | verified (both texts) | https://github.blog/changelog/2026-03-11-major-agentic-capabilities-improvements-in-github-copilot-for-jetbrains-ides/ |
| VS Code: `chat.useAgentsMdFile` (on by default), nested AGENTS.md behind the experimental `chat.useNestedAgentsMdFiles`, `chat.useClaudeMdFile`, and it also reads `.claude/rules` (`paths`). Markdown links in instructions are followed only with `chat.includeReferencedInstructions`. | verified | https://code.visualstudio.com/docs/copilot/customization/custom-instructions |
| Copilot code review doesn't follow external links ("copy the relevant content into your instruction file"). Keep any single file under about 1,000 lines, and "begin with 10–20 specific instructions". | verified | https://docs.github.com/en/copilot/tutorials/customize-code-review |
| Visual Studio's July 2026 "Agent (Preview)" is built on the Copilot SDK. Whether it reads AGENTS.md is not documented on the pages found. | unverified | Visual Studio blog snippet (search result) |
| AGENTS.md is "a README for agents". The listed readers include Codex, Jules, Cursor, Gemini CLI, Junie, Aider, Zed, Warp, VS Code and "Coding agent (GitHub Copilot)". Nearest file wins. Agents "will attempt to execute relevant programmatic checks". The format is stewarded by the Agentic AI Foundation under the Linux Foundation. | verified | https://agents.md/ |
| Claude Code `/init` reads `.github/copilot-instructions.md`, and with `CLAUDE_CODE_NEW_INIT=1` also AGENTS.md, to seed a CLAUDE.md. | verified | memory doc |
| Claude Code supports GHES for cloud sessions, Code Review and GitHub Actions (manual setup) on Team/Enterprise plans; the GitHub MCP server doesn't work with GHES. Claude's Code Review reads `REVIEW.md` "from the base or default branch". | verified | https://code.claude.com/docs/en/github-enterprise-server; https://code.claude.com/docs/en/code-review |

### 8.2 Layout options for one source of truth

| Layout | Claude Code | Copilot cloud agent / code review | Visual Studio / VS Code code review | Drift risk | Status |
|---|---|---|---|---|---|
| A. `AGENTS.md` only (delete `CLAUDE.md`) | reads it (≥ 2.1.277) unless anyone adds a `CLAUDE.local.md`, which silently switches AGENTS.md off for that person | yes | **no** | none | verified (behaviour) / inferred (risk) |
| B. `AGENTS.md` + `CLAUDE.md` = `@AGENTS.md` + Claude-only lines | yes, every version | yes; reads AGENTS.md, and possibly CLAUDE.md too (undocumented) | **no** | none | verified / unverified (Copilot precedence) |
| C. B + `.github/copilot-instructions.md` as a **generated copy** of AGENTS.md, checked in CI | yes | yes; the same text may arrive twice | yes | none if CI fails on difference | inferred |
| D. B + `.github/copilot-instructions.md` symlinked to `../AGENTS.md` | yes | unverified (symlink on GitHub.com) | breaks on Windows clones without `core.symlinks` | none | inferred from the Claude memory doc's Windows note |
| E. Hand-kept `copilot-instructions.md` | yes | yes | yes | high | inferred |

## 9. What good agent instructions contain

| Element | Anthropic | GitHub | agents.md | writing-for-agents skill | Status |
|---|---|---|---|---|---|
| Exact commands (test, typecheck, lint, one test file) | yes: "the single most useful line" | yes: "how to build, test and validate"; example "Full CI check: `make ci`" | "build and test commands" | the environment (`package.json` scripts) is a source of truth; restating it is a **cache**, worth it only when the lookup is expensive | verified |
| Definition of done / verification | "something it can run that comes back pass or fail"; evidence | issues with "complete acceptance criteria" | agents run the listed checks | each step ends on a **completion criterion**, "checkable and exhaustive" | verified |
| Project-specific gotchas and decisions not in the repo | yes | coding standards and conventions | security considerations, PR instructions | "cache what the agent cannot find by looking: the unwritten convention, the reason behind a choice, the gotcha" | verified |
| Leave out | layout and architecture, things discoverable from code, emphasis words | external links, response-style requests, vague goals ("be more accurate") | – | **no-ops** (what the model already does), **negation** (state the positive target), **duplication**; one meaning in one place | verified |
| Length | under 200 lines | about 1,000 lines max per file; start with 10–20 rules | – | **sprawl** is the failure mode; disclose by pointer | verified |

Sources: https://code.claude.com/docs/en/best-practices; https://docs.github.com/en/copilot/how-tos/agents/copilot-coding-agent/best-practices-for-using-copilot-to-work-on-tasks; https://docs.github.com/en/copilot/tutorials/customize-code-review; https://docs.github.com/en/copilot/concepts/prompting-and-context/custom-instructions; https://agents.md/; mattpocock-skills 1.3.1 `skills/productivity/writing-for-agents/SKILL.md`.

Two tensions and how they resolve (**inferred**):
- Anthropic says to put the command in the file; writing-for-agents says to leave single-command lookups to `package.json`. **One aggregate gate command** (`npm run check`) plus the single-test-file form satisfies both. Every other script stays in `package.json`.
- mattpocock's `tdd` skill already holds the test-first rules ("Red before green", vertical slices, "Test only at pre-agreed seams", anti-patterns). Copying them into AGENTS.md would duplicate them for Claude. Copilot and other agents can't load that skill, though, so AGENTS.md needs the **repo's** seam decisions from the spec (Seam 1 = MCP tools as a black box with fake OLIS, clock and snapshot; Seam 2 = table-driven text → links), stated once.

Enforcement that works for every agent (**inferred** from §2 and §7): CI status checks plus a ruleset on `main` are the only gates Copilot, Claude and humans all pass through. Claude hooks add a faster local loop, but only Claude Code runs them, and only after workspace trust.

---

## 10. Open questions

1. **Visibility.** Will SessionGateway go public, and when? Branch protection, secret scanning, CodeQL default setup and dependency review all depend on it (§2.4).
2. **The adopting org's GitHub product.** On GHES, workflow lockfiles and several Copilot features are unconfirmed (§2.1, §8.1), and dependency review loses licence checks.
3. Does Dependabot honour a repo `.npmrc` `min-release-age`? Not documented; cooldown is the documented equivalent.
4. Does transformers.js plus `onnxruntime-node` run CPU inference with the postinstall denied, `allowRemoteModels=false` and a read-only root filesystem? Test it in the #4 or #25 image build.
5. Does Node 26 with `onnxruntime-node` 1.30 (N-API) pass the embedder tests? Not measured.
6. Can platform-deploy (#39) express `init`, `read_only`, `tmpfs`, `cap_drop`, `no-new-privileges` and `mem_limit` for the new service kind?
7. When both exist at the root, does Copilot's cloud agent read `AGENTS.md`, `CLAUDE.md`, or both?
8. Does Visual Studio's Agent (Preview) read AGENTS.md?
9. Should the licence choice get legal review? No Oregon open-source policy was found to constrain it.
10. Which clock applies to High findings in the Oregon standard, RA-5 (30 days) or SI-2 (7 days)? An adopting state agency would apply its own reading.

---

## Recommendations for SessionGateway

| # | Choice | Pick | Reason | Risk |
|---|---|---|---|---|
| 1 | Repo visibility | Make `OregonAI/SessionGateway` **public** before ticket #4 merges. | Unlocks rulesets, secret scanning and push protection, CodeQL default setup, dependency review and Scorecard at no cost (§2.4). The corpus repos are already public, and ADR-0002 commits only public records. | Everything in git history becomes public. `.cache/` and `.env` must stay ignored (they are). If it stays private, none of the §2.4 controls exist until the org buys a plan. |
| 2 | Package manager and install | **npm** (bundled), committed `package-lock.json`, `npm ci` in CI and in the Dockerfile. | No extra tool for an adopter. npm 11.17 already has release-age and script policy (§1.2–1.3). | npm 12 changes defaults (default-deny scripts, `allow-git=none`). Making the policy explicit now means the upgrade changes nothing. |
| 3 | Project `.npmrc` | `min-release-age=7`, `strict-allow-scripts=true`, `allow-git=none`, `allow-remote=none`, `engine-strict=true` | Release age and strict scripts verified to work from the project `.npmrc` (§1.2–1.3). It matches npm 12's defaults on 11.x. | A 7-day gate also delays urgent fixes. Use `npm install pkg@x.y.z --min-release-age=0` deliberately; Dependabot security PRs ignore cooldown. |
| 4 | `allowScripts` | Start empty, review with `npm approve-scripts --allow-scripts-pending`. Deny `onnxruntime-node` (its linux/x64 postinstall only fetches CUDA files; §1.3), and approve nothing without reading the script. | Install scripts were the Shai-Hulud vector. A denied script fails loudly under `strict-allow-scripts`. | CPU inference with the script denied is untested (open question 4). Add a test in #4 that loads the model in CI. |
| 5 | Dependency updates | Dependabot for `npm`, `github-actions` and `docker`, weekly. `groups`: production minor+patch, development minor+patch, majors ungrouped. `cooldown: default-days: 7, semver-major-days: 14`. | Bot-side equivalent of the release-age gate; grouping keeps PR count low (§1.6). | Cooldown doesn't apply to security updates (intended). Grouped PRs can hide one breaking package; CI must be thorough. |
| 6 | CI workflow | Top-level `permissions: contents: read`. `actions/checkout@<sha> # v7` with `persist-credentials: false`. **Every action pinned by full SHA** with a version comment, and the repo setting "Require actions to be pinned to a full-length commit SHA" turned on. Steps: `npm ci` → `npm audit signatures` → `npm audit --omit=dev --audit-level=high` → `npm run check` (typecheck, lint, tests) → licence gate → `npm sbom` artifact. | Matches GitHub's secure-use guidance and Scorecard. SHA pins work on every GitHub product an adopter might run (§2.1). | Pins go stale without Dependabot (row 5). Adopt `actions.lock` only after it leaves preview and the adopter's platform supports it. |
| 7 | Security scanning | CodeQL default setup (javascript-typescript), secret scanning and push protection, `dependency-review-action@<sha> # v5` with `fail-on-severity: high` and `allow-licenses`. Optional: Scorecard action. | Covers SA-11(1) static analysis and RA-5 scanning evidence for a state adopter (§5.4). | All require public visibility or paid features (row 1). Licence checks in dependency review don't work on GHES, so row 9 is the portable gate. |
| 8 | Licence | **Apache-2.0**, with a README/NOTICE line that fixtures are public records not covered by it. | The express patent grant and its termination clause protect a public-body adopter; it's compatible with the MIT/ISC/BSD dependencies (§5.1). | Differs from `corpus-toolkit` (MIT). Relicensing after outside contributions is hard, so decide before the first external PR. Choose MIT instead if org consistency matters more than the patent grant. |
| 9 | Licence compliance | CI script: `npm sbom --omit=dev --sbom-format=cyclonedx --sbom-type=application` → fail on any component whose SPDX id isn't in an allowlist (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, BlueOak-1.0.0, CC0-1.0, Python-2.0 as needed). Keep the SBOM as a build artifact. | Zero new dependencies, while the npm licence-checker tools are mid-handover (§5.2). Works on GHES. The SBOM doubles as CM-7(5) inventory evidence. | `npm sbom` reports self-declared `package.json` licences, not scanned files. A package with a wrong or missing licence field needs a reviewed exception. |
| 10 | Node version | **Node 26 LTS** in `.nvmrc`, `engines` and the image. Upgrade the dev machine (24.19.0 is behind the 24.22.1 security release). | End of life 2029-04-30, against 2028-04-30 for Node 24, which falls before the 2029R1 session (§0). Lifecycle plans are what the Oregon draft 107-004-010 asks for. | Node 26 has been LTS for one day. `node:sqlite` is still RC on both lines. The onnxruntime N-API build on 26 is untested (open question 5). Fall back to 24 if the embedder tests fail. |
| 11 | Container image | Multi-stage: build on `node:26-trixie-slim@sha256:…`, run on `gcr.io/distroless/nodejs26-debian13:nonroot@sha256:…`, with both bases as `ARG`s so an adopter can swap in its approved image (DHI, Chainguard, internal). `npm ci --omit=dev` in the build stage, copy `node_modules` + `dist` + the model. Bake the model at a pinned revision with `allowRemoteModels=false`. `CMD`/`ENTRYPOINT` in exec form. Build with `--sbom=true --provenance=mode=max`. | Non-root, no shell or npm in the runtime, glibc for onnxruntime, signed base (§3.2). Attestations travel with the image. | No shell makes debugging harder (use `:debug-nonroot` temporarily). Digest pins need Dependabot `docker` updates. |
| 12 | Runtime hardening (compose / platform-deploy) | `init: true`, `user` non-root, `read_only: true`, `tmpfs: /tmp`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `mem_limit`, `stop_grace_period: 30s`, `restart: unless-stopped`. Healthcheck as exec-form `node dist/healthcheck.js`. **Server and worker on the same host and the same local volume.** | Node isn't PID-1-safe. SQLite WAL requires one host and no network filesystem (§3.3). | The server's volume can't be mounted `:ro` (WAL `-shm`). An adopter's managed platform must co-locate both containers. Write this in the run-book. |
| 13 | Configuration | One `config` module reads `process.env` once at startup through a **zod** schema, fails fast naming the bad variable (never printing values), and passes a typed object down. Variables: session key, data dir, model dir, snapshot path, OLIS base URL, MCP path, host and port, allowed origins, rate limit, log level. `.env.example` in the repo; `node --env-file` for local runs. No IPs, tunnel names or box paths anywhere in `src/`; deploy specifics live in platform-deploy plus a sample `compose.yaml`. | Twelve-Factor. zod is already a peer of the MCP SDK (§4). It makes the image runnable on another org's platform unchanged. | Names must be stable once an adopter depends on them, so treat the env contract like an API: document it and change it only with a changelog entry. |
| 14 | MCP endpoint safety | `Origin` validation (allowlist from config, 403 otherwise) and per-client rate limiting in the app, both on by default. Bind `0.0.0.0` only inside the container. | Both are spec MUSTs for servers (§4). The endpoint is public with no login. | Rate limiting behind a tunnel or proxy needs the real client IP. Make the trusted-proxy setting explicit in config. |
| 15 | Logging and telemetry | pino 10 JSON to stdout, `redact` on header and credential paths, no in-process transports. No OpenTelemetry SDK in v1. Document `NODE_OPTIONS=--require @opentelemetry/auto-instrumentations-node/register` as the adopter's option. | Twelve-Factor logs. OTel logs are still "Development" (§4). Keeps the dependency tree small. | Adopters wanting traces must add a package to the image. ESM behaviour of `--require` is unverified. |
| 16 | TypeScript and lint | **TS 6.0.x** + typescript-eslint (`strictTypeChecked`) with `explicit-module-boundary-types`. tsconfig: `strict`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`, `verbatimModuleSyntax`. Biome or Prettier for formatting only. Move to TS 7 when typescript-eslint's peer range allows it. | Type-aware rules (floating promises, boundary types) catch the bugs agents introduce. typescript-eslint doesn't accept TS 7 yet (§6.3). Explicit signatures read like C#. | Holding at 6.0 defers a later migration. Biome + TS 7 is the alternative if type-aware lint is dropped. |
| 17 | Governance files | `LICENSE`, `SECURITY.md` (private vulnerability reporting), `CODEOWNERS`, `CONTRIBUTING.md` (or org defaults in `OregonAI/.github`). Ruleset on `main`: PR required, required checks (`check`, CodeQL, dependency review), block force push, linear history. | Scorecard's High-risk checks; RA-5(11) "public reporting channel" (§5.3–5.4). | Rulesets need row 1. A one-maintainer repo can't require a second human review without blocking itself, so require checks and CODEOWNERS, not an approval count. |
| 18 | Handover docs | README as run-book (run locally, the env contract, build the database elsewhere and copy it, switch Session, co-location requirement), plus the existing `GLOSSARY.md` and ADRs. Add an ADR for rows 8, 10 and 11 when chosen. | #25 already asks for the Session-switch steps. ADRs carry the "why" an adopter needs. | Run-books rot. Tie each step to a command CI or the eval run exercises. |
| 19 | Agent file layout | **Layout C (§8.2):** `AGENTS.md` at the root is the single source. `CLAUDE.md` = `@AGENTS.md` + Claude-only lines (the mattpocock skill pointers). `.github/copilot-instructions.md` is a byte-for-byte generated copy of `AGENTS.md`, with a CI step that fails on any difference (`cmp`). No `.claude/rules/` or `.github/instructions/` until a mistake repeats twice. Add `CLAUDE.local.md` to `.gitignore`. | Claude reads AGENTS.md through the import on every version. Copilot's cloud agent, code review, VS Code and CLI read AGENTS.md. Visual Studio, VS Code code review and JetBrains chat read only `copilot-instructions.md` (§8.1), and C# teams use Visual Studio. A generated copy can't drift. | Copilot surfaces that read both files see the text twice (tokens, not meaning). Copilot's precedence with both AGENTS.md and CLAUDE.md is undocumented (open question 7). |
| 20 | AGENTS.md content | Under 200 lines, positive phrasing, no emphasis words. Sections: **Commands** (`npm run check` = the definition-of-done gate; the single-test-file form). **Done means** (each ticket's acceptance boxes ticked, red before green at the spec's seams, `npm run check` green, the command output pasted in the PR). **Testing** (Seam 1: MCP tools as a black box over fake OLIS + clock + snapshot fixture; Seam 2: table-driven text → Statute/Agency Links; assertions only on what an agent sees, never tables or SQL; tests never reach live OLIS or OregonAI). **Conventions** (glossary terms, OregonAI id forms, `isError` for tool errors, facts only on a Measure's merits, Pacific time from OLIS). **Workflow** (one PR per ticket off `main`, squash, rebase). **Pointers** (`GLOSSARY.md`, `docs/adr/`, `docs/agents/*.md`). | These are exactly the facts no agent can find by reading code (§9), drawn from the spec and ADRs. The seam rules give Copilot the TDD discipline the `tdd` skill gives Claude. | The file must change when the spec does; a stale line is worse than none. Run `/doctor prompt-audit` (Claude Code ≥ 2.1.283; installed 2.1.310) at each milestone. |
| 21 | Enforcement | Commit `.claude/settings.json` with a `Stop` hook running `npm run typecheck && npm run lint` (`1>&2 \|\| exit 2`), a `PostToolUse` `Edit\|Write` formatter on the edited file, and `deny` for `Read(./.env)`. The cross-tool gate is CI required checks + the ruleset (row 17). | Hooks are deterministic for Claude. CI is the only gate every agent and human passes (§7, §9). | Hooks run only after workspace trust; Stop blocks cap at eight in a row; Copilot ignores Claude hooks. Keep the full test suite in CI, not in the Stop hook, to keep turns fast. |
