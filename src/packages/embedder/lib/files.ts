import { readFileSync } from "node:fs";
import { join } from "node:path";
import { modelFileProblem, type ModelFile, type ModelFileProblem, type ModelLock } from "../lock.ts";
import { createTokenizer, type WordPieceTokenizer } from "./tokenizer.ts";

// A problem with the model directory is told without the directory's path: the path is the value of MODEL_PATH,
// and an error names the variable and never its value (src/CLAUDE.md, "Configuration and portability").
const WHERE = "the directory MODEL_PATH names";
const REMEDY = "Run npm run model:fetch to download the pinned files.";

function describe(file: ModelFile, problem: ModelFileProblem): string {
  switch (problem.kind) {
    case "missing":
      return `${file.path} is not there`;
    case "size":
      return `${file.path} is ${problem.actual} bytes, and the lock pins ${file.bytes}`;
    case "sha256":
      return `${file.path} has sha256 ${problem.actual}, and the lock pins ${file.sha256}`;
    default:
      return problem satisfies never;
  }
}

/**
 * Throws, naming each file, when a file the lock pins is not in the model directory or is not the pinned file:
 * the sha256 of every file is checked against the lock (the model is 34 MB, so this takes a few tens of
 * milliseconds). The model id names the pinned model, and vectors are kept and reused under it, so files that are
 * not the pinned ones must not run under it. This is `npm run model:verify`'s check, repeated at every start,
 * because neither entry script runs that.
 */
export async function checkModelFiles(modelPath: string, lock: ModelLock): Promise<void> {
  const problems: string[] = [];
  for (const file of lock.files) {
    const problem = await modelFileProblem(modelPath, file);
    if (problem !== undefined) problems.push(describe(file, problem));
  }
  if (problems.length > 0) {
    throw new Error(`The embedding model in ${WHERE} is not the pinned model: ${problems.join("; ")}. ${REMEDY}`);
  }
}

function parseJsonObject(modelPath: string, file: string): object {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(modelPath, file), "utf8"));
  } catch (error) {
    throw new Error(`The embedding model file ${file} in ${WHERE} is not valid JSON. ${REMEDY}`, { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`The embedding model file ${file} in ${WHERE} is not a JSON object. ${REMEDY}`);
  }
  return parsed;
}

/** The model's own tokenizer, from `tokenizer.json` and `tokenizer_config.json` in the model directory. */
export function loadTokenizer(modelPath: string): WordPieceTokenizer {
  return createTokenizer(
    parseJsonObject(modelPath, "tokenizer.json"),
    parseJsonObject(modelPath, "tokenizer_config.json"),
  );
}
