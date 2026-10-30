/** The constant of reciprocal rank fusion: 60, as spec #1 says and das-cairn uses. */
export const RRF_K = 60;

/**
 * Reciprocal rank fusion: each list ranks the same kind of key, best first, and a key's score is the sum
 * over the lists that rank it of 1 / (60 + its rank), the best rank being 1. The keys come back best score
 * first; keys with the same score come in the order of the first list that ranks them, then by their place
 * in it.
 */
export function reciprocalRankFusion<Key>(lists: readonly (readonly Key[])[]): Key[] {
  const scores = new Map<Key, { score: number; order: number }>();
  let order = 0;
  for (const list of lists) {
    list.forEach((key, index) => {
      const entry = scores.get(key) ?? { score: 0, order: order++ };
      entry.score += 1 / (RRF_K + index + 1);
      scores.set(key, entry);
    });
  }
  return [...scores.entries()].toSorted(([, a], [, b]) => b.score - a.score || a.order - b.order).map(([key]) => key);
}
