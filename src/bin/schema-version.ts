// Prints the schema version this image knows and, given a database, the version that file records, as one JSON line:
// `{"image":3}` or `{"image":3,"database":1}`, where `"database":null` is a path with no file (ticket #146,
// OregonAI/platform-deploy#45's schema gate). The database is opened read-only and never upgraded, and nothing is sent
// to OLIS. Exit 0 whenever it answers; non-zero on an argument it does not know and on a file it cannot read.
import { databaseSchemaVersion, imageSchemaVersion } from "#/packages/database/schema-version.ts";

const usage = "usage: node src/bin/schema-version.ts [--database <path>]";

function fail(message: string): never {
  process.stderr.write(`${message}\n${usage}\n`);
  process.exit(2);
}

const args = process.argv.slice(2);
let databasePath: string | undefined;
if (args.length === 2 && args[0] === "--database" && args[1] !== undefined && args[1] !== "") {
  databasePath = args[1];
} else if (args.length > 0) {
  fail(args[0] === "--database" ? "--database needs a path" : `unknown argument ${args.join(" ")}`);
}

let answer: { image: number; database?: number | null };
try {
  answer =
    databasePath === undefined
      ? { image: imageSchemaVersion }
      : { image: imageSchemaVersion, database: databaseSchemaVersion(databasePath) };
} catch (error) {
  process.stderr.write(`cannot read the schema version of ${databasePath ?? ""}: ${String(error)}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify(answer)}\n`);
