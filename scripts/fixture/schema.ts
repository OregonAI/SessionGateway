// What the fixture scripts know about the OLIS feed: each entity set's key, which of its
// properties refer to rows in other entity sets, and which rows link a downloadable document.
//
// build.ts uses this to decide which rows a Measure drags in. verify.ts uses the same table to
// check that every reference resolves inside the fixture, so the two cannot disagree about
// what refers to what. The shapes of the two files build.ts writes and verify.ts reads
// (manifest.json and unresolved.json) are declared here too, once, for the same reason.
// Source: docs/research/olis-odata.md section 2 ($metadata) and section 8.
//
// Property names are the feed's own, misspellings included: CommitteCode (on agenda items),
// CommittteCode (on analysis documents) and LegislatoreCode (on sponsors) are what OLIS
// serves. Do not "fix" them: the fixture keeps the feed verbatim.
//
// This file imports nothing, runs under Node type stripping, and uses erasable syntax only.

export type Row = Record<string, unknown>;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A reference from one row's properties to a row in another entity set. */
export type Ref = {
  /** The property that carries the reference, as the feed spells it. Used in messages. */
  property: string;
  /** The entity set the reference points into. */
  to: string;
  /** Target key property -> the property on this row that holds its value. */
  match: Record<string, string>;
};

export type EntitySpec = {
  /** The properties that identify a row when other rows refer to it. */
  key: string[];
  /**
   * The properties that name one row in unresolved.json and in messages, when the declared key is
   * not unique and a row needs more to be told apart. Absent: the key does. Only for a set that no
   * reference points at and whose rows link no document: build.ts and verify.ts look rows up by
   * `key` when they follow a reference or a manifest's linked_by, and both would then be wrong.
   */
  identity?: string[];
  /** True when the row carries SessionKey, MeasurePrefix and MeasureNumber (possibly null). */
  aboutMeasure: boolean;
  refs: Ref[];
};

// Reference builders. A reference whose source values include a null is no reference at all.
const measure: Ref = {
  property: "MeasureNumber",
  to: "Measures",
  match: { SessionKey: "SessionKey", MeasurePrefix: "MeasurePrefix", MeasureNumber: "MeasureNumber" },
};
const committee = (property: string): Ref => ({
  property,
  to: "Committees",
  match: { SessionKey: "SessionKey", CommitteeCode: property },
});
const meeting = (codeProperty: string): Ref => ({
  property: "MeetingDate",
  to: "CommitteeMeetings",
  match: { SessionKey: "SessionKey", CommitteeCode: codeProperty, MeetingDate: "MeetingDate" },
});
const legislator = (property: string): Ref => ({
  property,
  to: "Legislators",
  match: { SessionKey: "SessionKey", LegislatorCode: property },
});
const agendaItem: Ref = {
  property: "CommitteeAgendaItemId",
  to: "CommitteeAgendaItems",
  match: { CommitteeAgendaItemId: "CommitteeAgendaItemId" },
};

