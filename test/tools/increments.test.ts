// Seam 1 (test/CLAUDE.md): an increment (ticket #17, ADR-0005, ADR-0039), as an agent sees it through the tools. The
// worker pulls the Session in full, the clock moves, rows appear in the fake OLIS, and an increment reads what
// OLIS created or modified since. Each case builds its own system, because the clock and the rows are the thing
// under test, except the cases of "Testimony's Agency": their increment is the subject and not the first pull, so
// each copies the template of the fixture's pull at 2026-08-01 10:00 Pacific (test/CLAUDE.md, Templates). The embedder
// is the fake: nothing here is about how well a meaning ranks.
//
// The real rows are HB 3131's Testimony: 117165 (Oregon Climate and Agriculture Network, created 2025-01-17
// 15:16:44, modified 15:20:18 Pacific; the only one whose text holds "riparian planting and cover cropping") and
// 117166 and 117167 (American Farmland Trust and the Oregon Association of Conservation Districts, created at 16:17
// and 17:00 the same day; feed/CommitteePublicTestimonies.json).
//
// It covers a document absent and then found, a row with only a `CreatedDate` and one with only a `ModifiedDate`,
// the two-hour overlap, `session_overview`'s `last_increment`, the two-pull rule across an increment, and what an
// increment does with Testimony's Agency when the snapshot file has changed (ADR-0047).
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type Era } from "../support/mcp-clients.ts";
import { createFixtureCopy, type FixtureCopy, type FixtureSnapshot } from "../support/made-up-snapshot.ts";
import { startSystem, systemTemplate, type System } from "../support/system.ts";
import { listAgain, stopListing } from "../support/unlisted-rows.ts";

const started: System[] = [];
const copies: FixtureCopy[] = [];

vi.setConfig({ testTimeout: 60_000 });

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
  for (const copy of copies.splice(0)) copy.remove();
});

// 2025-01-17 14:00 and 18:00 in Oregon, which was on UTC-8: before and after the three letters were created.
const beforeTheLetters = "2025-01-17T22:00:00Z";
const afterTheLetters = "2025-01-18T02:00:00Z";

const letter = "testimony-2025r1-117165";

// MADE UP Testimony rows for HB 3131's meeting of HALNRW on 2025-01-22, which the cases that add rows to the fake write
// with `row`, each served the file of a real letter at `download`'s path.
const olisRoot = "https://olis.oregonlegislature.gov/liz/2025R1";
const download = (commTestId: number): string => `/liz/2025R1/Downloads/PublicTestimonyDocument/${commTestId}`;

function row(
  commTestId: number,
  dates: { CreatedDate: string | null; ModifiedDate: string | null },
): Record<string, unknown> {
  return {
    SessionKey: "2025R1",
    CommTestId: commTestId,
    SubmitterFirstName: "Made",
    SubmitterLastName: `Up ${commTestId}`,
    PositionOnMeasureId: 3983,
    CommitteeCode: "HALNRW",
    MeetingDate: "2025-01-22T08:00:00",
    DocumentDescription: "Testimony",
    MeasurePrefix: "HB",
    MeasureNumber: 3131,
    DocumentUrl: olisRoot,
    ...dates,
  };
}

async function start(clockAt: string = beforeTheLetters): Promise<System> {
  const system = await startSystem({ clockAt, documents: true });
  started.push(system);
  return system;
}

/** The ids of the hits for words only 117165 holds, in HB 3131's scope. */
async function idsFound(system: System, era: Era): Promise<string[]> {
  const connected = await connectClient(era, system.handler);
  try {
    const outcome = await callTool(connected, "search", {
      query: "riparian planting and cover cropping",
      measure: "HB 3131",
    });
    expect(outcome.isError).toBe(false);
    return (outcome.structured?.["results"] as { id: string }[]).map((hit) => hit.id);
  } finally {
    await connected.close();
  }
}

async function everyClient(check: (era: Era) => Promise<void>): Promise<void> {
  for (const era of eras) await check(era);
}

