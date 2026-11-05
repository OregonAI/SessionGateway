// Cuts a document's text into passages (spec #1 module 9: "passages stay under its 512-token limit").
export { splitPassages, splitAroundTurns, type TokenMeter, type TurnSpan } from "./lib/split.ts";
