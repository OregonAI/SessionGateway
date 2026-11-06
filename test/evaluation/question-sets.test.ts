// Seam 3 (test/CLAUDE.md): the 2026R1 question set loads (ticket #83, ADR-0046). The set is data for `npm run eval`
// (scripts/eval/questions/2026R1.yml). CI has no 2026R1 fixture, so this file runs the set against no database: it
// only reads the file. It asserts that the file parses against the question schema, that it holds one question for
// each of the acceptance cases (a) to (f), with (a) split as in 2025R1's, and that every question names the moment it is
// asked at (`clock`), and (ticket #129) that the five stage-1 hearing questions are there and each names its moment: the
// speaker, the Agenda item, the timecode and the player link. Whether the questions pass is the evaluation's report on a build of the Session, run by hand.
import { describe, expect, it } from "vitest";
import { loadQuestionSet, questionSetPath } from "../../scripts/eval/questions.ts";

const set = loadQuestionSet(questionSetPath("2026R1"), "2026R1");

describe("the 2026R1 question set", () => {
  it("holds one question for each of the cases (a) to (f), with (a) split in two", () => {
    expect(set.questions.map((each) => each.id)).toEqual([
      "a-statutes",
      "a-fiscal",
      "b-amendment",
      "c-meeting",
      "d-testimony",
      "e-analysis",
      "f-status",
      "h-nasbe-sb1518",
      "h-reschke-hb4098",
      "h-hauser-sb1507",
      "h-marsh-hb4004",
      "h-priestley-hb4004",
    ]);
  });

  // Ticket #129: 4 to 6 hearing questions, "when did [named speaker] speak on [Measure] at [Committee] on [date], and where is
  // the recording?". A question names its moment when it expects the speaker, the Agenda item, the timecode and the player
  // link of one turn, so a question that checks only that a hearing exists does not count.
  describe("the stage-1 hearing questions (ticket #129)", () => {
    const hearing = set.questions.filter((each) => each.id.startsWith("h-"));
    const expected = (each: (typeof hearing)[number]) =>
      each.steps.flatMap((one) => one.expect.map((check) => check.path));

    it("holds 4 to 6 of them", () => {
      expect(hearing.length).toBeGreaterThanOrEqual(4);
      expect(hearing.length).toBeLessThanOrEqual(6);
    });

    it.each(["speaker", "agenda_item", "offset_seconds", "player_link"])("expects the turn's %s", (field) => {
      for (const each of hearing) {
        expect(
          expected(each).some((path) => path.includes("speaker_turns.turns[timecode=") && path.endsWith(`].${field}`)),
          `${each.id} expects no ${field}`,
        ).toBe(true);
      }
    });

    it("asks the committee, the date and the recording of the Measure's hearing, from get_measure", () => {
      for (const each of hearing) {
        const paths = each.steps
          .filter((one) => one.tool === "get_measure")
          .flatMap((one) => one.expect.map((c) => c.path));
        for (const field of ["committee_code", "meeting_date", "recording_log_id"]) {
          expect(
            paths.some((path) => path.startsWith("hearings[") && path.endsWith(`].${field}`)),
            `${each.id} expects no hearing ${field}`,
          ).toBe(true);
        }
      }
    });

    it("builds each player link from the Legislature's player page and the timecode's second", () => {
      for (const each of hearing) {
        const link = each.steps
          .flatMap((one) => one.expect)
          .find((check) => check.path.endsWith("].player_link") && "includesText" in check);
        const seconds = each.steps
          .flatMap((one) => one.expect)
          .find((check) => check.path.endsWith("].offset_seconds") && "equals" in check);
        expect(link, each.id).toBeDefined();
        const wanted = link !== undefined && "includesText" in link ? [link.includesText].flat() : [];
        const second = seconds !== undefined && "equals" in seconds ? (seconds.equals as number[])[0] : undefined;
        // The clientID is the one the stored text of testimony-2026r1-234682 (page 4) quotes in a player link; the stored
        // text of the logs holds none (scripts/eval/questions/2026R1.yml says so).
        expect(wanted, each.id).toContain(
          "https://olis.oregonlegislature.gov/liz/mediaplayer?clientID=4879615486&eventID=",
        );
        expect(wanted, each.id).toContain(`&startStreamAt=${String(second)}`);
      }
    });
  });

  it("names the moment each question is asked at", () => {
    const without = set.questions.filter((each) => each.clock === undefined).map((each) => each.id);
    // b, d, e and f ask nothing that depends on the time, but the 2026R1 convention (ticket #79, ADR-0046) is that every
    // question names its moment, so that none of them is asked at the day the build was pulled.
    expect(without).toEqual([]);
  });

  it("asks each moment inside the 2026R1 Session's year", () => {
    for (const each of set.questions) {
      expect(each.clock, each.id).toMatch(/^2026-/);
    }
  });
});
