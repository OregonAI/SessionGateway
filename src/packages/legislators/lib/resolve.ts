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
  /** Every Legislator Code the resolver can resolve, with the Legislator it names: a person can have several. */
  codes: readonly { code: string; legislator: Legislator }[];
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
  /** The alias file's entries, as `readLegislatorAliases` returns them. Those of another Session are ignored. */
  aliases: readonly LegislatorAlias[];
};

/** Orders text by its code units, so the report reads the same on every machine. */
function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** What the alias file says in this Session, sorted by what each entry does. */
type AliasPlan = {
  /** Alias code -> the code with a row that it is the same person as. Only where that row exists. */
  movedTo: Map<string, string>;
  /** The reverse: a code with a row -> the alias code that also names the person. */
  movedFrom: Map<string, string>;
  /** People the Legislators rows do not list at all. */
  people: { code: string; firstName: string; lastName: string }[];
};

function planAliases(input: ResolverInput, rowByCode: ReadonlyMap<string, LegislatorRow>): AliasPlan {
  const plan: AliasPlan = { movedTo: new Map(), movedFrom: new Map(), people: [] };
  for (const alias of input.aliases) {
    if (alias.session !== input.session) continue;
    const target = alias.target;
    switch (target.kind) {
      case "same-person-as":
        // The person the entry names may not be in the feed yet (the Legislators snapshot lags): then
        // the entry does nothing until their row appears.
        if (rowByCode.has(target.code)) {
          plan.movedTo.set(alias.code, target.code);
          plan.movedFrom.set(target.code, alias.code);
        }
        break;
      case "person":
        plan.people.push({ code: alias.code, firstName: target.firstName, lastName: target.lastName });
        break;
      default:
        return target satisfies never;
    }
  }
  return plan;
}

/**
 * A Legislator Code that has a Legislators row is that row's Legislator. One that has none is looked
 * up in the alias file. One in neither stays unresolved: the resolver never guesses a person from a
 * code's look.
 *
 * A "same person as" entry joins its code to the code it names, whether or not the old code still has
 * a row of its own: they are one Legislator, named by the row of the code it names, and its id is the
 * one the entry's code makes. So the id is the same in a snapshot that lists only the old code (which
 * then makes the id from its own row), only the new one, or both.
 */
export function createLegislatorResolver(input: ResolverInput): LegislatorResolver {
  const rowByCode = new Map<string, LegislatorRow>();
  for (const row of input.rows) {
    if (rowByCode.has(row.code)) throw new Error(`The Legislators rows list the Legislator Code "${row.code}" twice`);
    rowByCode.set(row.code, row);
  }
  const aliases = planAliases(input, rowByCode);

  const byCode = new Map<string, Legislator>();
  const codeOfId = new Map<string, string>();

  /** Two people with one id would merge people in silence, so they stop the build. */
  function add(idCode: string, lastName: string, name: string, codes: readonly string[]): void {
    const id = legislatorIdOf(input.session, idCode, lastName);
    const other = codeOfId.get(id);
    if (other !== undefined) {
      throw new Error(`The Legislator Codes "${other}" and "${idCode}" would both have the id ${id}`);
    }
    const legislator = { id, name };
    codeOfId.set(id, idCode);
    for (const code of codes) byCode.set(code, legislator);
  }

  for (const row of input.rows) {
    // The row of a code that moved is the same person as the row of the code it moved to, which makes them.
    if (aliases.movedTo.has(row.code)) continue;
    const oldCode = aliases.movedFrom.get(row.code);
    const name = `${row.firstName} ${row.lastName}`;
    if (oldCode === undefined) add(row.code, row.lastName, name, [row.code]);
    else add(oldCode, row.lastName, name, [row.code, oldCode]);
  }
  for (const person of aliases.people) {
    // A code that has a row never needs a "person" entry: the row wins.
    if (!byCode.has(person.code)) {
      add(person.code, person.lastName, `${person.firstName} ${person.lastName}`, [person.code]);
    }
  }

  // code -> source -> how many times that source used the code
  const unresolvedCounts = new Map<string, Map<string, number>>();

  return {
    people: [...new Set(byCode.values())],
    codes: [...byCode.entries()].map(([code, legislator]) => ({ code, legislator })),
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
