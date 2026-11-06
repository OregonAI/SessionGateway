// Seam 3 (test/CLAUDE.md): the 2026R1 question set loads (ticket #83, ADR-0046). The set is data for `npm run eval`
// (scripts/eval/questions/2026R1.yml). CI has no 2026R1 fixture, so this file runs the set against no database: it
// only reads the file. It asserts that the file parses against the question schema, that it holds one question for
// each of the acceptance cases (a) to (f), with (a) split as in 2025R1's, and that every question names the moment it is
// asked at (`clock`). Whether the questions pass is the evaluation's report on a build of the Session, run by hand.
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
    ]);
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
