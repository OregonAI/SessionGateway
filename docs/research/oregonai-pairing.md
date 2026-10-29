# Pairing SessionGateway with the OregonAI Corpus platform

Researched 2026-10-28. The MCP calls ran at 2026-10-29T04:40–04:48Z, which is the evening of 2026-10-28 Pacific time.

**Question.** What does the OregonAI Corpus platform already provide that SessionGateway could pair with to get from "this measure or amendment" to "these agencies are affected, and how"? Where does SessionGateway overlap with what the platform already does?

**How to read this file.**

- **verified** means I observed it directly, in a tool response, a file, or an HTTP response.
- **inferred** means it is a conclusion drawn from verified facts and has not been observed itself.
- An MCP citation such as `resolve_citation(citation="ORS 409.711")` is a call to the OregonAI Corpus connector (the gateway).
- File citations use `path:line`.
- Some local checkouts are behind `origin/main`, and those citations say so. Where a local checkout and the live server disagree, the live server is the authority. Record content is quoted only from tool output received in this session.

---

## 1. Summary of findings

1. **The platform already ingests OLIS for every session from 2017R1 through 2026R1.** The `oregon-legislature` corpus mirrors measure metadata plus bill text from the OData feed, and it proxies live status and history. It holds 6,134 measure documents. **verified** (§3)
2. **Only three sessions are mirrored in full: 2024R1, 2025R1 and 2026R1.** Every older session holds only appropriation-shaped measures. **verified** (§3.2)
3. **Only two bill versions are mirrored: Introduced and Enrolled.** Amendments (A- and B-Engrossed, committee proposed amendments), testimony, committee meetings, agendas, fiscal or revenue impact statements, and sponsors are not mirrored. **verified** (§3.3)
4. **Measure→ORS links exist only as unresolved citation strings.** Each one is labelled a candidate, not a finding. The legislature corpus has **no graph** (0 edges). **verified** (§2, §3.4)
5. **The statute→rule→agency hop works.** It runs through the `executive-regulatory-frameworks` (ERF) graph's `implemented_by` edges and the rules' agency attribution. For about three quarters of statutes it returns nothing, because only 9,503 of 37,534 statutes have any implementing document. **verified** (§2.4)
6. **Statutes carry no administering agency.** Every ORS document has `agency: statewide`. **verified** (§2.4)
7. **Agency→budget, KPM and audits works by agency slug** through `documents_by_agency`. Budget expenditures key on the DAS agency number. **verified** (§2.5)
8. **A measure→agency join exists only for appropriation bills,** through the budget corpus's `join_lookup`. Every join is `human_reviewed: false`. **verified** (§2.6)
9. **No session after 2026R1 exists in the platform or in the OData feed yet.** The legislature corpus's citation scheme also lists its sessions in a hard-coded tuple. **verified** (§3.5)
10. **The gateway is reachable unauthenticated over public HTTPS** at `https://gateway.morficflux.com/mcp`, using stateful Streamable HTTP. The deployed build exposes 8 tools, not the 9 on `main`. **verified** (§6)

---

## 2. The trace: from measure to agencies, worked tool by tool

The measures used here were chosen from what `search` returned. Path A runs end to end. Path B shows where the chain breaks. Path C is the budget-specific route.

### 2.1 Path A: HB 3318 (2025R1), cargo-tank penalties, Department of Environmental Quality

**Step 1: find the measure.**

- **Call:** `search(query="Environmental Quality Commission rules amending ORS 468", corpus="oregon-legislature", limit=8)`
- **Result:** hit 7 was `measure-2025r1-hb3318`, titled *"HB 3318 (2025R1): Authorizes the Environmental Quality Commission to adopt by rule a schedule of enhanced civil penalties for violations of certain environmental laws involving cargo tank motor vehicles."* **verified**

**Step 2: read the measure and its ORS references.**

- **Call:** `get_document(corpus="oregon-legislature", doc_id="measure-2025r1-hb3318", part="chunk:0")`
- **Result (trimmed):**

```
"relationships":{"references_external":["ORS 468.130","ORS 468.140"]}
"source_url":"https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/HB3318/Introduced"
"retrieved":"2026-07-27"
- **Introduced/Enrolled documents on file:** Introduced
"live_status":{"as_of":{..."executed_at":"2026-10-29T04:43:45Z","upstream_status":"live"},
  "found":true,"current":{"CurrentLocation":"In House Committee","CurrentCommitteeCode":"HJUD", ... "Vetoed":false ...}}
```

- The ORS references come back as **citation strings**, not document ids. Every `get_document` on a measure adds a `live_status` block fetched from OData. **verified**

**Step 3: resolve each ORS string to a statute document.**

- **Call:** `resolve_citation(citation="ORS 418.808", corpus="executive-regulatory-frameworks")` resolves to `ors-418.808`. **verified**
- The same pattern applies to `ors-468.130` and `ors-468.140`, which Step 4 uses by id.
- `ORS 468.130(2)` does **not** resolve: `"resolved":false ... "No corpus recognised this citation format."` **verified**
- `ORS 163A.040` resolves to `ors-163a.040`, lower-cased. **verified**

