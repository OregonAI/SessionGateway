---
status: accepted; "re-embedding a Session takes minutes on the GPU desktop" holds only once a GPU path exists: the embedder runs on the CPU everywhere (ADR-0026, ADR-0046)
---

# Embeddings from a small local model, run inside the server

The corpus and every question are embedded with bge-small-en-v1.5 (MIT, 384 dimensions, quantized), run in-process: about 190 MB and 4–5 ms per question in the server, and about 8 core-hours to embed a whole session. A hosted embedding API would put a paid key and a network call into a public, unauthenticated server, and tie every stored vector to one provider. The cost is retrieval quality somewhat below hosted models (MTEB average 62.2 against 64.6 for text-embedding-3-large, each as its maker reports). Passages stay under the model's 512-token limit. The evaluation set decides whether a larger local model earns its memory; re-embedding a Session takes minutes on the GPU desktop.

The deploy box's shared bge-m3 encoder was considered, since it is already loaded and would match the rest of the platform. But documents must be embedded with the same model as questions, and they arrive every 15 minutes. At about 415 tokens/s per core, a day of 2,000 new letters (about 600k tokens) would hold both of the box's cores for about 12 minutes and stall question encoding for every corpus, unless new documents were embedded on the GPU desktop, which would put it in the live loop. bge-small does that day in about 3 minutes on one core.

What is embedded: Version and amendment text, digests and staff measure summaries, Fiscal Impact Statements, revenue impact statements and budget reports, Exhibits, floor letters, Testimony and, later, transcripts. Agendas, Recording Logs and witness-registration lists are keyword-only: they are lists, and embedding a list adds noise. Identical Testimony (form-letter campaigns) is embedded once. General searches leave Testimony out unless the question asks for it or is about one Measure, so about 100k letters (38% of the text) don't crowd Versions out of the results.
