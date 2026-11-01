---
status: accepted; amends ADR-0003 (which Session we build and test on), and the backfill sentence of ADR-0007 and the GPU sentence of ADR-0006
---

# 2026R1 is the Session we build on, and 2025R1 stays the fixture's Session

ADR-0003 made 2025R1 the Session we build and test on, because it was closed, complete and already cached. The owner decided on 2026-11-01 that the full build, the backfill (#24), the evaluation run against a full build and the first deployment (#25) target 2026R1 instead. 2026R1 is the newer Session and the smaller one. OLIS's `$count` on 2026-11-01 gave 304 Measures against 2025R1's 3,466, and 33,229 Testimony rows against 99,668. Across every set that links a document it gave about 39,300 document rows against about 130,700, so the documents to download and embed are about 30% of 2025R1's, not a tenth, because Testimony dominates both. 2027R1 stays the first Live Session. ADR-0003's other decisions stand: one Session per deployment, nothing before 2025R1, interim and special Sessions deferred (2025S1 has 3 Measures).

2025R1 is deferred as a full build, not dropped. The code holds no Session of its own: `SESSION_KEY` names it, the Legislator alias file keys each entry by Session, and the Statutes Affected Table's URL is a setting. The 2025R1 fixture stays CI's only fixture, with the values seam 1 and seam 2 established from it. A 2026R1 quirk gets a seam-2 row quoting 2026R1 text, or a labelled made-up row at seam 1. A 2026R1 fixture is added only when a quirk needs a whole system to show it. The 2026R1 question set (`scripts/eval/questions/2026R1.yml`) takes every expected value from an independent source (the feed, the document, the Statutes Affected Table), never from the tools' answers that the runner checks.

The backfill runs on the GPU desktop as ADR-0007 says, but on its CPU. ADR-0026 denies onnxruntime-node's install script, which is what fetches the CUDA provider, so the embedder runs on the CPU everywhere. ADR-0006's "re-embedding a Session takes minutes on the GPU desktop" holds only once a GPU path exists. #24 records the CPU embedding time, and a GPU path is built when that time or the hearing-video work calls for it.

## Considered Options

- **Stay on 2025R1.** Its feed is cached, but its documents are not, and it is the larger and older Session.
- **Both, 2026R1 then 2025R1.** 2025R1 is the bigger test of scale (SB 210 has 14,223 Testimony rows), at about three times the download. 2027R1, served live, will test scale anyway.
- **Move the fixture to 2026R1, or add one beside it.** Moving it rewrites hundreds of established values. Adding one means making the fixture build, its verification, the fake OLIS and the snapshot trim take a Session, which they each fix at 2025R1 today, with nothing yet known that needs it.

## Consequences

A deployment of a closed Session runs no increments, because they run only on days the Session meets (ADR-0042). Its nightly full pull and hash sample keep running, and a closed Session still changes a little: 2025R1's Testimony rows went from 99,665 (2026-07) to 99,668 (2026-11-01).
