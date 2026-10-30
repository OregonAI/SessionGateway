// The ingest worker's side of the database. The server has no way to reach this file's functions:
// it imports reader.ts only.
import { z } from "zod";
import {
  meetingDocumentKinds,
  type AgendaItem,
  type Committee,
  type DocumentId,
  type DocumentKind,
  type DocumentLink,
  type Meeting,
  type StoredDocument,
} from "#/packages/domain/documents.ts";
import type { HistoryAction, Measure, MeasureKey, SessionKey } from "#/packages/domain/index.ts";
import type { Legislator, LegislatorId, SponsorLevel } from "#/packages/domain/legislators.ts";
import type { SnapshotVersion } from "#/packages/domain/oregonai.ts";
import type { CommitteeVoteEntry, FloorVoteEntry } from "#/packages/domain/votes.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import { openWriteConnection } from "./lib/connection.ts";

type SponsorRecordFields = {
  id: number;
  measure: MeasureKey;
  level: SponsorLevel;
  printOrder: number;
};

/**
 * One MeasureSponsors row of the feed. A Member row carries the Legislator its code resolved to, if
 * any; a Committee row names a committee and a Presession row carries a message, and neither names a
 * Legislator.
 */
export type SponsorRecord =
  | (SponsorRecordFields & { kind: "member"; legislatorCode: string; legislatorId: LegislatorId | null })
  | (SponsorRecordFields & { kind: "committee"; committeeCode: string })
  | (SponsorRecordFields & { kind: "presession"; message: string });

/** A Legislator Code and the id of the Legislator it names. */
export type LegislatorCodeRecord = { code: string; legislatorId: LegislatorId };

/** What the worker stores of a floor vote entry: the entry and the Legislator its code resolved to, if any. */
export type FloorVoteRecord = FloorVoteEntry & { legislatorId: LegislatorId | null };

/** What the worker stores of a committee vote entry: the entry and the Legislator its code resolved to, if any. */
export type CommitteeVoteRecord = CommitteeVoteEntry & { legislatorId: LegislatorId | null };

/**
 * Everything a full pull read, ready to store: one field for each kind of row. A ticket that makes the
 * pull read another kind of row adds a field here, not a parameter to `recordFullPull`.
 */
export type FullPullRecord = {
  measures: readonly Measure[];
  history: readonly HistoryAction[];
  /** The Legislators the resolver can name. */
  legislators: readonly Legislator[];
  /** Every Legislator Code the resolver can resolve, with the id of the Legislator it names (the live lookup resolves codes OLIS sends later). */
  legislatorCodes: readonly LegislatorCodeRecord[];
  /** The MeasureSponsors rows, with the Legislator each Member row's code resolved to. */
  sponsors: readonly SponsorRecord[];
  floorVotes: readonly FloorVoteRecord[];
  committeeVotes: readonly CommitteeVoteRecord[];
  /** The version of the OregonAI snapshot the build used. */
  snapshot: SnapshotVersion;
  committees: readonly Committee[];
  /** The committee meetings. A meeting's status is the feed's latest. */
  meetings: readonly Meeting[];
  /** The agenda items of every meeting. An item's action is the feed's latest. */
  agendaItems: readonly AgendaItem[];
  /**
   * Every document the feed links, the meetings' agendas included, whether or not its file is fetched
   * yet. What each meeting lists (its agenda, Exhibits, Recording Logs and the postings of Proposed
   * Amendments) and which analysis documents each Measure has are stored from these before any file is
   * fetched, so a file that fails to come is still listed (ADR-0011, "Order of a pull").
   */
  documentLinks: readonly DocumentLink[];
};

/** The columns of the sponsor table that only some kinds of row fill; the others stay NULL. */
function kindColumnsOf(sponsor: SponsorRecord): {
  legislatorCode: string | null;
  legislatorId: string | null;
  committeeCode: string | null;
  message: string | null;
} {
  const none = { legislatorCode: null, legislatorId: null, committeeCode: null, message: null };
  switch (sponsor.kind) {
    case "member":
      return { ...none, legislatorCode: sponsor.legislatorCode, legislatorId: sponsor.legislatorId };
    case "committee":
      return { ...none, committeeCode: sponsor.committeeCode };
    case "presession":
      return { ...none, message: sponsor.message };
    default:
      return sponsor satisfies never;
  }
}

