// Seam 1 (test/CLAUDE.md): what a Pull asks OLIS for, entity set by entity set, read from the fake OLIS's request log
// (ticket #100, ADR-0005, ADR-0039, ADR-0042, ADR-0045, ADR-0050). A Full pull reads every set whole. An Increment reads
// Legislators and Committees whole (they are small and carry the names the rest resolve against), ConveneTimes and
// LegislativeSessions not at all (ADR-0042 leaves them to the Full pull), FloorLetters above the highest FloorLetterId the
// Index holds (they carry no dates, ADR-0045), and every other set only for the rows OLIS created or modified since the
// last run, less two hours. The cases assert the `$filter` of every request to each set, so a set that is read the wrong
// way, or read at all when it should not be, fails by name.
//
// The five sets that link documents are read in one call of the client, in one mode. If the register's entries for them
// ever differ, the Increment throws (`documentSetsReadOf`, ingest/lib/pull-register.ts), and every case below that runs an
// Increment fails with that error; the last one is the case that names the rule.
//
// Databases. The Full pull's cases are the pull of one system built for the file (the pull is the subject, so it is not a
// copy of a template). The Increment's cases copy the template of the fixture's pull at 14:00 Pacific on 2025-01-17
// (test/CLAUDE.md, Templates) and run an increment at 18:00, whose requests are the subject: the copy's fake has received
// none before `forgetRequests`. The fake serves a set the fixture holds no file for empty (FloorLetters, ConveneTimes,
// LegislativeSessions), so those sets are asked all the same. The one MADE UP row is a Floor Letter, FloorLetterId 900001,
// there at the pull (test/support/floor-letters.ts). The embedder is the fake: nothing here is about how well a meaning
// ranks, and the fixture's documents are off.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { withFloorLetters, type MadeUpFloorLetter } from "../support/floor-letters.ts";
import { startCopiedSystem, startSystem, type System } from "../support/system.ts";

const started: System[] = [];

afterAll(async () => {
  for (const system of started.splice(0)) await system.stop();
});

// 2025-01-17 14:00 in Oregon (UTC-8), when the pull ran, and 18:00, when the increment did. An increment reads rows changed
// after the last run began less two hours: 12:00.
const pulledAt = "2025-01-17T22:00:00Z";
const incrementAt = "2025-01-18T02:00:00Z";

// MADE UP: a letter the pull held, whose id the increment reads above.
const held: MadeUpFloorLetter = {
  floorLetterId: 900001,
  measure: null,
  letterDate: "2025-01-10T00:00:00",
  chamber: "S",
  title: "Made-up letter",
  description: "Made-up letter",
  lines: ["A made-up floor letter."],
};

const whole = "SessionKey eq '2025R1'";
const changedSince =
  "SessionKey eq '2025R1' and (CreatedDate gt datetime'2025-01-17T12:00:00' or ModifiedDate gt datetime'2025-01-17T12:00:00')";
const aboveHeld = "SessionKey eq '2025R1' and FloorLetterId gt 900001";

/** The distinct `$filter`s of the requests the fake received for one entity set, `/$count` and pages alike, in first-seen order. */
function filtersAsked(system: System, entitySet: string): (string | null)[] {
  return [
    ...new Set(
      system.olis
        .requests()
        .filter((request) => request.entitySet === entitySet)
        .map((request) => request.filter),
    ),
  ];
}

/** The 18 entity sets of a Pull, by the feed's own names, and what an Increment asks for. `[]` is a set it never asks for. A Full pull asks for every set whole. */
const sets: readonly { entitySet: string; increment: string[] }[] = [
  { entitySet: "Measures", increment: [changedSince] },
  { entitySet: "Legislators", increment: [whole] },
  { entitySet: "MeasureSponsors", increment: [changedSince] },
  { entitySet: "MeasureHistoryActions", increment: [changedSince] },
  { entitySet: "MeasureVotes", increment: [changedSince] },
  { entitySet: "CommitteeVotes", increment: [changedSince] },
  { entitySet: "Committees", increment: [whole] },
  { entitySet: "CommitteeMeetings", increment: [changedSince] },
  { entitySet: "CommitteeAgendaItems", increment: [changedSince] },
  { entitySet: "CommitteeMembers", increment: [changedSince] },
  { entitySet: "MeasureDocuments", increment: [changedSince] },
  { entitySet: "MeasureAnalysisDocuments", increment: [changedSince] },
  { entitySet: "CommitteeMeetingDocuments", increment: [changedSince] },
  { entitySet: "CommitteeProposedAmendments", increment: [changedSince] },
  { entitySet: "CommitteePublicTestimonies", increment: [changedSince] },
  { entitySet: "ConveneTimes", increment: [] },
  { entitySet: "LegislativeSessions", increment: [] },
  { entitySet: "FloorLetters", increment: [aboveHeld] },
];

/** The five sets whose rows link documents, which the client reads in one call. */
const documentSets = [
  "MeasureDocuments",
  "MeasureAnalysisDocuments",
  "CommitteeMeetingDocuments",
  "CommitteeProposedAmendments",
  "CommitteePublicTestimonies",
];

describe("a Full pull", () => {
  let system: System;
  beforeAll(async () => {
    system = await startSystem({ clockAt: pulledAt, olis: withFloorLetters([held]) });
    started.push(system);
  });

  test.for(sets)("asks OLIS for every row of $entitySet, and only the Session's", ({ entitySet }) => {
    expect(filtersAsked(system, entitySet)).toEqual([whole]);
  });
});

describe("an Increment", () => {
  let system: System;
  beforeAll(async () => {
    system = await startCopiedSystem({ clockAt: pulledAt, olis: withFloorLetters([held]) });
    started.push(system);
    system.olis.forgetRequests();
    system.clock.set(incrementAt);
    await system.incrementAgain();
  });

  test.for(sets)("reads $entitySet the way an Increment reads it", ({ entitySet, increment }) => {
    expect(filtersAsked(system, entitySet)).toEqual(increment);
  });

  test("asks for no set the table above does not name", () => {
    const asked = new Set(system.olis.requests().map((request) => request.entitySet));
    const expected = new Set(sets.filter((set) => set.increment.length > 0).map((set) => set.entitySet));
    expect(asked).toEqual(expected);
  });
});

describe("an Increment while the Index holds no Floor Letter", () => {
  test("reads the whole FloorLetters set, as there is no id to read above (ADR-0045)", async () => {
    const system = await startCopiedSystem({ clockAt: pulledAt });
    started.push(system);
    system.olis.forgetRequests();
    system.clock.set(incrementAt);
    await system.incrementAgain();
    expect(filtersAsked(system, "FloorLetters")).toEqual([whole]);
  });
});

describe("an Increment's read of the five sets that link documents", () => {
  test("is one read for all five: the Pull register's entries for them agree, or the Increment stops", async () => {
    const system = await startCopiedSystem({ clockAt: pulledAt });
    started.push(system);
    system.olis.forgetRequests();
    system.clock.set(incrementAt);
    await system.incrementAgain();
    expect(documentSets.map((entitySet) => filtersAsked(system, entitySet))).toEqual(
      documentSets.map(() => [changedSince]),
    );
  });
});