**Step 4: find the rules that implement each statute.**

- **Call:** `authority_chain(corpus="executive-regulatory-frameworks", doc_id="ors-468.130", depth=1, direction="down")`
- **Result:** `down_implemented_by` lists 6 documents: `deq-imd-7070215` and `deq-imd-7079990` (policies), plus `oar-340-011-0505`, `oar-340-011-0520`, `oar-340-011-0570` and `oar-340-012-0170` (rules). **verified**
- **Call:** `graph_neighbors(corpus="executive-regulatory-frameworks", doc_id="ors-468.140")`
- **Result:** `implemented_by` lists 23 items, for example `{"id":"oar-340-012-0130","title":"Determination of Violation Magnitude","doc_type":"rule"}` and `oar-340-012-0067` ("Underground Storage Tank (UST) Classification of Violations"). **verified**
- The local `_meta/graph.json` gives the same counts, 6 and 23, so the edge list does not appear to be truncated. **verified** (the local ERF checkout is 19 commits behind `origin/main`)

**Step 5: map rules to an agency.** Edges carry no agency, so a second step is needed. There are three ways to do it.

- **Search hits carry `issuing_body`.**
  - **Call:** `search(query="Classification of Violations civil penalty cargo tank", corpus="executive-regulatory-frameworks", issuing_body="Department of Environmental Quality", limit=3)`
  - **Result:** `"issuing_body":"Department of Environmental Quality"` on each hit, plus `"issuing_body_filter":{..."registry_checked":true}`. **verified**
- **The OAR chapter prefix maps to the agency registry.** `oar-340-…` maps to chapter `340`.
  - **Call:** `call(corpus="executive-regulatory-frameworks", tool="issuing_body_profile", arguments={"slug_or_query":"department-of-environmental-quality"})`
  - **Result:** `"oar_chapter":"340"`, `"das_agency_number":"340"`, `"enabling_authority":"ORS 468.030"`. **verified**
- **`get_document` on a rule does not return `issuing_body` or `agency` in its result.** The `oar-461-194-0030` response had neither. The slug is in the file's frontmatter (`rules/461/194/oar-461-194-0030.md:11`, `agency: department-of-human-services-self-sufficiency-programs`), but the tool does not surface it. **verified**

**Step 6: from the agency to its budget, performance measures (KPM) and audits.**

- **Budget.** `call(corpus="oregon-budget", tool="documents_by_agency", arguments={"slug":"department-of-environmental-quality"})` returned 20 documents: `expenditures-340-fy2019` … `expenditures-340-fy2025`, plus 13 `join-<session>-<measure>-agency-340` documents. It also returned `"slug_in_registry":null` and the attribution note *"752 document(s) carry no slug at all … this answer is a floor"*. **verified**
- **KPM.** The same call on `oregon-kpm` returned 10 Annual Performance Progress Reports, from `deq-kpm-report` (2016) to `appr-deq-2025-09-30` (2025). **verified**
- **Audits.** The same call on `oregon-audits` returned 8 reports, including `2024-13`, *"Ongoing Strategic Planning Can Help DEQ Address Obstacles to Achieving its Goals"*. **verified**
- **No budget join for this bill.** `call(corpus="oregon-budget", tool="join_lookup", arguments={"document_id":"measure-2025r1-hb3318"})` returned `"found":false`. HB 3318 is not an appropriation bill, so this is expected. **verified**

**Result of Path A.** Measure → 2 ORS → 29 implementing documents, nearly all OAR chapter 340 → DEQ → 7 expenditure years, 10 KPM reports and 8 audits.

- Every hop needed the agent to do its own join: string→id, then rule→chapter→slug. **verified**
- No hop says *how* the measure changes the statute. The measure lists `ORS 468.130` and `ORS 468.140` as references, not as "amends". **verified**

### 2.2 Path B: HB 3795 (2025R1), Department of Human Services. The chain breaks.

**Step 1: find and read the measure.**

- **Call:** `search(query="amending ORS Department of Human Services", corpus="oregon-legislature", limit=8)` returned `measure-2025r1-hb3795`, with the snippet *"… [human] [services]; [amending] [ORS] 409.711 and 418.808. …"*. **verified**
- **Call:** `get_document(corpus="oregon-legislature", doc_id="measure-2025r1-hb3795")` returned:
  - `"references_external":["ORS 192.245","ORS 409.711","ORS 418.806","ORS 418.808"]`
  - the bill-text line *"Relating to human services; amending ORS 409.711 and 418.808."*
  - live status: `"CurrentLocation":"House Desk - Vetoed" … "Vetoed":true`
  - **verified**
- **Observation:** the bill amends **2** sections, but `references_external` lists **4**. ORS 192.245 and 418.806 appear only as cross-references in the text. The candidate list is "cited", not "amended", as the platform's own code says (`oregon-legislature/src/build_measure_citations.py:18`). **verified**

**Step 2: look for implementing rules.**