export type IndexWriter = {
  /**
   * Stores what a full pull read, when, and the version of the OregonAI snapshot the build used, in one
   * transaction. A meeting's status, an agenda item's action, and a listed document's label, Measure and
   * a posting's Meaning are the feed's latest. The listing of analysis documents replaces the Session's,
   * so the server can tell a Measure whose statement the worker could not fetch from one that has none.
   * A full pull never deletes anything else (ADR-0005).
   */
  recordFullPull(session: SessionKey, asOf: Timestamp, pulled: FullPullRecord): void;
  /** The ids of the documents already stored for the Session: a stored document is never fetched again. */
  storedDocumentIds(session: SessionKey): Set<DocumentId>;
  /**
   * Brings what the feed says about documents already stored up to date, in one transaction: each one's
   * label, the node it belongs to, when it was posted, an analysis document's Version label and minority
   * flag and the nodes it points at. A fetched file is unchanging (ADR-0005), so its text, hash and retrieval time
   * are left alone. A link whose document is not stored is ignored.
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

/** SQLite has no boolean: an analysis document's flag is 0 or 1, and any other document's is NULL. */
function minorityColumn(isMinority: boolean | undefined): 0 | 1 | null {
  return isMinority === undefined ? null : isMinority ? 1 : 0;
}

/** The meeting a link is listed under and, for a posting, what the committee did with it there. */
function meetingListingOf(link: DocumentLink): { meetingId: string; meaning: string | null } | undefined {
  if (!(meetingDocumentKinds as readonly DocumentKind[]).includes(link.kind)) return undefined;
  const bound =
    link.relations.find((relation) => relation.relation === "posted_to") ??
    link.relations.find((relation) => relation.relation === "meeting");
  return bound === undefined ? undefined : { meetingId: bound.to, meaning: bound.meaning };
}

export function openIndexWriter(path: string): IndexWriter {
  const database = openWriteConnection(path);
  return {
    recordFullPull(session, asOf, pulled) {
      const upsertMeasure = database.prepare(
        `INSERT INTO measure (session_key, prefix, number, catchline, location, committee_code, digest, created_at,
                              modified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_key, prefix, number) DO UPDATE SET
           catchline = excluded.catchline, location = excluded.location, committee_code = excluded.committee_code,
           digest = excluded.digest, created_at = excluded.created_at, modified_at = excluded.modified_at`,
      );
      const upsertLegislator = database.prepare(
        `INSERT INTO legislator (session_key, id, name) VALUES (?, ?, ?)
         ON CONFLICT (session_key, id) DO UPDATE SET name = excluded.name`,
      );
      const upsertLegislatorCode = database.prepare(
        `INSERT INTO legislator_code (session_key, code, legislator_id) VALUES (?, ?, ?)
         ON CONFLICT (session_key, code) DO UPDATE SET legislator_id = excluded.legislator_id`,
      );
      const upsertSponsor = database.prepare(
        `INSERT INTO sponsor (session_key, sponsor_id, prefix, number, kind, level, print_order,
                              legislator_code, legislator_id, committee_code, presession_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_key, sponsor_id) DO UPDATE SET
           prefix = excluded.prefix, number = excluded.number, kind = excluded.kind, level = excluded.level,
           print_order = excluded.print_order, legislator_code = excluded.legislator_code,
           legislator_id = excluded.legislator_id, committee_code = excluded.committee_code,
           presession_message = excluded.presession_message`,
      );
      const upsertFloorVote = database.prepare(
        `INSERT INTO floor_vote (session_key, vote_id, history_id, prefix, number, chamber, action_date, action_text,
                                 legislator_code, legislator_id, vote)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_key, vote_id) DO UPDATE SET
           history_id = excluded.history_id, prefix = excluded.prefix, number = excluded.number,
           chamber = excluded.chamber, action_date = excluded.action_date, action_text = excluded.action_text,
           legislator_code = excluded.legislator_code, legislator_id = excluded.legislator_id, vote = excluded.vote`,
      );
      const upsertCommitteeVote = database.prepare(
        `INSERT INTO committee_vote (session_key, vote_id, report_id, prefix, number, committee_code, meeting_date,
                                     legislator_code, legislator_id, vote)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_key, vote_id) DO UPDATE SET
           report_id = excluded.report_id, prefix = excluded.prefix, number = excluded.number,
           committee_code = excluded.committee_code, meeting_date = excluded.meeting_date,
           legislator_code = excluded.legislator_code, legislator_id = excluded.legislator_id, vote = excluded.vote`,
      );
      const upsertHistory = database.prepare(
        `INSERT INTO history_action (session_key, history_id, prefix, number, chamber, action_date, action_text)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_key, history_id) DO UPDATE SET
           prefix = excluded.prefix, number = excluded.number, chamber = excluded.chamber,
           action_date = excluded.action_date, action_text = excluded.action_text`,
      );
      const recordAsOf = database.prepare(
        `INSERT INTO index_state (session_key, full_pull_as_of) VALUES (?, ?)
         ON CONFLICT (session_key) DO UPDATE SET full_pull_as_of = excluded.full_pull_as_of`,
      );
      const recordSnapshot = database.prepare(
        `INSERT INTO snapshot_state (session_key, source, commit_sha, commit_date) VALUES (?, ?, ?, ?)
         ON CONFLICT (session_key) DO UPDATE SET
           source = excluded.source, commit_sha = excluded.commit_sha, commit_date = excluded.commit_date`,
      );
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
      const upsertMeetingDocument = database.prepare(
        `INSERT INTO meeting_document (document_id, meeting_id, session_key, kind, node_id, label, source_url,
                                       title, measure_id, meaning)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (document_id) DO UPDATE SET meeting_id = excluded.meeting_id, kind = excluded.kind,
           node_id = excluded.node_id, label = excluded.label, source_url = excluded.source_url,
           title = excluded.title, measure_id = excluded.measure_id, meaning = excluded.meaning`,
      );
      const insertAnalysisListing = database.prepare(
        "INSERT INTO analysis_listing (document_id, session_key, measure_id) VALUES (?, ?, ?)",
      );
      const clearAnalysisListing = database.prepare("DELETE FROM analysis_listing WHERE session_key = ?");
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const measure of pulled.measures) {
          upsertMeasure.run(
            measure.session,
            measure.prefix,
            measure.number,
            measure.catchline,
            measure.location.current,
            measure.location.committeeCode,
            measure.digest,
            measure.createdAt,
            measure.modifiedAt,
          );
        }
        for (const legislator of pulled.legislators) upsertLegislator.run(session, legislator.id, legislator.name);
        for (const record of pulled.legislatorCodes)
          upsertLegislatorCode.run(session, record.code, record.legislatorId);
        for (const sponsor of pulled.sponsors) {
          const columns = kindColumnsOf(sponsor);
          upsertSponsor.run(
            session,
            sponsor.id,
            sponsor.measure.prefix,
            sponsor.measure.number,
            sponsor.kind,
            sponsor.level,
            sponsor.printOrder,
            columns.legislatorCode,
            columns.legislatorId,
            columns.committeeCode,
            columns.message,
          );
        }
        for (const entry of pulled.floorVotes) {
          upsertFloorVote.run(
            session,
            entry.id,
            entry.historyId,
            entry.measure.prefix,
            entry.measure.number,
            entry.chamber,
            entry.date,
            entry.action,
            entry.legislatorCode,
            entry.legislatorId,
            entry.vote,
          );
        }
        for (const entry of pulled.committeeVotes) {
          upsertCommitteeVote.run(
            session,
            entry.id,
            entry.reportId,
            entry.measure.prefix,
            entry.measure.number,
            entry.committeeCode,
            entry.meetingDate,
            entry.legislatorCode,
            entry.legislatorId,
            entry.vote,
          );
        }
        for (const action of pulled.history) {
          upsertHistory.run(
            session,
            action.id,
            action.measure.prefix,
            action.measure.number,
            action.chamber,
            action.date,
            action.text,
          );
        }
        for (const committee of pulled.committees) {
          upsertCommittee.run(session, committee.code, committee.id, committee.name);
        }
        for (const meeting of pulled.meetings) {
          upsertMeeting.run(
            meeting.id,
            session,
            meeting.committeeCode,
            meeting.committeeId,
            meeting.at,
            meeting.status,
          );
        }
        for (const item of pulled.agendaItems) {
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
        // What each meeting lists. A link to any other kind of document, or to no meeting, is not listed.
        for (const link of pulled.documentLinks) {
          const listing = meetingListingOf(link);
          if (listing === undefined) continue;
          upsertMeetingDocument.run(
            link.id,
            listing.meetingId,
            session,
            link.kind,
            link.nodeId,
            link.label,
            link.sourceUrl,
            link.title ?? null,
            link.relations.find((relation) => relation.relation === "measure")?.to ?? null,
            listing.meaning,
          );
        }
        // Which analysis documents the feed lists for each Measure, as this pull read it.
        clearAnalysisListing.run(session);
        for (const link of pulled.documentLinks) {
          if (link.kind !== "analysis") continue;
          const measure = link.relations.find((relation) => relation.relation === "measure");
          if (measure === undefined) throw new Error(`The analysis document ${link.id} names no Measure`);
          insertAnalysisListing.run(link.id, session, measure.to);
        }
        recordAsOf.run(session, asOf);
        recordSnapshot.run(session, pulled.snapshot.source, pulled.snapshot.commit, pulled.snapshot.commitDate);
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
        "UPDATE document SET node_id = ?, label = ?, posted_at = ?, analysis_version_label = ?, analysis_is_minority = ? WHERE id = ? AND session_key = ?",
      );
      const deleteRelations = database.prepare("DELETE FROM document_relation WHERE document_id = ?");
      const insertRelation = database.prepare(
        `INSERT INTO document_relation (document_id, relation, to_id, meaning, provenance) VALUES (?, ?, ?, ?, ?)`,
      );
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const link of links) {
          const updated = updateDocument.run(
            link.nodeId,
            link.label,
            link.postedAt,
            link.versionLabel ?? null,
            minorityColumn(link.isMinority),
            link.id,
            session,
          );
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
                               page_count, has_text_layer, posted_at, analysis_version_label,
                               analysis_is_minority, text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          document.versionLabel ?? null,
          minorityColumn(document.isMinority),
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
