import { defineConfig } from "vitest/config";

// The time zone is set here, in the process that starts the workers: setting TZ inside a test
// has no effect on Date (Vitest docs, "Time Zone Does Not Change in Worker Threads"). The zone is
// not Pacific, so code that quietly relies on local time fails (test/CLAUDE.md, "Time zone").
// The seam-1 harness refuses to start under the Pacific zone (test/support/), so a lost setting fails loudly.
process.env["TZ"] = "Asia/Kolkata";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Seam-1 tests start a system and pull the fixture; on a loaded machine that outlasts Vitest's 5 s
    // default, so every file gets 60 s (test/CLAUDE.md, "Timeouts under load"). A file that needs more
    // says so with vi.setConfig.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    globalSetup: ["test/support/template-cache.ts"],
  },
});
