// The small language a question set uses to say what must hold in what a tool returned (ticket #23). A check names a
// path into the tool's structured result and one thing that must hold of what the path finds. Everything here is
// plain data in and plain text out, so a question set needs no code.
//
// A path is names joined by dots, each name optionally followed by selectors in brackets:
//   `location.current`                          one value
//   `positions[*].position`                     every element of the list `positions`, and its `position`
//   `meetings[id=meeting-2025r1-slb-2025-01-30-0800].at`   the elements whose `id` is that text
//   `files[0].posting_ids`                      the first element
// A path with `[*]` or `[key=value]` finds a list (empty when nothing matches); any other path finds one value, or
// nothing when a name is missing from what the tool returned.
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

type Selector =
  | { kind: "key"; name: string }
  | { kind: "all" }
  | { kind: "index"; position: number }
  | { kind: "where"; key: string; value: string };

/** Reads a path's text; throws an Error naming the path when it is not one. */
export function parsePath(text: string): Selector[] {
  const selectors: Selector[] = [];
  let at = 0;
  while (at < text.length) {
    if (text[at] === "[") {
      const close = text.indexOf("]", at);
      if (close === -1) throw new Error(`The path "${text}" has a "[" with no "]"`);
      const inside = text.slice(at + 1, close);
      const where = /^([^=]+)=(.*)$/.exec(inside);
      if (inside === "*") selectors.push({ kind: "all" });
      else if (/^\d+$/.test(inside)) selectors.push({ kind: "index", position: Number(inside) });
      else if (where?.[1] !== undefined && where[2] !== undefined)
        selectors.push({ kind: "where", key: where[1], value: where[2] });
      else
        throw new Error(`The path "${text}" has the selector "[${inside}]", which is none of [*], [n] and [key=value]`);
      at = close + 1;
      if (text[at] === ".") at += 1;
      continue;
    }
    let end = at;
    while (end < text.length && text[end] !== "." && text[end] !== "[") end += 1;
    if (end === at) throw new Error(`The path "${text}" has an empty name at position ${at}`);
    selectors.push({ kind: "key", name: text.slice(at, end) });
    at = text[end] === "." ? end + 1 : end;
  }
  if (selectors.length === 0) throw new Error("A path is empty");
  return selectors;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * What a path finds in `root`: a list when the path selects with `[*]` or `[key=value]`, else the one value, or
 * undefined when a name is missing.
 */
export function find(root: unknown, path: string): unknown {
  let nodes: unknown[] = [root];
  let many = false;
  for (const selector of parsePath(path)) {
    switch (selector.kind) {
      case "key":
        nodes = nodes.flatMap((node) => (isRecord(node) && selector.name in node ? [node[selector.name]] : []));
        break;
      case "all":
        many = true;
        nodes = nodes.flatMap((node) => (Array.isArray(node) ? (node as unknown[]) : []));
        break;
      case "index":
        nodes = nodes.flatMap((node) => {
          const element: unknown = Array.isArray(node) ? (node as unknown[])[selector.position] : undefined;
          return element === undefined ? [] : [element];
        });
        break;
      case "where":
        many = true;
        nodes = nodes.flatMap((node) =>
          Array.isArray(node)
            ? (node as unknown[]).filter(
                (element) => isRecord(element) && String(element[selector.key]) === selector.value,
              )
            : [],
        );
        break;
      default:
        return selector satisfies never;
    }
  }
  return many ? nodes : nodes[0];
}

// A check is a path and exactly one of these (`equals`, `includes`, `includesText`, `atLeast`, `length`, `present`).
// The YAML a question set is written in has null, numbers, text, lists and maps, which is JSON's set (z.json()), so
// `equals` can name any of them.
const json = z.json();
export const checkSchema = z.union([
  z.strictObject({ path: z.string(), equals: json }),
  z.strictObject({ path: z.string(), includes: z.union([z.string(), z.array(json)]) }),
  // Ticket #129: one text the path finds contains the words (all of them, when several), for a long text that a
  // list's `includes` cannot say whole, such as a player link of which the question knows its page and its second.
  z.strictObject({ path: z.string(), includesText: z.union([z.string(), z.array(z.string())]) }),
  z.strictObject({ path: z.string(), atLeast: z.number() }),
  z.strictObject({ path: z.string(), length: z.number().int().nonnegative() }),
  z.strictObject({ path: z.string(), present: z.boolean() }),
]);
export type Check = z.infer<typeof checkSchema>;

/** A value as a reason shows it: JSON, cut short, or "absent". */
function show(value: unknown): string {
  if (value === undefined) return "absent";
  const text = JSON.stringify(value);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

const sizeOf = (value: unknown): number | undefined =>
  Array.isArray(value) ? (value as unknown[]).length : typeof value === "string" ? value.length : undefined;

/** Whether `text` contains `words`, a word that ends in a digit not being followed by a digit in the text. */
function hasWord(text: string, words: string): boolean {
  const endsInDigit = /\d$/.test(words);
  for (let at = text.indexOf(words); at !== -1; at = text.indexOf(words, at + 1)) {
    if (!endsInDigit || !/\d/.test(text.charAt(at + words.length))) return true;
  }
  return false;
}

/** Why `result` fails the check, or undefined when it holds. */
export function problemWith(result: unknown, check: Check): string | undefined {
  const value = find(result, check.path);
  const got = `and it is ${show(value)}`;
  if ("equals" in check) {
    return isDeepStrictEqual(value, check.equals)
      ? undefined
      : `${check.path} should equal ${show(check.equals)}, ${got}`;
  }
  if ("includes" in check) {
    const wanted: unknown[] = typeof check.includes === "string" ? [check.includes] : check.includes;
    const missing = wanted.filter((item) => {
      if (Array.isArray(value)) return !(value as unknown[]).some((element) => isDeepStrictEqual(element, item));
      if (typeof value === "string") return typeof item !== "string" || !value.includes(item);
      return true;
    });
    return missing.length === 0 ? undefined : `${check.path} should include ${missing.map(show).join(", ")}, ${got}`;
  }
  if ("includesText" in check) {
    const wanted = typeof check.includesText === "string" ? [check.includesText] : check.includesText;
    const texts = (Array.isArray(value) ? (value as unknown[]) : [value]).filter(
      (element): element is string => typeof element === "string",
    );
    // All the words in ONE text; a word that ends in a digit is not followed by another digit ("=70" is not in "=708").
    if (texts.some((text) => wanted.every((words) => hasWord(text, words)))) return undefined;
    const missing = wanted.filter((words) => !texts.some((text) => hasWord(text, words)));
    return missing.length > 0
      ? `${check.path} should have a text that includes ${missing.map(show).join(", ")}, ${got}`
      : `${check.path} should have one text that includes ${wanted.map(show).join(" and ")}, ${got}`;
  }
  if ("atLeast" in check) {
    const count = typeof value === "number" ? value : sizeOf(value);
    return count !== undefined && count >= check.atLeast
      ? undefined
      : `${check.path} should be at least ${check.atLeast}, ${got}`;
  }
  if ("length" in check) {
    const size = sizeOf(value);
    return size === check.length
      ? undefined
      : `${check.path} should have ${check.length} items, and it has ${size === undefined ? "none (it is not a list or text)" : size}`;
  }
  const there = value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);
  return there === check.present
    ? undefined
    : `${check.path} should be ${check.present ? "present" : "absent"}, ${got}`;
}
