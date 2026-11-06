// The MCP server's side of the search index: read-only, like reader.ts, and a file of its own so that
// the queries of search (ADR-0025) do not grow reader.ts. The worker writes the index through
// writer.ts.
import { z } from "zod";
import type { AmendmentId, CommitteeId, DocumentId, DocumentKind } from "#/packages/domain/documents.ts";
import type { MeasureId, SessionKey } from "#/packages/domain/index.ts";
import type { MeetingId } from "#/packages/domain/documents.ts";
import type { SearchedSpeakerTurn } from "#/packages/domain/speaker-turns.ts";
import type { SearchedTranscriptPassage } from "#/packages/domain/transcripts.ts";
import type { Clock } from "#/packages/time/clock.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import { openReadConnection } from "./lib/connection.ts";
import { listedDocumentSql, noLongerListedThrough, unlistedAmong } from "./lib/listing.ts";
import { readSpeakerTurn } from "./lib/speaker-turns.ts";
import { passageColumns, shownPassageOf, transcriptPassageRow } from "./lib/transcripts.ts";

/** Which documents a search may return. Every field given must hold. */
export type SearchFilter = {
  session: SessionKey;
  /** Only documents of this kind. */
  kind?: DocumentKind;
  /** Whether Testimony may be returned. The caller decides: it is left out unless asked for or scoped. */
  withTestimony: boolean;
  measure?: MeasureId;
  committee?: CommitteeId;
  /** Only documents dated on this Pacific date or later: "2025-01-21". */
  from?: string;
  /** Only documents dated on this Pacific date or earlier. */
  to?: string;
  /** Only documents of these Measures: the ones that have an Agency Link to the Agency asked for (ADR-0028). */
  agencyMeasures?: ReadonlySet<MeasureId>;
};

/** What a filter looks at in a document. */
export type DocumentFacts = {
  kind: DocumentKind;
  measureId: MeasureId | null;
  committeeId: CommitteeId | null;
  date: Timestamp | null;
};

/**
 * Whether a document passes a filter. This is `filterTerms` again, for the vector side, which scans in memory
 * and not in SQL: the two sit side by side so that they change together.
 */
export function acceptsDocument(filter: SearchFilter, facts: DocumentFacts): boolean {
  if (filter.kind !== undefined && facts.kind !== filter.kind) return false;
  if (!filter.withTestimony && facts.kind === "testimony") return false;
  if (filter.measure !== undefined && facts.measureId !== filter.measure) return false;
  if (filter.committee !== undefined && facts.committeeId !== filter.committee) return false;
  if (
    filter.agencyMeasures !== undefined &&
    (facts.measureId === null || !filter.agencyMeasures.has(facts.measureId))
  ) {
    return false;
  }
  const day = facts.date?.slice(0, 10);
  if (filter.from !== undefined && (day === undefined || day < filter.from)) return false;
  if (filter.to !== undefined && (day === undefined || day > filter.to)) return false;
  return true;
}

/** One passage that has a vector, with the document it is of. */
export type VectorRow = {
  passageId: number;
  documentId: DocumentId;
  nodeId: DocumentId | AmendmentId;
  facts: DocumentFacts;
  /** The int8 vector, as the worker stored it. */
  vector: Int8Array;
};

/** A passage that matched, and the hit it belongs to. */
export type PassageMatch = {
  passageId: number;
  documentId: DocumentId;
  /** The id a hit carries: the document's, or a posting's Proposed Amendment's. */
  nodeId: DocumentId | AmendmentId;
  /** The position of the speaker turn the passage is the lines of (ticket #127), or null for any other passage. */
  turnPosition: number | null;
};

/**
 * A document that a citation names exactly, and the passage that shows it (null for a file with no text to show).
 * For an ORS section that is the passage the first mention starts in, and `citedAt` is where the mention starts
 * in the document's text; for a Measure or an amendment it is the document's first passage.
 */
