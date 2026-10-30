import { describe, expect, it } from "vitest";
import { greet } from "../index.ts";

describe("example package", () => {
  it("names the Session through its entry point", () => {
    expect(greet("2025R1")).toBe("Session 2025R1");
  });
});