- **Call:** `authority_chain(corpus="executive-regulatory-frameworks", doc_id="ors-409.711")` returned `"up_implements":[],"up_cites":[],"down_implemented_by":[]`. `graph_neighbors` on the same id returned no relation keys at all. **verified**
- `authority_chain` on `ors-418.808` was also empty. **verified**
- The local graph has 0 edges into `ors-409.711`, `ors-418.808` or `ors-418.806`. **verified** (local checkout, 19 commits behind)

**Step 3: why the hop fails.** The rule that does carry out this program cites the session law, not the ORS section.

- `search(query="409.711 tax preparation grant program", corpus="executive-regulatory-frameworks", doc_type="rule", limit=5)` returned `oar-461-194-0030`, issuing body "Department of Human Services, Self-Sufficiency Programs", as a *"semantic match — no keyword overlap"*. **verified**
- `get_document(corpus="executive-regulatory-frameworks", doc_id="oar-461-194-0030")` returned *"Statutory/Other Authority: ORS 411.060 & HB 4117 (Oregon 2022 short session) Statutes/Other Implemented: HB 4117 (Oregon 2022 short session)"*. **verified**
- The ORS 409.711 document ends *"[2022 c.67 §1]"*. **verified**
- That 2022 c.67 is HB 4117 (2022) is **inferred**. Nothing on the platform asserts it.
- `resolve_citation(citation="HB 4117 (Oregon 2022 short session)", corpus="oregon-legislature")` and `resolve_citation(citation="HB 4117 (2022R1)", corpus="oregon-legislature")` were both `"resolved":false`. **verified**
- 2022R1 is mirrored appropriations-only, with 56 of 275 measures, and `hb4117` is not among the files. **verified** (`oregon-legislature/measures/_index.md`, local `ls`)
- In the local ERF checkout, 755 of 42,561 rule files list an `HB`/`SB` citation in `legal_authority` or `statutes_implemented`. **verified** (local count, behind `origin/main`)
- The rule's frontmatter lists `ORS 411.060` in `legal_authority` but has `implements: []` (`rules/461/194/oar-461-194-0030.md:12-33`). The implements edges therefore seem to come from `statutes_implemented` only. **inferred** from one example plus the graph note "Generated by src/link_graph.py from frontmatter relationships" in ERF `_meta/graph.json`.

**Side observation.** The ERF text of ORS 409.711 (2025 Edition, retrieved 2026-07-20) has subsections (1)–(4) and no subsection (5). HB 3795's enrolled text adds (5). This is consistent with the veto. The ORS mirror shows enacted law only, never pending changes. **verified** (both `get_document` bodies)

### 2.3 Path C: the budget route, for appropriation bills only

- **Call:** `call(corpus="oregon-budget", tool="join_lookup", arguments={"document_id":"measure-2023r1-hb5018"})`
- **Result:** `"found":true` with:

```
"join_document":"join-2023r1-hb5018-agency-340", "appropriation_document":"appropriations-2023r1-hb5018",
"sibling_corpus":"oregon-legislature","sibling_document_id":"measure-2023r1-hb5018",
"agency_code":"340","agency_registry_slug":"department-of-environmental-quality",
"agency_registry_corpus":"executive-regulatory-frameworks","fiscal_years":[2024,2025],"human_reviewed":false
```

- The response warns: *"These links pair an ENTITY and a PERIOD, never dollars with dollars."* **verified**
- `get_document(corpus="oregon-budget", doc_id="join-2023r1-hb5018-agency-340")` carries `"review_status":{"human_reviewed":false,"servable_as_fact":false, …}`. **verified**
- This is the platform's only direct measure→agency link. It is built by regex extraction from the legislature mirror's bill text (`oregon-budget/src/extract_appropriations.py:1-4`). **verified**

### 2.4 Where the path breaks or is missing a link

| Hop | Status | Evidence |
|---|---|---|
| measure → ORS | Citation **strings** only, regex-extracted from Introduced *or* Enrolled text, never resolved to ids. No "amends" vs "cites" distinction. | `ingest_measures.py:109` (`CITE_RE`), `:294`, `:332`; `get_document` on HB 3795. **verified** |
| measure graph | None. `graph_neighbors(corpus="oregon-legislature", doc_id="measure-2025r1-hb3318")` returned `"no_graph":true,"error":"this corpus has no relationship graph"`. `corpus_overview` reports `"graph_edges":0`. | **verified** |
| cross-corpus measure → statute | Not wired. The legislature corpus has no `siblings:` block (`_meta/corpus.yml:180`, commented out). | **verified** |
| statute → rule | 92,532 rule→statute `implements` edges, but only 9,503 of 37,534 statutes have any implementing document. | Local ERF `_meta/graph.json` count. **verified** (local, behind 19 commits; live overview says 195,788 edges) |
| statute → agency | None directly: statutes are `agency: statewide`. The chapter heading names a chapter, for example *"Chapter 409 (Department of Human Services)"* in the `ors-409.711` body, but only as text. | `statutes/ors-409.711.md:11`; gateway README:252-253. **verified** |
| rule → statute via session law | Rules that cite a bill (`HB 4117 (Oregon 2022 short session)`) do not link to the ORS section or the measure. | Path B. **verified** |
| rule → agency | Available as the OAR chapter in the id, as `issuing_body` on search hits, and through `documents_by_agency`. Not available on `get_document`. | Path A step 5. **verified** |
| agency → budget, KPM, audits | Works by slug. Budget expenditures key on the DAS number (`340`). Attribution is complete for ERF and "UNKNOWN" or "a floor" for budget, KPM and audits, per their own notes. | Path A step 6. **verified** |
| audits → statute | Forward only, as `references_external` resolved to ERF ids through `sibling:executive-regulatory-frameworks`. Example: `graph_neighbors(corpus="oregon-audits", doc_id="2020-02")` → `ors-297.405`. No reverse "which audits cite ORS X" tool was found. A keyword `search(query="ORS 468.140 civil penalties", corpus="oregon-audits,oregon-kpm", mode="keyword")` returned 0. | **verified** (absence of a reverse tool: **inferred** from the 8-tool surface) |
| fiscal impact | Not mirrored. `FiscalImpact`/`RevenueImpact` are deliberately excluded and `MeasureAnalysisDocument` is not ingested. | `ingest_measures.py:63-66`. **verified** |

