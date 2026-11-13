// Cuts a document's text into passages (spec #1 module 9: "passages stay under its 512-token limit").
/**
 * The version of the reading that cuts a Recording Log's text around its speaker turns (ADR-0066). The worker records it with
 * each log it cuts (`replacePassages`) and cuts the log again, from its stored text and turns with no fetch, when the recorded
 * version is not this one. BUMP IT BY HAND in any change that would change the Passages `splitAroundTurns` gives for the same
 * text and turns, or what the worker's loop in `ingest/index.ts` stores with them: a change to `search/lib/split.ts` and what it
 * calls, to `speakerTurnSpans` (`recording-log` package), to the embedder's Passage size (`maxPassageTokens`) and to
 * `replacePassages` in `database/writer.ts`. Without the bump a stored database keeps the old Passages. A change that leaves every
 * stored result as it was needs none. A cut made before schema step 10 counts as version 0, so this starts at 1.
 */
export const TURN_PASSAGES_READER_VERSION = 1;

export { splitPassages, splitAroundTurns, type TokenMeter, type TurnSpan } from "./lib/split.ts";
