// The transcript file format, version 1 (ADR-0054). docs/schemas/transcript-v1.schema.json is this schema as JSON Schema,
// and a test holds the two together. A change to the format is a new version, a new schema file and a new module here,
// never an edit of this one; the version only increases.
import { z } from "zod";

/** The versions of the format this service reads. The newest is last. */
export const knownFormatVersions = [1] as const;
export const transcriptFormatVersion = 1;

const seconds = z.number().min(0);

const word = z
  .strictObject({
    start: seconds.describe("Second of the audio at which the word starts."),
    end: seconds.describe("Second of the audio at which the word ends."),
    text: z.string().describe("The word as the model wrote it, with any leading space and punctuation it carries."),
    probability: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("The model's probability for the word, when it gives one."),
  })
  .describe("One word with its timing.");

const segment = z
  .strictObject({
    start: seconds.describe("Second of the audio at which the segment starts."),
    end: seconds.describe("Second of the audio at which the segment ends."),
    text: z.string().describe("The segment's text."),
    words: z.array(word).describe("The segment's words in order. May be empty when the model gave none."),
  })
  .describe("One stretch of speech the model wrote as a unit.");

/** What a version-1 file holds: one Meeting's machine transcript. */
export const transcriptFileSchema = z
  .strictObject({
    format_version: z.literal(transcriptFormatVersion).describe("The version of this format. It only increases."),
    event_id: z
      .string()
      .min(1)
      .describe("The Invintus event ID of the Meeting's recording, as the Recording Log's player link gives it."),
    audio: z
      .strictObject({
        sha256: z
          .string()
          .regex(/^[0-9a-f]{64}$/)
          .describe("SHA-256 of the audio file that was transcribed, as 64 lower-case hex digits."),
        duration_seconds: seconds.describe("Length of the audio in seconds."),
      })
      .describe("The audio that was transcribed. The audio itself is never kept."),
    model: z
      .strictObject({
        id: z.string().min(1).describe("Identifies the model weights used (name and revision)."),
        settings: z
          .strictObject({
            model_name: z.string().min(1).describe("The faster-whisper model name, such as small.en."),
            device: z.string().min(1).describe("The device it ran on, such as cpu or cuda."),
            compute_type: z.string().min(1).describe("The compute type, such as int8 or float16."),
            language: z.string().min(1).describe("The language the model was told to expect, such as en."),
            beam_size: z.number().int().min(1).describe("The beam size."),
          })
          .describe("The settings the model ran with."),
      })
      .describe("The model that made the transcript."),
    made_at: z.iso
      .datetime({ offset: true })
      .describe("When the transcript was made, as an ISO 8601 time with its offset."),
    segments: z.array(segment).describe("The transcript, in the order of the audio."),
  })
  .describe("One Meeting's machine transcript: the contract between the transcription tool and SessionGateway.");

/** The rules JSON Schema cannot state; the read applies them and ADR-0054 lists them. */
export function orderProblems(file: z.infer<typeof transcriptFileSchema>): { path: string; message: string }[] {
  const problems: { path: string; message: string }[] = [];
  file.segments.forEach((s, i) => {
    if (s.end < s.start) problems.push({ path: `segments.${i}`, message: "ends before it starts" });
    s.words.forEach((w, j) => {
      if (w.end < w.start) problems.push({ path: `segments.${i}.words.${j}`, message: "ends before it starts" });
    });
  });
  return problems;
}
