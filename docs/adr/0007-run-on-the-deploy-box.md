---
status: accepted; the backfill is 2026R1's, not 2025R1's, and runs on the desktop's CPU (ADR-0046); the sentence on cached PDFs is corrected by ticket #24 (2026-11-04)
---

# Run on the OregonAI deploy box under platform-deploy, not on a free cloud tier

SessionGateway runs on the OregonAI deploy box (`192.168.86.2`: 2 cores, 14 GB RAM, no GPU) as two containers from one image, a server and an ingest worker, sharing one SQLite database on a host volume. The worker writes and the server reads, so a document is searchable as soon as it is indexed. The image carries only code and the embedding model; the database (about 1–1.5 GB a Session) and the cached PDFs (about 14 GB) live on the volume. **[Corrected below: no PDFs are cached.]** It deploys through platform-deploy's reconcile loop, which redeploys within 10 minutes of a merge and records the serving commit in `deployed.txt`, as a second kind of service beside the Python corpora, and is reached at a path on the existing Cloudflare tunnel.

The GPU desktop does the heavy one-off work: the 2025R1 backfill, whose finished database is copied to the box once, and later the transcription of hearing video with faster-whisper (about 2,000 audio hours a session, which hosted batch transcription would bill at $266–$850). The live loop never depends on the desktop.

**Corrected by ticket #24 (2026-11-04).** The volume holds no cached PDFs, and the sentence above stays as it was written. No code writes a PDF: the ingest worker fetches a file, hashes its bytes, extracts its text and keeps the hash, the text, the page count and the passages in the database, and then drops the bytes. The only files the code writes beside the database are the two reports (`build-report.json` and `unresolved-legislator-codes.json`) and the nightly hash sample's report. The 14 GB was the spec's size of a Session's PDFs (`docs/research/testing-and-mcp.md`), which the index does not keep. What the volume holds is the database: 0.34 GB for 2026R1 after the backfill (`docs/research/2026r1-backfill.md`). The box needs room for that and for the reports, not for 14 GB of files.

## Considered Options

- **Cloud Run or Azure Container Apps free tier.** An index that changes every 15 minutes could reach a scale-to-zero container only as a nightly image plus small update files fetched from a bucket. Cloud Run's writable disk is held in memory, and Google says its Cloud Storage mount "shouldn't be used as the backend for storing a database". Rejected as too many moving parts for a free tier the project doesn't need.
- **A separate compose stack on the box,** as corpus-gateway has. Rejected because separate stacks drift: corpus-gateway still serves a build from before PR #12.
