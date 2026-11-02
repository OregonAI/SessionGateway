// Seam 4 (test/CLAUDE.md): the reader has no per-kind method that returns a bare Listing (ticket #97). A tool that wants a
// Listing reads it from the thing it was handed; there is nothing to choose among and nothing to forget to ask.
import { afterEach, describe, expect, it } from "vitest";
import { openMadeUpIndex, type MadeUpIndex } from "./made-up-index.ts";

let index: MadeUpIndex;
afterEach(() => {
  index.close();
});

describe("the reader's interface", () => {
  it.for(["measureListing", "findNoLongerListed", "testimonyListing"])("has no %s", (method) => {
    index = openMadeUpIndex();
    expect(index.reader).not.toHaveProperty(method);
  });
});