// Measures.CurrentSubCommittee is null on all 3,466 rows of 2025R1, so it is not treated as a
// reference until a non-null value shows what it holds.
export const entitySets: Record<string, EntitySpec> = {
  Measures: {
    key: ["SessionKey", "MeasurePrefix", "MeasureNumber"],
    aboutMeasure: true,
    refs: [committee("CurrentCommitteeCode")],
  },
  MeasureDocuments: {
    key: ["SessionKey", "MeasurePrefix", "MeasureNumber", "VersionDescription"],
    aboutMeasure: true,
    refs: [measure],
  },
  MeasureAnalysisDocuments: {
    key: ["MeasureAnalysisId"],
    aboutMeasure: true,
    refs: [measure, committee("CommittteCode")],
  },
  MeasureHistoryActions: {
    key: ["MeasureHistoryId"],
    aboutMeasure: true,
    refs: [measure],
  },
  MeasureVotes: {
    key: ["MeasureVoteId"],
    aboutMeasure: true,
    refs: [
      measure,
      {
        property: "MeasureHistoryId",
        to: "MeasureHistoryActions",
        match: { MeasureHistoryId: "MeasureHistoryId" },
      },
      legislator("VoteName"),
    ],
  },
  MeasureSponsors: {
    key: ["MeasureSponsorId"],
    aboutMeasure: true,
    refs: [measure, legislator("LegislatoreCode"), committee("CommitteeCode")],
  },
  Committees: {
    key: ["SessionKey", "CommitteeCode"],
    aboutMeasure: false,
    refs: [committee("ParentCommitteeCode")],
  },
  // The declared key is not unique (olis-odata.md section 8, gotcha 5), so nothing may point at
  // a CommitteeMembers row, and nothing in this table does. build.ts adds the rows of the
  // committees it keeps (ticket #81) and follows these references from them.
  // The declared key is shared by several rows, e.g. five members of JOCSS (measured on the full
  // 2025R1 cache on 2026-11-02: JOCSS|2025-05-30T16:19:00|Member, 5 rows), so a row is named by its
  // Legislator Code too. With it, no two of the 468 rows share a name.
  CommitteeMembers: {
    key: ["CommitteeCode", "CreatedDate", "Title"],
    identity: ["CommitteeCode", "CreatedDate", "Title", "LegislatorCode"],
    aboutMeasure: false,
    refs: [committee("CommitteeCode"), legislator("LegislatorCode")],
  },
  CommitteeStaffMembers: {
    key: ["CommitteeStaffId"],
    aboutMeasure: false,
    refs: [committee("CommitteeCode")],
  },
  CommitteeMeetings: {
    key: ["SessionKey", "CommitteeCode", "MeetingDate"],
    aboutMeasure: false,
    refs: [committee("CommitteeCode")],
  },
  CommitteeAgendaItems: {
    key: ["CommitteeAgendaItemId"],
    aboutMeasure: true,
    refs: [meeting("CommitteCode"), committee("CommitteCode"), measure],
  },
  CommitteeProposedAmendments: {
    key: ["ProposedAmendmentId"],
    aboutMeasure: true,
    refs: [agendaItem, meeting("CommitteeCode"), committee("CommitteeCode"), measure],
  },
  CommitteeVotes: {
    key: ["CommitteeVoteId"],
    aboutMeasure: true,
    refs: [agendaItem, meeting("CommitteeCode"), committee("CommitteeCode"), measure, legislator("VoteName")],
  },
  CommitteeMeetingDocuments: {
    key: ["CommitteeMeetingDocumentId"],
    aboutMeasure: true,
    refs: [meeting("CommitteeCode"), committee("CommitteeCode"), measure],
  },
  // The declared key has seven parts; CommTestId alone is unique in 2025R1 (gotcha 6).
  CommitteePublicTestimonies: {
    key: ["CommTestId"],
    aboutMeasure: true,
    refs: [meeting("CommitteeCode"), committee("CommitteeCode"), measure],
  },
  FloorSessionAgendaItems: {
    key: ["AgendaId"],
    aboutMeasure: true,
    refs: [measure, legislator("CarrierCode")],
  },
  FloorLetters: {
    key: ["FloorLetterId"],
    aboutMeasure: true,
    refs: [measure],
  },
  Legislators: {
    key: ["SessionKey", "LegislatorCode"],
    aboutMeasure: false,
    refs: [],
  },
  ConveneTimes: {
    key: ["SessionKey", "SessionDate", "Chamber"],
    aboutMeasure: false,
    refs: [],
  },
};

/** How a row names a downloadable document. */
export type DocumentLink = {
  /** Folder under documents/ and under the download cache. */
  kind: string;
  /**
   * Mean size of one such document, from docs/research/olis-odata.md section 7. The build uses
   * it to estimate a download before it starts. It sits on the link so a kind cannot be renamed
   * without its size. Floor letters were not sampled: 250 kB is a guess.
   */
  meanBytes: number;
  /** The row's document URL as the feed (or the OLIS testimony page) gives it. */
  url: (row: Row) => string;
  /** Path under the kind folder, without an extension. */
  stem: (row: Row) => string;
};

