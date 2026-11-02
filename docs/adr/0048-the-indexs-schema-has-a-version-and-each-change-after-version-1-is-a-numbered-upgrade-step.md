---
status: accepted; supersedes ADR-0009's "a migration waits for the first release that needs one" and the reason ADR-0041 gives for rejecting a `revision` column (the rest of both stands)
---

# The Index's schema has a version, and each change after version 1 is a numbered upgrade step

The database is created by one `CREATE TABLE IF NOT EXISTS` pass, and ADR-0009 left migrations until a release needed one, so a file built by an earlier version is rebuilt. Tables have since been shaped to avoid a migration: ADR-0041 put the agenda's revision in a table of its own because a column on `document` would need one. No database is deployed yet, but after #24 and #25 a rebuild means a whole Full pull of a real Session from OLIS and embedding every Passage again. The architecture review of 2026-11-01 reopened the question, and the owner decided it there, before the first deployment.

## Decision

- **The file records its schema version** (SQLite's `user_version`).
- **Today's schema is version 1.** A file with no version gets today's `CREATE TABLE IF NOT EXISTS` pass and is stamped 1, so a file built before this ADR upgrades the way it always has.
- **Every change after version 1 is a numbered step** that the worker applies in order when it opens the file. A column can be added where it belongs instead of in a table built to avoid a migration.
- **A wrong version refuses by name.** The server, which opens the file read-only, refuses to start on a file whose version is not the one it knows, naming both versions (a file with no recorded version, and a file that does not exist, are files the worker has not opened yet, and its message says to start the worker first); ADR-0030 already has it refuse a file the worker has not upgraded. A worker that meets a version newer than it knows refuses too: there is no downgrade.
- **Only the `database` package knows how an old file differs.** Tables where a missing row already means something (`statute_read`, `statutes_affected_read`, `feed_row`, `agenda_revision`) stay as they are.

## Considered Options

- **Keep rebuilding until a release needs a migration (ADR-0009).** Rejected: after the first deployment a rebuild costs a whole Full pull and a full embedding, and tables are already bent around the missing mechanism.
