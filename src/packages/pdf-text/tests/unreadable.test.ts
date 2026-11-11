import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { extractPdfLinks, extractPdfText } from "../index.ts";

// Seam 4: the pdf-text entry points `extractPdfText` and `extractPdfLinks` on a file that needs a password (ticket #178).
// Such a file is a property of what OLIS serves, not a bug, so both come back `unreadable` with a reason that names the
// password, as for bytes that are not a PDF, and neither throws. THE FILE IS MADE UP: one blank page, AES-128, a user
// password (test/fixtures/made-up/README.md says how it was written). The case of the whole pull is seam 1's
// (test/tools/get-document-pull.test.ts, ticket #178).

const PASSWORD_PROTECTED = new URL("../../../../test/fixtures/made-up/password-protected.pdf", import.meta.url);

function passwordProtected(): Uint8Array {
  const bytes = new Uint8Array(readFileSync(PASSWORD_PROTECTED));
  // The README's hash: a replaced file fails here by name, not as a changed outcome.
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    "7a709222def642ea331a9515755d6f4648ec3222a86996b886783d00b4fda30e",
  );
  return bytes;
}

describe("a PDF that needs a user password (MADE UP)", () => {
  test("extractPdfText reports it unreadable, naming the password", async () => {
    await expect(extractPdfText(passwordProtected())).resolves.toEqual({
      kind: "unreadable",
      reason: expect.stringMatching(/password/i) as unknown,
    });
  });

  test("extractPdfLinks reports it unreadable, naming the password", async () => {
    await expect(extractPdfLinks(passwordProtected())).resolves.toEqual({
      kind: "unreadable",
      reason: expect.stringMatching(/password/i) as unknown,
    });
  });
});
