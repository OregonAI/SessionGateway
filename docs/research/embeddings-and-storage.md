# Embeddings, vector + keyword storage, and graph storage for SessionGateway

Researched 2026-10-28. Every price below was read on 2026-10-28 unless another date is given.

Labels used below:
- **verified**: I read the fact at the cited URL (or file), or saw it in a response.
- **inferred**: my reading or arithmetic on verified evidence, not stated by the source.
- **local measurement**: I ran it on this machine (Intel Core Ultra 7 265F under WSL2, Node v24.19.0, SQLite 3.53.3 bundled in `node:sqlite`). Scripts and raw results are in `/home/dzinck/.claude/jobs/a3847f05/tmp` (see the appendix). These numbers are from a desktop core, not a Cloud Run or Container Apps vCPU, and should be read as relative.

Scope: facts and trade-offs for (a) producing embeddings, (b) storing and querying vectors with keyword search, and (c) storing the session graph, all from TypeScript in a scale-to-zero container of roughly 0.25–1 vCPU and 0.5–2 GiB. This file does not choose an architecture.

---

## 0. How big the corpus is, and why it matters here

The brief estimates "tens of thousands of text chunks" and 50–150M tokens. Those two numbers don't fit together unless chunks are 1,000+ tokens each. The sibling research file sizes 2025R1 from the feed:

