# What the live lookup of one Measure reads from the OLIS feed

Researched 2026-10-30 (Pacific), for ticket #21. Every count is over the 2025R1 feed cache (`.cache/olis-2025R1/feed/` in the main checkout, pulled 2026-10-28), read with the script in "Commands" below. `docs/research/olis-odata.md` covers how the feed is served and `docs/research/olis-votes.md` the vote, history and location rows.

Labels used below:
- **local measurement**: I ran the command named in the Source column on the cache and read its output. The line numbers (for example "output 2") are the numbered lines the script prints.
- **inferred**: my reading of measured evidence, not stated by the source.
- **not verified**: a fact about live OLIS that nothing run for this ticket could check, because the tests reach only the fake OLIS and no query was sent to the feed.

## 1. How many rows one Measure has

The live lookup asks for one Measure's rows in each of five entity sets, narrowed by `SessionKey`, `MeasurePrefix` and `MeasureNumber`. A set sends at most 5,000 rows a page (`olis-odata.md` section 1).

| Fact | Status | Source |
|---|---|---|
| The most rows any one Measure has in each set: Measures 1, MeasureHistoryActions 42 (SB 5525), MeasureVotes 447 (SB 83), CommitteeVotes 65 (HB 3506), CommitteeAgendaItems 24 (HB 5025). | local measurement | `live.mjs`, output 1 |
| So a read narrowed to one Measure is one page in every set, and the first page's `odata.count` ($inlinecount) is the count of all its rows. | inferred, from the maxima above and the 5,000-row page | output 1 |

## 2. Agenda items

| Fact | Status | Source |
|---|---|---|
| The cache has 9,275 CommitteeAgendaItems rows, 3,598 of them with no Measure (`MeasurePrefix` and `MeasureNumber` null: organizational meetings, appointments), and 5,677 with one. | local measurement | `live.mjs`, output 2 |
| In the 5,677 rows that have a Measure, `MeetingType`, `CommitteCode` and `MeasureNumber` are never null and `MeasureNumber` is always a number. | local measurement | `live.mjs`, output 2 |
| `MeetingType` of those rows is one of six words: Work Session 2,850, Public Hearing 2,343, Informational Meeting 222, Public Hearing and Work Session 184, Public Hearing and Possible Work Session 43, Possible Work Session 35. | local measurement | `live.mjs`, output 2 |
| The committee's code is in a property spelled `CommitteCode`: the feed drops one `e` of `CommitteeCode`, which is how CommitteeVotes and CommitteeMeetings spell it. | local measurement (the printed property names, read by eye) | `live.mjs`, output 2 |
| `PrintOrder` is a JSON string in all 9,275 rows ("6"); `CommitteeAgendaItemId` is a number and `MeetingDate` a string with no offset. | local measurement | `live.mjs`, output 2 |
| No `MeetingDate` of a row with a Measure has a fractional second or a second other than 00. | local measurement | `live.mjs`, output 2 |

## 3. What no test could check

| Fact | Status | Source |
|---|---|---|
| Live OLIS accepts `$filter=SessionKey eq '2025R1' and MeasurePrefix eq 'SB' and MeasureNumber eq 69` with `$inlinecount=allpages` on each of the five sets. `olis-odata.md` section 1 verified `eq`, `and`, `ge` and `datetime'...'` in `$filter`, and `$inlinecount=allpages`, on other queries. | not verified for these five | no feed query was sent |
| Live OLIS accepts `MeetingDate ge datetime'2025-01-29T09:00:00'` on CommitteeAgendaItems, and reads the wall-clock reading as Pacific local time. `olis-odata.md` section 6 verified `datetime'...'` filters on `ModifiedDate` and `CreatedDate`, and infers that the feed's times are Pacific local time. | not verified for `MeetingDate` | no feed query was sent |
| The client builds the query with `URLSearchParams`, which writes a space as `+` (`$filter=SessionKey+eq+'2025R1'`). That is how the full pull has always sent its filter; live OLIS's reading of `+` as a space is not among the facts verified. | not verified | `olis-client/lib/feed.ts` |

The by-hand contract test against live OLIS (`test/CLAUDE.md`, "Hermetic") is the check for all three.

## Commands

The script was run with Node 26 from outside the repository:

```
node live.mjs ~/SessionGateway/.cache/olis-2025R1/feed
```

```js
// Counts over the 2025R1 feed cache for docs/research/olis-live.md. Run: node live.mjs <feed directory>
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const load = (set) => JSON.parse(readFileSync(`${dir}/${set}.json`, "utf8"));
const most = (rows) => {
  const counts = new Map();
  for (const r of rows) {
    if (r.MeasurePrefix === null || r.MeasurePrefix === undefined) continue;
    const key = `${r.SessionKey} ${r.MeasurePrefix} ${r.MeasureNumber}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { measures: counts.size, most: top };
};
for (const set of ["Measures", "MeasureHistoryActions", "MeasureVotes", "CommitteeVotes", "CommitteeAgendaItems"]) {
  const rows = load(set);
  console.log("1.", set, "rows", rows.length, JSON.stringify(most(rows)));
}
const items = load("CommitteeAgendaItems");
const tally = (rows, of) => { const c = {}; for (const r of rows) { const k = of(r); c[k] = (c[k] ?? 0) + 1; } return c; };
console.log("2. agenda items", items.length, "with no Measure", items.filter((r) => r.MeasurePrefix === null).length);
const forMeasures = items.filter((r) => r.MeasurePrefix !== null);
console.log("2. of the", forMeasures.length, "with a Measure: MeetingType null", forMeasures.filter((r) => r.MeetingType === null).length, "CommitteCode null", forMeasures.filter((r) => r.CommitteCode === null).length, "MeasureNumber not a number", forMeasures.filter((r) => typeof r.MeasureNumber !== "number").length);
console.log("2. JSON types of PrintOrder", tally(items, (r) => typeof r.PrintOrder), "of CommitteeAgendaItemId", tally(items, (r) => typeof r.CommitteeAgendaItemId), "of MeetingDate", tally(items, (r) => typeof r.MeetingDate));
console.log("2. MeetingType of items with a Measure", tally(forMeasures, (r) => r.MeetingType));
console.log("2. property names", Object.keys(items[0]).join(","));
console.log("2. items with a Measure whose MeetingDate has a fractional second", forMeasures.filter((r) => /\.\d/.test(r.MeetingDate)).length, "; whose seconds are not :00", forMeasures.filter((r) => !/:00(\.\d+)?$/.test(r.MeetingDate)).length);
```
