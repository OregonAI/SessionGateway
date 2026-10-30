# Run on the OregonAI deploy box under platform-deploy, not on a free cloud tier

SessionGateway runs on the OregonAI deploy box (`192.168.86.2`: 2 cores, 14 GB RAM, no GPU) as two containers from one image, a server and an ingest worker, sharing one SQLite database on a host volume. The worker writes and the server reads, so a document is searchable as soon as it is indexed. The image carries only code and the embedding model; the database (about 1–1.5 GB a Session) and the cached PDFs (about 14 GB) live on the volume. It deploys through platform-deploy's reconcile loop, which redeploys within 10 minutes of a merge and records the serving commit in `deployed.txt`, as a second kind of service beside the Python corpora, and is reached at a path on the existing Cloudflare tunnel.

The GPU desktop does the heavy one-off work: the 2025R1 backfill, whose finished database is copied to the box once, and later the transcription of hearing video with faster-whisper (about 2,000 audio hours a session, which hosted batch transcription would bill at $266–$850). The live loop never depends on the desktop.

## Considered Options

- **Cloud Run or Azure Container Apps free tier.** An index that changes every 15 minutes could reach a scale-to-zero container only as a nightly image plus small update files fetched from a bucket. Cloud Run's writable disk is held in memory, and Google says its Cloud Storage mount "shouldn't be used as the backend for storing a database". Rejected as too many moving parts for a free tier the project doesn't need.
- **A separate compose stack on the box,** as corpus-gateway has. Rejected because separate stacks drift: corpus-gateway still serves a build from before PR #12.