export type CitedDocument = {
  passageId: number | null;
  documentId: DocumentId;
  nodeId: DocumentId | AmendmentId;
  /** The position of the speaker turn the passage is the lines of (ticket #127), or null: a hit is ranked as its turn. */
  turnPosition: number | null;
  citedAt?: number;
};

/**
 * What the index holds of an item a citation names when the feed no longer lists any document of it (ADR-0030): how
 * many such documents there are, and the one the feed listed most recently. `get_document` serves them all.
 */
export type UnlistedHolding = {
  count: number;
  latest: { documentId: DocumentId; nodeId: DocumentId | AmendmentId; lastListedAt: Timestamp };
};

/** How much text after the start of a mention is shown, so that a mention a passage ends in the middle of is whole. */
const CITATION_TAIL = 100;

/** What a hit shows of a document and of the passage that matched. */
export type HitDetails = {
  documentId: DocumentId;
  nodeId: DocumentId | AmendmentId;
  kind: DocumentKind;
  title: string;
  measureId: MeasureId | null;
  date: Timestamp | null;
  sourceUrl: string;
  /**
   * The text of the passage that matched, exactly as the document has it. When the hit was found by a mention of a
   * citation that starts in the passage, the text runs on past the passage's end far enough to hold the mention.
   */
  passageText: string;
  /** The speaker turn the passage is the lines of, with its Meeting, or null when the passage is not a turn's (ticket #127). */
  turn: SearchedSpeakerTurn | null;
};

/** A transcript passage that matched by its words (ticket #134, ADR-0055): the passage and the Recording Log it is of. */
export type TranscriptMatch = {
  transcriptPassageId: number;
  documentId: DocumentId;
  /** The id a hit carries: the Recording Log's. */
  nodeId: DocumentId | AmendmentId;
};

/**
 * One transcript passage that has a vector, with the Recording Log it is of. Its facts are the log's, except the Measure: a
 * passage's Measure is the one its Agenda item names (a log itself belongs to a Meeting and names none).
 */
export type TranscriptVectorRow = {
  passageId: number;
  documentId: DocumentId;
  nodeId: DocumentId | AmendmentId;
  facts: DocumentFacts;
  vector: Int8Array;
};

/** What a hit shows of a transcript passage: the passage with its speaker, and the log it is of. */
export type TranscriptHitDetails = SearchedTranscriptPassage & {
  nodeId: DocumentId | AmendmentId;
  kind: DocumentKind;
  title: string;
  /** The date the log is filed under: the start of its Meeting. */
  date: Timestamp | null;
  sourceUrl: string;
};

