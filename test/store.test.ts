import { describe, expect, it } from "vitest";
import { toMatchExpression } from "../src/store.ts";
import { sampleStore } from "./helpers.ts";

describe("SessionStore", () => {
  it("finds passages by keyword, stemmed", () => {
    const hits = sampleStore().search("library hour");
    expect(hits[0]?.id).toBe("sample-hb9001-intro");
    expect(hits[0]?.sourceUrl).toBe("https://example.org/sample/HB9001/introduced");
    expect(hits[0]?.snippet).toContain("[");
  });

  it("filters by document type", () => {
    const hits = sampleStore().search("Saturday", { type: "amendment" });
    expect(hits.map((h) => h.id)).toEqual(["sample-hb9001-a1"]);
  });

  it("matches a measure however it is typed", () => {
    for (const measure of ["SB 9002", "sb9002", "S.B. 9002"]) {
      expect(sampleStore().search("broadband", { measure }).map((h) => h.id)).toEqual(["sample-sb9002-testimony-1"]);
    }
  });

  it("treats query punctuation as text, not FTS syntax", () => {
    expect(() => sampleStore().search('"HB 9001" AND (NEAR -* ^')).not.toThrow();
    expect(sampleStore().search("?!")).toEqual([]);
  });

  it("re-ingesting a document replaces its passages", () => {
    const store = sampleStore();
    const doc = store.get("sample-hb9001-intro");
    store.upsert({ ...doc!, text: "Replaced text about ferries." });
    expect(store.search("Saturdays", { type: "measure" })).toEqual([]);
    expect(store.search("ferries").map((h) => h.id)).toEqual(["sample-hb9001-intro"]);
  });

  it("returns full documents and an overview", () => {
    const store = sampleStore();
    expect(store.get("sample-hb9001-a1")).toMatchObject({ measure: "HB9001", type: "amendment", date: "2026-02-03" });
    expect(store.get("missing")).toBeUndefined();
    expect(store.overview()).toEqual({
      sessions: ["SAMPLE2026"],
      documents: 3,
      measures: 2,
      byType: { measure: 1, amendment: 1, testimony: 1 },
    });
  });
});

describe("toMatchExpression", () => {
  it("quotes and ORs terms", () => {
    expect(toMatchExpression('rural "broadband"-grants')).toBe('"rural" OR "broadband" OR "grants"');
  });
});
