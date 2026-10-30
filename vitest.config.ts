import { defineConfig } from "vitest/config";

// The time zone is set here, in the process that starts the workers: setting TZ inside a test
// has no effect on Date (Vitest docs, "Time Zone Does Not Change in Worker Threads"). The zone is
// not Pacific, so code that quietly relies on local time fails (test/CLAUDE.md, "Time zone").
// The seam-1 harness refuses to start under the Pacific zone (test/support/), so a lost setting fails loudly.
process.env["TZ"] = "Asia/Kolkata";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
