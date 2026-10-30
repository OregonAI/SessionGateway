// What the fixture scripts know about the OLIS feed: each entity set's key, which of its
// properties refer to rows in other entity sets, and which rows link a downloadable document.
//
// build.ts uses this to decide which rows a Measure drags in. verify.ts uses the same table to
// check that every reference resolves inside the fixture, so the two cannot disagree about
// what refers to what. Source: docs/research/olis-odata.md section 2 ($metadata) and section 8.
//
// Property names are the feed's own, misspellings included: CommitteCode (on agenda items),
// CommittteCode (on analysis documents) and LegislatoreCode (on sponsors) are what OLIS
// serves. Do not "fix" them: the fixture keeps the feed verbatim.
//
// This file imports nothing, runs under Node type stripping, and uses erasable syntax only.

export type Row = Record<string, unknown>;

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
  // a CommitteeMembers row, and nothing in this table does.
  CommitteeMembers: {
    key: ["CommitteeCode", "CreatedDate", "Title"],
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
  /** The row's document URL as the feed (or the OLIS testimony page) gives it. */
  url: (row: Row) => string;
  /** Path under the kind folder, without an extension. */
  stem: (row: Row) => string;
};

const slug = (text: unknown): string => String(text).replace(/[^A-Za-z0-9._-]+/g, "-");

// Mean document sizes by kind, from docs/research/olis-odata.md section 7. The build uses them
// to estimate a download before it starts. Floor letters were not sampled: 250 kB is a guess.
export const meanBytes: Record<string, number> = {
  "measure-documents": 42_415,
  "measure-analysis-documents": 500_075,
  "proposed-amendments": 40_907,
  "committee-meeting-documents": 218_262,
  "testimony": 77_397,
  "committee-agendas": 101_925,
  "floor-letters": 250_000,
};

export const documentLinks: Record<string, DocumentLink> = {
  MeasureDocuments: {
    kind: "measure-documents",
    url: (r) => String(r.DocumentUrl),
    stem: (r) => `${slug(r.MeasurePrefix)}${slug(r.MeasureNumber)}/${slug(r.VersionDescription)}`,
  },
  MeasureAnalysisDocuments: {
    kind: "measure-analysis-documents",
    url: (r) => String(r.DocumentUrl),
    stem: (r) => slug(r.MeasureAnalysisId),
  },
  CommitteeProposedAmendments: {
    kind: "proposed-amendments",
    url: (r) => String(r.ProposedAmendmentUrl),
    stem: (r) => slug(r.ProposedAmendmentId),
  },
  CommitteeMeetingDocuments: {
    kind: "committee-meeting-documents",
    url: (r) => String(r.DocumentUrl),
    stem: (r) => slug(r.CommitteeMeetingDocumentId),
  },
  CommitteeMeetings: {
    kind: "committee-agendas",
    url: (r) => String(r.AgendaUrl),
    stem: (r) => `${slug(r.CommitteeCode)}/${slug(String(r.MeetingDate).replace("T", "-").replace(/:\d\d$/, ""))}`,
  },
  // The feed's DocumentUrl for Testimony is always the session root (olis-odata.md section 8,
  // gotcha 2); the file lives under PublicTestimonyDocument/{CommTestId}.
  CommitteePublicTestimonies: {
    kind: "testimony",
    url: (r) => `https://olis.oregonlegislature.gov/liz/${r.SessionKey}/Downloads/PublicTestimonyDocument/${r.CommTestId}`,
    stem: (r) => slug(r.CommTestId),
  },
  FloorLetters: {
    kind: "floor-letters",
    url: (r) => String(r.FloorLetterUrl),
    stem: (r) => slug(r.FloorLetterId),
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

/** The target key a reference points at, in the target's own property order, or null. */
export function targetKeyOf(row: Row, ref: Ref): Record<string, unknown> | null {
  const target: Record<string, unknown> = {};
  for (const [targetProperty, sourceProperty] of Object.entries(ref.match)) {
    const value = row[sourceProperty];
    if (value === undefined || value === null) return null;
    target[targetProperty] = value;
  }
  return target;
}

/** The key of a row as an object, for messages and for the manifest's linked_by. */
export function rowKeyOf(entitySet: string, row: Row): Record<string, unknown> {
  const spec = entitySets[entitySet];
  const key: Record<string, unknown> = {};
  if (spec === undefined) return key;
  for (const property of spec.key) key[property] = row[property] ?? null;
  return key;
}

/** `Set[Prop=value, Prop=value]` for one line of output. */
export function describeKey(entitySet: string, key: Record<string, unknown>): string {
  const parts = Object.entries(key).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  return `${entitySet}[${parts.join(", ")}]`;
}