const slug = (text: unknown): string => String(text).replace(/[^A-Za-z0-9._-]+/g, "-");

export const documentLinks: Record<string, DocumentLink> = {
  MeasureDocuments: {
    kind: "measure-documents",
    meanBytes: 42_415,
    url: (r) => String(r["DocumentUrl"]),
    stem: (r) => `${slug(r["MeasurePrefix"])}${slug(r["MeasureNumber"])}/${slug(r["VersionDescription"])}`,
  },
  MeasureAnalysisDocuments: {
    kind: "measure-analysis-documents",
    meanBytes: 500_075,
    url: (r) => String(r["DocumentUrl"]),
    stem: (r) => slug(r["MeasureAnalysisId"]),
  },
  CommitteeProposedAmendments: {
    kind: "proposed-amendments",
    meanBytes: 40_907,
    url: (r) => String(r["ProposedAmendmentUrl"]),
    stem: (r) => slug(r["ProposedAmendmentId"]),
  },
  CommitteeMeetingDocuments: {
    kind: "committee-meeting-documents",
    meanBytes: 218_262,
    url: (r) => String(r["DocumentUrl"]),
    stem: (r) => slug(r["CommitteeMeetingDocumentId"]),
  },
  CommitteeMeetings: {
    kind: "committee-agendas",
    meanBytes: 101_925,
    url: (r) => String(r["AgendaUrl"]),
    stem: (r) =>
      `${slug(r["CommitteeCode"])}/${slug(
        String(r["MeetingDate"])
          .replace("T", "-")
          .replace(/:\d\d$/, ""),
      )}`,
  },
  // The feed's DocumentUrl for Testimony is always the session root (olis-odata.md section 8,
  // gotcha 2); the file lives under PublicTestimonyDocument/{CommTestId}.
  CommitteePublicTestimonies: {
    kind: "testimony",
    meanBytes: 77_397,
    url: (r) =>
      `https://olis.oregonlegislature.gov/liz/${String(r["SessionKey"])}/Downloads/PublicTestimonyDocument/${String(r["CommTestId"])}`,
    stem: (r) => slug(r["CommTestId"]),
  },
  FloorLetters: {
    kind: "floor-letters",
    meanBytes: 250_000,
    url: (r) => String(r["FloorLetterUrl"]),
    stem: (r) => slug(r["FloorLetterId"]),
  },
};

/** Rows whose link property is null link no document (an agenda may be absent). */
export function linkedDocumentUrl(entitySet: string, row: Row): string | null {
  const link = documentLinks[entitySet];
  if (link === undefined) return null;
  const raw = link.url(row);
  if (raw === "null" || raw === "undefined" || raw === "") return null;
  return encodeSourceUrl(raw);
}

/**
 * MeasureDocument URLs hold raw spaces ("Senate Amendments to Introduced"). The URL parser
 * percent-encodes them, and the encoded form is what is fetched and what the manifest records.
 */
export function encodeSourceUrl(raw: string): string {
  return new URL(raw).href;
}

/** A key as a lookup string. Values keep their JSON types, so 69 and "69" differ. */
export function keyString(values: unknown[]): string {
  return JSON.stringify(values);
}

// What the schema reads from each entity set's rows, and why: the key, the Measure the row is
// about, and every property a reference is made from. Built on first use.
const readsCache = new Map<string, Array<{ property: string; why: string }>>();

function readsOf(entitySet: string): Array<{ property: string; why: string }> {
  const known = readsCache.get(entitySet);
  if (known !== undefined) return known;
  const spec = entitySets[entitySet];
  const whys = new Map<string, Set<string>>();
  const read = (property: string, why: string): void => {
    whys.set(property, (whys.get(property) ?? new Set()).add(why));
  };
  if (spec !== undefined) {
    for (const property of spec.key) read(property, "part of its key");
    if (spec.aboutMeasure)
      for (const property of ["SessionKey", "MeasurePrefix", "MeasureNumber"])
        read(property, "says which Measure it is about");
    for (const ref of spec.refs) for (const property of Object.values(ref.match)) read(property, `refers to ${ref.to}`);
  }
  const reads = [...whys].map(([property, why]) => ({ property, why: [...why].join(", ") }));
  readsCache.set(entitySet, reads);
  return reads;
}

