// `npm run check`: the whole gate. Runs each npm script named on the command line, in order, and
// keeps going after a failure so one run shows every broken step. Prints a summary and exits 1 if
// any step failed. package.json says which steps make up the gate; this file only runs them.
// Dependency-free, run by Node 26 as `node scripts/check.ts <script> [<script> ...]`.
import { spawn } from "node:child_process";

type StepResult = { name: string; passed: boolean; seconds: number; detail: string };

/** Lines of a step's output worth repeating in the summary (test totals, modules cruised, ...). */
const detailPatterns: Record<string, RegExp[]> = {
  "guard:tsc": [/^Version .*/m],
  "lint:boundaries": [/(?:\d+ modules,).*cruised/m],
  "fixture:verify": [/^verify: .*/m],
  test: [/^\s*Test Files\s+.*/m, /^\s*Tests\s+.*/m],
};

function detailOf(name: string, output: string): string {
  const lines: string[] = [];
  for (const pattern of detailPatterns[name] ?? []) {
    const match = pattern.exec(output);
    if (match !== null) lines.push(match[0].trim().replace(/\s+/g, " "));
  }
  return lines.join(" | ");
}

function runStep(name: string): Promise<StepResult> {
  console.log(`\n=== ${name} ===`);
  const started = performance.now();
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", "--silent", name], {
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    let output = "";
    const keep = (chunk: Buffer): void => {
      output += chunk.toString();
      process.stdout.write(chunk);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const finish = (passed: boolean): void => {
      resolve({
        name,
        passed,
        seconds: (performance.now() - started) / 1000,
        detail: detailOf(name, output),
      });
    };
    child.on("error", (error) => {
      console.error(`could not start npm: ${error.message}`);
      finish(false);
    });
    child.on("close", (code) => {
      finish(code === 0);
    });
  });
}

const steps = process.argv.slice(2);
if (steps.length === 0) {
  console.error("usage: node scripts/check.ts <npm script> [<npm script> ...]");
  process.exit(2);
}

const results: StepResult[] = [];
for (const step of steps) results.push(await runStep(step));

console.log("\n=== check summary ===");
for (const result of results) {
  const mark = result.passed ? "PASS" : "FAIL";
  const detail = result.detail === "" ? "" : `  ${result.detail}`;
  console.log(`${mark}  ${result.name.padEnd(16)} ${result.seconds.toFixed(1).padStart(5)}s${detail}`);
}
const failed = results.filter((result) => !result.passed);
if (failed.length > 0) {
  console.log(`\ncheck FAILED: ${failed.map((result) => result.name).join(", ")}`);
  process.exit(1);
}
console.log("\ncheck passed");