export type SearchIndexReader = {
  /**
   * The passages that match an FTS5 expression, best first (BM25), at most `limit`; only the passages of
   * keyword-only documents when `keywordOnly` is true.
   */
  keyword(match: string, filter: SearchFilter, limit: number, keywordOnly?: boolean): PassageMatch[];
  /**
   * The Versions of a Measure that pass the filter, in the order they came: Introduced first, Enrolled last.
   * The Measure's own texts are what its citation names.
   */
  versionsOf(measure: MeasureId, filter: SearchFilter): CitedDocument[];
  /**
   * The Proposed Amendment's latest posting that passes the filter and that the feed lists, or undefined when none
   * does. It is the posting search offers for the amendment; `get_document` serves the node's latest posting that
   * the index holds, listed or not (ADR-0011, ADR-0030).
   */
  postingOf(amendment: AmendmentId, filter: SearchFilter): CitedDocument | undefined;
  /**
   * The documents whose text names a citation (an id: `ors-468.130`) and pass the filter, at most `limit`, oldest
   * first (by the date they are filed under, then by id). Each comes with the passage that holds the citation's
   * first mention, or the passage it starts in when a boundary cuts it in two.
   */
  citing(citationId: string, filter: SearchFilter, limit: number): CitedDocument[];
  /**
   * The postings of a Proposed Amendment that the index holds and the feed no longer lists, or undefined when there is
   * none. For a note that says an amendment is held and not listed: `postingOf` leaves such a posting out.
   */
  unlistedPostings(amendment: AmendmentId, session: SessionKey): UnlistedHolding | undefined;
  /**
   * The documents whose text names a citation (an id: `ors-468.130`) that the index holds and the feed no longer
   * lists, Testimony included, or undefined when there is none. `citing` leaves such documents out.
   */
  unlistedCiting(citationId: string, session: SessionKey): UnlistedHolding | undefined;
  /**
   * A number that moves whenever the worker stores or refreshes something the meaning side holds in memory: a
   * document's vectors, or how a document is filed (its kind, Measure, committee, date, keyword-only flag). Read
   * it before reading the vectors, and read the vectors again when it has moved.
   */
  generation(): number;
  /** How many passages of the Session have a vector under this model id. */
  vectorCount(session: SessionKey, modelId: string): number;
  /**
   * Every passage of the Session that has a vector under this model id, in the order of the passages' ids.
   * The passages of keyword-only documents have none.
   */
  vectors(session: SessionKey, modelId: string): Iterable<VectorRow>;
  /** What a hit shows. A document with no passage shows no text. */
  details(match: { passageId: number | null; documentId: DocumentId; citedAt?: number }): HitDetails;
  /**
   * The transcript passages that match an FTS5 expression, best first (BM25), at most `limit` (ticket #134, ADR-0055). The
   * filter applies to the Recording Log the passage is of, except that its Measure is the passage's own, so a search of a
   * Measure finds the words said under it. The caller asks for these only when the publication gate is on.
   */
  keywordTranscripts(match: string, filter: SearchFilter, limit: number): TranscriptMatch[];
  /** How many transcript passages of the Session have a vector under this model id. */
  transcriptVectorCount(session: SessionKey, modelId: string): number;
  /** Every transcript passage of the Session that has a vector under this model id, in the order of the passages' ids. */
  transcriptVectors(session: SessionKey, modelId: string): Iterable<TranscriptVectorRow>;
  /** What a hit shows of a transcript passage. */
  transcriptDetails(passageId: number): TranscriptHitDetails;
  close(): void;
};

const citedRow = z.object({
  document_id: z.string(),
  node_id: z.string(),
  passage_id: z.number().nullable(),
  cited_at: z.number().nullable().optional(),
  turn_position: z.number().nullable().optional(),
});
const countRow = z.object({ n: z.number() });
const candidateRow = z.object({ document_id: z.string(), node_id: z.string() });
const generationRow = z.object({ generation: z.number() });
const vectorRow = z.object({
  passage_id: z.number(),
  document_id: z.string(),
  node_id: z.string(),
  kind: z.string(),
  measure_id: z.string().nullable(),
  committee_id: z.string().nullable(),
  dated_at: z.string().nullable(),
  vector: z.instanceof(Uint8Array),
});
const matchRow = z.object({
  passage_id: z.number(),
  document_id: z.string(),
  node_id: z.string(),
  turn_position: z.number().nullable(),
});
const detailsRow = z.object({
  document_id: z.string(),
  node_id: z.string(),
  kind: z.string(),
  title: z.string(),
  measure_id: z.string().nullable(),
  dated_at: z.string().nullable(),
  source_url: z.string(),
  text: z.string(),
  start_offset: z.number().nullable(),
  end_offset: z.number().nullable(),
  turn_position: z.number().nullable(),
});
const meetingOfRow = z.object({ meeting_id: z.string() });
const transcriptMatchRow = z.object({ passage_id: z.number(), document_id: z.string(), node_id: z.string() });
const transcriptDetailsRow = transcriptPassageRow.extend({
  node_id: z.string(),
  kind: z.string(),
  title: z.string(),
  dated_at: z.string().nullable(),
  source_url: z.string(),
});

/**
 * The rows of a vector SELECT as `VectorRow`s, each with its vector copied out: the blob is a view of SQLite's buffer, which the
 * next row reuses. The documents' passages and a transcript's are read by the one loop.
 */
