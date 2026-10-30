// The ingest worker's side of the database. The server has no way to reach this file's functions:
// it imports reader.ts only.
import { z } from "zod";
import type {
  AgendaItem,
  Committee,
  DocumentId,
  DocumentLink,
  Meeting,
  StoredDocument,
} from "#/packages/domain/documents.ts";
import type { Measure, SessionKey } from "#/packages/domain/index.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import { openWriteConnection } from "./lib/connection.ts";

export type IndexWriter = {
  /** Stores what a full pull read, and when, in one transaction. A full pull never deletes (ADR-0005). */
  recordFullPull(session: SessionKey, measures: readonly Measure[], asOf: Timestamp): void;
  /**
   * Stores the committees, meetings and agenda items a full pull read, in one transaction. A meeting's
   * status and an item's action are the feed's latest. A full pull never deletes (ADR-0005).
   */
  recordMeetings(
    session: SessionKey,
    committees: readonly Committee[],
    meetings: readonly Meeting[],
    agendaItems: readonly AgendaItem[],
  ): void;
  /** The ids of the documents already stored for the Session: a stored document is never fetched again. */
  storedDocumentIds(session: SessionKey): Set<DocumentId>;
  /**
   * Brings what the feed says about documents already stored up to date, in one transaction: each one's
   * label, the node it belongs to, when it was posted and the nodes it points at. A fetched file is
   * unchanging (ADR-0005), so its text, hash and retrieval time are left alone. A link whose document is
   * not stored is ignored.
   */
  refreshDocuments(session: SessionKey, links: readonly DocumentLink[]): void;
  /** Every stored document of the Session whose file has no text layer, by id. */
  documentsWithoutTextLayer(session: SessionKey): { id: DocumentId; sourceUrl: string }[];
  /** Keeps one fetched document, its text and the nodes it points at, in one transaction. */
  storeDocument(session: SessionKey, document: StoredDocument): void;
  close(): void;
};

const idRow = z.object({ id: z.string() });
const scanRow = z.object({ id: z.string(), source_url: z.string() });

export function openIndexWriter(path: string): IndexWriter {
  const database = openWriteConnection(path);
  return {
    recordFullPull(session, measures, asOf) {
      const upsertMeasure = database.prepare(
        `INSERT INTO measure (session_key, prefix, number, catchline, created_at, modified_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_key, prefix, number) DO UPDATE SET
           catchline = excluded.catchline, created_at = excluded.created_at, modified_at = excluded.modified_at`,
      );
      const recordAsOf = database.prepare(
        `INSERT INTO index_state (session_key, full_pull_as_of) VALUES (?, ?)
         ON CONFLICT (session_key) DO UPDATE SET full_pull_as_of = excluded.full_pull_as_of`,
      );
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const measure of measures) {
          upsertMeasure.run(
            measure.session,
            measure.prefix,
            measure.number,
            measure.catchline,
            measure.createdAt,
            measure.modifiedAt,
          );
        }
        recordAsOf.run(session, asOf);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    recordMeetings(session, committees, meetings, agendaItems) {
      const upsertCommittee = database.prepare(
        `INSERT INTO committee (session_key, code, id, name) VALUES (?, ?, ?, ?)
         ON CONFLICT (session_key, code) DO UPDATE SET id = excluded.id, name = excluded.name`,
      );
      const upsertMeeting = database.prepare(
        `INSERT INTO meeting (id, session_key, committee_code, committee_id, at, status) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET committee_code = excluded.committee_code,
           committee_id = excluded.committee_id, at = excluded.at, status = excluded.status`,
      );
      const upsertAgendaItem = database.prepare(
        `INSERT INTO agenda_item (id, meeting_id, session_key, measure_prefix, measure_number, meeting_type, action,
                                  print_order, comments, board_name, executive_appointee)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET meeting_id = excluded.meeting_id, measure_prefix = excluded.measure_prefix,
           measure_number = excluded.measure_number, meeting_type = excluded.meeting_type, action = excluded.action,
           print_order = excluded.print_order, comments = excluded.comments, board_name = excluded.board_name,
           executive_appointee = excluded.executive_appointee`,
      );
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const committee of committees) upsertCommittee.run(session, committee.code, committee.id, committee.name);
        for (const meeting of meetings) {
          upsertMeeting.run(
            meeting.id,
            session,
            meeting.committeeCode,
            meeting.committeeId,
            meeting.at,
            meeting.status,
          );
        }
        for (const item of agendaItems) {
          upsertAgendaItem.run(
            item.itemId,
            item.meetingId,
            session,
            item.measure?.prefix ?? null,
            item.measure?.number ?? null,
            item.meetingType,
            item.action,
            item.printOrder,
            item.comments,
            item.boardName,
            item.executiveAppointee,
          );
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    storedDocumentIds(session) {
      const rows = database.prepare("SELECT id FROM document WHERE session_key = ?").all(session);
      return new Set(rows.map((row) => idRow.parse(row).id as DocumentId));
    },
    documentsWithoutTextLayer(session) {
      const rows = database
        .prepare("SELECT id, source_url FROM document WHERE session_key = ? AND has_text_layer = 0 ORDER BY id")
        .all(session);
      return rows.map((row) => {
        const stored = scanRow.parse(row);
        return { id: stored.id as DocumentId, sourceUrl: stored.source_url };
      });
    },
    refreshDocuments(session, links) {
      const updateDocument = database.prepare(
        "UPDATE document SET node_id = ?, label = ?, posted_at = ? WHERE id = ? AND session_key = ?",
      );
      const deleteRelations = database.prepare("DELETE FROM document_relation WHERE document_id = ?");
      const insertRelation = database.prepare(
        `INSERT INTO document_relation (document_id, relation, to_id, meaning, provenance) VALUES (?, ?, ?, ?, ?)`,
      );
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const link of links) {
          const updated = updateDocument.run(link.nodeId, link.label, link.postedAt, link.id, session);
          if (updated.changes === 0) continue;
          deleteRelations.run(link.id);
          for (const relation of link.relations) {
            insertRelation.run(link.id, relation.relation, relation.to, relation.meaning, relation.provenance);
          }
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    storeDocument(session, document) {
      const insertDocument = database.prepare(
        `INSERT INTO document (id, node_id, session_key, kind, label, source_url, retrieved_at, content_hash,
                               page_count, has_text_layer, posted_at, text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertRelation = database.prepare(
        `INSERT INTO document_relation (document_id, relation, to_id, meaning, provenance) VALUES (?, ?, ?, ?, ?)`,
      );
      database.exec("BEGIN IMMEDIATE");
      try {
        insertDocument.run(
          document.id,
          document.nodeId,
          session,
          document.kind,
          document.label,
          document.sourceUrl,
          document.retrievedAt,
          document.contentHash,
          document.pageCount,
          document.hasTextLayer ? 1 : 0,
          document.postedAt,
          document.text,
        );
        for (const relation of document.relations) {
          insertRelation.run(document.id, relation.relation, relation.to, relation.meaning, relation.provenance);
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    close() {
      database.close();
    },
  };
}
