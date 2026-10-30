// The MCP server's side of the database: read-only.
import { z } from "zod";
import type { StoredAnalysis } from "#/packages/domain/analysis.ts";
import {
  documentKinds,
  type AmendmentId,
  type CommitteeId,
  type DocumentId,
  type DocumentKind,
  type DocumentView,
  type IndexCounts,
  type NodeId,
  type Relation,
  type RelatedNode,
} from "#/packages/domain/documents.ts";
import { measureIdOf, type Measure, type MeasureKey, type SessionKey } from "#/packages/domain/index.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import { openReadConnection } from "./lib/connection.ts";

export type IndexReader = {
  findMeasure(key: MeasureKey): Measure | undefined;
  /** When the last completed full pull started, or undefined if none has completed. */
  asOf(session: SessionKey): Timestamp | undefined;
  /**
   * A document by its id, or a Proposed Amendment by its id: the text of its latest posting, with the
   * nodes all its postings point at.
   */
  findDocument(id: DocumentId | AmendmentId): DocumentView | undefined;
  /**
   * The analysis documents the store holds for a Measure: the ones whose files the worker fetched, so
   * that each is a document `findDocument` resolves.
   */
  analysisDocuments(key: MeasureKey): StoredAnalysis[];
  /** What the index holds of the Session. */
  counts(session: SessionKey): IndexCounts;
  close(): void;
};

const measureRow = z.object({
  catchline: z.string().nullable(),
  digest: z.string().nullable(),
  created_at: z.string(),
  modified_at: z.string().nullable(),
});
const stateRow = z.object({ full_pull_as_of: z.string() });
const documentRow = z.object({
  id: z.string(),
  node_id: z.string(),
  kind: z.string(),
  label: z.string(),
  source_url: z.string(),
  retrieved_at: z.string(),
  content_hash: z.string(),
  page_count: z.number(),
  has_text_layer: z.number(),
  posted_at: z.string().nullable(),
  text: z.string(),
});
const analysisRow = z.object({
  id: z.string(),
  label: z.string(),
  source_url: z.string(),
  analysis_version_label: z.string(),
  analysis_is_minority: z.number(),
});
const countRow = z.object({ n: z.number() });
const kindCountRow = z.object({ kind: z.string(), n: z.number() });
const relationRow = z.object({
  relation: z.string(),
  to_id: z.string(),
  meaning: z.string().nullable(),
});