describe("an increment", () => {
  it("finds a document that was absent from search, once the clock has moved and an increment has run", async () => {
    const system = await start();
    await everyClient(async (era) => {
      expect(await idsFound(system, era)).not.toContain(letter);
    });

    system.clock.set(afterTheLetters);
    await system.incrementAgain();

    await everyClient(async (era) => {
      expect(await idsFound(system, era)).toContain(letter);
    });
  });

  it("is reported by session_overview as the last increment, and moves the index's as-of time", async () => {
    const system = await start();
    const overview = async (era: Era): Promise<Record<string, unknown> | undefined> => {
      const connected = await connectClient(era, system.handler);
      try {
        return (await callTool(connected, "session_overview", {})).structured;
      } finally {
        await connected.close();
      }
    };
    await everyClient(async (era) => {
      expect(await overview(era)).toMatchObject({ as_of: "2025-01-17T14:00:00-08:00", last_increment: null });
    });

    system.clock.set(afterTheLetters);
    await system.incrementAgain();

    await everyClient(async (era) => {
      expect(await overview(era)).toMatchObject({
        as_of: "2025-01-17T18:00:00-08:00",
        last_increment: "2025-01-17T18:00:00-08:00",
      });
    });
  });

  describe("a row with one of the two dates, and the two-hour overlap", () => {
    // MADE UP: four Testimony rows for HB 3131's meeting of HALNRW on 2025-01-22, added to the fake after the pull
    // (14:00), and read at 18:00. Each is served the file of one of the real letters. The increment asks for rows
    // created or modified after 12:00, two hours before the pull.
    async function startWithFiles(): Promise<System> {
      const system = await startSystem({
        clockAt: beforeTheLetters,
        documents: true,
        olis: {
          strayDocuments: {
            [download(900101)]: "testimony/117166.pdf",
            [download(900102)]: "testimony/117167.pdf",
            [download(900103)]: "testimony/117166.pdf",
            [download(900104)]: "testimony/117167.pdf",
          },
        },
      });
      started.push(system);
      return system;
    }

    async function isHeld(system: System, era: Era, commTestId: number): Promise<boolean> {
      const connected = await connectClient(era, system.handler);
      try {
        const outcome = await callTool(connected, "get_document", { id: `testimony-2025r1-${commTestId}` });
        return !outcome.isError;
      } finally {
        await connected.close();
      }
    }

    it("picks up a row that has only a CreatedDate and a row that has only a ModifiedDate", async () => {
      const system = await startWithFiles();
      system.olis.addRows("CommitteePublicTestimonies", [
        row(900101, { CreatedDate: "2025-01-17T16:30:00", ModifiedDate: null }),
        row(900102, { CreatedDate: null, ModifiedDate: "2025-01-17T16:45:00" }),
      ]);
      system.clock.set(afterTheLetters);

      await system.incrementAgain();

      await everyClient(async (era) => {
        expect(await isHeld(system, era, 900101)).toBe(true);
        expect(await isHeld(system, era, 900102)).toBe(true);
      });
    });

    it("reads back two hours before the last run, and no further", async () => {
      const system = await startWithFiles();
      system.olis.addRows("CommitteePublicTestimonies", [
        // 13:00 is inside the overlap (after 12:00); 09:00 is before it.
        row(900103, { CreatedDate: "2025-01-17T13:00:00", ModifiedDate: null }),
        row(900104, { CreatedDate: "2025-01-17T09:00:00", ModifiedDate: null }),
      ]);
      system.clock.set(afterTheLetters);

      await system.incrementAgain();

      await everyClient(async (era) => {
        expect(await isHeld(system, era, 900103)).toBe(true);
        expect(await isHeld(system, era, 900104)).toBe(false);
      });
    });
  });
});

