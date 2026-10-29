import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { documentSchema } from "../document.ts";
import { SessionStore } from "../store.ts";

// Usage: npm run ingest -- <documents.jsonl> [--db data/session.db]
// One SessionDocument per line. Re-ingesting an id replaces it.
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { db: { type: "string" } },
});
if (positionals.length === 0) {
  console.error("usage: ingest <documents.jsonl> [...more.jsonl] [--db path]");
  process.exit(2);
}

const dbPath = values.db ?? loadConfig().dbPath;
const store = SessionStore.open(dbPath);
let count = 0;
let failed = 0;

for (const file of positionals) {
  let line = 0;
  for await (const raw of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    line++;
    if (!raw.trim()) continue;
    const parsed = documentSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      failed++;
      console.error(`${file}:${line}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      continue;
    }
    store.upsert(parsed.data);
    count++;
  }
}

store.close();
console.error(`ingested ${count} documents into ${dbPath}${failed ? `, ${failed} rejected` : ""}`);
process.exit(failed ? 1 : 0);