---

## 3. How the platform's legislative-measures corpus is built

The repo is `OregonAI/oregon-legislature`. The local checkout at `/home/dzinck/oregon-legislature` is at `d154dc30`. Live `origin/main` is `944c2b55`, dated 2026-10-01: `gh api repos/OregonAI/oregon-legislature/commits`. The commits after `d154dc30` are toolkit-pin bumps and a drift run. The README describes a 20-measure proof run and is stale; the platform review lists that as finding F27 (`/home/dzinck/PLATFORM-REVIEW-2026-08-01.md:85`). **verified**

### 3.1 Source: OLIS OData, plus PDF scraping

- **Metadata** comes from `https://api.oregonlegislature.gov/odata/odataservice.svc` (`ingest_measures.py:57`), paged with `$skip` and checked against `odata.count` (`:131-159`). **verified**
- **Bill text** comes from the `MeasureDocuments` → `DocumentUrl` PDFs on `olis.oregonlegislature.gov`, extracted with pypdf (`:176-191`). **verified**
- **Mirrored fields** (`MEASURE_SELECT`, `:67`): SessionKey, MeasurePrefix, MeasureNumber, PrefixMeaning, CatchLine, MinorityCatchLine, MeasureSummary, RelatingTo, RelatingToFull, AtTheRequestOf, LCNumber, CreatedDate, ModifiedDate. **verified**
- **Deliberately not mirrored:** "CurrentLocation/CurrentCommitteeCode/FiscalImpact/RevenueImpact/EffectiveDate/ChapterNumber/Vetoed/EmergencyClause" (`:63-66`). **verified**

### 3.2 Sessions held, and how fresh

Source: `oregon-legislature/measures/_index.md` and local per-directory file counts. **verified**

| Session | Mirrored / odata.count | Scope |
|---|---|---|
| 2026R1 | 304 / 304 | complete |
| 2025R1 | 3,466 / 3,466 | complete |
| 2024R1 | 291 / 291 | complete |
| 2023R1, 2021R1, 2019R1, 2017R1 | 541 / 2,970, 483 / 2,519, 437 / 2,768, 430 / 2,829 | appropriations-only |
| 2018R1, 2020R1, 2022R1 and the special sessions | partial | appropriations-only |

- **Appropriations-only** means a regex over CatchLine, RelatingTo and MeasureSummary (`APPROPRIATION_RE`, `ingest_measures.py:91`), chosen to cap repo size (`:75-89`). **verified**
- **Retrieval dates:** every 2025R1 file has `retrieved: '2026-07-27'` and every 2026R1 file has `'2026-07-28'`. **verified** (local frontmatter)
- **Last ingest:** the last commit touching `measures/` that adds content is `280e6210`, 2026-07-28, "Mirror the sessions that funded FY2019-FY2025, plus 2026R1". It was followed by a 2026-08-03 frontmatter-only fix. **verified** (`gh api …/commits?path=measures`)
- **No scheduled ingest.** `.github/workflows/scheduled.yml` runs weekly validation and a monthly drift check (`scheduled.yml:4-5`). The drift run on 2026-10-01 compared exactly **1** source: "1 in scope · 0 changed" (live `DRIFT.md`). Re-ingest is a manual script, `scripts/nightly_ingest.sh`. **verified**
- **The mirror is stale; live status is not.** `get_document` adds `live_status`, and `query_dataset` reads OData live: the HB 3795 history came back with `executed_at` 2026-10-29T04:47:46Z. **verified**

### 3.3 Document types held

