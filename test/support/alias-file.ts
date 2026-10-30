import { mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** An alias file in a directory of its own, for a test that needs the worker to read another one. */
export type TempAliasFile = {
  path: string;
  remove(): void;
};

/** Writes `content` as the file's JSON (or as it is, when it is text, to make an unparsable file). */
export function createTempAliasFile(content: unknown): TempAliasFile {
  const directory = mkdtempDisposableSync(join(tmpdir(), "session-gateway-aliases-"));
  const path = join(directory.path, "legislator-aliases.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return {
    path,
    remove: () => {
      directory.remove();
    },
  };
}
