# What the OLIS feed holds for a Measure's location, history and votes

Researched 2026-10-30 (Pacific), for ticket #15. Every count is over the 2025R1 feed cache (`.cache/olis-2025R1/feed/` in the main checkout, which the files' times say was pulled 2026-10-28 between 21:42 and 21:44 Pacific, one file per entity set), read with the script in "Commands" below. `docs/research/olis-odata.md` covers how the feed is served.

Labels used below:
- **local measurement**: I ran the command named in the Source column on the cache and read its output. The line numbers (for example "output 4") are the numbered lines the script prints.
- **inferred**: my reading of measured evidence, not stated by the source.

Tickets and ADRs that need one of these facts quote it from here and say which section.

## 1. Rows and JSON types

| Fact | Status | Source |
|---|---|---|
| The cache holds 3,466 Measures rows, 27,488 MeasureHistoryActions rows, 72,752 MeasureVotes rows and 21,959 CommitteeVotes rows. | local measurement | `measure.mjs`, output 1 |
| In those four sets every key and number property is a JSON number in every row: `MeasureNumber`, `LCNumber`, `MeasureHistoryId`, `MeasureVoteId`, `CommitteeVoteId`, `CommitteeReportId` and `CommitteeAgendaItemId`. No decimal key is sent as a string in these four sets. | local measurement | `measure.mjs`, output 3 |
| Every property name in those four sets is spelled as its meaning reads: `CommitteeVotes` has `CommitteeCode`, and `Measures` has `CurrentCommitteeCode`. | local measurement (the printed property names, read by eye) | `measure.mjs`, output 3 |
| The vote and the Legislator Code are in properties with other names: `VoteName` holds the Legislator Code in `MeasureVotes` and in `CommitteeVotes`, the vote is `Vote` in `MeasureVotes` and `Meaning` in `CommitteeVotes`. | local measurement | `measure.mjs`, output 3 |

## 2. The vote words

| Fact | Status | Source |
|---|---|---|
| Floor votes (`MeasureVotes.Vote`): Aye 56,651, Nay 7,984, Excused 6,519, Excused for Business 1,538, Absent 60. | local measurement | `measure.mjs`, output 2 |
| Committee votes (`CommitteeVotes.Meaning`): Aye 18,322, Nay 2,013, Excused 1,624. | local measurement | `measure.mjs`, output 2 |

## 3. Reports and agenda items

A `CommitteeReportId` groups the rows of one report, and a `CommitteeAgendaItemId` is the item on a committee's agenda that the report is about.

| Fact | Status | Source |
|---|---|---|
| All 2,156 reports name one committee, one meeting and one Measure in all their rows. | local measurement | `measure.mjs`, output 4 |
| The cache has 1,947 agenda items with votes. 1,738 have one report and 209 have two. None has more than two. | local measurement | `measure.mjs`, output 4 |
| In all 209 items with two reports, the two reports hold the same roll (the same Legislator Codes with the same votes), and every row of the item has one `CreatedDate`. None of the 209 has two different rolls. | local measurement | `measure.mjs`, output 4 |
| The 209 items belong to joint committees: 207 to "Joint Committee On" (JWM 191, JCT 14, JLAUD 1, JLCIMT 1) and 2 to conference committees (`HB3694` and `SB916`). `Committees.HouseOfAction` is `J` for all of them. 63 items of joint committees have one report. | local measurement | `measure.mjs`, output 4 |
| HB 2232, JCT, agenda item 204180, meeting 2025-02-18T17:00:00: reports 37557 and 37689, each with the same 12 Aye rows (7 Representatives and 5 Senators), all created 2025-02-10T15:02:49. Its history has one "Work Session held." (House, 2025-02-18T17:02:00), then "Recommendation: Do pass with amendments and be printed A-Engrossed." in the House on 2025-02-20 and "Recommendation: Do pass the A-Eng. bill." in the Senate on 2025-03-06. | local measurement | `measure.mjs`, output 8 |
| The two reports of a joint committee's item are one roll call that the feed gives once for each chamber the committee reports to. The feed does not say why there are two. | inferred, from the 209 identical rolls and the HB 2232 history | outputs 4 and 8 |