| SessionGateway type (`prototype/scaffold:src/document.ts:11`) | On the platform? | Evidence |
|---|---|---|
| `measure`: metadata + text | **Yes.** Introduced and Enrolled only. One document per measure embeds one version, Enrolled preferred over Introduced. 2025R1 embeds 702 Enrolled and 2,764 Introduced. | `ingest_measures.py:102`, `:577-592`; local frontmatter count. **verified** |
| `amendment`: engrossed versions, committee proposed amendments | **No.** The spec measured 504 A-Engrossed, 552 chamber amendments and 94 B-Engrossed in 2025R1 and chose "fetch on demand". `CommitteeProposedAmendment` is not among the 3 live datasets. | `PHASE5-MCP-SPEC.md:119`, `:128-132`; `leg_tools.py:49-79`. **verified** |
| `testimony` | **No.** Excluded on privacy grounds. | `PHASE5-MCP-SPEC.md:105-107`, `:257-260`. **verified** |
| `meeting` / agendas | **No.** The `list_corpora` description says "status, history, votes and agendas", but `list_datasets` offers only `measures`, `measure-history-actions` and `legislative-sessions`. | `call(corpus="oregon-legislature", tool="list_datasets")`. **verified** |
| `vote` | **Partly, and live only.** `VoteText` on history actions is prose, for example `"Ayes, 44; Nays, 11--Boice, …"`. `MeasureVote`/`CommitteeVote` are not exposed. | `query_dataset(dataset="measure-history-actions", …, number=3795)`. **verified** |
| `journal` | **No.** | No dataset or content root. **verified** (`_meta/corpus.yml` content_roots) |
| fiscal / revenue impact | **No.** | §3.1. **verified** |
| sponsors | **No.** | `MeasureSponsor` is not in `DATASETS`. **verified** |

### 3.4 Links it extracts

- **Measure → ORS.** Regex candidates from bill text, falling back to `RelatingToFull` (`ingest_measures.py:223-233`, `:294`). They are stored twice:
  - `relationships.references_external`, as `"ORS 137.225"` strings (`:332`)
  - `candidate_ors_citations.from_bill_text` / `.from_relating_to_full` (`:358-361`)
  - The comment says these are left citation-shaped on purpose, "resolution against oregon-policy-repo is future step-7 work" (`:287-293`). **verified**
- **No measure → agency, measure → sponsor or measure → committee edges.** There is no `_meta/graph.json`; `_meta/corpus.yml:117` names a path that does not exist. **verified**
- **Measure `issuing_body` is always "Oregon State Legislature"** (`ingest_measures.py:318`). The gateway README's measured agency profile classifies the corpus as `cannot_answer_by_slug` (`corpus-gateway/README.md:198-208`). **verified**

### 3.5 Citation scheme and session handling

- **Three schemes** (`src/citations.py:45-59`):
  - the raw id `measure-2025r1-hb3318`
  - the session-qualified form `HB 3318 (2025R1)`
  - the bare form `HB 3318`, which fans out to every session, newest first
- **Ten prefixes are recognised:** HB, SB, HJR, SJR, HCR, SCR, HJM, SJM, HR, SR (`:29`). **verified**
- **Sessions are a hard-coded tuple, newest `"2026r1"`** (`citations.py:25`). A bare citation in a session not listed would not fan out to it. That a new session needs a code change is **inferred** from reading the code.
- **The OData feed lists 41 sessions, the newest `2026R1`, and no 2027 session.** `"DefaultSession":true` is on `2025I1` (2025–2026 Interim). Source: `query_dataset(dataset="legislative-sessions", limit=200)`. **verified**

---

## 4. Overlap with SessionGateway

**What the platform already does that SessionGateway plans to do.** **verified**

- **Fetches OLIS OData Measures and MeasureDocuments for a session,** with pagination guarded against silent truncation (`ingest_measures.py:131-159`). The feed's quirks are measured and written up in `entities/*.md` and `_meta/corpus.yml:132-176`:
  - no server-side paging
  - JSON-unsupported `$metadata`
  - OData v3 `$inlinecount`
  - 5–15 s latency
- **Extracts Introduced and Enrolled PDF text** and makes it searchable, with keyword plus semantic hybrid search (`_meta/corpus.yml` `semantic_search_module`).
- **Serves live status and history.** `live_status` on `get_document`, and `query_dataset` on 3 entity sets.
- **Resolves measure citations,** including disambiguation across sessions.

**What SessionGateway's ingest types cover that the platform does not.** **verified** (§3.3)

- Amendment and engrossed versions, committee proposed amendments
- Testimony
- Committee meetings and agendas
- Structured votes
- Journals
- Fiscal and revenue impact
- A graph over the session: sponsors, committees, versions, ORS targets
- Any session after 2026R1

**Facts that bear on "read OLIS directly or reuse the corpus".** These are facts only; no decision is made here.

