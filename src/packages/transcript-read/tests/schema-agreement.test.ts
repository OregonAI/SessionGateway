import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { describe, expect, test } from "vitest";
import { transcriptFileSchema, transcriptFormatVersion } from "../index.ts";

// Seam 4: the JSON Schema committed for the transcription tool (docs/schemas/transcript-v1.schema.json, ADR-0054) and
// the zod schema the read validates with say the same thing. The zod schema is turned into a JSON Schema and compared
// with the committed file, apart from the prose (title, description) and the draft marker. The rules JSON Schema cannot
// state (a word ends no earlier than it starts) are in the read alone, and ADR-0054 lists them.

type Node = Record<string, unknown>;
type CommittedSchema = {
  $schema: string;
  $id: string;
  properties: { format_version: { const: number; type: string }; model: Node; segments: Node };
};

const schemaPath = new URL("../../../../docs/schemas/transcript-v1.schema.json", import.meta.url);
const committed = JSON.parse(readFileSync(schemaPath, "utf8")) as CommittedSchema;

/**
 * The SHA-256 of docs/schemas/transcript-v1.schema.json, byte for byte. Version 1 is frozen once a tool writes it
 * (ADR-0054): editing the schema and the zod schema together keeps the agreement test green, so this fingerprint is
 * what turns red. A change to the format is a NEW file, transcript-v2.schema.json, a new format_version and a new
 * reader module, never an edit of v1; until the first merge of ticket #130 this value moves with the ticket.
 */
const V1_SCHEMA_SHA256 = "d5fc48f8e639dad2f113895ac7f00c62ad3a5cee20956c780471e8d6ebac73a0";

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

  test("the format version is an integer fixed at 1, and beam_size is an integer with no upper bound artifact", () => {
    expect(committed.properties.format_version).toMatchObject({ type: "integer", const: 1 });
    const settings = (committed.properties.model as { properties: { settings: { properties: { beam_size: Node } } } })
      .properties.settings.properties;
    expect(settings.beam_size).toMatchObject({ type: "integer", minimum: 1 });
    expect(settings.beam_size).not.toHaveProperty("maximum");
  });

  test("a segment may carry faster-whisper's avg_logprob, compression_ratio, no_speech_prob and temperature, and no other key", () => {
    const segment = (
      committed.properties.segments as {
        items: { properties: Node; required: string[]; additionalProperties: boolean };
      }
    ).items;
    expect(Object.keys(segment.properties).toSorted()).toEqual(
      ["avg_logprob", "compression_ratio", "end", "no_speech_prob", "start", "temperature", "text", "words"].toSorted(),
    );
    expect(segment.required.toSorted()).toEqual(["end", "start", "text", "words"]);
    expect(segment.additionalProperties).toBe(false);
    expect(segment.properties).not.toHaveProperty("id");
    expect(segment.properties).not.toHaveProperty("seek");
    expect(segment.properties).not.toHaveProperty("tokens");
  });
});

describe("version 1 is frozen", () => {
  test("the committed schema is the one fingerprinted here; a change to the format needs a transcript-v2 file", () => {
    const sha256 = createHash("sha256").update(readFileSync(schemaPath)).digest("hex");
    expect(
      sha256,
      "docs/schemas/transcript-v1.schema.json changed. Version 1 never changes once a tool writes it (ADR-0054): " +
        "add transcript-v2.schema.json, a new format_version and a new reader module instead.",
    ).toBe(V1_SCHEMA_SHA256);
  });
});
