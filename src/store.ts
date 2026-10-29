import { DatabaseSync } from "node:sqlite";
import { chunkText } from "./chunk.ts";
import { normalizeMeasure, type SessionDocument } from "./document.ts";

export interface SearchOptions {
  type?: string | undefined;
  measure?: string | undefined;
  limit?: number | undefined;
}

export interface SearchHit {
  id: string;
  title: string;
  type: string;
  measure: string | null;
  sourceUrl: string;
  passage: number;
  snippet: string;
  score: number;
}

export interface Overview {
  sessions: string[];
  documents: number;
  measures: number;
  byType: Record<string, number>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id         TEXT PRIMARY KEY,
  session    TEXT NOT NULL,
  type       TEXT NOT NULL,
  measure    TEXT,
  title      TEXT NOT NULL,
  date       TEXT,
  source_url TEXT NOT NULL,
  text       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_measure ON documents (measure);
CREATE VIRTUAL TABLE IF NOT EXISTS passages USING fts5 (
  doc_id UNINDEXED,
  ord UNINDEXED,
  text,
  tokenize = 'porter unicode61'
);
`;

/**
 * The session index: documents plus full-text passages in one SQLite file.
 * The file is built offline by `ingest` and shipped read-only inside the
 * container image, so serving needs no database service.
 */
export class SessionStore {
  readonly #db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.#db = db;
  }

  static open(path: string, { readOnly = false } = {}): SessionStore {
    const db = new DatabaseSync(path, { readOnly });
    if (!readOnly) db.exec(SCHEMA);
    return new SessionStore(db);
  }

  static memory(): SessionStore {
    return SessionStore.open(":memory:");
  }

  upsert(doc: SessionDocument): void {
    const measure = doc.measure ? normalizeMeasure(doc.measure) : null;
    this.#db.exec("BEGIN");
    try {
      this.#db.prepare("DELETE FROM passages WHERE doc_id = ?").run(doc.id);
      this.#db
        .prepare(
          `INSERT OR REPLACE INTO documents (id, session, type, measure, title, date, source_url, text)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(doc.id, doc.session, doc.type, measure, doc.title, doc.date ?? null, doc.sourceUrl, doc.text);
      const insert = this.#db.prepare("INSERT INTO passages (doc_id, ord, text) VALUES (?, ?, ?)");
      // The title leads the first passage so a title-only match still retrieves the document.
      chunkText(`${doc.title}\n\n${doc.text}`).forEach((passage, ord) => insert.run(doc.id, ord, passage));
      this.#db.exec("COMMIT");
    } catch (err) {
      this.#db.exec("ROLLBACK");
      throw err;
    }
  }

  search(query: string, { type, measure, limit = 10 }: SearchOptions = {}): SearchHit[] {
    const match = toMatchExpression(query);
    if (!match) return [];
    const rows = this.#db
      .prepare(
        `SELECT d.id, d.title, d.type, d.measure, d.source_url AS sourceUrl, p.ord AS passage,
                snippet(passages, 2, '[', ']', '…', 32) AS snippet, bm25(passages) AS score
         FROM passages p JOIN documents d ON d.id = p.doc_id
         WHERE passages MATCH ?
           AND (? IS NULL OR d.type = ?)
           AND (? IS NULL OR d.measure = ?)
         ORDER BY score
         LIMIT ?`,
      )
      .all(match, type ?? null, type ?? null, measureParam(measure), measureParam(measure), limit);
    return rows as unknown as SearchHit[];
  }

  get(id: string): SessionDocument | undefined {
    const row = this.#db
      .prepare(
        `SELECT id, session, type, measure, title, date, source_url AS sourceUrl, text
         FROM documents WHERE id = ?`,
      )
      .get(id);
    if (!row) return undefined;
    const { measure, date, ...rest } = row as Record<string, string | null>;
    return { ...rest, ...(measure ? { measure } : {}), ...(date ? { date } : {}) } as SessionDocument;
  }

  overview(): Overview {
    const sessions = this.#db.prepare("SELECT DISTINCT session FROM documents ORDER BY session").all();
    const byType = this.#db.prepare("SELECT type, count(*) AS n FROM documents GROUP BY type").all();
    const totals = this.#db
      .prepare("SELECT count(*) AS documents, count(DISTINCT measure) AS measures FROM documents")
      .get() as { documents: number; measures: number };
    return {
      sessions: sessions.map((r) => String(r.session)),
      documents: totals.documents,
      measures: totals.measures,
      byType: Object.fromEntries(byType.map((r) => [String(r.type), Number(r.n)])),
    };
  }

  close(): void {
    this.#db.close();
  }
}

function measureParam(measure: string | undefined): string | null {
  return measure ? normalizeMeasure(measure) : null;
}

/**
 * Turn free text into a safe FTS5 expression: quote every term so user
 * punctuation can never be parsed as query syntax, and OR them so bm25
 * ranks partial matches instead of dropping them.
 */
export function toMatchExpression(query: string): string {
  const terms = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  return terms.map((t) => `"${t}"`).join(" OR ");
}
