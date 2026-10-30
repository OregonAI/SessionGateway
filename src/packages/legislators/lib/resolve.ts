import type { SessionKey } from "#/packages/domain/index.ts";
import { legislatorIdOf, type Legislator, type LegislatorRow } from "#/packages/domain/legislators.ts";
import type { LegislatorAlias } from "./alias-file.ts";

/** What a Legislator Code comes to: a Legislator, or nothing the resolver may name. */
export type Resolution = { kind: "resolved"; legislator: Legislator } | { kind: "unresolved"; code: string };

export type LegislatorResolver = {
  /** Every Legislator the resolver can name, one entry per person. */
  people: readonly Legislator[];
  resolve(code: string): Resolution;
};

export type ResolverInput = {
  session: SessionKey;
  /** The Session's Legislators rows. */
  rows: readonly LegislatorRow[];
  /** The alias file's entries. Those of another Session are ignored. */
  aliases: readonly LegislatorAlias[];
};

/**
 * A Legislator Code that has a Legislators row is that row's Legislator. One that has none is looked
 * up in the alias file. One in neither stays unresolved: the resolver never guesses a person from a
 * code's look.
 */
export function createLegislatorResolver(input: ResolverInput): LegislatorResolver {
  const byCode = new Map<string, Legislator>();
  const codeOfId = new Map<string, string>();

  /** Two people with one id, or one code twice, would merge people in silence, so they stop the build. */
  function add(code: string, lastName: string, name: string): Legislator {
    if (byCode.has(code)) throw new Error(`The Legislators rows list the Legislator Code "${code}" twice`);
    const id = legislatorIdOf(input.session, code, lastName);
    const other = codeOfId.get(id);
    if (other !== undefined) {
      throw new Error(`The Legislator Codes "${other}" and "${code}" would both have the id ${id}`);
    }
    const legislator = { id, name };
    byCode.set(code, legislator);
    codeOfId.set(id, code);
    return legislator;
  }

  for (const row of input.rows) add(row.code, row.lastName, `${row.firstName} ${row.lastName}`);

  for (const alias of input.aliases) {
    if (alias.session !== input.session || byCode.has(alias.code)) continue;
    if (alias.target.kind === "person") {
      add(alias.code, alias.target.lastName, `${alias.target.firstName} ${alias.target.lastName}`);
    } else {
      // The person the alias names may not be in the feed yet (the Legislators snapshot lags): then
      // the code stays unresolved until their row appears.
      const person = byCode.get(alias.target.code);
      if (person !== undefined) byCode.set(alias.code, person);
    }
  }

  return {
    people: [...new Set(byCode.values())],
    resolve(code) {
      const legislator = byCode.get(code);
      return legislator === undefined ? { kind: "unresolved", code } : { kind: "resolved", legislator };
    },
  };
}