describe("an increment and the two-pull rule (ADR-0030)", () => {
  // HB 3131's Testimony 117165, as in no-longer-listed.test.ts. Complete pulls at 17:00, 18:00 and 19:00 Pacific on
  // 2025-01-17, an increment at 18:30. The feed lists the letter at the first pull, not at the second, lists it again
  // (with a ModifiedDate of 18:20, so that the increment reads it) and then not at the third.
  const isLetter = (row: Record<string, unknown>): boolean => row["CommTestId"] === 117165;

  it("is not a complete pull: a row it saw between two complete pulls that missed it is still no longer listed", async () => {
    const system = await start("2025-01-18T01:00:00Z");

    stopListing(system.olis, "CommitteePublicTestimonies", isLetter);
    system.clock.set("2025-01-18T02:00:00Z");
    await system.pullAgain();
    listAgain(system.olis, "CommitteePublicTestimonies", isLetter);
    system.olis.amendRows("CommitteePublicTestimonies", isLetter, { ModifiedDate: "2025-01-17T18:20:00" });
    system.clock.set("2025-01-18T02:30:00Z");
    await system.incrementAgain();
    stopListing(system.olis, "CommitteePublicTestimonies", isLetter);
    system.clock.set("2025-01-18T03:00:00Z");
    await system.pullAgain();

    await everyClient(async (era) => {
      expect(await idsFound(system, era)).not.toContain(letter);
      const connected = await connectClient(era, system.handler);
      const document = await callTool(connected, "get_document", { id: letter });
      await connected.close();
      expect(document.structured).toMatchObject({
        no_longer_listed: true,
        // The first complete pull's time: the increment did not list the row.
        last_listed_at: "2025-01-17T17:00:00-08:00",
      });
    });
  });

  it("stores a document it saw first as listed, not yet checked: searchable, unflagged, with no time it was listed", async () => {
    const system = await start();
    system.clock.set(afterTheLetters);
    await system.incrementAgain();

    await everyClient(async (era) => {
      expect(await idsFound(system, era)).toContain(letter);
      const connected = await connectClient(era, system.handler);
      const document = await callTool(connected, "get_document", { id: letter });
      await connected.close();
      expect(document.structured).toMatchObject({ no_longer_listed: false, last_listed_at: null });
    });
  });
});

