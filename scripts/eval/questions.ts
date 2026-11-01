// A question set: the acceptance questions of one Session, as data (ticket #23, spec #1 story 58). Each question is the
// tool calls an agent would make and what must hold in what it sees. A later Session's set (2026R1) is another file of
// this folder, with no change to the code that runs it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { checkSchema } from "./paths.ts";

const step = z.strictObject({
  /** The MCP tool to call. */
  tool: z.string().min(1),
  /** Its arguments. The text "$since" stands for the run's "since yesterday" (see `runEvaluation`). */
  arguments: z.record(z.string(), z.json()),
  /** What must hold in the tool's structured result. */
  expect: z.array(checkSchema).min(1),
});

const question = z.strictObject({
  /** What the report calls the question. */
  id: z.string().regex(/^[a-z0-9-]+$/, "must be lower case letters, digits and hyphens"),
  title: z.string().min(1),
  /**
   * The moment the server answers at, for a question that is about a moment ("the next meeting", with the clock at
   * 2025-01-29). An ISO 8601 time with an offset. The database's own as-of time when it is not given.
   */
  clock: z
    .string()
    .refine((text) => !Number.isNaN(Date.parse(text)), "must be an ISO 8601 time")
    .optional(),
  steps: z.array(step).min(1),
});

const questionSet = z.strictObject({
  /** The Session whose database this set is run against: 2025R1. */
  session: z.string().min(1),
  questions: z
    .array(question)
    .min(1)
    .refine((all) => new Set(all.map((each) => each.id)).size === all.length, "question ids must be different"),
});

export type Step = z.infer<typeof step>;
export type Question = z.infer<typeof question>;
export type QuestionSet = z.infer<typeof questionSet>;

/** Where a Session's questions are kept. */
export function questionSetPath(session: string): string {
  return join(import.meta.dirname, "questions", `${session}.yml`);
}

/** Reads and checks a question set; throws an Error that names the file and what is wrong. */
export function loadQuestionSet(path: string, session: string): QuestionSet {
  if (!existsSync(path)) {
    throw new Error(`There is no question set for ${session}: ${path} does not exist`);
  }
  const parsed = questionSet.safeParse(parseYaml(readFileSync(path, "utf8")));
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`The question set ${path} is not valid: ${problems.join("; ")}`);
  }
  if (parsed.data.session !== session) {
    throw new Error(`The question set ${path} is for ${parsed.data.session}, not ${session}`);
  }
  return parsed.data;
}
