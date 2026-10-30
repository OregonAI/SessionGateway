# Node 26 runs the TypeScript source; TypeScript 7 checks it, with TypeScript 6 aliased for the lint tools

SessionGateway is TypeScript on Node 26, the Active LTS line since 2026-10-28, supported to 2029-04-30. Node 24 has been in maintenance since 2026-10-20 and ends 2028-04-30, before 2029R1 begins.

**No build step.** Both containers run the `.ts` source directly through Node's type stripping, which has been stable since 24.12. The image therefore runs exactly the reviewed source, and stack traces point at it. The costs:
- code must be erasable: no `enum`, `namespace` or parameter properties;
- imports carry `.ts` extensions;
- cross-module imports use `package.json` `"imports"` (`#/…`), because Node ignores tsconfig `paths`.

**Two TypeScript versions.** `tsc` from TypeScript 7 is the type gate. TypeScript 7 ships no JavaScript API until 7.1, and two tools need one:
- typescript-eslint, whose peer range stops below 6.1;
- dependency-cruiser, which supports TypeScript below 7. Under TypeScript 7 alone it cruised 0 modules and still reported a pass.

So `package.json` uses the aliases the TypeScript team documents: `"typescript": "npm:@typescript/typescript6@…"` and `"@typescript/native": "npm:typescript@…"`. Under that layout dependency-cruiser cruised the modules and caught a planted deep import (measured 2026-10-29). `npm run check` fails unless `tsc --version` reports 7 and the boundary check cruised more than 0 modules. The alias goes when both typescript-eslint and dependency-cruiser support TypeScript 7.

**MCP SDK v2.** The MCP server uses `@modelcontextprotocol/server`, the stable line that implements the 2026-07-28 spec. v1, which the spike used, is promised bug and security fixes for "at least six months" after v2's release on 2026-07-27. That could end around 2027-01-27, near the start of 2027R1 (inferred).

**The rest of the toolchain.**
- **Vitest** runs the tests: stable coverage thresholds, file-scoped fixtures and `test.for` tables, which `node:test` lacks or still marks experimental (`testing-and-mcp.md` §2).
- **ESLint** with typescript-eslint's `strictTypeChecked` lints, and **Prettier** formats (`typescript-toolchain.md` §5).
- **zod** parses every value from outside the process, and its schemas are each MCP tool's `inputSchema` and `outputSchema`. Its JSON Schema output defaults to 2020-12, the dialect MCP uses (`typescript-toolchain.md` §6).
- **pino** writes JSON lines to stdout, with no in-process transports, so the deployment decides where logs go (`adoption-and-agent-files.md` §4).

**Dependency policy.** npm installs only from the committed lockfile, only versions published at least 14 days earlier (`min-release-age=14`), and runs a dependency's install script only after it is approved in `allowScripts` (`strict-allow-scripts=true`). A compromised fresh release can't land, and an organization adopting the code inherits a small, reviewed dependency tree. Runtime dependencies carry permissive licenses only (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD), which CI checks against `npm sbom --omit=dev`. Anything else needs the owner's approval and an entry in the check's exceptions list (`adoption-and-agent-files.md`, recommendation 9).

Research: `docs/research/typescript-toolchain.md`, `docs/research/testing-and-mcp.md`, `docs/research/adoption-and-agent-files.md`.

## Considered Options

- **TypeScript 6 alone.** One compiler and no alias. But 6.0.3 is the last release of its line, so moving to 7 later would be a second migration.
- **oxlint with its TypeScript 7 type-aware rules.** No alias, and 12–18× faster. But it is less familiar than ESLint to a team taking the code over, and dependency-cruiser would still need the swc parser, which has an install script to approve.
- **A `tsc` build to `dist/`.** Plain JavaScript at runtime. But it adds a second tree and source maps, and the `#/` imports would need remapping per condition.
- **A 7-day release age**, as the research suggested. 14 days gives the registry and the community twice as long to catch a bad release, at the cost of waiting a week longer for fixes. A security fix may bypass the window deliberately, noted in its PR.
