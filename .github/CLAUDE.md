# CI and repository automation

- **One gate.** CI runs `npm ci`, then `npm run check`, on every PR: the same gate as local work. It uses the Node version `package.json` pins (`actions/setup-node` with `node-version-file: package.json`), and `concurrency` cancels superseded runs.
- **Least privilege.** Each workflow starts with `permissions: contents: read`, and a job that needs more raises it for that job alone. `actions/checkout` runs with `persist-credentials: false`.
- **Pinned actions.** Every action is pinned to a full commit SHA, with its version in a comment, for example `actions/checkout@<sha> # v7.0.1`.
- **Untrusted input.** Workflows trigger on `pull_request` and `push`. Untrusted input reaches a `run:` step through an `env:` variable, never inline in `${{ }}`.
- **No secrets.** Tests are hermetic, so CI needs none.
- **Supply-chain jobs.** Separate jobs run `npm audit signatures`, `npm audit --omit=dev --audit-level=high`, and the license check over `npm sbom --omit=dev`.
- **Dependabot** updates npm, GitHub Actions and Docker weekly, with minor and patch updates grouped. Its cooldown is 14 days, matching `.npmrc`; security updates skip the cooldown.
