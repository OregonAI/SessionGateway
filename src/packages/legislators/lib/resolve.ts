import { legislatorIdOf, type Legislator, type LegislatorRow } from "#/packages/domain/legislators.ts";
import type { SessionKey } from "#/packages/domain/index.ts";

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
};

export function createLegislatorResolver(input: ResolverInput): LegislatorResolver {
  const byCode = new Map<string, Legislator>();
  for (const row of input.rows) {
    byCode.set(row.code, { id: legislatorIdOf(input.session, row.code), name: `${row.firstName} ${row.lastName}` });
  }
  return {
    people: [...byCode.values()],
    resolve(code) {
      const legislator = byCode.get(code);
      return legislator === undefined ? { kind: "unresolved", code } : { kind: "resolved", legislator };
    },
  };
}