| Fact | Status |
|---|---|
| The platform mirror was last refreshed 2026-07-28 and has no scheduled re-ingest. A session in progress would be stale between manual runs, except for `live_status` and `query_dataset`. | verified (§3.2) |
| The platform's full-session ingest of 2025R1 (Introduced + Enrolled) was estimated at ~2.4 h at concurrency 4. The spec gives ~8.9 s per PDF fetch and a ~5.4 s floor per OData call. | verified (`scripts/nightly_ingest.sh:10`; `PHASE5-MCP-SPEC.md:77`, `:117`) |
| The spec measured no throttling at concurrency 1, 2, 4 or 8 over 45 requests, and the ingest uses 4. | verified (`PHASE5-MCP-SPEC.md:76`; `ingest_measures.py:105`) |
| The platform exposes no tool that returns a whole session's measure list in one call. `query_dataset` caps at 200 rows (`leg_tools.py:39`), and there is no bulk export endpoint. Its mirror is a public GitHub repo of markdown files under `measures/<session>/`. | verified (tool code); that the repo is public is **inferred** (gateway README:7 calls the gateway repo "Private"; the corpus repo's visibility was not checked) |
| Bill text on the platform is one embedded version per measure. A measure's other mirrored version is captured as a PDF snapshot but not embedded (`Also captured, not embedded: Introduced version` in HB 3795). | verified |
| Amendments, which the SessionGateway brief names, would have to come from OLIS whichever option is chosen. | inferred (from §3.3) |
| The budget corpus's appropriation extraction **reads the legislature mirror's files** (`extract_appropriations.py:4`, `--sibling ../oregon-legislature`). A SessionGateway-only session would not feed budget joins. | verified (code); the consequence is **inferred** |
| Bill text is not copyrighted ("Oregon bills are government edicts"). | verified (`PHASE5-MCP-SPEC.md:133-134`) |

---

## 5. Identifiers SessionGateway would need to emit to join the platform

| Thing | Platform id | Citation string the platform resolves | Notes |
|---|---|---|---|
| Measure | `measure-{session lower}-{prefix lower}{number}`, for example `measure-2025r1-hb3318` (`ingest_measures.py:240-241`) | `HB 3318 (2025R1)` (session-qualified, exact); `HB 3318` (bare, ambiguous across sessions) (`citations.py:45-59`) | No leading zeros: `int(num)` (`citations.py:33`). SessionGateway's spike normalises to `HB3318` with no session (`prototype/scaffold:src/document.ts:23-25`), which does not match either form. **verified** |
| Session | `SessionKey` as OLIS spells it: `2025R1`, `2025S1`, `2025I1` | lower-case inside ids | **verified** |
| ORS section | `ors-{chapter}.{section}`, lower-case letter suffix: `ors-409.711`, `ors-163a.040` | `ORS 409.711`, `ORS 163A.040` | Subsections do not resolve: `ORS 468.130(2)` → unresolved. Ranges such as "ORS 418.806 to 418.816" were not tested. **verified** |
| OAR rule | `oar-{chapter}-{division}-{rule}`: `oar-340-012-0130` | `OAR 340-012-0130` | Resolves in ERF and through 4 sibling corpora. **verified** |
| Agency | registry slug: `department-of-environmental-quality`, `department-of-human-services` (ERF `_meta/catalog/agencies.yml:909`) | `issuing_body_profile(slug_or_query=…)` accepts a slug or a name | 190 registry rows. Sub-units are separate slugs with `relations: part_of` (`agencies.yml:920-935`). **verified** |
| Agency, budget join key | `das_agency_number`, for example `'340'` (DEQ) or `'100'` (DHS); present on 84 of 190 rows | budget `dataset_key` `agency=340;fiscal_year=2024`; doc ids `expenditures-340-fy2025` | Hand-reviewed, not scraped (`agencies.yml` note). **verified** |
| Agency, OAR key | `oar_chapter`, for example `'340'` or `'407'` | — | The rule id's chapter prefix maps to this. **verified** |
| Budget join | `join-{session}-{measure}-agency-{das}` | `join_lookup(document_id="measure-…")` | **verified** |
| KPM report | ids such as `appr-deq-2025-09-30` | — | No fixed pattern across years: `deq-kpm-report`, `12-01-deq-kpm-report-final`. **verified** |
| Audit | `{year}-{nn}`, for example `2024-13` | `Report No. 2024-13` | **verified** |

**Edge shape the platform returns.**

- **`graph_neighbors`** returns `{relation: [{id, title, doc_type}, …]}`, keyed by relation name. Observed keys: `implemented_by`, `related`, `references_external`. Cross-corpus entries add `citation`, `external`, `corpus`, `url` and `resolved_via`. **verified** (ERF `ors-468.140`, KPM, audits `2020-02`)
- **`authority_chain`** returns `up_implements`, `up_cites` and `down_implemented_by`. Each down item carries `{id, title, doc_type, via}`, nested one list per depth level. **verified**
- **ERF graph relation types** (local file): `implements`, `implemented_by`, `related`, `references_external`, `supersedes`. Edges look like `{"from":…, "to":…, "type":…}`. **verified**

---

## 6. The gateway's interface and reachability

**Deployment.**

- **Endpoint:** `https://gateway.morficflux.com/mcp`, "Live … since 2026-08-03, on 192.168.86.2" (`corpus-gateway/README.md:116`).
- **Network path:** a Cloudflare tunnel (`cloudflared/gateway.yml`) to `http://gateway:8000`, with no host ports published (`docker-compose.yml`, header comment).
- **Per-corpus endpoints** remain at `https://oregonai.morficflux.com/<corpus-id>/mcp` (`platform-deploy/README.md:6-16`).
- All three facts **verified**.

**Reachable from outside claude.ai, without auth. verified**

