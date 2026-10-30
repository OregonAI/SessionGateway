# Early decisions (before grilling)

Answers the user gave on 2026-10-28, after reading the OLIS and OregonAI research
and before running `/grill-with-docs`. The interview should confirm or refine
these and record the lasting ones as ADRs. It shouldn't reopen them from scratch.

## Decided

1. **Testimony is in scope**, full text. Video of hearings is also of interest:
   pull the recordings, generate transcripts, and store them.
2. **Build on 2025R1.** No sessions earlier than that.
3. **The main use is during a live session.** Measure→ORS links therefore come
   from **parsing bill and amendment text** as documents arrive (primary). The
   official post-session "Statutes Affected by Measures" table (`artables`) is
   added as a second source once it is published. Both are used.
4. **The output works like ERF:** a graph plus semantic embeddings served over
   MCP. Every answer cites its source and says the data is not the official
   source.

## Proposed, awaiting confirmation: what to reproduce

This applies the three-part legal basis from the OregonAI collective-bargaining
corpus: (1) a public record of a public body, ORS 192.311–192.478; (2) the
government already publishes the full document at the cited `source_url`;
(3) the document is an official act, so it carries no copyright (*Georgia v.
Public.Resource.Org*, 590 U.S. 255 (2020)).

- **Legislature-authored documents** (measures, amendments, fiscal and revenue
  impact statements, staff measure summaries, agendas, minutes, votes,
  history): all three parts apply. Mirror the full text exactly as published,
  with `source_url` and a non-official notice on every result.
- **Public testimony:** mirror the full text exactly as published, like every
  other document. It is public material the Legislature already publishes.
  Decided 2026-10-29; see `docs/adr/0002-mirror-everything-as-published.md`.
- **Video transcripts:** derived text of public proceedings. Label each one
  machine-generated and not official, link it to its timestamp in the
  recording, and cite the recording. This comes in a later slice.
- **Terms of use** (`olis-odata.md` §Access): the agreement has no license
  grant and no prohibition on mirroring, and its disclaimer already says the
  data is "not an official record". To respect clause 3 ("forego regular
  scraping"), download only documents the feed links to, once each, and cache
  them. Full re-pulls stay in the 5 pm–6 am Pacific window; new documents are
  fetched as they appear (`docs/adr/0005-read-olis-within-its-terms.md`). No
  email to the Legislature: dropped 2026-10-29.

## Research still needed

- **Hearing video:** done in `hearing-video.md` (2026-10-28). The video slice
  was deferred on 2026-10-29; how videos are found is decided with it.
