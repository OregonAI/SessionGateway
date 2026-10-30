import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelLock } from "../lock.ts";
import { createTokenizer, type WordPieceTokenizer } from "./tokenizer.ts";

// A problem with the model directory is told without the directory's path: the path is the value of MODEL_PATH,
// and an error names the variable and never its value (src/CLAUDE.md, "Configuration and portability").
const WHERE = "the directory MODEL_PATH names";

/** Throws, naming the file and `npm run model:fetch`, when a file the lock pins is not in the model directory. */
export function checkModelFiles(modelPath: string, lock: ModelLock): void {
  for (const file of lock.files) {
    if (!existsSync(join(modelPath, file.path))) {
      throw new Error(
        `The embedding model file ${file.path} is not in ${WHERE}. Run npm run model:fetch to download the pinned files.`,
      );
    }
  }
}

function parseJsonObject(modelPath: string, file: string): object {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(modelPath, file), "utf8"));
  } catch (error) {
    throw new Error(`The embedding model file ${file} in ${WHERE} is not valid JSON`, { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`The embedding model file ${file} in ${WHERE} is not a JSON object`);
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