// The snapshot is the full pull's (ADR-0035): it reads every stored document's links again when the snapshot changes and
// only then reports the new version. An increment never switches it. While the snapshot file is the one the index
// reports, an increment reads the links of the documents it stores and matches each Testimony row it reads, with that
// snapshot. Once the file has changed, it does neither (ADR-0035, ADR-0047): it leaves the links of the documents it
// stores to the next full pull, stores a Testimony row new to the index with no Agency, and leaves the stored Agency of a
// Testimony row the index already holds, so the index never holds an Agency Link made with a snapshot it does not
// report (ADR-0027). The next full pull matches every Testimony row with the new snapshot and reports it. The second
// snapshot is MADE UP: a copy of the committed fixture with a commit of its own.
describe("an increment and the OregonAI snapshot (ADR-0035, ADR-0039)", () => {
  async function snapshotCommit(system: System, era: Era): Promise<unknown> {
    const connected = await connectClient(era, system.handler);
    try {
      const outcome = await callTool(connected, "session_overview", {});
      return (outcome.structured?.["snapshot"] as { commit: string }).commit;
    } finally {
      await connected.close();
    }
  }

  it("leaves the snapshot the index reports to the next full pull, though the snapshot file has changed", async () => {
    const copy = createFixtureCopy(() => {});
    try {
      const system = await startSystem({ clockAt: beforeTheLetters, documents: true, snapshot: copy.path });
      started.push(system);
      const [first] = eras;
      if (first === undefined) throw new Error("There are no client eras");
      const before = await snapshotCommit(system, first);
      copy.changeIt();
      system.clock.set(afterTheLetters);

      await system.incrementAgain();

      for (const era of eras) expect(await snapshotCommit(system, era)).toBe(before);
      // The next full pull reads every link again and reports the new snapshot.
      await system.pullAgain();
      expect(await snapshotCommit(system, first)).not.toBe(before);
    } finally {
      copy.remove();
    }
  });

  // Testimony's Agency (ADR-0047). The first pull of these cases is a copy of the template for the fixture at
  // 2026-08-01 10:00 Pacific, when every row of the fixture exists; the increment at 12:00 is the subject. The made-up row
  // a case adds and the row it amends are read by the increment (it asks for rows created or modified after 08:00, two
  // hours before the pull).
  describe("Testimony's Agency", () => {
    const template = systemTemplate({ clockAt: "2026-08-01T17:00:00Z", documents: true });
    const atTheIncrement = "2026-08-01T19:00:00Z";
    const boli = "bureau-of-labor-and-industries";
    const dhs = "department-of-human-services";
    // MADE UP: an Organization that no registry of the committed snapshot names, and the alias with which the changed
    // snapshot gives it to the Bureau of Labor and Industries. The Bureau's own name is the committed registry's.
    const madeUpOrganization = "MADE UP Wage Office";
    const newRow = 900201;
    // The fixture's Testimony 209256 (feed/CommitteePublicTestimonies.json) for HB 3795 gives the Organization "ODHS",
    // which the committed registry names as an alias of the Department of Human Services; the changed snapshot takes
    // the alias away, as agency-links-snapshot.test.ts's does.
    const heldRow = 209256;

    /**
     * A made-up copy of the snapshot that, once changed, gives the Bureau of Labor and Industries the made-up alias and
     * takes "ODHS" away from the Department of Human Services.
     */
    function copyWithChangedRegistry(): FixtureCopy {
      const copy = createFixtureCopy((snapshot: FixtureSnapshot) => {
        const agency = (slug: string): FixtureSnapshot["agencies"][number] => {
          const found = snapshot.agencies.find((candidate) => candidate.slug === slug);
          if (found === undefined) throw new Error(`The snapshot fixture has no row for ${slug}`);
          return found;
        };
        const bureau = agency(boli);
        bureau.aliases = [...bureau.aliases, madeUpOrganization];
        const department = agency(dhs);
        if (!department.aliases.includes("ODHS")) throw new Error("The snapshot fixture's Department lacks ODHS");
        department.aliases = department.aliases.filter((alias) => alias !== "ODHS");
      });
      copies.push(copy);
      return copy;
    }

    async function startOn(snapshot: string): Promise<System> {
      const system = await template.start({ snapshot });
      started.push(system);
      return system;
    }

    /** Adds the made-up row to the fake, created at 10:30 Pacific, and the file it links. */
    function addNewRow(system: System, organization: string): void {
      system.olis.addStrayDocuments({ [download(newRow)]: "testimony/117166.pdf" });
      system.olis.addRows("CommitteePublicTestimonies", [
        { ...row(newRow, { CreatedDate: "2026-08-01T10:30:00", ModifiedDate: null }), Organization: organization },
      ]);
    }

    /** The Testimony evidence in the Agency Links get_measure shows for the Measure, as [Agency, Testimony document]. */
    async function testimonyLinks(system: System, era: Era, measure: string): Promise<[string, string][]> {
      type Links = {
        agencies: { agency_id: string; evidence: { kind: string; examples: { document_id: string }[] }[] }[];
      };
      const connected = await connectClient(era, system.handler);
      try {
        const outcome = await callTool(connected, "get_measure", { measure });
        expect(outcome.isError, outcome.text).toBe(false);
        const links = outcome.structured?.["agency_links"] as Links;
        return links.agencies.flatMap((agency) =>
          agency.evidence
            .filter((group) => group.kind === "testimony")
            .flatMap((group) =>
              group.examples.map((example): [string, string] => [agency.agency_id, example.document_id]),
            ),
        );
      } finally {
        await connected.close();
      }
    }

    /** The Organization the `testimony` tool gives for one Testimony row of the Measure, as the index stores it. */
    async function organizationOf(system: System, era: Era, measure: string, commTestId: number): Promise<unknown> {
      type Page = { positions: { organizations: { items: { id: string; organization: string | null }[] }[] }[] };
      const connected = await connectClient(era, system.handler);
      try {
        const outcome = await callTool(connected, "testimony", { measure });
        expect(outcome.isError, outcome.text).toBe(false);
        const items = (outcome.structured as Page).positions.flatMap((position) =>
          position.organizations.flatMap((group) => group.items),
        );
        const found = items.find((item) => item.id === `testimony-2025r1-${commTestId}`);
        if (found === undefined) throw new Error(`The testimony tool lists no row ${commTestId} for ${measure}`);
        return found.organization;
      } finally {
        await connected.close();
      }
    }

    async function isHeld(system: System, era: Era, documentId: string): Promise<boolean> {
      const connected = await connectClient(era, system.handler);
      try {
        return !(await callTool(connected, "get_document", { id: documentId })).isError;
      } finally {
        await connected.close();
      }
    }

    it("stores a Testimony row new to the index with no Agency Link when the snapshot file has changed, and the index still reports the old snapshot", async () => {
      const copy = copyWithChangedRegistry();
      const system = await startOn(copy.path);
      const [first] = eras;
      if (first === undefined) throw new Error("There are no client eras");
      const before = await snapshotCommit(system, first);
      addNewRow(system, madeUpOrganization);
      copy.changeIt();
      system.clock.set(atTheIncrement);

      await system.incrementAgain();

      await everyClient(async (era) => {
        expect(await isHeld(system, era, `testimony-2025r1-${newRow}`)).toBe(true);
        expect(await testimonyLinks(system, era, "HB 3131")).toEqual([]);
        expect(await snapshotCommit(system, era)).toBe(before);
      });
    });

    it("keeps the Agency Link a Testimony row the index already held had, though the increment reads the row again with another Organization under a changed snapshot", async () => {
      const copy = copyWithChangedRegistry();
      const system = await startOn(copy.path);
      await everyClient(async (era) => {
        expect(await testimonyLinks(system, era, "HB 3795")).toEqual([[dhs, `testimony-2025r1-${heldRow}`]]);
      });
      // The row is read again: OLIS modified it at 10:30 and changed its Organization to the MADE UP one that the changed
      // registry gives to the Bureau of Labor and Industries, so a match would give the row the Bureau and not the
      // Department (ADR-0047: a row whose Organization an increment changed keeps the Agency its earlier text matched).
      system.olis.amendRows("CommitteePublicTestimonies", (candidate) => candidate["CommTestId"] === heldRow, {
        ModifiedDate: "2026-08-01T10:30:00",
        Organization: madeUpOrganization,
      });
      copy.changeIt();
      system.clock.set(atTheIncrement);

      await system.incrementAgain();

      await everyClient(async (era) => {
        // The increment stored the row's new Organization, and left the Agency its earlier text matched.
        expect(await organizationOf(system, era, "HB 3795", heldRow)).toBe(madeUpOrganization);
        expect(await testimonyLinks(system, era, "HB 3795")).toEqual([[dhs, `testimony-2025r1-${heldRow}`]]);
      });
    });

    it("matches a Testimony row new to the index with the registry as before when the snapshot file has not changed", async () => {
      // The committed registry names the Bureau of Labor and Industries by its name; nothing is changed.
      const system = await template.start();
      started.push(system);
      addNewRow(system, "Bureau of Labor and Industries");
      system.clock.set(atTheIncrement);

      await system.incrementAgain();

      await everyClient(async (era) => {
        expect(await testimonyLinks(system, era, "HB 3131")).toEqual([[boli, `testimony-2025r1-${newRow}`]]);
      });
    });

    it("is followed by a full pull that matches every Testimony row with the changed snapshot and reports it", async () => {
      const copy = copyWithChangedRegistry();
      const system = await startOn(copy.path);
      const [first] = eras;
      if (first === undefined) throw new Error("There are no client eras");
      const before = await snapshotCommit(system, first);
      addNewRow(system, madeUpOrganization);
      system.olis.amendRows("CommitteePublicTestimonies", (candidate) => candidate["CommTestId"] === heldRow, {
        ModifiedDate: "2026-08-01T10:30:00",
      });
      copy.changeIt();
      system.clock.set(atTheIncrement);

      await system.incrementAgain();

      // The increment left both rows to the full pull.
      await everyClient(async (era) => {
        expect(await testimonyLinks(system, era, "HB 3131")).toEqual([]);
        expect(await testimonyLinks(system, era, "HB 3795")).toEqual([[dhs, `testimony-2025r1-${heldRow}`]]);
        expect(await snapshotCommit(system, era)).toBe(before);
      });

      await system.pullAgain();

      // The full pull matches the new row with the alias the changed registry gave and the held row without the alias it took.
      await everyClient(async (era) => {
        expect(await testimonyLinks(system, era, "HB 3131")).toEqual([[boli, `testimony-2025r1-${newRow}`]]);
        expect(await testimonyLinks(system, era, "HB 3795")).toEqual([]);
        expect(await snapshotCommit(system, era)).not.toBe(before);
      });
    });
  });
});