function* vectorRowsOf(rows: Iterable<unknown>): Generator<VectorRow> {
  for (const row of rows) {
    const stored = vectorRow.parse(row);
    yield {
      passageId: stored.passage_id,
      documentId: stored.document_id as DocumentId,
      nodeId: stored.node_id as DocumentId | AmendmentId,
      facts: {
        kind: stored.kind as DocumentKind,
        measureId: stored.measure_id as MeasureId | null,
        committeeId: stored.committee_id as CommitteeId | null,
        date: stored.dated_at as Timestamp | null,
      },
      vector: new Int8Array(
        stored.vector.buffer.slice(stored.vector.byteOffset, stored.vector.byteOffset + stored.vector.byteLength),
      ),
    };
  }
}

/**
 * The WHERE terms of a filter over `search_document` (aliased `sd`), and the values they take. They leave out a document
 * the feed no longer lists (ADR-0005, ADR-0030) by the Listing's term (`listedDocumentSql`). `unlistedThrough` is the
 * last pull whose rows are No longer listed, for the filter's Session (`noLongerListedThrough`).
 */
function filterTerms(
  filter: SearchFilter,
  unlistedThrough: number,
  measureColumn = "sd.measure_id",
): { sql: string; values: (string | number)[] } {
  const terms = ["sd.session_key = ?", listedDocumentSql("sd", "?")];
  const values: (string | number)[] = [filter.session, unlistedThrough];
  if (filter.kind !== undefined) {
    terms.push("sd.kind = ?");
    values.push(filter.kind);
  }
  if (!filter.withTestimony) terms.push("sd.kind <> 'testimony'");
  if (filter.measure !== undefined) {
    terms.push(`${measureColumn} = ?`);
    values.push(filter.measure);
  }
  if (filter.committee !== undefined) {
    terms.push("sd.committee_id = ?");
    values.push(filter.committee);
  }
  if (filter.agencyMeasures !== undefined) {
    terms.push(`${measureColumn} IN (SELECT value FROM json_each(?))`);
    values.push(JSON.stringify([...filter.agencyMeasures]));
  }
  if (filter.from !== undefined) {
    terms.push("substr(sd.dated_at, 1, 10) >= ?");
    values.push(filter.from);
  }
  if (filter.to !== undefined) {
    terms.push("substr(sd.dated_at, 1, 10) <= ?");
    values.push(filter.to);
  }
  return { sql: terms.join(" AND "), values };
}

/** The passage's text, run on to hold a mention of a citation that starts in it (`HitDetails.passageText`). */
function passageTextOf(stored: z.infer<typeof detailsRow>, citedAt: number | undefined): string {
  if (stored.start_offset === null || stored.end_offset === null) return "";
  const startsHere = citedAt !== undefined && citedAt >= stored.start_offset && citedAt < stored.end_offset;
  const end = startsHere ? Math.max(stored.end_offset, citedAt + CITATION_TAIL) : stored.end_offset;
  return stored.text.slice(stored.start_offset, end);
}

