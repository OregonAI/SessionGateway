import type { Embedder } from "#/packages/embedder/index.ts";

/** One passage the worker had embedded, and the vector the model gave it. */
export type EmbeddedPassage = { text: string; vector: Float32Array };

/**
 * An embedder that passes every call on to `inner` and remembers the passages the worker asked it to embed,
 * with the vectors it gave back. The worker stores exactly these vectors (as int8), so a test reads here what
 * the index holds of each passage, the way `olis.documentRequests()` shows what the worker asked OLIS for. It
 * changes nothing the worker or the server sees.
 */
export function recordEmbeddings(inner: Embedder): { embedder: Embedder; embedded: EmbeddedPassage[] } {
  const embedded: EmbeddedPassage[] = [];
  return {
    embedded,
    embedder: {
      ...inner,
      async embedPassages(texts) {
        const vectors = await inner.embedPassages(texts);
        texts.forEach((text, index) => embedded.push({ text, vector: vectors[index] as Float32Array }));
        return vectors;
      },
    },
  };
}
