import { describe, expect, it } from "vitest";
import { chunkText } from "../src/chunk.ts";

describe("chunkText", () => {
  it("keeps short text as one passage", () => {
    expect(chunkText("one\n\ntwo")).toEqual(["one\n\ntwo"]);
  });

  it("breaks on paragraph boundaries when over the limit", () => {
    const chunks = chunkText(["a".repeat(60), "b".repeat(60), "c".repeat(60)].join("\n\n"), 130);
    expect(chunks).toEqual([`${"a".repeat(60)}\n\n${"b".repeat(60)}`, "c".repeat(60)]);
  });

  it("splits a single oversized paragraph on whitespace", () => {
    const chunks = chunkText(Array(50).fill("word").join(" "), 40);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 40)).toBe(true);
    expect(chunks.join(" ")).toBe(Array(50).fill("word").join(" "));
  });

  it("returns nothing for blank text", () => {
    expect(chunkText("  \n\n  ")).toEqual([]);
  });
});
