# An analysis document is placed on the Version its label names, and a label that names none is listed as unmapped, never guessed

The feed's `MeasureAnalysisDocuments.Version` is a label, not a Version: it holds nine values in 2025R1, and OLIS does not define them. `get_document` lists the Version an analysis document is of (ADR-0011) and `get_measure` groups a Measure's analysis documents by Version, so one function reads the label for both: `placeAnalysis` in `domain/analysis.ts`. The worker calls it to write the `version` edge, and `get_measure` calls it over the stored edges to group the documents, so the two tools cannot disagree.

The rule reads only what the label says. `INTRO` is Introduced, and a single capital letter is that letter's Engrossed Version (`A` is A-Engrossed), when the feed lists that Version for the Measure (`MeasureDocuments`). Every other label, and a letter whose Version the Measure lacks, places the document on no Version. It is still listed, in `analysis_documents.unmapped`, with the feed's label as written and a reason that says what the feed leaves unsaid. Nothing is dropped and nothing is guessed: an agent that reads a Fiscal Impact Statement under the wrong Version tells a director the wrong cost.

All nine labels of the full 2025R1 cache (`.cache/olis-2025R1/feed/MeasureAnalysisDocuments.json`, 5,260 rows, read on 2026-10-30 against its `MeasureDocuments.json`):

| Label | Rows | Read as | Evidence |
|---|---|---|---|
| `INTRO` | 1,197 (562 Fiscal, 635 Revenue) | Introduced | All 1,197 are on Measures that list an Introduced Version. |
| `A` | 2,839 | A-Engrossed | 2,824 are on Measures that list one. 15 are not, and are listed unmapped: row 89211, HB 2057's Revenue Impact Statement, "A", on a Measure whose Versions are `Introduced` alone (so are 89212, 90733 to 90735, 92978, 92979, 93362, 93410, 93411, 93564, 93898), and 88167, 92788 and 93182, whose Measures list `Enrolled` and `Introduced` but no A-Engrossed. |
| `B` | 441 | B-Engrossed | 432 are on Measures that list one; 9 are not (92164, 92336, 93116, 93120, 93374, 93832, 93847, 93900, 95625), for example 92336, HB 3336's Revenue Impact Statement, on a Measure with `A-Engrossed`, `Enrolled`, `Introduced` and `Senate Amendments to Introduced`. |
| `C` | 42 | C-Engrossed | 41 are on Measures that list one; 93870, HB 2528's Staff Measure Summary, is not (its Measure lists A-Engrossed and B-Engrossed). |
| `B*` | 7 | Not mapped | Rows 92919, 92920 (HB 3694), 93054, 93057, 93058 (SB 916), 93766 and 93778 (HB 2614), created 2025-06-09 to 2025-06-25. The feed does not say what `*` adds. All three Measures list both `B-Engrossed` and `Conference Committee Amendments to B-Engrossed`, which suggests the statements follow the conference committee's change, and a suggestion is not a mapping. |
| `MRA` | 20 (10 Fiscal, 10 Revenue) | Not mapped | A minority-report label. 16 of the 20 are on Measures that list `Minority Report A-Engrossed`; 4 are not (90731, 90732 on HB 2200 and 92953, 93117 on SB 1153, whose only Version is `Introduced`). The feed does not say which text the statement is of. |
| `MRB` | 22 (11, 11) | Not mapped | 14 of the 22 are on Measures that list `Minority Report to B-Engrossed`; 8 are not (for example 93230 and 93321 on SB 1060, whose Versions are `A-Engrossed`, `Introduced` and a Printed Amendment). |
| `MRC` | 4 (2, 2) | Not mapped | Rows 93266, 93357 (HB 3865) and 93662, 93762 (HB 2528). No Measure of the Session lists a `Minority Report ... C-Engrossed` Version: the Session has `Minority Report A-Engrossed` on 8 Measures and `Minority Report to B-Engrossed` on 7. |
| `""` | 688 (686 Staff Measure Summary, 2 Budget Report) | Not mapped | On 464 Measures. The two Budget Reports are 93004 and 93279, HB 5040's, whose Versions are `Introduced` and `Enrolled`. The feed gives no Version for them. |

`IsMinority` is a separate property: its 18 `true` rows carry `A` (8), `B` (9) and `C` (1), so it does not explain `MR*`.

## Considered Options

- **Read `B*` as B-Engrossed, and `MRA` as the minority-report Version when the Measure lists one.** This would place 7 more rows, and 16 and 14 more where the Measure has the Version. It is a reading of codes the feed does not define, and it already fails for 4 of 20 `MRA` rows, for 8 of 22 `MRB` rows and for all of `MRC`. The labels stay unmapped until OLIS says what they mean; a mapping then adds a line to `placeAnalysis` and a row to its test.
- **Place a blank-label document by its dates or its committee.** A Staff Measure Summary posted between two Versions is not of either by that fact.
- **List only the placed documents.** The ticket asks that an unplaceable document be listed, and an agent that reads "no revenue impact statement" where there is one with an unreadable label is misled.
- **Store the placement and have `get_measure` read it back.** The `version` edge the worker writes is already the stored placement of a document that has one: the worker wrote it only to a Version the feed lists for the Measure. So `get_measure` runs the same function over that edge, which stands for "the feed lists this Version" for the one Version the document is on and for no other, and the stored label is the only new column. The edge is not the Measure's list of Versions.

## Consequences

- `get_measure` lists a document only when the worker holds its file, so that every `id` it shows resolves in `get_document`. A document the feed lists and the worker could not fetch is in `build-report.json` (ADR-0011) and is missing from `get_measure` until the next pull fetches it.
- A group's `version_id` is the id of a Version the feed lists. If the worker could not fetch that Version's file, `get_document` does not resolve it, as with the `version` edges ADR-0011 already writes.
- The worker stores the feed's label beside each analysis document and refreshes it at every pull, so a label OLIS changes moves the document without fetching it again. A database built before this ADR has no such column and is rebuilt (no deployment holds one yet).
