import { mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A SQLite file in a directory of its own. WAL cannot run in memory, so a database needs a file. */
export type TempDatabase = {
  path: string;
  remove(): void;
};

export function createTempDatabase(): TempDatabase {
  const directory = mkdtempDisposableSync(join(tmpdir(), "session-gateway-test-"));
  return {
    path: join(directory.path, "index.db"),
    remove: () => {
      directory.remove();
    },
  };
}
