import { Tokenizer as PackageTokenizer } from "@huggingface/tokenizers";

// @huggingface/tokenizers 0.2.0 ships declarations whose relative imports ("./core/Tokenizer") have no file
// extension, which TypeScript's nodenext resolution cannot follow in an ES module package. `tsc` hides it
// (skipLibCheck) and treats the class as untyped, so ESLint's no-unsafe rules reject every use of it. This
// file is the one place the package is named: it types the part the embedder uses, as the package's own
// declarations (types/core/Tokenizer.d.ts) say it is, and nothing else imports the package.

/** The part of the package's `Tokenizer` that the embedder uses. */
export type WordPieceTokenizer = {
  /** The token ids of a text, with [CLS] first and [SEP] last unless `add_special_tokens` is false. */
  encode(text: string, options?: { add_special_tokens?: boolean }): { ids: number[] };
};

type TokenizerConstructor = new (tokenizerJson: object, tokenizerConfig: object) => WordPieceTokenizer;

export function createTokenizer(tokenizerJson: object, tokenizerConfig: object): WordPieceTokenizer {
  const Tokenizer = PackageTokenizer as unknown as TokenizerConstructor;
  return new Tokenizer(tokenizerJson, tokenizerConfig);
}