export function openIndexReader(path: string): IndexReader {
  const database = openReadConnection(path);
  const selectMeasure = database.prepare(
    "SELECT catchline, digest, created_at, modified_at FROM measure WHERE session_key = ? AND prefix = ? AND number = ?",
  );
  const selectAsOf = database.prepare("SELECT full_pull_as_of FROM index_state WHERE session_key = ?");
  const countOf = (sql: string, session: SessionKey): number => countRow.parse(database.prepare(sql).get(session)).n;
  const selectKindCounts = database.prepare(
    "SELECT kind, COUNT(*) AS n FROM document WHERE session_key = ? GROUP BY kind",
  );
  const selectDocument = database.prepare("SELECT * FROM document WHERE id = ?");
  const selectPostings = database.prepare(
    "SELECT * FROM document WHERE node_id = ? AND node_id <> id ORDER BY posted_at DESC, id DESC",
  );
  const selectRelations = database.prepare(
    "SELECT relation, to_id, meaning FROM document_relation WHERE document_id = ? ORDER BY rowid",
  );
  const selectAnalyses = database.prepare(
    `SELECT d.id, d.label, d.source_url, d.analysis_version_label, d.analysis_is_minority
       FROM document d JOIN document_relation r ON r.document_id = d.id
      WHERE d.kind = 'analysis' AND r.relation = 'measure' AND r.to_id = ?
      ORDER BY d.id`,
  );
  function documentOf(row: unknown): DocumentView["document"] {
    const stored = documentRow.parse(row);
    return {
      id: stored.id as DocumentId,
      nodeId: stored.node_id as DocumentId | AmendmentId,
      kind: stored.kind as DocumentKind,
      label: stored.label,
      sourceUrl: stored.source_url,
      retrievedAt: stored.retrieved_at as Timestamp,
      contentHash: stored.content_hash,
      pageCount: stored.page_count,
      hasTextLayer: stored.has_text_layer === 1,
      postedAt: stored.posted_at as Timestamp | null,
      text: stored.text,
    };
  }
  function relationsOf(documentId: DocumentId): RelatedNode[] {
    return selectRelations.all(documentId).map((row) => {
      const stored = relationRow.parse(row);
      return { relation: stored.relation as Relation, to: stored.to_id as NodeId, meaning: stored.meaning, documentId };
    });
  }
  return {
    analysisDocuments(key) {
      return selectAnalyses.all(measureIdOf(key)).map((row) => {
        const stored = analysisRow.parse(row);
        const id = stored.id as DocumentId;
        const related = relationsOf(id);
        return {
          id,
          type: stored.label,
          versionLabel: stored.analysis_version_label,
          isMinority: stored.analysis_is_minority === 1,
          sourceUrl: stored.source_url,
          committeeId: (related.find((node) => node.relation === "committee")?.to as CommitteeId | undefined) ?? null,
          placedVersionId: (related.find((node) => node.relation === "version")?.to as DocumentId | undefined) ?? null,
        };
      });
    },
    counts(session) {
      const documentsByKind = Object.fromEntries(documentKinds.map((kind) => [kind, 0])) as Record<
        DocumentKind,
        number
      >;
      for (const row of selectKindCounts.all(session)) {
        const counted = kindCountRow.parse(row);
        documentsByKind[counted.kind as DocumentKind] = counted.n;
      }
      return {
        measures: countOf("SELECT COUNT(*) AS n FROM measure WHERE session_key = ?", session),
        committees: countOf("SELECT COUNT(*) AS n FROM committee WHERE session_key = ?", session),
        meetings: countOf("SELECT COUNT(*) AS n FROM meeting WHERE session_key = ?", session),
        proposedAmendments: countOf(
          "SELECT COUNT(DISTINCT node_id) AS n FROM document WHERE session_key = ? AND kind = 'proposed_amendment'",
          session,
        ),
        documents: countOf("SELECT COUNT(*) AS n FROM document WHERE session_key = ?", session),
        documentsWithoutTextLayer: countOf(
          "SELECT COUNT(*) AS n FROM document WHERE session_key = ? AND has_text_layer = 0",
          session,
        ),
        documentsByKind,
      };
    },
    findDocument(id) {
      const own = selectDocument.get(id);
      if (own !== undefined) {
        const document = documentOf(own);
        return { document, related: relationsOf(document.id) };
      }
      // Not a document: a Proposed Amendment, which has a posting (and a file) for each meeting.
      const postings = selectPostings.all(id).map(documentOf);
      const latest = postings[0];
      if (latest === undefined) return undefined;
      const related: RelatedNode[] = [];
      const seen = new Set<string>();
      for (const posting of postings.toReversed()) {
        for (const node of relationsOf(posting.id)) {
          if (node.relation === "amendment") continue;
          // A posting is told apart by its meeting; every other relation is the same for each posting.
          const key = `${node.relation} ${node.to}`;
          if (seen.has(key)) continue;
          seen.add(key);
          related.push(node);
        }
      }
      return { document: latest, related };
    },
    findMeasure(key) {
      const row = selectMeasure.get(key.session, key.prefix, key.number);
      if (row === undefined) return undefined;
      const stored = measureRow.parse(row);
      return {
        ...key,
        catchline: stored.catchline,
        digest: stored.digest,
        createdAt: stored.created_at as Timestamp,
        modifiedAt: stored.modified_at as Timestamp | null,
      };
    },
    asOf(session) {
      const row = selectAsOf.get(session);
      return row === undefined ? undefined : (stateRow.parse(row).full_pull_as_of as Timestamp);
    },
    close() {
      database.close();
    },
  };
}