/**
 * The properties the schema reads from this row that the row does not have at all.
 *
 * valuesOf and targetKeyOf cannot tell such a property from one that is present and null, and
 * they must not: a null is a row that refers to nothing, which is legitimate. A property that is
 * absent is a different thing. OLIS respelled it, or the row was edited, and the reference it
 * carried would be skipped without a word. Callers check this first, so that case is an error.
 */
export function absentProperties(entitySet: string, row: Row): Array<{ property: string; why: string }> {
  return readsOf(entitySet).filter(({ property }) => !Object.hasOwn(row, property));
}

/** The values of `properties` on a row, or null when any of them is missing or null. */
export function valuesOf(row: Row, properties: string[]): unknown[] | null {
  const values: unknown[] = [];
  for (const property of properties) {
    const value = row[property];
    if (value === undefined || value === null) return null;
    values.push(value);
  }
  return values;
}

/** The target key a reference points at, in the target's own property order, or null when a source value is null or absent (see absentProperties). */
export function targetKeyOf(row: Row, ref: Ref): Record<string, unknown> | null {
  const target: Record<string, unknown> = {};
  for (const [targetProperty, sourceProperty] of Object.entries(ref.match)) {
    const value = row[sourceProperty];
    if (value === undefined || value === null) return null;
    target[targetProperty] = value;
  }
  return target;
}

/** The properties that name a row of this set: its `identity` when it declares one, otherwise its `key`. */
const identityProperties = (spec: EntitySpec): string[] => spec.identity ?? spec.key;

/**
 * The name of a row as an object (the values of identityProperties), for messages, unresolved.json
 * and the manifest's linked_by. It equals the row's key unless the set declares an `identity`; it
 * is not what other rows refer to (that is `key`, see targetKeyOf).
 */
export function rowIdentityOf(entitySet: string, row: Row): Record<string, unknown> {
  const spec = entitySets[entitySet];
  const name: Record<string, unknown> = {};
  if (spec === undefined) return name;
  for (const property of identityProperties(spec)) name[property] = row[property] ?? null;
  return name;
}

/** `Set[Prop=value, Prop=value]` for one line of output. */
export function describeKey(entitySet: string, key: Record<string, unknown>): string {
  const parts = Object.entries(key).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  return `${entitySet}[${parts.join(", ")}]`;
}

// ---------------------------------------------------------------------------------------------
// The two files build.ts writes beside the feed rows and verify.ts reads back. Their shapes are
// declared once, here, so a change to one cannot leave the other reading a different file.

/** A feed row that links a document: its entity set and its name (see rowIdentityOf). */
export type LinkedBy = { entity_set: string; row_key: Record<string, unknown> };

export const isLinkedBy = (value: unknown): value is LinkedBy =>
  isRecord(value) && typeof value["entity_set"] === "string" && isRecord(value["row_key"]);

/**
 * The one document in the fixture that no feed row links: the Statutes Affected Table, which
 * Legislative Counsel publishes outside OLIS (olis-odata.md section 5). verify.ts requires every
 * other manifest entry to be linked by a fixture row.
 */
export const statutesAffectedTablePath = "documents/reports/artables2025R1.pdf";

/** One entry of manifest.json: a document in the fixture. */
export type ManifestEntry = {
  path: string;
  source_url: string;
  retrieved_at: string;
  sha256: string;
  bytes: number;
  content_type: string;
  linked_by: LinkedBy[];
  note?: string;
};

/** The string fields every manifest entry must carry. The type checks the names. */
export const requiredManifestStrings = [
  "path",
  "source_url",
  "retrieved_at",
  "sha256",
] as const satisfies readonly (keyof ManifestEntry)[];

/** One entry of unresolved.json: a reference the full cache cannot resolve either. */
export type Unresolved = {
  entity_set: string;
  row_key: Record<string, unknown>;
  property: string;
  refers_to: string;
  target_key: Record<string, unknown>;
  reason: string;
};

