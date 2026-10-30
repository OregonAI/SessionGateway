# Docs

- **`docs/research/`** holds facts gathered before a decision. Each file is dated, and every claim is labelled verified, inferred or local measurement and cited to the URL, file or command that produced it. A count or date is quoted exactly as the source states it.
- **`docs/adr/`** holds one decision per file, numbered in sequence, in the format of `/domain-modeling`'s ADR guide. When a decision changes, a new ADR supersedes the old one (`Status` frontmatter on both), so the history stays readable.
- **`GLOSSARY.md`** (repo root) holds the domain words. A term goes in when a ticket introduces it.
- **`docs/agents/`** configures the mattpocock skills. `/setup-matt-pocock-skills` wrote it; change it by rerunning that skill.

Decisions live in ADRs and the spec, facts live in research, and the CLAUDE.md files hold only the rules agents need while working, pointing to the decision behind each rule.