## 4. Committee rows exist before the meeting

| Fact | Status | Source |
|---|---|---|
| All 21,959 CommitteeVotes rows have a `CreatedDate` earlier than their `MeetingDate`. 21,907 of the 21,959 also have a `ModifiedDate` earlier than their `MeetingDate`. | local measurement | `measure.mjs`, output 5 |
| SB 69's SLB roll (report 37391, meeting 2025-01-30T08:00:00) was created 2025-01-23T07:44:41 and last modified 2025-01-29T09:14:12, and it lists "Sen Woods" as Excused. | local measurement | the rows with `CommitteeVoteId` 324937 to 324941 in `test/fixtures/olis-2025R1/feed/CommitteeVotes.json` |
| The rows say who is down as Aye, Nay or Excused before the meeting. The feed does not say whether a vote was taken. | inferred, from the creation times | output 5 |

## 5. Order of the rows within a vote

| Fact | Status | Source |
|---|---|---|
| In the cache files, the rows of each of the 1,613 floor votes (rows sharing a `MeasureHistoryId`) are in `MeasureVoteId` order, and the rows of each of the 2,156 committee reports are in `CommitteeVoteId` order. | local measurement | `measure.mjs`, output 6 |

## 6. Location and committee code

| Fact | Status | Source |
|---|---|---|
| `CurrentLocation` and whether `CurrentCommitteeCode` is null, over the 3,466 Measures: In House Committee with a code 1,724; In Senate Committee with a code 1,021; Chapter Number Assigned, no code 633; Filed with Secretary of State, no code 62; At Presidents Desk Upon Adjournment, **with a code** 8; At House Desk Upon Adjournment, no code 4; House - Tabled 3, Senate - Tabled 2, At Senate Desk Upon Adjournment 2, all no code; In House Committee Awaiting transfer to Desk, with a code 2; In Senate Committee Awaiting transfer to Desk, with a code 1; **In House Committee, no code 1**; House Desk - Failed 1, House Desk - Vetoed 1, Senate Presidents Desk - Awaiting Referral 1, all no code. | local measurement | `measure.mjs`, output 7 |
| The 8 Measures at the President's desk with a code are SB 310 (SED), SB 533 (SHC), SB 1024 (JCT), SB 1060 (SRULES), SB 1153 (SRULES), SB 1196 (SFR), HB 2282 (SLB) and HB 2322 (JWM). The last history line of each is "At President's desk upon adjournment.". The one In House Committee Measure with no code is HB 3029, whose last history line is "In committee upon adjournment.". | local measurement | `measure.mjs`, output 7 |
| `CurrentCommitteeCode` is therefore not a statement that the Measure is in that committee. The feed does not say what the field means once the Measure has left committee. | inferred, from the rows above | output 7 |

## 7. A database from before ticket #15

| Fact | Status | Source |
|---|---|---|
| The tables are made with `CREATE TABLE IF NOT EXISTS`. A database file made by the version before ticket #15 (its `measure` table has no `location` column), given to the current writer, makes the full pull fail with "table measure has no column named location". | local measurement | `old-schema.mjs` below |

## Commands

Both scripts were run with Node 26 from outside the repository. `measure.mjs` takes the cache's `feed` directory:

```
node measure.mjs ~/SessionGateway/.cache/olis-2025R1/feed
```