// The references the full cache itself cannot resolve. Only these are recorded in unresolved.json
// and only these does verify accept, so a broken reference cannot be waved through by editing
// the file: it has to be a documented gap with the documented reason. There are two kinds.
//
// 1. Legislators is a current snapshot, so the Legislator Codes "Rep Neron" and "Sen Woods", which
//    2025R1 votes, sponsorships and floor carriers use, have no row (docs/research/olis-odata.md
//    section 8, gotcha 4). Two codes, listed below.
// 2. A CommitteeMembers row whose Legislator Code matches no Legislators row is a member of a task
//    force who is no Legislator (gotcha 5), and the code is the person's name. That is a kind of
//    row, not a list of people: the cache has 32 of them (JTFBHA 22, JOCSS 10), and the reason
//    follows from the entity set and the property alone, except that a code starting "Rep " or
//    "Sen " is never given it (owner decision on #87, 2026-11-02): it is a gap only if listed in 1. Names are public record and are
//    committed as published (ADR-0002).
//
// A scan of every reference in every row of the full 2025R1 feed cache on 2026-10-29 (791,744 of
// them) found no other that fails. A new gap is for a person to look at: add it here with the evidence.
export const legislatorCodesWithoutRow: readonly string[] = ["Rep Neron", "Sen Woods"];

const legislatorGapReason =
  "No Legislators row with this LegislatorCode in the full 2025R1 feed cache: Legislators is a current snapshot (docs/research/olis-odata.md section 8, gotcha 4).";

const nonLegislatorMemberReason =
  "No Legislators row with this LegislatorCode in the full 2025R1 feed cache: the member is no Legislator but a member of a task force, whose LegislatorCode is a personal name (docs/research/olis-odata.md section 8, gotcha 5).";

/** The reason the full cache cannot resolve this reference, or null when it is not a documented gap. */
export function documentedGapReason(
  entitySet: string,
  property: string,
  refersTo: string,
  target: Record<string, unknown>,
): string | null {
  if (refersTo !== "Legislators" || target["SessionKey"] !== "2025R1") return null;
  const code = target["LegislatorCode"];
  if (typeof code !== "string") return null;
  if (legislatorCodesWithoutRow.includes(code)) return legislatorGapReason;
  // A code that starts "Rep " or "Sen " is a legislator's, not a task-force member's name, so gotcha 5
  // does not cover it: it is a gap only if it is on the gotcha-4 list above.
  if (entitySet === "CommitteeMembers" && property === "LegislatorCode" && !/^(Rep|Sen) /.test(code))
    return nonLegislatorMemberReason;
  return null;
}

/** The entry for a reference the full cache cannot resolve, or null when that is not a documented gap. */
export function makeUnresolved(
  entitySet: string,
  row: Row,
  ref: Ref,
  target: Record<string, unknown>,
): Unresolved | null {
  const reason = documentedGapReason(entitySet, ref.property, ref.to, target);
  if (reason === null) return null;
  return {
    entity_set: entitySet,
    row_key: rowIdentityOf(entitySet, row),
    property: ref.property,
    refers_to: ref.to,
    target_key: target,
    reason,
  };
}

export const isUnresolved = (value: unknown): value is Unresolved =>
  isRecord(value) &&
  typeof value["entity_set"] === "string" &&
  isRecord(value["row_key"]) &&
  typeof value["property"] === "string" &&
  typeof value["refers_to"] === "string" &&
  isRecord(value["target_key"]) &&
  typeof value["reason"] === "string" &&
  value["reason"] !== "";

/** Identifies one reference of one row, so a listed gap can be matched to the reference it covers. */
export function unresolvedId(
  entitySet: string,
  rowKey: Record<string, unknown>,
  property: string,
  refersTo: string,
): string {
  const spec = entitySets[entitySet];
  const keyValues = spec === undefined ? [] : identityProperties(spec).map((p) => rowKey[p]);
  return `${entitySet}|${keyString(keyValues)}|${property}|${refersTo}`;
}
