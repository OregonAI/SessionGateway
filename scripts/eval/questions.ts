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
  /**
   * What the step needs of the server. `transcripts-published`: the machine-transcript gate is on (`npm run eval
   * --transcripts-published`, ADR-0055); with the gate off the step is not run and the report says so (ticket #136).
   */
  requires: z.literal("transcripts-published").optional(),
  /** Its arguments. The text "$since" stands for the Pacific day before the question's clock (see `runEvaluation`). */
  arguments: z.record(z.string(), z.json()),
  /** What must hold in the tool's structured result. */
  expect: z.array(checkSchema).min(1),
});

/** Whether any argument of a step says "$since", the run's "since yesterday". */
function asksSince(value: unknown): boolean {
  if (value === "$since") return true;
  if (Array.isArray(value)) return (value as unknown[]).some(asksSince);
  if (typeof value === "object" && value !== null) return Object.values(value).some(asksSince);
  return false;
}

/** Whether the text is an ISO 8601 instant: a time with a UTC offset or "Z". */
function isInstant(text: string): boolean {
  try {
    Temporal.Instant.from(text);
    return true;
  } catch {
    return false;
  }
}

const question = z
  .strictObject({
    /** What the report calls the question. */
    id: z.string().regex(/^[a-z0-9-]+$/, "must be lower case letters, digits and hyphens"),
    title: z.string().min(1),
    /**
     * The moment the question is asked at: the server's clock stands still there, and "$since" is the Pacific day before
     * it. An ISO 8601 time with an offset. Required for a question that says "$since" (so the question does not depend on
     * the day the database was pulled); the database's own as-of time when it does not, for a question that does not
     * depend on time.
     */
    clock: z
      .string()
      .refine(isInstant, "must be an ISO 8601 time with a UTC offset, such as 2025-01-24T12:00:00-08:00")
      .optional(),
    steps: z.array(step).min(1),
  })
  .superRefine((each, context) => {
    if (each.clock === undefined && asksSince(each.steps.map((one) => one.arguments))) {
      context.addIssue({
        code: "custom",
        message: `question ${each.id} says $since and has no clock: give the moment it is asked at, such as clock: "2025-01-24T12:00:00-08:00"`,
      });
    }
  });

const questionSet = z.strictObject({
  /** The Session whose database this set is run against, such as 2025R1. */
  session: z.string().min(1),
  questions: z
    .array(question)
    .min(1)
    .refine((all) => new Set(all.map((each) => each.id)).size === all.length, "question ids must be different"),
});

export type Step = z.infer<typeof step>;
export type Question = z.infer<typeof question>;

/** Whether the question says "$since" in any call. */
export function questionAsksSince(each: Question): boolean {
  return asksSince(each.steps.map((one) => one.arguments));
}
export type QuestionSet = z.infer<typeof questionSet>;

/** Where a Session's questions are kept. */
export function questionSetPath(session: string, folder: string = join(import.meta.dirname, "questions")): string {
  return join(folder, `${session}.yml`);
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