- A plain `curl` POST of `initialize` to `https://gateway.morficflux.com/mcp` from this machine returned `HTTP/2 200`, `content-type: text/event-stream`, an `mcp-session-id` header and `"serverInfo":{"name":"oregonai-gateway"}`.
- `initialize` to `https://oregonai.morficflux.com/oregon-legislature/mcp` returned 200 with `"serverInfo":{"name":"oregon-legislature"}`.
- No `Authorization` header was sent. The repo states "no secrets here — the corpora are public and unauthenticated" (`corpus-gateway/.env.example:1-2`).
- The server is **session-stateful**: it issues `mcp-session-id`, and `tools/list` was sent with that header after `notifications/initialized` (202).
- Host-header checking uses `allowed_hosts=[…, args.public_hostname]` (`server.py:321` on `origin/main`).

**Deployed tools: 8. verified** (`tools/list` over HTTP)

```
list_corpora []
search ['query','corpus','limit','mode','doc_type','issuing_body']
get_document ['corpus','doc_id','part']
resolve_citation ['citation','corpus']
authority_chain ['corpus','doc_id','direction','depth']
graph_neighbors ['corpus','doc_id','direction','depth']
corpus_overview ['corpus']
call ['corpus','tool','arguments']
```

- `agency_profile(slug_or_name, limit)` is on `origin/main` (`server.py:242`; merged in PR #12) and documented in the README (`:176-256`), but the deployed server does not expose it. The live `initialize` instructions also omit the sentence about it that `main` has (`server.py:47`). The deployed gateway is therefore older than PR #12. **verified** (the difference); why deployment lags is unknown.

**`call` argument names are not discoverable through the gateway.** `list_corpora` lists tool names only. Guessing wrong produced pydantic validation errors, wrapped as `corpora_failed`. Argument names confirmed by trial or by reading the source:

| Tool | Arguments | Source |
|---|---|---|
| `documents_by_agency` | `slug`, `limit`, `offset` | trial |
| `issuing_body_profile` | `slug_or_query` | trial |
| `join_lookup` | `document_id` or `dataset_key` | `oregon-budget/src/budget_tools.py:124-125` |
| legislature `query_dataset` | `dataset`, `session`, `prefix`, `number`, `chamber`, `current_committee`, `limit` | `leg_tools.py:106-109` |

All **verified**.

**The `_gateway` block is on every response. verified** (every call above)

- Fields: `corpora_queried`, `corpora_answered`, `latency_ms` (per corpus), `complete`. On failure it adds `corpora_failed` (a map from corpus to reason) and `warning` (*"Absence of a result here is not evidence the material does not exist"*).
- A tool-level error inside a corpus, such as `no_graph` or a validation error, also sets `complete:false`.

**Latency observed this session.** **verified** (the `_gateway.latency_ms` values)

- Directed calls: 100–1,000 ms.
- Fan-out `resolve_citation` with no corpus: up to 11,073 ms for ERF (`OAR 340-012-0130`).
- Live OData `query_dataset`: 395–434 ms here, against a documented 5–15 s.

**Other interface facts.**

- **Search results carry no score.** Cross-corpus merge is reciprocal rank fusion, and hybrid search "ALWAYS returns nearest neighbours" (the `caveat` on every `search`). **verified**
- **Errors come back inside the result,** for example `{"error":"no document with id …"}`, not as MCP `isError` (`corpus-gateway/README.md:61-63`). Observed on `graph_neighbors(corpus="executive-regulatory-frameworks", doc_id="measure-2025r1-hb3318")`. **verified**
- **The `list_datasets` endpoint strings are missing a slash,** for example `"https://api.oregonlegislature.gov/odata/odataservice.svcMeasures"`. `odata.BASE` has no trailing slash (`odata.py:37`) and `leg_tools.py` concatenates `f"{odata.BASE}{d['entity']}"`. **verified**; cosmetic, but anyone copying the URL gets a broken one.
- **`join_lookup`'s not-found note says "150 of the 170 extracted appropriation documents"** (`budget_tools.py:140-151`), while the budget README says 740 extracted and 196 outside the mirror (`README.md:63-65`). **verified** that the two disagree; which is current was not established.

---

## 7. Corpora on the platform, and which matter for bill→agency impact

Freshness here is the live `commit` from `corpus_overview()`, which dates the mirrored documents. **verified**

| Corpus | Holds | Live commit | Relevant to bill→agency? |
|---|---|---|---|
| `executive-regulatory-frameworks` | 39,002 statutes; 42,897 rules; 526 EOs; 676 policies; 195,788 edges. ORS is the 2025 Edition (`ors-409.711` "2025 Edition", retrieved 2026-07-20). | `b99d23b91 2026-10-17` | **Yes, central.** ORS/OAR hub, statute→rule edges, agency registry. |
| `oregon-legislature` | 6,134 measure docs + 3 entity docs; 0 edges; live OData reachable | `944c2b55 2026-10-01`; mirror retrieved 2026-07-27/28 | **Yes.** Measure text and ORS candidates; direct overlap with SessionGateway. |
| `oregon-budget` | 1,758 dataset docs + 4 entity docs, all `summary` mode; 4,017 edges; live SODA `y9g9-xsxs` | `96751bb 2026-10-01` | **Yes.** Agency expenditures FY2019–FY2025 by DAS number; appropriation→agency joins. |
| `oregon-kpm` | 785 performance reports; 671 edges, all `related` (report→report) | `41c9e41 2026-10-02` | **Yes.** Agency outcomes, joined by slug only. |
| `oregon-audits` | 249 audit reports; 739 edges (`references_external` to ORS) | `288d945 2026-10-01` | **Yes.** Agency audits by slug, plus ORS citations. |
| `oregon-collective-bargaining` | 166 CBAs + 77 LOAs | `1a52886 2026-10-06` | Possibly, for workforce impact. Not traced. |
| `federal-reference` | 451 federal instruments | `ef218d4 2026-10-06` | Possibly, for federal constraints. Not traced. |
| `oregon-counties` | 3,078 ordinances + 258 policies, 27 of 36 counties | `8212819 2026-10-01` | Local, not state agencies. Not traced. |

Note that the `oregon-budget` overview's `authoritative_source` is `https://olis.oregonlegislature.gov/`. **verified**

---

## 8. Open questions

1. **Should the platform's measure→ORS candidates ever separate "amends" from "cites"?** The bill title line ("amending ORS 409.711 and 418.808") is in the text, but no parser reads it. Is that planned (spec "step 7"), or would it be SessionGateway's job?
2. **When will `oregon-legislature` re-ingest,** and will it add 2027R1 when the feed lists it? Nothing scheduled was found, and `citations.py:25` needs a code change for each new session.
3. **Why is the deployed gateway older than `main`?** `agency_profile` is merged but not served. Is a redeploy pending, and is there a URL or version endpoint SessionGateway could check?
4. **Is unauthenticated public access to `gateway.morficflux.com` a commitment** a hosted service can depend on, with no rate limit, auth or uptime promise? Or is it a convenience layer? The README calls it "a new single point of failure" (`README.md:260-262`).
5. **Is the `oregon-legislature` GitHub repo public,** making its `measures/` markdown a bulk source? Visibility was not checked.
6. **How much of the 755-rule "cites a bill, not an ORS section" population could be bridged?** Bill→session-law→ORS mapping (for example `2022 c.67` → HB 4117 (2022)) is not on the platform. Is there a source for Oregon Laws chapter numbers? OData `Measures.ChapterNumber` exists and is shown in `live_status`.
7. **Do ORS range citations resolve?** For example "ORS 418.806 to 418.816", and chapter-level forms such as "ORS chapter 468". Not tested.
8. **Are ERF `implements` edges built from `statutes_implemented` only, ignoring `legal_authority`?** Only one example was seen (`oar-461-194-0030`). `src/link_graph.py` would need reading to confirm.
9. **Which `join_lookup` coverage figures are current:** the tool's "150 of 170" or the README's "740 / 196"?
10. **Does any platform corpus hold OLIS `MeasureAnalysisDocument`** (fiscal and revenue impact statements, staff measure summaries)? None was found, and the mirror code excludes the fiscal fields on purpose.

---

## Sources

**MCP connector.** Every call is named inline above. The main ones:

- `list_corpora()`, `corpus_overview()`, `corpus_overview(corpus="oregon-legislature")`
- `search(…)` ×5, `get_document(…)` ×6
- `resolve_citation(…)` ×9, `authority_chain(…)` ×4, `graph_neighbors(…)` ×7
- `call(…)` for `list_datasets`, `query_dataset` ×2, `join_lookup` ×2, `documents_by_agency` ×4 and `issuing_body_profile`

**HTTP.**

- `POST https://gateway.morficflux.com/mcp`: `initialize`, `notifications/initialized`, `tools/list`
- `POST https://oregonai.morficflux.com/oregon-legislature/mcp`: `initialize`

**GitHub (read-only).**

- `gh api repos/OregonAI/oregon-legislature/commits`
- `…/commits?path=measures`
- `…/contents/DRIFT.md`
- `gh pr list -R OregonAI/corpus-gateway`

**Files** (local checkouts; behind-`origin` status noted in each section):

- `/home/dzinck/oregon-legislature/`: `src/{ingest_measures,citations,odata_backend,leg_tools,odata,build_measure_citations}.py`, `_meta/corpus.yml`, `measures/_index.md`, `scripts/nightly_ingest.sh`, `.github/workflows/scheduled.yml`
- `/home/dzinck/executive-regulatory-frameworks/`: `_meta/graph.json`, `_meta/agency-graph.json`, `_meta/catalog/agencies.yml`, `_meta/agency-profiles.yml`, `statutes/ors-409.711.md`, `rules/461/194/oar-461-194-0030.md`
- `/home/dzinck/oregon-budget/`: `README.md`, `src/budget_tools.py`, `src/extract_appropriations.py`
- `/home/dzinck/corpus-gateway/`: `README.md`, `src/server.py` (`origin/main`), `docker-compose.yml`, `cloudflared/gateway.yml`, `.env.example`
- `/home/dzinck/platform-deploy/README.md`
- `/home/dzinck/PHASE5-MCP-SPEC.md`
- `/home/dzinck/PLATFORM-REVIEW-2026-08-01.md`
- `/home/dzinck/SessionGateway` branch `prototype/scaffold` (`3be2380`): `src/document.ts`, `src/http.ts`
