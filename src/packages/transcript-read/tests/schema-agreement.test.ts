import { readFileSync } from "node:fs";
import { z } from "zod";
import { describe, expect, test } from "vitest";
import { transcriptFileSchema, transcriptFormatVersion } from "../index.ts";

// Seam 4: the JSON Schema committed for the transcription tool (docs/schemas/transcript-v1.schema.json, ADR-0053) and
// the zod schema the read validates with say the same thing. The zod schema is turned into a JSON Schema and compared
// with the committed file, apart from the prose (title, description) and the draft marker. The rules JSON Schema cannot
// state (a word ends no earlier than it starts) are in the read alone, and ADR-0053 lists them.

const committed = JSON.parse(
  readFileSync(new URL("../../../../docs/schemas/transcript-v1.schema.json", import.meta.url), "utf8"),
);

function withoutProse(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutProse);
  if (node === null || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => !["title", "description", "$schema", "$id"].includes(key))
      .map(([key, value]) => [key, withoutProse(value)]),
  );
}

describe("the committed JSON Schema and the read's zod schema agree", () => {
  test("they describe the same document", () => {
    const generated = z.toJSONSchema(transcriptFileSchema, { target: "draft-2020-12", io: "input" });
    expect(withoutProse(committed)).toEqual(withoutProse(generated));
  });

  test("the schema carries the format version, and a draft and an address the tool can vendor it from", () => {
    expect(committed.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(committed.$id).toBe(
      "https://raw.githubusercontent.com/OregonAI/SessionGateway/main/docs/schemas/transcript-v1.schema.json",
    );
    expect(committed.properties.format_version.const).toBe(transcriptFormatVersion);
    expect(transcriptFormatVersion).toBe(1);
  });
});
