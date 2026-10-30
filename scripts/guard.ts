// Guards for `npm run check` (root CLAUDE.md, "Toolchain"): a gate that runs the wrong compiler, or
// a boundary check that cruised nothing, still exits 0, so each guard runs the command itself and
// reads its output. Dependency-free, run by Node 26 as `node scripts/guard.ts <name>`.
//
//   tsc-version  `tsc --version` must report TypeScript 7.x. Under the ADR-0008 aliases `tsc` is
//                TypeScript 7 and `tsc6` is TypeScript 6; a changed alias would silently swap them.
//   boundaries   `depcruise src test` must pass and must have cruised more than 0 modules. Under
//                TypeScript 7 alone dependency-cruiser cruised 0 modules and still reported a pass.
//
// The commands are looked up on PATH, which `npm run` extends with node_modules/.bin.
import { spawnSync } from "node:child_process";

type Guard = {
  command: string;
  args: string[];
  /** Returns what is wrong with the command's output, or undefined when it is right. */
  problem: (output: string) => string | undefined;
};

const guards: Record<string, Guard> = {
  "tsc-version": {
    command: "tsc",
    args: ["--version"],
    problem: (output) =>
      /^Version 7\.\d+\.\d+/m.test(output)
        ? undefined
        : "tsc must report TypeScript 7.x (ADR-0008): check the @typescript/native and typescript aliases in package.json",
  },
  boundaries: {
    command: "depcruise",
    args: ["src", "test"],
    problem: (output) => {
      const match = /\b(\d+) modules\b/.exec(output);
      if (match === null) return "the boundary check did not say how many modules it cruised";
      return Number(match[1]) > 0
        ? undefined
        : "the boundary check cruised 0 modules, so it checked nothing (ADR-0008: dependency-cruiser needs the TypeScript 6 alias)";
    },
  },
};

const name = process.argv[2];
const guard = name === undefined ? undefined : guards[name];
if (name === undefined || guard === undefined) {
  console.error(`usage: node scripts/guard.ts <${Object.keys(guards).join("|")}>`);
  process.exit(2);
}

const result = spawnSync(guard.command, guard.args, { encoding: "utf8" });
const output = `${result.stdout}${result.stderr}`;
process.stdout.write(output);
if (result.error !== undefined) {
  console.error(`guard ${name}: could not run \`${guard.command} ${guard.args.join(" ")}\`: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`guard ${name}: \`${guard.command} ${guard.args.join(" ")}\` exited with ${String(result.status)}`);
  process.exit(1);
}
const problem = guard.problem(output);
if (problem !== undefined) {
  console.error(`guard ${name}: ${problem}`);
  process.exit(1);
}
