// Vitest's global setup (ticket #47): makes the folder where the files of one test run keep the databases they share
// (test/support/system.ts, "SystemTemplate"), and removes it at the end. The folder is new for each run, so a template
// never outlives the code that built it. The workers inherit the variable.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The variable that carries the folder to the workers; test/support/system.ts reads it. */
export const templateCacheVariable = "SESSION_GATEWAY_TEMPLATE_CACHE";

export default function setup(): () => void {
  const folder = mkdtempSync(join(tmpdir(), "session-gateway-templates-"));
  process.env[templateCacheVariable] = folder;
  return () => {
    rmSync(folder, { recursive: true, force: true });
  };
}
