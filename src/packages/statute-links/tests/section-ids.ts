import type { OrsSectionId } from "#/packages/domain/oregonai.ts";
import { parseOrsSectionId } from "#/packages/domain/oregonai.ts";

/** A literal ORS section list for a test, such as ["ors-418.806", "ors-418.808"]. A malformed literal fails the test. */
export function orsSectionList(...ids: string[]): OrsSectionId[] {
  return ids.map((text) => {
    const id = parseOrsSectionId(text);
    if (id === undefined) throw new Error(`not an ORS section id: ${text}`);
    return id;
  });
}
