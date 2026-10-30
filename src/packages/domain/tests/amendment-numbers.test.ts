import { describe, expect, test } from "vitest";
import { amendmentIdOf, parseAmendmentNumber, versionDescriptionOfLetter } from "../documents.ts";
import { parseSessionKey } from "../index.ts";

// Seam 2 (test/CLAUDE.md): a parser table. The text in is the amendment number as the feed spells it, and what
// comes out is the number and the Version it names (ticket #13, ADR-0015). Legislative Counsel numbers an amendment
// to the Introduced Version with digits alone and an amendment to an engrossed Version with that Version's letter
// before them, and the feed spells the same number more than one way: "-1", "1", "- 1". Each row is a real spelling
// from the 2025R1 feed (CommitteeProposedAmendments.json, read-only in ~/SessionGateway/.cache/olis-2025R1/feed/),
// named by the row's ProposedAmendmentId and Measure. Nothing in the committed fixture has the unusual ones. The OLIS
// client trims a spelling ("-1 " is "-1"), so no row has a space round it.
// Expected values are literals: the meaning of the number as the brief and Legislative Counsel's numbering give it,
// and the amendment id in spec #1's form (module 8: `amendment-2025r1-sb69-2`).

const session = parseSessionKey("2025R1");
if (session === undefined) throw new Error("2025R1 is a Session key");

type Row = {
  name: string;
  /** The feed row the spelling is from. */
  source: string;
  spelling: string;
  measure: { prefix: string; number: number };
  /** The letter and digits it reads as, or undefined when it is not a number with an optional Version letter. */
  number: { letter: string | null; digits: string } | undefined;
  /** The Version it names, in the words the feed describes Versions in, or undefined when it names none. */
  version: string | undefined;
  /** The id of the amendment node the spelling is of. */
  id: string;
};

const rows: Row[] = [
  {
    name: "-2: digits alone, with the hyphen, name Introduced",
    source: "CommitteeProposedAmendments 26286 (SB 69)",
    spelling: "-2",
    measure: { prefix: "SB", number: 69 },
    number: { letter: null, digits: "2" },
    version: "Introduced",
    id: "amendment-2025r1-sb69-2",
  },
  {
    name: "-A3: a letter and digits name that engrossed Version",
    source: "CommitteeProposedAmendments 28997 (HB 3795)",
    spelling: "-A3",
    measure: { prefix: "HB", number: 3795 },
    number: { letter: "A", digits: "3" },
    version: "A-Engrossed",
    id: "amendment-2025r1-hb3795-a3",
  },
  {
    name: "1: digits with no hyphen name Introduced, and are the same amendment as -1",
    source: "CommitteeProposedAmendments 27679 (HB 2344; the same Measure's 27883 spells it -1)",
    spelling: "1",
    measure: { prefix: "HB", number: 2344 },
    number: { letter: null, digits: "1" },
    version: "Introduced",
    id: "amendment-2025r1-hb2344-1",
  },
  {
    name: "2: digits with no hyphen name Introduced, and are the same amendment as -2",
    source: "CommitteeProposedAmendments 27680 (HB 2344; the same Measure's 27884 spells it -2)",
    spelling: "2",
    measure: { prefix: "HB", number: 2344 },
    number: { letter: null, digits: "2" },
    version: "Introduced",
    id: "amendment-2025r1-hb2344-2",
  },
  {
    name: "-1 (the same amendment): the hyphenated spelling of HB 2344's first",
    source: "CommitteeProposedAmendments 27883 (HB 2344)",
    spelling: "-1",
    measure: { prefix: "HB", number: 2344 },
    number: { letter: null, digits: "1" },
    version: "Introduced",
    id: "amendment-2025r1-hb2344-1",
  },
  {
    name: "- 3: a space after the hyphen is the same number as -3",
    source: "CommitteeProposedAmendments 26731 (HB 3051)",
    spelling: "- 3",
    measure: { prefix: "HB", number: 3051 },
    number: { letter: null, digits: "3" },
    version: "Introduced",
    id: "amendment-2025r1-hb3051-3",
  },
  {
    name: "- 1: a space after the hyphen again, on another Measure",
    source: "CommitteeProposedAmendments 28717 (SB 5545)",
    spelling: "- 1",
    measure: { prefix: "SB", number: 5545 },
    number: { letter: null, digits: "1" },
    version: "Introduced",
    id: "amendment-2025r1-sb5545-1",
  },
  {
    name: "A6: a letter and digits with no hyphen name the engrossed Version, and are the same amendment as -A6",
    source: "CommitteeProposedAmendments 29245 (SB 702; the same Measure's 29484 spells it -A6)",
    spelling: "A6",
    measure: { prefix: "SB", number: 702 },
    number: { letter: "A", digits: "6" },
    version: "A-Engrossed",
    id: "amendment-2025r1-sb702-a6",
  },
  {
    name: "A7: the same spelling on a House bill",
    source: "CommitteeProposedAmendments 28777 (HB 3940)",
    spelling: "A7",
    measure: { prefix: "HB", number: 3940 },
    number: { letter: "A", digits: "7" },
    version: "A-Engrossed",
    id: "amendment-2025r1-hb3940-a7",
  },
  {
    name: "A9: and its neighbour",
    source: "CommitteeProposedAmendments 28789 (HB 3940)",
    spelling: "A9",
    measure: { prefix: "HB", number: 3940 },
    number: { letter: "A", digits: "9" },
    version: "A-Engrossed",
    id: "amendment-2025r1-hb3940-a9",
  },
  {
    name: "-B22: two digits after a B name B-Engrossed",
    source: "CommitteeProposedAmendments 29668 (SB 243)",
    spelling: "-B22",
    measure: { prefix: "SB", number: 243 },
    number: { letter: "B", digits: "22" },
    version: "B-Engrossed",
    id: "amendment-2025r1-sb243-b22",
  },
  {
    name: "-C24: a C names C-Engrossed",
    source: "CommitteeProposedAmendments 29741 (SB 243)",
    spelling: "-C24",
    measure: { prefix: "SB", number: 243 },
    number: { letter: "C", digits: "24" },
    version: "C-Engrossed",
    id: "amendment-2025r1-sb243-c24",
  },
  {
    name: "-AMR10: more than one letter is not a Version letter, so it names no Version",
    source: "CommitteeProposedAmendments 29083 (HB 3789)",
    spelling: "-AMR10",
    measure: { prefix: "HB", number: 3789 },
    number: undefined,
    version: undefined,
    id: "amendment-2025r1-hb3789-amr10",
  },
  {
    name: "-MR2: two letters again (a minority report's amendment), so it names no Version",
    source: "CommitteeProposedAmendments 27003 (SB 1098)",
    spelling: "-MR2",
    measure: { prefix: "SB", number: 1098 },
    number: undefined,
    version: undefined,
    id: "amendment-2025r1-sb1098-mr2",
  },
  {
    name: "-BMR7: three letters, so it names no Version",
    source: "CommitteeProposedAmendments 29679 (HB 3865)",
    spelling: "-BMR7",
    measure: { prefix: "HB", number: 3865 },
    number: undefined,
    version: undefined,
    id: "amendment-2025r1-hb3865-bmr7",
  },
];

describe("an amendment number, as the feed spells it", () => {
  test.for(rows)("$name ($source)", ({ spelling, measure, number, version, id }) => {
    expect(parseAmendmentNumber(spelling)).toEqual(number);
    expect(number === undefined ? undefined : versionDescriptionOfLetter(number.letter)).toBe(version);
    expect(amendmentIdOf({ session, ...measure }, spelling)).toBe(id);
  });
});
