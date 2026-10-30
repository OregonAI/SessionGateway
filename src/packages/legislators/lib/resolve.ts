import type { SessionKey } from "#/packages/domain/index.ts";
import { legislatorIdOf, type Legislator, type LegislatorRow } from "#/packages/domain/legislators.ts";
import type { LegislatorAlias } from "./alias-file.ts";

/** What a Legislator Code comes to: a Legislator, or nothing the resolver may name. */
export type Resolution = { kind: "resolved"; legislator: Legislator } | { kind: "unresolved"; code: string };

/** A Legislator Code the resolver could not resolve, and how often each source of codes used it. */
export type UnresolvedLegislatorCode = {
  code: string;
  references: { source: string; count: number }[];
};

export type LegislatorResolver = {
  /** Every Legislator the resolver can name, one entry per person. */
  people: readonly Legislator[];
  /**
   * Resolves a code that `source` (an entity set, such as "MeasureSponsors") used. A code that does not
   * resolve is counted against its source, for the report.
   */
  resolve(source: string, code: string): Resolution;
  /** Every code that did not resolve so far, by code, with how many times each source used it. */
  unresolved(): UnresolvedLegislatorCode[];
};

export type ResolverInput = {
  session: SessionKey;
  /** The Session's Legislators rows. */
  rows: readonly LegislatorRow[];
  /** The alias file's entries. Those of another Session are ignored. */
  aliases: readonly LegislatorAlias[];
};

/** Orders text by its code units, so the report reads the same on every machine. */
function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

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
  // An alias can name only a code that has a Legislators row, never another alias, so the order of
  // the alias file does not matter.
  const rowCodes = new Map(byCode);

  for (const alias of input.aliases) {
    if (alias.session !== input.session || byCode.has(alias.code)) continue;
    if (alias.target.kind === "person") {
      add(alias.code, alias.target.lastName, `${alias.target.firstName} ${alias.target.lastName}`);
    } else {
      // The person the alias names may not be in the feed yet (the Legislators snapshot lags): then
      // the code stays unresolved until their row appears.
      const person = rowCodes.get(alias.target.code);
      if (person !== undefined) byCode.set(alias.code, person);
    }
  }

  // code -> source -> how many times that source used the code
  const unresolvedCounts = new Map<string, Map<string, number>>();

  return {
    people: [...new Set(byCode.values())],
    resolve(source, code) {
      const legislator = byCode.get(code);
      if (legislator !== undefined) return { kind: "resolved", legislator };
      const sources = unresolvedCounts.get(code) ?? new Map<string, number>();
      sources.set(source, (sources.get(source) ?? 0) + 1);
      unresolvedCounts.set(code, sources);
      return { kind: "unresolved", code };
    },
    unresolved() {
      return [...unresolvedCounts.entries()]
        .sort(([a], [b]) => compareText(a, b))
        .map(([code, sources]) => ({
          code,
          references: [...sources.entries()].map(([source, count]) => ({ source, count })),
        }));
    },
  };
}
