---
status: accepted; amends ADR-0039 (its staleness warning gains a mode for a deployment with no worker; the two rhythm settings and the three warnings stand unchanged)
---

# A deployment that runs no worker says so with `INGEST_WORKER=off`, and its index is a static copy

Ticket #119. The owner turned the ingest worker off on the deploy box on 2026-11-04 (ticket #25, OregonAI/platform-deploy#39) until the next Session starts. The box serves the 2026R1 database as the backfill left it, as of 2026-11-03T17:29:53-08:00. ADR-0039's staleness rule reads `INGEST_INCREMENTS` and `INGEST_FULL_PULL` and assumes a worker runs them, so with the compose settings `daily` and `weekly` every answer from 2026-11-05 06:00 Pacific says "a nightly update was missed". That is true of the data and false about the cause: no update is scheduled. No value of the two rhythm settings says what is true (`off` and `monthly` would say "a scheduled full pull was missed" from 2026-12-01, and `15min` never warns for a closed Session). The owner accepted the warning for go-live and approved a mode that says the index is a static copy (2026-11-06).

## Decision

**One new setting, read by the server only.**

| Setting | Values | Default |
|---|---|---|
| `INGEST_WORKER` | `on`, `off` | `on` |

- **Why a setting of its own, and not a fourth value of `INGEST_INCREMENTS` or `INGEST_FULL_PULL`.** "No worker" is a fact about the deployment, not about a rhythm: a worker that is off runs no increment and no full pull, so it would have to be written into both settings, and either setting alone would leave the other warning. The two rhythms keep their meaning for the day the worker returns.
- **Why `on` and `off`, and not a bare flag.** The form is the one `TRANSCRIPTS_PUBLISHED` takes (ADR-0055): the exact text, and anything else (`yes`, `OFF`, an empty string) stops the start-up, naming the variable and not its value. A switch that read "OFF" as on would be a decision the owner did not make. Unset is `on`, so a deployment that sets nothing behaves as ADR-0039 says.
- **Why the name starts with `INGEST_`.** It sits beside the two settings it overrides in effect, and the README lists them together.
- **Only the server reads it.** The worker's schema does not list it, and a worker started with it set runs as before: the setting says what the deployment does, and it does not stop a worker. Turning the worker back on is unsetting the variable on the server and starting the worker (README, "Deploying it"); a server left at `off` beside a running worker would call a live index a static copy.

## What the server says

With `INGEST_WORKER=off`, every tool result carries one more block of text after the tool's own, as ADR-0039's warning does (no output schema changes), and it is a note, not a warning:

> Note: this index is a static copy, as of its last full pull at 2025-01-22T07:00:00-08:00. No worker updates it, so changes the Legislature has made since then are not in it.

- **The time is the last full pull's, read from the database for each call** (`lastFullPull`), not the `as_of` the answer carries: an increment moves `as_of`, and the note still names the full pull, which built the Session's full text. A deployment whose database has no full pull yet gets no note, as it got no warning (an index with nothing in it is empty, not old).
- **The note is always carried, however recent the pull.** It is not a statement that the index is too old; it states what the index is. It is never worded as "out of date" or as a missed update, because none was scheduled.
- **No window is read.** `stalenessAt` is not called, so the rhythm settings, the meeting days and the clock play no part: the note on the day of the pull and a year later is the same text.
- **With the setting absent or `on`, nothing changes:** the same three warnings under the same rules, and ADR-0039's seam-1 tests stand unchanged.

## Considered options

- **Hide the warning (no note at all) while the worker is off.** The index still is not current, and an agent should be told what it is reading; the owner asked for a mode that says what is true.
- **Infer "no worker" from the database** (no increment recorded, last full pull old). A quiet Session and a stopped worker look alike, which is what ADR-0039 said a server could not tell; a deployment states it.
- **Make the worker refuse to start when the setting is `off`.** Not built: the compose file starts no worker, and an operator who runs `ingest.ts --once` by hand on an `off` deployment is doing what the README's steps describe.

## Consequences

`config` adds `INGEST_WORKER` to the server's schema and `worker` to `ServerConfig`; `mcp-server/lib/staleness.ts` returns the note when it is `off`. No schema step: `lastFullPull` is read as before, and `versionOneSchema` is unchanged. platform-deploy's `docker-compose.yml` sets `INGEST_WORKER: "off"` for the `session-gateway` service while the worker is off (a PR there, linking #119); its README's "Turning the worker back on" removes it. This repository's README lists the setting and the same steps.
