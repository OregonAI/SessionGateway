// `npm run eval -- --database <path> [--session 2025R1] [--since <iso>]`: runs a Session's acceptance questions against
// any built database, prints the report and exits 1 when any question fails (ticket #23, spec #1 story 58). It exits 2
// when it cannot run at all (no database, a bad option, a question set that is not valid). It reads the database
// read-only and sends nothing to OLIS. It is never part of `npm test` or `npm run check`.
//
//   --database  the SQLite file the ingest worker wrote (required)
//   --session   the Session whose questions to run (2025R1); the database must hold that Session
//   --since     what "since yesterday" means to the questions that say so: an ISO 8601 date or time. The day before
//               the database's own as-of time when it is not given, so a full build made months after the Session
//               needs it (for 2025R1 question (a): 2025-01-23).
// MODEL_PATH names the embedding model's directory as for the server; unset, it is the one `npm run model:fetch` fills.
import { argv, exit } from "node:process";
import { parseArgs } from "node:util";
import { modelLockPath, readModelLock } from "#/packages/embedder/lock.ts";
import { loadOnnxEmbedder } from "#/packages/embedder/onnx.ts";
import { modelDirectory } from "../model/files.ts";
import { formatReport, runEvaluation } from "./runner.ts";

const usage = "usage: node scripts/eval/run.ts --database <path> [--session 2025R1] [--since <iso>]";

try {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      database: { type: "string" },
      session: { type: "string", default: "2025R1" },
      since: { type: "string" },
    },
    strict: true,
  });
  if (values.database === undefined) {
    console.error(`eval: --database is required\n${usage}`);
    exit(2);
  }
  const modelPath = modelDirectory(readModelLock());
  const embedder = await loadOnnxEmbedder({ modelPath, lockPath: modelLockPath, intraOpThreads: 1 });
  const report = await runEvaluation({
    databasePath: values.database,
    session: values.session,
    ...(values.since === undefined ? {} : { since: values.since }),
    embedder,
    modelPath,
  });
  console.log(formatReport(report));
  exit(report.passed ? 0 : 1);
} catch (error) {
  console.error(`eval: ${error instanceof Error ? error.message : String(error)}\n${usage}`);
  exit(2);
}