export function openSearchReader(path: string, clock: Clock): SearchIndexReader {
  // The index as it stood at the clock (ADR-0055): `document` and `search_document` hide what was created after it.
  const database = openReadConnection(path, clock);
  /** The last pull whose rows are No longer listed, for a Session, as of now: asked for each query. */
  const unlistedThrough = (session: SessionKey): number => noLongerListedThrough(database, session);
  const selectDetails = database.prepare(
    `SELECT d.id AS document_id, sd.node_id, sd.kind, sd.title, sd.measure_id, sd.dated_at, d.source_url, d.text,
            p.start_offset, p.end_offset, p.turn_position
     FROM document d
       JOIN search_document sd ON sd.document_id = d.id
       LEFT JOIN passage p ON p.id = ? AND p.document_id = d.id
     WHERE d.id = ?`,
  );
  const vectorSelection = `FROM passage p
       JOIN search_document sd ON sd.document_id = p.document_id
       JOIN passage_vector v ON v.text_hash = p.text_hash AND v.model_id = ?2
     WHERE sd.session_key = ?1 AND sd.keyword_only = 0 AND ${listedDocumentSql("sd", "?3")}`;
  const selectMeetingOfDocument = database.prepare("SELECT meeting_id FROM meeting_document WHERE document_id = ?");
  const selectGeneration = database.prepare("SELECT generation FROM search_generation WHERE id = 1");
  const selectVectorCount = database.prepare(`SELECT COUNT(*) AS n ${vectorSelection}`);
  // A transcript marked for attaching again (an empty `attached_to`) is left out: its passages' turn positions are stale (ADR-0055).
  const transcriptVectorSelection = `FROM transcript_passage tp
       JOIN transcript tr ON tr.meeting_id = tp.meeting_id AND tr.event_id = tp.event_id AND tr.attached_to <> ''
       JOIN search_document sd ON sd.document_id = tp.document_id
       JOIN passage_vector v ON v.text_hash = tp.text_hash AND v.model_id = ?2
     WHERE sd.session_key = ?1 AND ${listedDocumentSql("sd", "?3")}`;
  const selectTranscriptVectorCount = database.prepare(`SELECT COUNT(*) AS n ${transcriptVectorSelection}`);
  // A passage's Measure is its own (`tp.measure_id`), which is what a search of a Measure and the Agency filter ask about.
  const selectTranscriptVectors = database.prepare(
    `SELECT tp.id AS passage_id, tp.document_id, sd.node_id, sd.kind, tp.measure_id, sd.committee_id, sd.dated_at,
            v.vector ${transcriptVectorSelection} ORDER BY tp.id`,
  );
  const selectTranscriptDetails = database.prepare(
    `SELECT ${passageColumns}, sd.node_id, sd.kind, sd.title, sd.dated_at, d.source_url
     FROM transcript_passage tp
       JOIN search_document sd ON sd.document_id = tp.document_id
       JOIN document d ON d.id = tp.document_id
     WHERE tp.id = ?`,
  );
  const selectVectors = database.prepare(
    `SELECT p.id AS passage_id, p.document_id, sd.node_id, sd.kind, sd.measure_id, sd.committee_id, sd.dated_at,
            v.vector ${vectorSelection} ORDER BY p.id`,
  );
  /** The first passage of a document: what a hit shows when it is found by a citation and not by a passage. */
  const firstPassage = "(SELECT p.id FROM passage p WHERE p.document_id = sd.document_id ORDER BY p.ordinal LIMIT 1)";
  const citedOf = (row: unknown): CitedDocument => {
    const stored = citedRow.parse(row);
    return {
      passageId: stored.passage_id,
      documentId: stored.document_id as DocumentId,
      nodeId: stored.node_id as DocumentId | AmendmentId,
      turnPosition: stored.turn_position ?? null,
      ...(stored.cited_at === null || stored.cited_at === undefined ? {} : { citedAt: stored.cited_at }),
    };
  };
  /**
   * The candidates a note is about, as the search index files them (the stored Documents of an item), and of them the
   * ones the Listing says the feed no longer lists: how many, and the one listed last.
   */
  const unlistedHoldingOf = (session: SessionKey, candidates: readonly unknown[]): UnlistedHolding | undefined => {
    const nodeOf = new Map<string, DocumentId | AmendmentId>();
    for (const row of candidates) {
      const stored = candidateRow.parse(row);
      nodeOf.set(stored.document_id, stored.node_id as DocumentId | AmendmentId);
    }
    const unlisted = unlistedAmong(database, session, [...nodeOf.keys()] as DocumentId[]);
    const [latest] = unlisted;
    if (latest === undefined) return undefined;
    const nodeId = nodeOf.get(latest.documentId);
    if (nodeId === undefined) throw new Error(`The Listing named ${latest.documentId}, which search did not offer`);
    return {
      count: unlisted.length,
      latest: { documentId: latest.documentId, nodeId, lastListedAt: latest.lastListedAt },
    };
  };
  const selectPostingDocuments = database.prepare(
    "SELECT sd.document_id, sd.node_id FROM search_document sd WHERE sd.node_id = ? AND sd.session_key = ?",
  );
  const selectCitingDocuments = database.prepare(
    `SELECT DISTINCT sd.document_id, sd.node_id
     FROM document_citation dc
       JOIN search_document sd ON sd.document_id = dc.document_id
     WHERE dc.citation_id = ? AND sd.session_key = ?`,
  );
  return {
    keyword(match, filter, limit, keywordOnly = false) {
      const terms = filterTerms(filter, unlistedThrough(filter.session));
      const rows = database
        .prepare(
          `SELECT p.id AS passage_id, p.document_id, sd.node_id, p.turn_position
           FROM passage_fts
             JOIN passage p ON p.id = passage_fts.rowid
             JOIN search_document sd ON sd.document_id = p.document_id
           WHERE passage_fts MATCH ? AND ${terms.sql}${keywordOnly ? " AND sd.keyword_only = 1" : ""}
           ORDER BY passage_fts.rank, p.id
           LIMIT ?`,
        )
        .all(match, ...terms.values, limit);
      return rows.map((row) => {
        const stored = matchRow.parse(row);
        return {
          passageId: stored.passage_id,
          documentId: stored.document_id as DocumentId,
          nodeId: stored.node_id as DocumentId | AmendmentId,
          turnPosition: stored.turn_position,
        };
      });
    },
    generation() {
      return generationRow.parse(selectGeneration.get()).generation;
    },
    vectorCount(session, modelId) {
      return countRow.parse(selectVectorCount.get(session, modelId, unlistedThrough(session))).n;
    },
    *vectors(session, modelId) {
      yield* vectorRowsOf(selectVectors.iterate(session, modelId, unlistedThrough(session)));
    },
    citing(citationId, filter, limit) {
      const terms = filterTerms(filter, unlistedThrough(filter.session));
      return database
        .prepare(
          `SELECT cited.document_id, cited.node_id, cited.passage_id, cited.cited_at,
                  (SELECT p.turn_position FROM passage p WHERE p.id = cited.passage_id) AS turn_position
           FROM (
             SELECT sd.document_id, sd.node_id,
                    COALESCE(
                      (SELECT p.id FROM passage p
                       WHERE p.document_id = sd.document_id AND p.start_offset <= dc.first_offset
                         AND dc.first_offset < p.end_offset
                       ORDER BY p.ordinal LIMIT 1),
                      ${firstPassage}) AS passage_id,
                    dc.first_offset AS cited_at,
                    sd.dated_at
             FROM document_citation dc
               JOIN search_document sd ON sd.document_id = dc.document_id
             WHERE dc.citation_id = ? AND ${terms.sql}
           ) cited
           ORDER BY cited.dated_at IS NULL, cited.dated_at, cited.document_id
           LIMIT ?`,
        )
        .all(citationId, ...terms.values, limit)
        .map(citedOf);
    },
    versionsOf(measure, filter) {
      const terms = filterTerms(filter, unlistedThrough(filter.session));
      return database
        .prepare(
          `SELECT sd.document_id, sd.node_id, ${firstPassage} AS passage_id
           FROM search_document sd
           WHERE sd.kind = 'version' AND sd.measure_id = ? AND ${terms.sql}
           ORDER BY sd.dated_at, sd.document_id`,
        )
        .all(measure, ...terms.values)
        .map(citedOf);
    },
    postingOf(amendment, filter) {
      const terms = filterTerms(filter, unlistedThrough(filter.session));
      const row = database
        .prepare(
          `SELECT sd.document_id, sd.node_id, ${firstPassage} AS passage_id
           FROM search_document sd
           WHERE sd.node_id = ? AND ${terms.sql}
           ORDER BY sd.dated_at DESC, sd.document_id DESC
           LIMIT 1`,
        )
        .get(amendment, ...terms.values);
      return row === undefined ? undefined : citedOf(row);
    },
    unlistedPostings(amendment, session) {
      return unlistedHoldingOf(session, selectPostingDocuments.all(amendment, session));
    },
    unlistedCiting(citationId, session) {
      return unlistedHoldingOf(session, selectCitingDocuments.all(citationId, session));
    },
    details(match) {
      const row = selectDetails.get(match.passageId, match.documentId);
      if (row === undefined) throw new Error(`The index has no document ${match.documentId}`);
      const stored = detailsRow.parse(row);
      const documentId = stored.document_id as DocumentId;
      const turn =
        stored.turn_position === null ? undefined : readSpeakerTurn(database, documentId, stored.turn_position);
      if (stored.turn_position !== null && turn === undefined) {
        throw new Error(
          `The passage of ${documentId} is turn ${String(stored.turn_position)}, which the index does not hold`,
        );
      }
      const meetingRow = turn === undefined ? undefined : selectMeetingOfDocument.get(documentId);
      return {
        documentId: stored.document_id as DocumentId,
        nodeId: stored.node_id as DocumentId | AmendmentId,
        kind: stored.kind as DocumentKind,
        title: stored.title,
        measureId: stored.measure_id as MeasureId | null,
        date: stored.dated_at as Timestamp | null,
        sourceUrl: stored.source_url,
        passageText: passageTextOf(stored, match.citedAt),
        turn:
          turn === undefined
            ? null
            : {
                ...turn,
                meeting: meetingRow === undefined ? null : (meetingOfRow.parse(meetingRow).meeting_id as MeetingId),
              },
      };
    },
    keywordTranscripts(match, filter, limit) {
      // The Measure is the passage's own (`tp.measure_id`); every other term is of the Recording Log (`sd`).
      const terms = filterTerms(filter, unlistedThrough(filter.session), "tp.measure_id");
      return database
        .prepare(
          `SELECT tp.id AS passage_id, tp.document_id, sd.node_id
           FROM transcript_passage_fts
             JOIN transcript_passage tp ON tp.id = transcript_passage_fts.rowid
             JOIN transcript tr ON tr.meeting_id = tp.meeting_id AND tr.event_id = tp.event_id AND tr.attached_to <> ''
             JOIN search_document sd ON sd.document_id = tp.document_id
           WHERE transcript_passage_fts MATCH ? AND ${terms.sql}
           ORDER BY transcript_passage_fts.rank, tp.id
           LIMIT ?`,
        )
        .all(match, ...terms.values, limit)
        .map((row) => {
          const stored = transcriptMatchRow.parse(row);
          return {
            transcriptPassageId: stored.passage_id,
            documentId: stored.document_id as DocumentId,
            nodeId: stored.node_id as DocumentId | AmendmentId,
          };
        });
    },
    transcriptVectorCount(session, modelId) {
      return countRow.parse(selectTranscriptVectorCount.get(session, modelId, unlistedThrough(session))).n;
    },
    *transcriptVectors(session, modelId) {
      yield* vectorRowsOf(selectTranscriptVectors.iterate(session, modelId, unlistedThrough(session)));
    },
    transcriptDetails(passageId) {
      const row = selectTranscriptDetails.get(passageId);
      if (row === undefined) throw new Error(`The index has no transcript passage ${String(passageId)}`);
      const stored = transcriptDetailsRow.parse(row);
      return {
        ...shownPassageOf(database, stored),
        documentId: stored.document_id as DocumentId,
        meetingId: stored.meeting_id as MeetingId,
        nodeId: stored.node_id as DocumentId | AmendmentId,
        kind: stored.kind as DocumentKind,
        title: stored.title,
        date: stored.dated_at as Timestamp | null,
        sourceUrl: stored.source_url,
      };
    },
    close() {
      database.close();
    },
  };
}
