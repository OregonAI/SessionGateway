import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseSessionKey, type SessionKey } from "#/packages/domain/index.ts";

/** Who a Legislator Code without a Legislators row is. */
export type AliasTarget =
  { kind: "same-person-as"; code: string } | { kind: "person"; firstName: string; lastName: string };

/** One entry of the alias file. The evidence it cites is checked to be there and is for the reader. */
export type LegislatorAlias = {
  session: SessionKey;
  code: string;
  target: AliasTarget;
};

const sessionKey = z.string().transform((text, context) => {
  const parsed = parseSessionKey(text);
  if (parsed === undefined) {
    context.addIssue({ code: "custom", message: "must be an OLIS Session key such as 2025R1" });
    return z.NEVER;
  }
  return parsed;
});

const text = z.string().trim().min(1);

// Every entry cites at least one piece of evidence from the feed (ticket #8).
const evidence = z.strictObject({ entity_set: text, row: text, says: text });
const entry = { session: sessionKey, code: text, evidence: z.array(evidence).min(1) };

const aliasFile = z.strictObject({
  about: z.string(),
  aliases: z.array(
    z.union([
      z.strictObject({ ...entry, same_person_as: text }).transform((alias): LegislatorAlias => ({
        session: alias.session,
        code: alias.code,
        target: { kind: "same-person-as", code: alias.same_person_as },
      })),
      z
        .strictObject({ ...entry, person: z.strictObject({ first_name: text, last_name: text }) })
        .transform((alias): LegislatorAlias => ({
          session: alias.session,
          code: alias.code,
          target: { kind: "person", firstName: alias.person.first_name, lastName: alias.person.last_name },
        })),
    ]),
  ),
});

/** Parses the alias file's content. A file that breaks the rules above is an error that names the problem. */
export function parseAliasFile(content: unknown): LegislatorAlias[] {
  const result = aliasFile.safeParse(content);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`The Legislator alias file is not what the resolver reads: ${problems.join("; ")}`, {
      cause: result.error,
    });
  }
  const seen = new Set<string>();
  const codeOfTarget = new Map<string, string>();
  for (const alias of result.data.aliases) {
    const key = `${alias.session} ${alias.code}`;
    if (seen.has(key)) throw new Error(`The Legislator alias file lists "${alias.code}" twice for ${alias.session}`);
    seen.add(key);
    if (alias.target.kind !== "same-person-as") continue;
    // The person's id is made from the entry's code, so a person with two codes to make it from has no one id.
    const targetKey = `${alias.session} ${alias.target.code}`;
    const other = codeOfTarget.get(targetKey);
    if (other !== undefined) {
      throw new Error(
        `The Legislator alias file names "${alias.target.code}" as the same person for both "${other}" and "${alias.code}" in ${alias.session}`,
      );
    }
    codeOfTarget.set(targetKey, alias.code);
  }
  for (const alias of result.data.aliases) {
    if (alias.target.kind !== "same-person-as" || !seen.has(`${alias.session} ${alias.target.code}`)) continue;
    throw new Error(
      `The Legislator alias file names "${alias.target.code}" as the same person for "${alias.code}" in ${alias.session}, but "${alias.target.code}" has an entry of its own: an entry names a code that has a Legislators row`,
    );
  }
  return result.data.aliases;
}

/** Where the alias file committed with the code is: beside the package's other implementation files. */
export const committedAliasFilePath = fileURLToPath(new URL("../data/legislator-aliases.json", import.meta.url));

/** Reads and parses the alias file at `path`. The entry script chooses the path and passes it down. */
export function readAliasFile(path: string): LegislatorAlias[] {
  let content: unknown;
  try {
    content = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`The Legislator alias file at "${path}" could not be read as JSON`, { cause: error });
  }
  return parseAliasFile(content);
}
