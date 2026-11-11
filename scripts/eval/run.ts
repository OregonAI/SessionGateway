// `npm run eval -- --database <path> [--session <key>] [--since <iso>]`: runs a Session's acceptance questions against
// any built database, prints the report and exits 1 when any question fails (ticket #23, spec #1 story 58). It exits 2
// when it cannot run at all (no database, a bad option, a question set that is not valid). It reads the database
// read-only and sends nothing to OLIS. It is never part of `npm test` or `npm run check`.
//
//   --database  the SQLite file the ingest worker wrote (required)
//   --session   the Session whose questions to run, such as 2025R1. Not given, the Session the database holds (it must
//               hold exactly one, or name one). A Session needs its question set: scripts/eval/questions/<session>.yml.
//   --transcripts-published  run with the server's transcript gate on (TRANSCRIPTS_PUBLISHED=true, ADR-0055): the steps
//               a question marks `requires: transcripts-published` run. Not given, the gate is off and those steps are not run.
//   --since     what "since yesterday" means to every question that says so: an ISO 8601 date or time. Not given, each
//               question's own: the Pacific day before the moment it is asked at (its `clock`), so no flag is needed.
// MODEL_PATH names the embedding model's directory as for the server; unset, it is the one `npm run model:fetch` fills.
import { existsSync } from "node:fs";
import { argv, exit } from "node:process";
import { parseArgs } from "node:util";
import { modelLockPath, readModelLock } from "#/packages/embedder/lock.ts";
import { loadOnnxEmbedder } from "#/packages/embedder/onnx.ts";
import { modelDirectory } from "../model/files.ts";
import { formatReport, runEvaluation } from "./runner.ts";

const usage =
  "usage: node scripts/eval/run.ts --database <path> [--session <key>] [--since <iso>] [--transcripts-published]";

try {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      database: { type: "string" },
      session: { type: "string" },
      since: { type: "string" },
      "transcripts-published": { type: "boolean" },
    },
    strict: true,
  });
  if (values.database === undefined) {
    console.error(`eval: --database is required\n${usage}`);
    exit(2);
  }
  // Check the input before the model is loaded (about a second): no database is an exit 2 without the model.
  if (!existsSync(values.database)) {
    console.error(`eval: There is no database at ${values.database}\n${usage}`);
    exit(2);
  }
  const modelPath = modelDirectory(readModelLock());
  const embedder = await loadOnnxEmbedder({ modelPath, lockPath: modelLockPath, intraOpThreads: 1 });
  const report = await runEvaluation({
    databasePath: values.database,
    ...(values.session === undefined ? {} : { session: values.session }),
    ...(values.since === undefined ? {} : { since: values.since }),
    ...(values["transcripts-published"] === true ? { transcriptsPublished: true } : {}),
    embedder,
    modelPath,
  });
  console.log(formatReport(report));
  exit(report.passed ? 0 : 1);
} catch (error) {
  console.error(`eval: ${error instanceof Error ? error.message : String(error)}\n${usage}`);
  exit(2);
}
