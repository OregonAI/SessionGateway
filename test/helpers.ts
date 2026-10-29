import { readFileSync } from "node:fs";
import { documentSchema } from "../src/document.ts";
import { SessionStore } from "../src/store.ts";

export function sampleStore(): SessionStore {
  const store = SessionStore.memory();
  const lines = readFileSync(new URL("./fixtures/sample-session.jsonl", import.meta.url), "utf8").split("\n");
  for (const line of lines.filter((l) => l.trim())) store.upsert(documentSchema.parse(JSON.parse(line)));
  return store;
}
