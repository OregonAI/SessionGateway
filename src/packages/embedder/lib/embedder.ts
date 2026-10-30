import { createHash } from "node:crypto";
import { MAX_PASSAGE_TOKENS, type Embedder, type ModelRunner } from "../index.ts";
import type { WordPieceTokenizer } from "./tokenizer.ts";

/**
 * What the model card says to put before a question when the passages are retrieved by it, and before no
 * passage (BAAI/bge-small-en-v1.5 model card, note [1]).
 */
export const QUESTION_INSTRUCTION = "Represent this sentence for searching relevant passages: ";

/** The first eight digits of the sha256 of the question instruction: the part of the model id that names it. */
export const questionInstructionId: string = createHash("sha256")
  .update(QUESTION_INSTRUCTION)
  .digest("hex")
  .slice(0, 8);

/** The most tokens the model reads, [CLS] and [SEP] included. */
const MODEL_INPUT_TOKENS = MAX_PASSAGE_TOKENS + 2;

const SEP_TOKEN_ID = 102;

/**
 * An embedder from the model's tokenizer and something that runs the model. Everything that decides what a
 * text means to the model but the weights is here: the tokenizer, the limit, the instruction before a question
 * and the rule that a text is run alone (a runner is never given a batch: the quantized model scales its
 * activations over the whole tensor it is given, so the vector of a text run with others differs a little from
 * its vector alone, and a vector that is kept under the hash of its text and reused, ADR-0025, must be a
 * function of that text and nothing else. One thread gains no speed from a batch, and a batch raises the peak
 * memory with its padding and activations).
 */
export function createEmbedder(tokenizer: WordPieceTokenizer, runner: ModelRunner): Embedder {
  return {
    modelId: runner.modelId,
    maxPassageTokens: MAX_PASSAGE_TOKENS,
    countTokens: (text) => tokenizer.encode(text, { add_special_tokens: false }).ids.length,
    async embedPassages(texts) {
      const vectors: Float32Array[] = [];
      for (const text of texts) {
        const ids = tokenizer.encode(text).ids;
        if (ids.length > MODEL_INPUT_TOKENS) {
          throw new Error(`A passage is ${ids.length} tokens; the model reads at most ${MODEL_INPUT_TOKENS}`);
        }
        vectors.push(await runner.run(ids));
      }
      return vectors;
    },
    async embedQuestion(text) {
      let ids = tokenizer.encode(`${QUESTION_INSTRUCTION}${text}`).ids;
      // A question longer than the model reads is cut, keeping [SEP] last, rather than refused.
      if (ids.length > MODEL_INPUT_TOKENS) ids = [...ids.slice(0, MODEL_INPUT_TOKENS - 1), SEP_TOKEN_ID];
      return runner.run(ids);
    },
  };
}