| Fact | Value | Status | Source |
|---|---|---|---|
| Documents with full text in 2025R1 (versions, analyses, proposed amendments, exhibits, testimony, agendas) | ≈132,000 | verified (row counts) | `docs/research/olis-odata.md` §7 "Row counts" |
| Extracted text, whole session | ≈357 M characters | inferred (extrapolated from 344 sampled PDFs) | `docs/research/olis-odata.md` §7 "Full-text volume" |
| Characters per token on OLIS text, cl100k_base (the OpenAI `text-embedding-3` tokenizer family) | 4.19 | local measurement, 4 documents / 40,601 chars (HB 2001 Introduced, HB 3131, proposed amendment 26284, testimony 117165) | `scripts/tokratio.mjs` |
| Characters per token, BERT WordPiece (bge-small tokenizer) | 4.59 | local measurement, same 4 documents | same |
| Session tokens, cl100k | ≈85 M (357 M / 4.19) | inferred | arithmetic |
| Chunks at 1,100 chars | ≈325,000 | inferred (357 M / 1,100) | arithmetic |
| Chunks at 3,000 chars (das-cairn's passage size) with 200 overlap | ≈128,000 | inferred (357 M / 2,800) | arithmetic |

So the vector count for one full session is more likely **120k–350k** than tens of thousands, unless testimony (136 M chars, 38% of the text) is excluded or summarized. The storage benchmarks below go to 200k vectors; 350k is extrapolated linearly. The cost arithmetic in §1.4 uses 50M, 85M and 150M tokens.

---

## 1. Embedding models

### 1.1 Local, in-process in Node

**Runtime facts**

| Fact | Status | Source |
|---|---|---|
| `@huggingface/transformers` (transformers.js) is at 4.3.2, Apache-2.0, published 2026-10-27. It depends on `onnxruntime-node` 1.30.0, `onnxruntime-web`, `sharp` and `@huggingface/tokenizers`. | verified | `npm view @huggingface/transformers`; its `package.json` dependencies |
| `onnxruntime-node` latest is 1.31.1 (MIT, 2026-10-26). Unpacked npm size is 307.6 MB, covering all platforms. | verified | `npm view onnxruntime-node version dist.unpackedSize` |
| After `npm install` on linux-x64, `node_modules/onnxruntime-node` was 548 MB. Of that, `libonnxruntime.so.1` (the CPU runtime) is 45.8 MB and `libonnxruntime_providers_cuda.so` is 272 MB. `onnxruntime-web` added 141 MB. | local measurement | `du` in `tmp/bench` |
| A CPU-only serving image needs only the CPU library for its platform. The CUDA provider and the other platforms' binaries could be pruned. | inferred | the sizes above |
| Inference threads are set per session with `session_options: { intraOpNumThreads }` passed to `pipeline(...)`. This worked in 4.3.2. | local measurement | `scripts/embed.mjs` |
| npm 11.17 printed `allow-scripts` warnings for `onnxruntime-node`, `protobufjs` and `usearch` install scripts. The prototype Dockerfile already runs `npm ci --ignore-scripts`. | local measurement; `prototype/scaffold:Dockerfile` | |

**Models.** Throughput and memory are local measurements: transformers.js 4.3.2, ONNX `q8` (quantized) weights unless marked fp32, pinned to one core with `taskset`, `intraOpNumThreads: 1`, batches of 8 passages of about 1,100 characters (332–352 tokens), Node.js API docs as text. Query latency is one ~10-word query. "Peak RSS (build)" is the batch-8 run. "Peak RSS (query only)" is a process that loads the model and embeds only queries. Cold start is process start to the first query vector with the model file already in the OS page cache, so a real container cold start is slower.

| Model (ONNX repo) | Licence | Dims | Max input | q8 file | MTEB, from the model card's own table | Tokens/s, 1 core | Query ms | Peak RSS build / query-only | Cold start to 1st query |
|---|---|---|---|---|---|---|---|---|---|
| all-MiniLM-L6-v2 (`Xenova/all-MiniLM-L6-v2`) | Apache-2.0 | 384 | "input text longer than 256 word pieces is truncated" | 23 MB | Retrieval 41.95 (from Snowflake's card) | 5,833 (fp32: 3,259) | 1.7 | 507 / 168 MB | 229 ms |
| bge-small-en-v1.5 (`Xenova/bge-small-en-v1.5`) | MIT | 384 | 512 | 34 MB | Avg(56) 62.17, Retrieval(15) 51.68 | 3,042 (fp32: 1,720; 2 cores: 5,485; 4 cores: 9,338) | 4.4 | 516 / 190 MB | 270 ms |
| e5-small-v2 (`Xenova/e5-small-v2`) | MIT | 384 | 512 | 34 MB | Avg 59.93, Retrieval 49.04 (from gte's card) | 3,018 | 4.6 | 519 MB / – | – |
| gte-small (`Xenova/gte-small`) | MIT | 384 | 512 | 34 MB | Avg 61.36, Retrieval 49.46 | 2,973 | 4.8 | 517 MB / – | – |
| snowflake-arctic-embed-s (`Snowflake/snowflake-arctic-embed-s`) | Apache-2.0 | 384 | 512 (inferred: BERT-small base) | 34 MB | Retrieval (NDCG@10) 51.98 | 2,987 | 4.5 | 515 MB / – | – |
| bge-base-en-v1.5 (`Xenova/bge-base-en-v1.5`) | MIT | 768 | 512 | 110 MB | Avg 63.55, Retrieval 53.25 | 1,281 | 12.5 | 674 / 318 MB | 386 ms |
| nomic-embed-text-v1.5 (`nomic-ai/nomic-embed-text-v1.5`) | Apache-2.0 | 768 (Matryoshka: 512/256/128/64) | 8,192 | 137 MB | MTEB avg 62.28 @768, 61.96 @512, 61.04 @256; Retrieval 53.01–53.25 (Snowflake's card) | 936 | 17 | 1,015 / 425 MB | 505 ms |
| EmbeddingGemma-300m (`onnx-community/embeddinggemma-300m-ONNX`) | Gemma terms (`google/embeddinggemma-300m` is gated) | 768 (MRL 512/256/128) | 2,048 | 309 MB | MTEB **English v2** mean 68.36 @768 (a different benchmark version; don't compare with the v1 column) | 411 | 126 | 1,759 MB / – | – |
| bge-m3 (`Xenova/bge-m3`) | MIT | 1,024 (also sparse and ColBERT outputs) | 8,192 | 570 MB | Card reports MIRACL/multilingual, no English MTEB average comparable with the others | 416 | 42 | 1,480 / 1,141 MB | 2,022 ms |

Sources for the table (all **verified** unless marked):
- Licences: Hugging Face model API `cardData.license`, e.g. https://huggingface.co/api/models/BAAI/bge-small-en-v1.5, …/sentence-transformers/all-MiniLM-L6-v2, …/nomic-ai/nomic-embed-text-v1.5, …/thenlper/gte-small, …/intfloat/e5-small-v2, …/Snowflake/snowflake-arctic-embed-s, …/google/embeddinggemma-300m (`license: gemma`, `gated: manual`), …/BAAI/bge-m3.
- bge MTEB table: https://huggingface.co/BAAI/bge-small-en-v1.5 (README "MTEB" table: bge-base 63.55/53.25, bge-small 62.17/51.68).
- gte and e5 numbers: https://huggingface.co/thenlper/gte-small (README table; gte-small 61.36 avg, 49.46 retrieval; e5-small-v2 59.93, 49.04).
- arctic, MiniLM and nomic retrieval: https://huggingface.co/Snowflake/snowflake-arctic-embed-s (README tables "MTEB Retrieval Score (NDCG @ 10)": arctic-embed-s 51.98, all-MiniLM-L6-v2 41.95, nomic-embed-text-v1.5 53.25 and 53.01). These are Snowflake's figures for other vendors' models.
- MiniLM truncation: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2 ("By default, input text longer than 256 word pieces is truncated.").
- nomic dims/MTEB/prefixes: https://huggingface.co/nomic-ai/nomic-embed-text-v1.5 (table of SeqLen 8192 by dimension; it requires `search_document:` / `search_query:` prefixes).
- EmbeddingGemma: https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX ("Maximum input context length of 2048 tokens"; MRL 768/512/256/128; MTEB English v2 table). The card's JS example reads the model's `sentence_embedding` output. My throughput run used the generic pipeline with mean pooling, so its vectors are not the card's, but the compute is the same (inferred).
- bge-m3: https://huggingface.co/BAAI/bge-m3 (1024 dims, 8192 tokens, dense + sparse + multi-vector).
- Pooling: bge/gte/arctic use CLS pooling per their cards. My throughput runs used mean pooling. Pooling cost is negligible next to the encoder (inferred). The recall test in §2.1 used CLS for bge-small.

Observations (**inferred** from the measurements):
- The 384-dim small models (bge-small, e5-small, gte-small, arctic-s) all run at about 3,000 tokens/s per core in q8. MiniLM-L6 is about 2× faster (6 layers against 12) but truncates at 256 tokens and scores lowest on retrieval.
- q8 is 1.8× faster than fp32 for bge-small and uses less memory. Quality loss from q8 was not measured.
- Throughput scaled close to linearly to 4 cores (3,042 → 9,338 tokens/s for bge-small).
- Query-time cost of a local small model inside the serving container: about 170–320 MB RSS and 2–13 ms per query on one core, plus 23–137 MB of model file in the image. bge-m3 needs about 1.1 GB RSS just to answer queries, which doesn't fit a 0.5–1 GiB instance.
- The "peak RSS (build)" column is dominated by batch-8 activations, not weights. Smaller batches lower it.

### 1.2 Hosted embedding APIs

| Service / model | Dims | Max input | Price per 1M input tokens (read 2026-10-28) | Batch | Free quota | Default rate limits | Status | Sources |
|---|---|---|---|---|---|---|---|---|
| Azure OpenAI `text-embedding-3-small` | 1,536 (reducible via `dimensions`) | 8,192 | **Global $0.020**; Data Zone (US) $0.022; Regional $0.022 (westus, eastus2) | Azure OpenAI Batch exists, but no batch meter for embeddings appeared in the price list | None specific to the model | Tier 1: GlobalStandard 1,000 RPM / 1,000,000 TPM; DataZoneStandard 1,000 RPM / 1,000,000 TPM (rises with tier). Max 2,048 inputs and 300,000 tokens per request | GA, retires **2028-02-09** | verified: Azure Retail Prices API (`prices.azure.com/api/retail/prices`, meters `text-embedding-3-small-glbl`, `text embedding 3 small DZ`, `text-embedding-3-small-regional`, effective 2024-06-01 / 2026-02-01 / 2025-09-01); https://learn.microsoft.com/en-us/azure/foundry/openai/quotas-limits (ms.date 2026-08-20); https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure (8,192 / 1,536); https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-retirement-schedule |
| Azure OpenAI `text-embedding-3-large` | 3,072 (reducible) | 8,192 | **Global $0.130**; Data Zone (US) $0.143; Regional $0.143 (eastus2) | as above | None | same tier table | GA, retires 2028-02-09 | same sources (meters `text-embedding-3-large-glbl`, `text embedding 3 large DZ`, `text-embedding-3-large-regional`) |
| (quality reference, both Azure models) | | | | | | | MTEB avg: ada-002 61.0, 3-small 62.3, 3-large 64.6; MIRACL 31.4 / 44.0 / 54.9 | verified: models-sold-directly-by-azure page ("OpenAI reports…") |
| OpenAI API `text-embedding-3-small` (direct, not Azure) | 1,536 | – | $0.02 | not listed on the page | Free tier: 100 RPM, 40,000 TPM, 2,000 RPD | Build tier 5,000 RPM / 1,000,000 TPM | – | verified: https://developers.openai.com/api/docs/models/text-embedding-3-small |
| Gemini API `gemini-embedding-001` | 3,072 default; 128–3,072 (manual normalization needed below 3,072) | 2,048 | **$0.15** paid | **$0.075** | **Free tier: "Free of charge"**, but "Used to improve our products: Yes" on the free tier (No on paid) | Per-project limits are shown in AI Studio, not on the rate-limits page | Model page has no status label | verified: https://ai.google.dev/gemini-api/docs/pricing ("Last updated 2026-10-28 UTC"); https://ai.google.dev/gemini-api/docs/embeddings; https://ai.google.dev/gemini-api/docs/rate-limits |
| Gemini API `gemini-embedding-2` | 3,072 default; 128–3,072 (auto-renormalized) | 8,192 | **$0.20** text | **$0.10** | Free tier, same data-use terms | as above | Vertex lists it as "Unified Multimodal, Preview" | same Gemini pages; https://cloud.google.com/vertex-ai/generative-ai/pricing |
| (quality reference) `gemini-embedding-001` | | | | | | | MTEB 68.16 @2048, 68.17 @1536, 67.99 @768, 66.19 @256 (benchmark version not named; not comparable with the v1 table in §1.1, inferred) | verified: https://ai.google.dev/gemini-api/docs/embeddings |
| Vertex AI, Gemini Embedding | as above | as above | $0.00015 per "1,000 count" online, i.e. **$0.15/1M tokens** (the unit is read as tokens: inferred, since it matches the Gemini API price) | $0.00012 per 1,000 → $0.12/1M | None found on the page | Vertex quotas (not read) | – | verified price text: https://cloud.google.com/vertex-ai/generative-ai/pricing ("Embedding costs" table) |
| Vertex AI, "Embeddings for Text (Excluding Gemini Embedding)", e.g. `text-embedding-005` | 768 (not read this session) | – | $0.000025 per "1,000 count" online. The page says other Google models bill text "by every 1,000 characters", with whitespace excluded, so ≈ **$0.025 per 1M characters** ≈ $0.10/1M cl100k tokens at 4.19 chars/token (unit and conversion **inferred**) | $0.00002 per 1,000 | None found | – | – | same page |
| Vertex AI hosted open models: `multilingual-e5-small` / `-large` | – | – | $0.015 / $0.025 per 1M tokens | $0.0075 / $0.0125 | – | – | – | same page ("Open Source Model" table) |
| Voyage AI `voyage-4-lite` / `voyage-4` / `voyage-4-large` | 1,024 default; 256/512/1,024/2,048; float, int8, uint8, binary outputs | 32,000 | **$0.02 / $0.06 / $0.12** | 33% off, 12-hour window. Free tokens don't apply to batch | **200M free tokens per model per account** | Tier 1 (needs a payment method): 16M / 8M / 3M TPM, 2,000 RPM. Limits without a payment method aren't stated | – | verified: https://docs.voyageai.com/docs/pricing, https://docs.voyageai.com/docs/embeddings, https://docs.voyageai.com/docs/rate-limits |
| Voyage `voyage-law-2` | 1,024, float only | 16,000 | $0.12 | as above | 50M free | – | – | same pages |

Notes:
- The Azure pricing web page renders prices client-side and showed "$-" when fetched. The Azure Retail Prices API (first-party) supplied the figures above for US regions. **verified**
- Azure model lifecycle: GA embedding models "have extended timelines", and the schedule lists 2028-02-09 for all of ada-002, 3-small and 3-large. **verified** (https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-retirements, …/model-retirement-schedule). When a model retires, every stored vector must be re-embedded with its successor. The das-cairn design records the same consequence (`work-platform-design/specs/10-semantic-search.md:109-110`).
- No price page I read gives Azure OpenAI a free quota for embeddings. **verified absence on the pages read**

### 1.3 Which choice ties hosting to one cloud

| Choice | Tie | Status |
|---|---|---|
| Local ONNX model in the container | None. The same image runs on Cloud Run and Container Apps. | inferred |
| Azure OpenAI | Needs an Azure subscription and resource. Callable from Cloud Run over the internet with an API key, but keyless managed identity works only from Azure hosts. Data Zone/Regional deployments pin processing geography. | inferred from the deployment types listed in the retail meters and the quotas page |
| Vertex AI (Gemini Embedding, text-embedding-005) | Needs a GCP project; service-account auth is native on Cloud Run. From Azure it needs a key or workload identity federation. | inferred |
| Gemini API (ai.google.dev) | API key, callable from anywhere. Billing through a Google project. | inferred |
| Voyage | Third-party vendor, API key, no cloud tie. | inferred |
| Any hosted model | Stored vectors are valid only for that model, so moving providers means re-embedding everything. Query embedding at serve time needs a network call and a credential in the serving container. The prototype's rule "no LLM calls, no API keys" (`prototype/scaffold:CLAUDE.md` line 10) would have to change, and search needs a keyword-only fallback when the API is down (das-cairn's rule, `specs/10-semantic-search.md:198`). | inferred |

### 1.4 Cost of embedding a session (estimate)

Assumptions (all **inferred**): input tokens only. The 85M figure is the OLIS-derived estimate from §0; 50M and 150M are the brief's bounds. Chunk overlap adds tokens in proportion (200/2,800 ≈ 7% at das-cairn's passage rule). Vertex's character-billed model is converted at 4.19 chars/token. Free quotas are ignored except where a column says so.

**One full embedding of the session**

| Model | $/1M | 50M tokens | 85M tokens | 150M tokens |
|---|---:|---:|---:|---:|
| Azure 3-small Global | 0.020 | $1.00 | $1.70 | $3.00 |
| Azure 3-small Data Zone US | 0.022 | $1.10 | $1.87 | $3.30 |
| Azure 3-large Global | 0.130 | $6.50 | $11.05 | $19.50 |
| Azure 3-large Data Zone US | 0.143 | $7.15 | $12.16 | $21.45 |
| Gemini `gemini-embedding-001` paid / batch | 0.15 / 0.075 | $7.50 / $3.75 | $12.75 / $6.38 | $22.50 / $11.25 |
| Gemini `gemini-embedding-2` paid / batch | 0.20 / 0.10 | $10.00 / $5.00 | $17.00 / $8.50 | $30.00 / $15.00 |
| Gemini free tier | 0 | $0 if the project's free rate limits allow it (not published); content used to improve products | | |
| Vertex text-embedding-005 (per char) | ≈0.105 | ≈$5.24 | ≈$8.93 | ≈$15.71 |
| Voyage 4-lite / 4 / 4-large | 0.02 / 0.06 / 0.12 | $1.00 / $3.00 / $6.00 | $1.70 / $5.10 / $10.20 | $3.00 / $9.00 / $18.00 |
| Voyage, inside the 200M free tokens | 0 | $0 | $0 | $0 (the allowance covers about one to four full embeddings per model; whether it is one-time isn't stated) |

Arithmetic: cost = tokens / 1,000,000 × price. For example, 85,000,000 / 1,000,000 × $0.13 = $11.05.

**Local model: compute instead of dollars.** vCPU-seconds = tokens / (tokens per second per core), using the §1.1 single-core local measurements. Desktop-core speed is assumed, and a cloud vCPU may be slower:

| Local model (q8) | 50M | 85M | 150M | Hours on 1 core at 85M |
|---|---:|---:|---:|---:|
| all-MiniLM-L6-v2 (5,833 tok/s) | 8,572 | 14,572 | 25,716 | 4.0 |
| bge-small / e5-small / gte-small / arctic-s (≈3,000) | ≈16,500 | ≈28,000 | ≈49,500 | ≈7.8 |
| bge-base-en-v1.5 (1,281) | 39,032 | 66,354 | 117,096 | 18.4 |
| nomic-embed-text-v1.5 (936) | 53,419 | 90,812 | 160,256 | 25.2 |
| bge-m3 / EmbeddingGemma (≈415) | ≈120,000 | ≈205,000 | ≈362,000 | ≈57 |

Free compute these can be measured against:
- Cloud Run **jobs**: "First 240,000 vCPU-seconds free per month" and "First 450,000 GiB-seconds free per month". Request-billed services get 180,000 vCPU-s, 360,000 GiB-s and 2 million requests. The free tier is aggregated per billing account. **verified** https://cloud.google.com/run/pricing
- Azure Container Apps Consumption: the first 180,000 vCPU-seconds, 360,000 GiB-seconds and 2 million requests per subscription per month are free, and jobs are billed at the active rate. Beyond the grant, the West US 2 active rates are $0.000034 per vCPU-second and $0.000004 per GiB-second. **verified** https://learn.microsoft.com/en-us/azure/container-apps/billing; Azure Retail Prices API (`Standard vCPU Active Usage` 3.4e-05/s, `Standard Memory Active Usage` 4e-06/GiB-s, effective 2022-06-01)
- **Inferred:** a full embedding with a small 384-dim model (≈28,000 vCPU-s at 85M) fits either monthly grant several times over, if a cloud vCPU is near a desktop core. bge-m3-class models at 150M exceed both grants for one pass. The grant is shared with serving.

**Deltas during a live session.**
- The 2025R1 session began 2025-01-13 (**verified**, `olis-odata.md` line 180); its end date is null in the feed. Spread evenly over about 160 days, 85M tokens is about 0.5M new tokens a day (**inferred**; real arrivals are bursty around deadlines, and this wasn't measured).
- Re-embedding only new or changed chunks costs about $0.01 a day on 3-small, $0.07 on 3-large and $0.08 on gemini-embedding-001 (**inferred**: 0.5M × price).
- Re-embedding the whole session on every nightly rebuild costs 30 × the one-time cost: about $51/month on 3-small Global, $332 on 3-large Global and $383 on gemini-embedding-001 at 85M (**inferred**). For a local small model it is about 840,000 vCPU-s/month, above both free grants (**inferred**).
- Keying stored vectors by chunk content hash plus model name, so unchanged chunks are never re-sent, is the variable that decides delta cost. das-cairn already reuses vectors "under the same model" (`specs/10-semantic-search.md:171-178`). **verified** (file)
- Query embedding is negligible in dollars: 10,000 queries × 20 tokens = 200,000 tokens = $0.004 on 3-small (**inferred**).

---

## 2. Vector + keyword storage that fits scale-to-zero

### 2.1 Local measurements

**Exact (brute-force) KNN, k=10, one core, median of 30 queries, random unit vectors.** `float`, `int8` and `bit` are sqlite-vec `vec0` tables under `node:sqlite`. "JS scan" is a plain loop over a `Float32Array` with no dependency. usearch is an HNSW graph (M=16).

| N × dims | JS scan (ms) | sqlite-vec float: ms / file | int8: ms / file | bit: ms / file | usearch HNSW: build s / query ms / file | Bench process peak RSS |
|---|---:|---|---|---|---|---:|
| 50k × 384 | 12.8 | 19.6 / 75 MB | 12.3 / 20 MB | 0.8 / 3.4 MB | 52 / 0.65 / 80 MB | 227 MB |
| 100k × 384 | 25.9 | 35.6 / 149 MB | 24.9 / 39 MB | 1.8 / 6.8 MB | 130 / 0.76 / 161 MB | 388 MB |
| 200k × 384 | 52.5 | 64.5 / 299 MB | 47.0 / 78 MB | 3.6 / 13.7 MB | 318 / 0.97 / 321 MB | 707 MB |
| 100k × 768 | 52.0 | 80.5 / 297 MB | 51.0 / 76 MB | 3.1 / 11.4 MB | 254 / 1.47 / 307 MB | 688 MB |
| 200k × 768 | 104 | 135.7 / 593 MB | 94.9 / 152 MB | 6.3 / 22.8 MB | 620 / 1.57 / 614 MB | 1,299 MB |

Source: `scripts/vec.mjs`, `results-vec-1cpu.jsonl`. **local measurement.** Insert time into sqlite-vec was 0.2–7 s for every case. The usearch build used one core.

**Serving-side memory**, as a read-only server would open the file (**local measurement**, `scripts/serve-rss.mjs`, `scripts/usearch-view.mjs`):

| What | Open → first result | Peak RSS |
|---|---:|---:|
| sqlite-vec float, 200k × 384, opened read-only | 100 ms | 51 MB |
| sqlite-vec int8, 200k × 384 | 59 ms | 49 MB |
| sqlite-vec bit, 200k × 384 | 6 ms | 49 MB |
| sqlite-vec float, 100k × 768 | 147 ms | 52 MB |
| usearch 200k × 384, `load()` into memory | 377 ms | 393 MB |
| usearch 200k × 384, `view()` (memory-mapped) | 20 ms | 383 MB (touched mapped pages count toward RSS) |

The file was in the OS page cache for these runs. sqlite-vec reads through SQLite's pager, so RSS stays small, but the scan still reads the whole vector table on every query. Whether a container's page cache counts toward its memory limit depends on the platform's cgroup accounting (**inferred**; not checked for Cloud Run or Container Apps).

**Recall@10 against exact float search, on real embeddings** (bge-small-en-v1.5 q8, CLS pooling, 2,333 Node docs passages, 100 held-out passages used as queries; **local measurement**, `scripts/recall.mjs`):

| Method | Recall@10 |
|---|---:|
| sqlite-vec int8 (`vec_quantize_int8(…, 'unit')`) | 92.7% |
| sqlite-vec bit (`vec_quantize_binary`) | 44.9% |
| bit top-40, then exact float re-score | 72.8% |
| usearch HNSW, M=16 | 99.5% |

Caveats (**inferred**): a small corpus with passage-shaped queries. Legislative questions against 100k+ passages will behave differently. Binary quantization of a 384-dim model is lossy. Models trained for binary output (Voyage offers `binary` output) may do better.

**Graph and keyword coexistence check:** FTS5 (built into `node:sqlite`) and a `vec0` table in one connection, fused by reciprocal rank fusion (k=60) in a single SQL statement, returned the expected order. sqlite-vec reported `v0.1.9` on SQLite 3.53.3. **local measurement**, `scripts/hybrid-check.mjs`.

### 2.2 sqlite-vec with `node:sqlite` (or better-sqlite3)

| Fact | Status | Source |
|---|---|---|
| `node:sqlite` is "Stability: 1.2 - Release candidate" since v24.15.0, and no longer behind a flag since v22.13/v23.4. | verified | https://nodejs.org/docs/latest-v24.x/api/sqlite.md |
| Extension loading: `new DatabaseSync(path, { allowExtension: true })`, then `database.loadExtension(path[, entryPoint])` (added v23.5.0 / v22.13.0). `allowExtension` defaults to false. `enableLoadExtension(false)` can turn it off afterwards. | verified | same page |
| sqlite-vec's docs: "If you're on Node.js `23.5.0` or above, you can use the builtin `node:sqlite` module". Its `load()` is "compatible with node:sqlite, better-sqlite3, node-sqlite3, …". Vectors are bound as `new Uint8Array(float32.buffer)` with `node:sqlite`, or as a `Float32Array` directly with better-sqlite3. | verified | https://alexgarcia.xyz/sqlite-vec/js.html |
| Latest stable 0.1.9 (2026-03-31). "`sqlite-vec` is a pre-v1, so expect breaking changes!" | verified | https://github.com/asg017/sqlite-vec (README, releases) |
| ANN indexes are in **alpha**: v0.1.10-alpha.1 (2026-03-31) adds "rescore, ivf (experimental, not enabled), and DiskANN"; alpha.4 (2026-05-18) fixes DiskANN bugs. alpha.2 notes "DELETEs to be quite expensive" for DiskANN. Repo last pushed 2026-05-18. | verified | GitHub releases API for asg017/sqlite-vec |
| Stable `vec0` searches are exact: every query computes a distance to every stored vector (no index). | inferred from the absence of an index in 0.1.9 and the linear scaling measured in §2.1 | |
| `vec0` supports float, int8 and bit columns; metadata columns usable in KNN `WHERE` (`=`, `!=`, `<`, …); partition keys that shard the scan ("~100s of vectors" per value advised); auxiliary columns. | verified | https://alexgarcia.xyz/sqlite-vec/features/vec0.html; README |
| npm ships prebuilt `vec0.so` for linux-x64 and linux-arm64 (glibc ELF; 160 KB), darwin and windows. No musl/Alpine build is listed. The prototype image is `node:24-slim` (Debian, glibc). | verified (package.json `optionalDependencies`; `file vec0.so`); `prototype/scaffold:Dockerfile` | |
| Hybrid: the author documents three FTS5 + vec0 patterns: keyword-first (`UNION ALL`), RRF with tunable weights, and re-rank of FTS hits by vector distance. | verified | https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/index.html |
| better-sqlite3 13.0.3 (2026-08-05) is a native addon (27 MB unpacked). `node:sqlite` needs no native addon. | verified (npm) | `npm view better-sqlite3` |
| Ships in the image: yes, as one file next to FTS5 and the relational tables. | inferred | |

### 2.3 Plain in-memory scan from a file

A `Float32Array` (or `Int8Array`) loaded from a flat file and scanned in JS was faster than sqlite-vec's float scan at every size measured (§2.1) and needs no dependency. Its memory is the whole matrix (**inferred**):

| Vectors | 384 float32 | 384 int8 | 768 float32 |
|---|---:|---:|---:|
| 200k | 307 MB | 77 MB | 614 MB |
| 350k | 538 MB | 134 MB | 1,075 MB |

Keyword search would stay in SQLite FTS5 and be fused in TypeScript. **inferred**

### 2.4 In-memory ANN index loaded from a file

| Library | Facts | Status | Source |
|---|---|---|---|
| usearch 2.26.5 (Apache-2.0, 2026-10-18) | Native addon with prebuilds (linux-x64/arm64, darwin, win32), 25 MB unpacked. `save()` / `load()` / `view()` (memory-map). Measured: 0.65–1.57 ms queries at 50k–200k, 99.5% recall@10 on real embeddings, and slow single-core builds (318 s for 200k × 384). | verified (npm, `prebuilds/`); local measurement | `npm view usearch` |
| hnswlib-node 3.0.0 (Apache-2.0) | Last published 2024-03-11, compiled at install (196 KB package, no prebuilds in the tarball). | verified (npm metadata); "compiled at install" inferred from package size | `npm view hnswlib-node` |
| faiss-node 0.5.1 | Last published 2023-10-15. | verified | `npm view faiss-node` |
| Hybrid | None of these does keyword search. Pair with FTS5 or another BM25 index and fuse in TS. | inferred | |
| Ships in the image | Yes, as an index file. Building it is a build-time step. | inferred | |

### 2.5 LanceDB (Node SDK)

| Fact | Status | Source |
|---|---|---|
| `@lancedb/lancedb` 0.40.0 (Apache-2.0, published 2026-10-28). The linux-x64-gnu native package is 212 MB unpacked. | verified | `npm view @lancedb/lancedb`, `npm view @lancedb/lancedb-linux-x64-gnu dist.unpackedSize` |
| FTS is "based on BM25". The TypeScript API is `table.createIndex("text", { config: lancedb.Index.fts() })` and `.search("…", "fts")`, with phrase and fuzzy queries, ~18 stemming languages, and an ngram tokenizer. | verified | https://docs.lancedb.com/search/full-text-search |
| Rows added after an FTS index build "aren't part of the index until you optimize the table", but are still scanned. `optimize()` is suggested after about 100,000 row changes or 20 modification operations. | verified | same |
| Hybrid search in TypeScript: `fullTextSearch(...)`, `nearestTo(...)`, `.rerank(RRFReranker.create())`. RRF is the default reranker. | verified | https://docs.lancedb.com/search/hybrid-search |
| Vector index types: IVF_RQ, IVF_PQ, IVF_HNSW_SQ, IVF_HNSW_FLAT (and IVF_HNSW_PQ). Exact flat scan via `bypass_vector_index()`. Appended rows stay outside the index until refreshed, but are still searched by a slower path. | verified | https://docs.lancedb.com/indexing/vector-index |
| Storage is a directory of Lance files, so it can ship inside the image. | inferred (embedded library over local files); not benchmarked here | |

### 2.6 DuckDB VSS + FTS

| Fact | Status | Source |
|---|---|---|
| `@duckdb/node-api` 2.0.0-r.1 (MIT, 2026-10-21). The linux-x64 bindings are 96 MB unpacked. | verified | npm |
| HNSW (`vss` extension) "can only be created on tables in in-memory databases by default". With `hnsw_enable_experimental_persistence` it is written to the file but rewritten in full at each checkpoint, and "we still recommend that you do not use this feature in production environments". | verified | https://duckdb.org/docs/2.0/core_extensions/vss.html |
| "The index itself is not buffer managed and must be able to fit into RAM memory", and its size is not counted in `memory_limit`. "WAL recovery is not yet properly implemented for custom indexes." Deletes are soft until `hnsw_compact_index`. | verified | same |
| FTS: `PRAGMA create_fts_index` with Porter stemmer by default, `match_bm25` scoring. "By default, the FTS index will not update automatically when the input table changes" unless `incremental = 1`. | verified | https://duckdb.org/docs/2.0/core_extensions/full_text_search.html |
| For a read-only image, an exact `array_cosine_distance` scan needs no HNSW. Building HNSW at container start would cost CPU and RAM on every cold start. | inferred | |
| Extensions (`vss`, `fts`) are normally downloaded at first `INSTALL`. An offline image must bundle them. | inferred; not verified this session | |

### 2.7 pgvector on free Postgres tiers (and embedded PGlite)

| Fact | Status | Source |
|---|---|---|
| pgvector v0.8.7 is the latest. Index limits: `vector` up to 2,000 dims, `halfvec` 4,000, `bit` 64,000. "Use together with Postgres full-text search for hybrid search", fused with RRF or a cross-encoder. HNSW builds run "significantly faster when the graph fits into `maintenance_work_mem`". | verified | https://github.com/pgvector/pgvector |
| **Neon Free**: 1 GB storage per project (20 GB total), 100 CU-hours per project, autoscaling to 2 CU (8 GB RAM), 5 GB egress. Compute suspends after 5 minutes idle, which Free users can't turn off. pgvector is on all plans. | verified | https://neon.com/pricing |
| Neon reactivates "within a few hundred milliseconds". | verified | https://neon.com/docs/introduction/scale-to-zero |
| Neon offers pgvector 0.8.0 on PG14–17 and 0.8.6 on PG18. `pg_search` is unavailable; `pg_trgm` and `rum` (PG14–17) are available. | verified | https://neon.com/docs/extensions/pg-extensions |
| **Supabase Free**: 500 MB database (shared CPU, 500 MB RAM), 5 GB egress, 2 active projects, "paused after 1 week of inactivity". The pricing page doesn't mention pgvector. | verified | https://supabase.com/pricing |
| Size check: the full session's text alone is ≈357 MB (§0). With a tsvector/GIN index, 128k–325k vectors and an HNSW index, a full session exceeds Supabase's 500 MB and is tight or over on Neon's 1 GB. `halfvec` or a 384-dim model reduces the vector part. | inferred | arithmetic |
| A hosted Postgres can't ship inside the image. Every query crosses the network, and a suspended compute adds its resume time. | inferred | |
| **PGlite** (Postgres in WASM, in-process): `@electric-sql/pglite` 0.5.13, 26 MB unpacked. pgvector is "an external extension, distributed as a separate package" (`@electric-sql/pglite-pgvector`), and a `pg_textsearch` BM25 extension is listed. This would ship in the image as a data directory. | verified (npm; https://pglite.dev/extensions/); fit for this workload not measured | |

### 2.8 Azure AI Search, Free tier

| Fact | Status | Source |
|---|---|---|
| One free service per subscription. Shared infrastructure, no scaling, **storage limited to 50 MB**. "A free search service might be deleted after extended periods of inactivity." Maximum 3 indexes, 3 indexers. | verified | https://learn.microsoft.com/en-us/azure/search/search-limits-quotas-capacity (ms.date 2026-09-16) |
| Semantic ranker "Runs on the Free tier but not recommended for large workloads". | verified | https://learn.microsoft.com/en-us/azure/search/search-sku-tier |
| Paid: Basic $0.101/hour (≈$74/month), S1 $0.336/hour. Serverless Developer (preview, billing since 2026-09-13): $0.24 per CU-hour plus $0.20 per GB-month, a 300 MB vector index per index, and a 1 GB max index size. | verified | Azure Retail Prices API (westus2, `Azure AI Search`); limits page above |
| 50 MB can't hold 50k × 384 float vectors (73 MB) before any text. The Free tier can't hold a session. | inferred | arithmetic |
| Hybrid: Azure AI Search has keyword + vector in one query. It is a remote service, so it can't ship in the image. | inferred (general product knowledge; not re-read this session) | |

### 2.9 Vertex AI Vector Search

| Fact | Status | Source |
|---|---|---|
| Index build/update is "$3.00 per gibibyte (GiB) of data processed"; streaming inserts are $0.45/GiB. Serving is billed per node-hour while an index is deployed. | verified | https://cloud.google.com/vertex-ai/pricing ("Vector Search") |
| The smallest machine in the price table is e2-standard-2 at $0.0938084/hour (≈$68/month). Google's own example: 2M × 128-dim, 100 QPS, 1 node, "$68" a month. | verified | same |
| Storage-optimized tier: $2.30 per Capacity Unit-hour per replica, and $0.45/GiB writes. | verified | same |
| **No free tier or free quota for Vector Search is stated** on the pricing page. A deployed index costs node-hours whether queried or not, so it doesn't scale to zero. | verified absence on the page; scale-to-zero conclusion inferred | same |

### 2.10 Orama (pure JS, in-memory)

`@orama/orama` 3.1.18 (Apache-2.0) runs in-process with `mode: 'fulltext' | 'vector' | 'hybrid'` and BM25 (**verified**: https://github.com/oramasearch/orama README; npm). The whole index lives in the JS heap, so memory for 128k–325k passages of text plus vectors was not measured and is likely the limiting factor in 0.5–1 GiB (**inferred**).

### 2.11 Image-size arithmetic for an in-image index (estimate)

For one session at 85M tokens and 357 MB of text (**inferred**):
- The text is stored once: ≈357 MB.
- An FTS5 index adds tens of percent of the text size. It wasn't measured on this corpus, so that is an open question.
- Vectors: about 128k–325k chunks. At 384 dims that is 49–125 MB as int8 or 197–499 MB as float. At 768 dims, double those.
- A local query model adds 23–137 MB, and the ONNX runtime about 46 MB plus the JS packages.
- Total: an image layer of roughly 0.7–1.5 GB. Cold-start time with an image that size on Cloud Run or Container Apps wasn't measured.

---

## 3. Graph storage

The session graph has measures, versions, amendments, committees, meetings, agenda items, legislators, votes and testimony, with edges via the keys listed in `docs/research/olis-odata.md` §2 (for example testimony → measure via `SessionKey + MeasurePrefix + MeasureNumber`). If each document is a node, 2025R1 has on the order of 150k nodes; without documents it has tens of thousands (**inferred** from the §7 row counts).

### 3.1 Relational tables + recursive CTEs in SQLite

**Local measurement** (`scripts/graph.mjs`): node and edge tables in `node:sqlite`, indexes on `(src, kind)` and `(dst, kind)`, an undirected walk with a recursive CTE using `UNION` (dedup), and a synthetic skewed-degree graph. Median and p95 of 20 random starts, one core:

| Graph | Load | File | 1 hop | 2 hops | 3 hops (median / p95) | Nodes reached at 3 hops (median / max) |
|---|---|---|---|---|---|---|
| 30k nodes / 100k edges | 0.1 s | 7 MB | <0.1 ms | 0.1 / 3.5 ms | 1.8 / 20.1 ms | 1,284 / 15,557 |
| 150k nodes / 400k edges | 0.5 s | 30 MB | <0.1 ms | 0.1 / 0.5 ms | 2.6 / 110 ms | 1,636 / 40,595 |

What the measurement shows (**inferred**): traversal speed is not a constraint at this size. Hub nodes are. An untyped 3-hop walk through a busy committee or a measure with thousands of testimony rows reaches a large fraction of the graph, so walks need edge-type filters and limits. Lives in the same file as FTS5 and the vectors, ships in the image, and needs no new dependency.

Prior art: das-cairn chose ordinary tables over SQL Server graph tables because "Walks go at most 3 steps … None of it needs pattern matching, unbounded depth or shortest path". It also quotes Microsoft: "a relational database can achieve anything that a graph database can." It records ERF at about 82,000 nodes and 194,534 edges (`work-platform-design/docs/adr/0012-the-first-engine-is-azure-sql-database.md:102-135`). **verified** (file)

### 3.2 Embedded graph DB: Kùzu and its fork

| Fact | Status | Source |
|---|---|---|
| **Kùzu is archived.** The GitHub repo `kuzudb/kuzu` has `archived: true` and was last pushed 2025-10-10. Its README: "We are archiving the KuzuDB project … prior Kuzu releases will continue to be usable". It points to 0.11.3, which bundles most extensions. | verified | GitHub API `repos/kuzudb/kuzu`; README |
| npm `kuzu` last published 0.11.3 on 2025-10-10. | verified | `npm view kuzu` |
| **LadybugDB** is the continuation: "The database was formerly known as Kuzu". It is active, with v0.22.1 released 2026-10-28 and v0.22.0 on 2026-10-25, and its README lists Cypher, "Native full text search and vector index", and embedded (in-process) operation. npm `@ladybugdb/core` 0.22.1 has per-platform binary packages (linux-x64/arm64, darwin, win32). | verified | https://github.com/LadybugDB/ladybug (README, releases); `npm view @ladybugdb/core` |
| A single-maintainer-group fork a year old carries continuity risk. Not benchmarked here. | inferred | |

### 3.3 Neo4j AuraDB Free

| Fact | Status | Source |
|---|---|---|
| Free: 200,000 nodes, 400,000 relationships, 1 GB storage, on-demand backup (1 kept). | verified | https://neo4j.com/docs/aura/quotas-and-limits/ |
| "You cannot manually pause an AuraDB Free instance; they are paused automatically after 72 hours of inactivity." A paused instance has "No connectivity". If a Free instance stays paused more than 30 days, "Aura deletes the instance, and all information is lost". Resuming "can take a few minutes to a few hours". | verified | https://neo4j.com/docs/aura/managing-instances/instance-actions/ |
| Driver: `neo4j-driver` 6.2.0 (Apache-2.0, 2026-06-30). | verified | npm |
| A full-session graph that includes testimony as nodes (~150k nodes) fits 200k nodes, but edges could pass 400k once votes (≈95k) and testimony links are added. A read-mostly server that only writes on rebuild could find the instance paused. A remote DB can't ship in the image. | inferred | |

### 3.4 Azure Cosmos DB for Apache Gremlin, free tier

| Fact | Status | Source |
|---|---|---|
| Free tier: "the first 1000 RU/s and 25 GB of storage", one free-tier account per subscription, for "all API accounts with provisioned throughput"; "Free tier is currently not available for serverless accounts." | verified | https://learn.microsoft.com/en-us/azure/cosmos-db/free-tier |
| The Gremlin overview and support pages now say: "migrate an existing Apache Gremlin application? Consider Graph in Microsoft Fabric." No retirement notice was found. | verified (banner); no retirement found in one search | https://learn.microsoft.com/en-us/azure/cosmos-db/gremlin/overview |
| Gremlin Bytecode is not supported ("pass traversal as a text string"); GraphSONv3 is not supported; `match()` and lambdas are not supported; breadth-first execution. The recommended driver version is 3.4.13, and "3.5.\*, 3.6.\* have known compatibility issues". The current npm `gremlin` is 3.8.2. | verified | https://learn.microsoft.com/en-us/azure/cosmos-db/gremlin/support; `npm view gremlin` |
| Limits: 30 s traversal timeout, `.repeat()` capped at 32, 1 h idle WebSocket timeout. | verified | https://learn.microsoft.com/en-us/azure/cosmos-db/gremlin/limits |
| Ties the graph to Azure, can't ship in the image, and a Cloud Run deployment would query across clouds. | inferred | |

---

## 4. Prior art on this machine (read only)

### 4.1 das-cairn and its design notes

| Decision | What it is | Why, as recorded | Source |
|---|---|---|---|
| Embedder behind an interface | `IEmbedder` with `EmbeddingModel(Name, Dimensions)`; `EmbedQuestionAsync` for the reader-waiting path. A release records its model name. | "so that changing it is an infrastructure change" | `/home/dzinck/das-cairn/src/Application/IEmbedder.cs`; `work-platform-design/specs/10-semantic-search.md:61-62,69-71` |
| Local model for build and test | **Ollama** 0.32.4 on loopback serving **`bge-m3`** (MIT, 1,024 dims, 8,192 tokens) via the OpenAI-style `/v1/embeddings`, on the graphics card. The model name is recorded as `local/bge-m3`. | Dan: "We can use a local llm for building and testing and then transition to the azure service" | `specs/10-semantic-search.md:123-130`; `/home/dzinck/das-cairn/src/Infrastructure/LocalEmbedder.cs`; `das-cairn/docs/runbook/developing-locally.md:14` |
| Local model not in the image | "The local model is for this machine only. It is not the fallback for DAS and is not in the container image." | Its vectors and floor don't carry over to the hosted model. | `specs/10-semantic-search.md:132-135` |
| Hosted model for production | Azure OpenAI in Microsoft Foundry, **`text-embedding-3-large` at 1,536 dims**, Data Zone Standard (US), managed identity. Retires 2028-02-09. | "Either model costs cents for this corpus, so cost no longer argues for the small one"; the enterprise must approve the use of an LLM; managed identity, no keys. | `specs/10-semantic-search.md:89-113`; `das-cairn/docs/architecture/das-cairn-on-azure.md:143` |
| Vector store | Vectors in **Azure SQL** in a `vector(1536)` column beside passages; vectors reused across releases by model name | Engine the team already runs; "vector type holds up to 1,998 dimensions" | `specs/10-semantic-search.md:171-178`; `das-cairn/src/Infrastructure/Sql/CorpusDbContext.cs:480`; ADR 0012 |
| Exact search, no index | "With about 2,600 passages the database compares a question with every vector. No vector index is used." | Size; ADR 0012 estimates exact comparison suffices up to ERF's 229,000 passages ("an estimate, not a measurement"). | `specs/10-semantic-search.md:180-181`; `docs/adr/0012-…md` "Why Azure SQL first" |
| Hybrid ranking | RRF with k=60 on documents; an exact citation match always leads; a citation-only query skips the vector half. | – | `specs/10-semantic-search.md:182-187, 210` |
| Similarity floor | A floor below which vector hits are dropped. Default 0.3; set to **0.5 for bge-m3** because nonsense words scored 0.36–0.40. A floor belongs to one model. | – | `specs/10-semantic-search.md:188-197, 315` |
| Fallback | If the embedder can't be reached, search uses words alone and says so. | – | `specs/10-semantic-search.md:198-203` |
| Passage rule | ≤3,000 chars, 200-char overlap, cut at a blank line, line break or space within 600 chars. The rule is part of the vector key. | – | `specs/10-semantic-search.md:158-170` |
| Graph | Ordinary tables, walks ≤3 steps (see §3.1). | – | ADR 0012 amendment 2026-10-11 |
| Build-plane alternative considered | "ONNX Runtime in C# with a local embedding model — no per-token cost and no data leaving the build agent, at the price of managing model weights and getting tokenisation exactly right." | – | `work-platform-design/docs/open-questions.md:117-125` |

What transfers to SessionGateway and what doesn't (**inferred**):
- The interface, the model name stored with the vectors, content-keyed vector reuse, exact search at this size, RRF k=60 with a citation-first rule, a per-model floor and an announced keyword fallback are runtime-independent.
- bge-m3 over Ollama doesn't transfer to a 0.5–2 GiB scale-to-zero container. It needs about 1.1 GB RSS just for queries and 2 s to load (§1.1), and Ollama is a separate server process.
- Azure SQL doesn't transfer to the static-image design.

### 4.2 OregonAI ERF (via the design review) and the SessionGateway spike

- ERF uses `BAAI/bge-m3`, "about 2.2 GB of weights", and "The index cannot be built in CI. ERF's `Dockerfile` says 'the artifact needs a GPU'". The review's advice: "Make vectors an optional part of the bundle and add them when a measured retrieval gap justifies the cost." **verified** (`work-platform-design/docs/review-2026-10.md:311-318, 543-545`)
- SessionGateway's parked spike (`prototype/scaffold` branch, commit `3be2380`) chose "`node:sqlite` with FTS5, not a vector database". It planned hybrid retrieval "in the same SQLite file through `sqlite-vec`, with embeddings computed at ingest time", added only "if the evaluation set shows BM25 missing paraphrased questions". It requires a stateless server, "retrieval only: no LLM calls, no API keys", and an index "baked into" the image. **verified** (`git show prototype/scaffold:docs/architecture.md` lines 6, 12, 23–32, 68–69; `prototype/scaffold:CLAUDE.md` lines 9–10). The README calls it "reference material, not a decision".

---

## 5. Hosting envelope (facts used above)

| Fact | Status | Source |
|---|---|---|
| Cloud Run request-billed services: 180,000 vCPU-s, 360,000 GiB-s and 2M requests free per month. Instance-billed services and **jobs**: 240,000 vCPU-s and 450,000 GiB-s. Aggregated per billing account. 1 GiB/month free egress within North America. | verified | https://cloud.google.com/run/pricing |
| Azure Container Apps Consumption: 180,000 vCPU-s, 360,000 GiB-s and 2M requests free per subscription per month. Scaled to zero costs nothing. Jobs are billed at the active rate. Overage (West US 2): $0.000034/vCPU-s and $0.000004/GiB-s active, $0.40 per 1M requests. | verified | https://learn.microsoft.com/en-us/azure/container-apps/billing (ms.date 2025-12-09); Azure Retail Prices API |

---

## 6. Comparison tables

### 6.1 Embedding producers

| Option | $ for 85M tokens (one pass) | Serve-time query embedding | RAM in serving container | Cloud tie | Data leaves | Licence / terms |
|---|---|---|---|---|---|---|
| Local bge-small / e5-small / gte-small / arctic-s (384, q8) | $0; ≈28k vCPU-s | in-process, 4–5 ms | ≈190 MB | none | no | MIT / Apache-2.0 |
| Local all-MiniLM-L6-v2 (384) | $0; ≈15k vCPU-s | 1.7 ms | ≈170 MB | none | no | Apache-2.0; 256-token cap |
| Local bge-base / nomic (768) | $0; 66k–91k vCPU-s | 12–17 ms | 320–430 MB | none | no | MIT / Apache-2.0 |
| Local bge-m3 / EmbeddingGemma | $0; ≈205k vCPU-s | 42–126 ms | ≥1.1 GB | none | no | MIT / Gemma terms |
| Azure 3-small | $1.70 (Global) | network call + key/MI | ~0 | Azure (MI) | yes | provider terms |
| Azure 3-large | $11.05 (Global) | network call | ~0 | Azure | yes | provider terms |
| Gemini embedding-001 / -2 | $12.75 / $17.00 (batch half); free tier with data use | network call + key | ~0 | Google project | yes (the free tier is used to improve products) | provider terms |
| Vertex text-embedding-005 | ≈$8.93 | network call | ~0 | GCP | yes | provider terms |
| Voyage 4-lite / 4 / 4-large | $1.70 / $5.10 / $10.20, or $0 within the 200M free | network call + key | ~0 | none (third vendor) | yes | provider terms |

### 6.2 Vector + keyword stores

| Option | Hybrid with BM25 | Ships in image | Query at 200k × 384 (local) | Serving RAM | Maturity / risk | Cost at rest |
|---|---|---|---|---|---|---|
| sqlite-vec (exact) + FTS5 in `node:sqlite` | yes, same file, RRF in SQL | yes | float 65 ms, int8 47 ms (92.7% recall), bit 3.6 ms (44.9%) | ≈50 MB + page cache | pre-v1; ANN only in alpha; `node:sqlite` is RC | $0 |
| Flat `Float32Array`/`Int8Array` + FTS5 | yes, fused in TS | yes | 52 ms (float) | the whole matrix (77–307 MB at 200k) | no dependency | $0 |
| usearch HNSW file + FTS5 | yes, fused in TS | yes | ≈1 ms, 99.5% recall | ≈index size (≈320 MB at 200k float) | maintained; native addon; slow single-core build | $0 |
| LanceDB | yes, built in (BM25 FTS + RRF) | yes (directory) | not measured | not measured | active; 212 MB native binary | $0 |
| DuckDB VSS + FTS | yes, manual fusion | yes, but HNSW persistence is experimental and the FTS index isn't auto-updated | not measured | HNSW must fit in RAM | experimental persistence | $0 |
| PGlite + pgvector | yes (Postgres FTS / pg_textsearch) | yes (data dir) | not measured | not measured | WASM Postgres; external extension | $0 |
| Neon Free + pgvector | yes (tsvector + RRF) | no | not measured | n/a | 1 GB cap is tight for a full session; 5-min suspend, resumes in "a few hundred ms" | $0 within limits |
| Supabase Free + pgvector | yes | no | – | – | 500 MB cap too small; pauses after 7 days | $0 |
| Azure AI Search Free | yes | no | – | – | 50 MB cap too small; may be deleted when inactive | $0; Basic ≈$74/mo |
| Vertex AI Vector Search | vector only (keyword elsewhere) | no | – | – | no free tier found; billed per deployed node-hour | ≈$68/mo minimum |
| Orama | yes, in-memory | yes (serialized) | not measured | the whole index in the JS heap | pure JS | $0 |

### 6.3 Graph stores

| Option | Ships in image | 3-hop at 150k/400k (local) | Free-tier limits | Risk |
|---|---|---|---|---|
| SQLite tables + recursive CTE | yes, same file | median 2.6 ms, p95 110 ms (hub fan-out) | n/a | none new; hub fan-out needs typed edges |
| LadybugDB (Kùzu fork), embedded | yes | not measured | n/a | young fork of an archived project |
| Kùzu 0.11.3 | yes | not measured | n/a | archived 2025-10-10, no further releases |
| Neo4j AuraDB Free | no | not measured | 200k nodes / 400k rels / 1 GB; pauses after 72 h inactive; deleted after 30 days paused | remote; pause/resume |
| Cosmos DB for Gremlin, free tier | no | not measured | 1,000 RU/s + 25 GB, provisioned only | Azure-only; driver pinned to 3.4.x; Microsoft points migrations to Fabric Graph |

---

## 7. Open questions

1. **Corpus scope.** Is testimony (≈100k documents, 38% of the text) embedded, keyword-only, or excluded? That choice moves the vector count between about 80k and 325k, and with it the store and the RAM budget.
2. **Chunk size.** The brief's "tens of thousands of chunks" implies ~1,000+ token chunks. bge-small/MiniLM-class models cap at 512/256 tokens, while nomic/bge-m3/Voyage/OpenAI take 2k–32k. Which chunk rule, and is it part of the vector key as in das-cairn?
3. **Does semantic search earn its cost on legislative questions?** The spike and the ERF review both say: measure BM25 first on a question set. No eval set exists yet.
4. **Cloud vCPU speed.** All throughput here is from a desktop core. Running `scripts/embed.mjs` as a Cloud Run job and an Azure Container Apps job would settle whether a full local embedding fits the free grants.
5. **Real cold start.** Measure with a 0.7–1.5 GB image (text + FTS5 + vectors + model) on both platforms. Page-cache accounting against the memory limit for a mmap'd or pread SQLite file is also unverified.
6. **FTS5 index size** on the real session text (not measured).
7. **Quality of q8 vs fp32, int8 vs float, and binary + re-score** on legislative text with real questions. The recall figures here are passage-to-passage on Node docs.
8. **Gemini free-tier limits** for `gemini-embedding-001/2` are per project in AI Studio and not published. Are they enough for 85M tokens, and is "used to improve our products" acceptable for public records and for user queries?
9. **Voyage's 200M free tokens:** one-time or recurring? What are the limits without a payment method?
10. **Hosted query embedding at serve time** adds a credential, a network hop and an outage mode to a server the spike kept key-free. Is that acceptable, or must query embedding be local, which forces a local model for the corpus too?
11. **Delta detection.** OLIS has no ETags and many null `ModifiedDate`s (`olis-odata.md` §6). How will changed documents be found so that only their chunks are re-embedded?
12. **sqlite-vec's DiskANN/IVF** is alpha. Is exact search at 47–135 ms per query on one core acceptable at the expected query rate, or is an ANN index (usearch, LanceDB, or sqlite-vec alpha) needed?
13. **LadybugDB** fit and stability for 1–3-hop typed walks were not tested. Does anything need Cypher that recursive CTEs can't express?
14. **DuckDB extension bundling** for an offline image, and LanceDB/PGlite memory at 200k+ rows, were not measured.

---

## Appendix: local measurement files

All under `/home/dzinck/.claude/jobs/a3847f05/tmp`:
- `scripts/embed.mjs`: model load, batch embedding throughput, query latency. Results: `results-embed-1cpu.jsonl`, `results-embed-multicpu.jsonl`.
- `scripts/query-only.mjs`: cold start to first query and query-only RSS. Results: `results-query-only.jsonl`.
- `scripts/vec.mjs`: sqlite-vec float/int8/bit, JS scan and usearch at 50k–200k. Results: `results-vec-1cpu.jsonl`.
- `scripts/serve-rss.mjs`, `scripts/usearch-view.mjs`: serving-side RSS.
- `scripts/recall.mjs`: recall@10 on real bge-small embeddings.
- `scripts/hybrid-check.mjs`: FTS5 + vec0 RRF in one `node:sqlite` statement.
- `scripts/graph.mjs`: recursive CTE traversals.
- `scripts/tokratio.mjs` and `dl/`: chars/token on four OLIS PDFs.
- Packages were installed in `bench/` (transformers.js 4.3.2, sqlite-vec 0.1.9, usearch 2.26.5, js-tiktoken), and model files are in `hfcache/`. Nothing was installed in the SessionGateway repo.