```js
// Counts over the 2025R1 feed cache (.cache/olis-2025R1/feed/, pulled 2026-10-28) for docs/research/olis-votes.md.
// Run: node measure.mjs <feed directory>
import { readFileSync } from "node:fs";

const dir = process.argv[2];
const load = (set) => JSON.parse(readFileSync(`${dir}/${set}.json`, "utf8"));
const tally = (rows, of) => {
  const counts = {};
  for (const row of rows) counts[of(row)] = (counts[of(row)] ?? 0) + 1;
  return counts;
};
const measures = load("Measures");
const history = load("MeasureHistoryActions");
const floor = load("MeasureVotes");
const committee = load("CommitteeVotes");

console.log("1. rows", { Measures: measures.length, MeasureHistoryActions: history.length, MeasureVotes: floor.length, CommitteeVotes: committee.length });
console.log("2. vote words, floor (Vote)", tally(floor, (r) => r.Vote));
console.log("2. vote words, committee (Meaning)", tally(committee, (r) => r.Meaning));

for (const [name, rows] of [["Measures", measures], ["MeasureHistoryActions", history], ["MeasureVotes", floor], ["CommitteeVotes", committee]]) {
  const types = {};
  for (const row of rows) for (const [property, value] of Object.entries(row)) {
    const type = value === null ? "null" : typeof value;
    ((types[property] ??= {})[type] = (types[property][type] ?? 0) + 1);
  }
  console.log(`3. JSON types of ${name}`, JSON.stringify(types));
}

// Reports of one agenda item.
const items = new Map();
for (const row of committee) {
  const reports = items.get(row.CommitteeAgendaItemId) ?? new Map();
  const rows = reports.get(row.CommitteeReportId) ?? [];
  rows.push(row);
  reports.set(row.CommitteeReportId, rows);
  items.set(row.CommitteeAgendaItemId, reports);
}
const rollOf = (rows) => rows.map((r) => `${r.VoteName}:${r.Meaning}`).sort().join(",");
let sameRolls = 0, differentRolls = 0, oneCreatedDate = 0;
const reportsPerItem = {}, committeesOfMulti = {};
for (const reports of items.values()) {
  reportsPerItem[reports.size] = (reportsPerItem[reports.size] ?? 0) + 1;
  if (reports.size < 2) continue;
  const all = [...reports.values()];
  if (new Set(all.map(rollOf)).size === 1) sameRolls++; else differentRolls++;
  if (new Set(all.flat().map((r) => r.CreatedDate)).size === 1) oneCreatedDate++;
  const code = all[0][0].CommitteeCode;
  committeesOfMulti[code] = (committeesOfMulti[code] ?? 0) + 1;
}
console.log("4. agenda items with votes", items.size, "reports per item", reportsPerItem, "items with 2+ reports: same roll", sameRolls, "different rolls", differentRolls, "one CreatedDate", oneCreatedDate);
console.log("4. committee of the items with 2+ reports", committeesOfMulti);
const reportRows = new Map();
for (const row of committee) reportRows.set(row.CommitteeReportId, [...(reportRows.get(row.CommitteeReportId) ?? []), row]);
console.log("4. reports", reportRows.size, "reports whose rows name one committee, meeting and Measure", [...reportRows.values()].filter((rows) => new Set(rows.map((r) => `${r.CommitteeCode}|${r.MeetingDate}|${r.MeasurePrefix}${r.MeasureNumber}`)).size === 1).length);

// Rows made before the meeting.
console.log("5. CommitteeVotes rows with CreatedDate before MeetingDate", committee.filter((r) => r.CreatedDate < r.MeetingDate).length, "ModifiedDate before MeetingDate", committee.filter((r) => r.ModifiedDate < r.MeetingDate).length, "of", committee.length);

// Order of the rows within a vote against the order of their ids.
const floorGroups = new Map();
for (const row of floor) floorGroups.set(row.MeasureHistoryId, [...(floorGroups.get(row.MeasureHistoryId) ?? []), row]);
const outOfOrder = (groups, id) => [...groups.values()].filter((rows) => rows.some((r, i) => i > 0 && r[id] < rows[i - 1][id])).length;
console.log("6. floor votes (by MeasureHistoryId)", floorGroups.size, "whose rows are not in MeasureVoteId order", outOfOrder(floorGroups, "MeasureVoteId"), "; reports", reportRows.size, "whose rows are not in CommitteeVoteId order", outOfOrder(reportRows, "CommitteeVoteId"));

// Location and committee code of Measures.
console.log("7. CurrentLocation | CurrentCommitteeCode is null?", tally(measures, (m) => `${m.CurrentLocation} | ${m.CurrentCommitteeCode === null ? "null" : "a code"}`));
for (const m of measures.filter((m) => m.CurrentLocation === "At Presidents Desk Upon Adjournment" || (m.CurrentLocation === "In House Committee" && m.CurrentCommitteeCode === null))) {
  const last = history.filter((h) => h.MeasurePrefix === m.MeasurePrefix && h.MeasureNumber === m.MeasureNumber).sort((a, b) => (a.ActionDate < b.ActionDate ? -1 : 1)).at(-1);
  console.log("7.", m.MeasurePrefix + m.MeasureNumber, "|", m.CurrentLocation, "|", m.CurrentCommitteeCode, "| last history line:", last?.ActionText);
}

// Which committees the items with 2+ reports belong to (Committees.json, HouseOfAction "J" is joint).
const committees = load("Committees");
const houseOf = new Map(committees.map((c) => [c.CommitteeCode, `${c.HouseOfAction} (${c.CommitteeType.trim()})`]));
const multiHouses = {}, singleJoint = { joint: 0, other: 0 };
for (const reports of items.values()) {
  const code = [...reports.values()][0][0].CommitteeCode;
  if (reports.size > 1) multiHouses[houseOf.get(code)] = (multiHouses[houseOf.get(code)] ?? 0) + 1;
  else if (houseOf.get(code)?.startsWith("J")) singleJoint.joint++; else singleJoint.other++;
}
console.log("4. HouseOfAction of the committee, items with 2+ reports", multiHouses, "; items with one report, by joint or not", singleJoint);

// HB 2232: an item with two reports.
const item = items.get(204180);
console.log("8. HB 2232 item 204180: reports", [...item.keys()], "rows per report", [...item.values()].map((rows) => rows.length), "CreatedDate", [...new Set([...item.values()].flat().map((r) => r.CreatedDate))], "roll", rollOf([...item.values()][0]));
for (const h of history.filter((h) => h.MeasurePrefix === "HB" && h.MeasureNumber === 2232).sort((a, b) => (a.ActionDate < b.ActionDate ? -1 : 1))) console.log("8.  ", h.Chamber, h.ActionDate, h.ActionText);
```

`old-schema.mjs` takes the repository path and the previous version's `src/packages/database/lib/connection.ts` (`git show 2b86f8f:src/packages/database/lib/connection.ts`, the head of ticket #8):

```
node old-schema.mjs <repository> <that file>
```

```js
// A database file made by the version before ticket #15, then the current writer's full pull against it.
import { readFileSync, mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
const repo = process.argv[2];
const source = readFileSync(process.argv[3], "utf8");
const schema = source.slice(source.indexOf("const schema = `") + "const schema = `".length, source.indexOf("`;", source.indexOf("const schema = `")));
const path = join(mkdtempSync("/tmp/sg-old-schema-"), "old.sqlite");
const old = new DatabaseSync(path);
old.exec(schema);
old.close();
const { openIndexWriter } = await import(`${repo}/src/packages/database/writer.ts`);
const writer = openIndexWriter(path);
try {
  writer.recordFullPull("2025R1", "2026-10-30T00:00:00-07:00", { measures: [], history: [], legislators: [], sponsors: [], floorVotes: [], committeeVotes: [] });
  console.log("pull succeeded");
} catch (error) {
  console.log("pull failed:", error.message);
} finally {
  writer.close();
}
```
