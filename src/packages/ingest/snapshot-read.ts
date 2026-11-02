// The Snapshot read: the one module that reads the Index with a Snapshot (GLOSSARY.md, "Snapshot"; ADR-0027, ADR-0035,
// ADR-0044, ADR-0047). The Snapshot is the registry, the ORS section list and the Chapter table, and every link the Index
// holds is made with one, so the Index may report a Snapshot only when every link in it was read with that one. This module
// holds the rule that keeps that true, so that neither the pull that calls it nor the writer has to:
//
// - **the guard.** A Full pull reads the Index with its Snapshot, and switches the Index to it. An Increment reads with the
//   Snapshot the Index reports, when its Snapshot file is that one, and otherwise reads nothing and leaves it to the next
//   Full pull (ADR-0035, ADR-0047). Each kind of Pull has a begin function of its own, so that the types say what `finish`
//   takes and gives: only a Full pull is handed a Statutes Affected Table (an Increment fetches none, ADR-0034), and only an
//   Increment can leave the Snapshot to the next Full pull;
// - **the order.** The Statute Links of every stored Version and posting not yet read with the Snapshot, then the Agency
//   Links made from them (ADR-0035), then the series of the Statutes Affected Table (ADR-0044), and the Snapshot is
//   recorded last, so a run that stops before that leaves the Snapshot of the last run that finished (ADR-0027);
// - **Testimony's Agency**, which the Pull stores with the Testimony rows and not at the end, so that a server reading during
//   a Pull never sees a stored row lose its Agency: matched with the Snapshot's registry when the guard reads, left alone
//   when it does not (ADR-0047).
//
// Fetching the Statutes Affected Table from its address stays with the Pull, which hands this module what it got.
// The reading is the parsers' (`statute-links`, `agency-links`, `pdf-text`), the storage is the writer's. `database`
// imports no parser.
import { testimonyAgencyLinks } from "#/packages/agency-links/index.ts";
import type { IndexWriter, TestimonyAgency, TestimonyRecord } from "#/packages/database/writer.ts";
import type { DocumentLink, TestimonyDetails } from "#/packages/domain/documents.ts";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { Download } from "#/packages/olis-client/index.ts";
import type { Snapshot } from "#/packages/oregonai-snapshot/index.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import { agencyReadOf } from "./lib/agency-links.ts";
import { statuteParseOf } from "./lib/statute-parse.ts";
import { readStatutesAffectedTable, type StatutesAffectedTableReport } from "./lib/statutes-affected-table.ts";

export type { StatutesAffectedTableReport };

export type SnapshotReadStart = {
  /** The Index's writer: the Snapshot read stores through it, and asks it which Snapshot the Index reports. */
  writer: IndexWriter;
  session: SessionKey;
  /** The Snapshot file the Pull loaded. */
  snapshot: Snapshot;
};

/**
 * The Statutes Affected Table as the Pull got it from the address the deployment names: the address, the time of the
 * fetch (the copy's retrieval time, if the bytes are stored), and the bytes or why there are none. Fetching is the Pull's;
 * a Pull whose deployment names no table hands the Snapshot read nothing.
 */
export type StatutesAffectedTableFetch = {
  url: string;
  retrievedAt: Timestamp;
  download: Download;
};

/** What a Full pull's `finish` did: the Index was read with the Snapshot and now reports it, and the table's report if the Pull handed one. */
export type FullPullSnapshotOutcome = { kind: "read"; statutesAffectedTable: StatutesAffectedTableReport | undefined };

/**
 * What an Increment's `finish` did: `read` when the Index was read with the Snapshot and now reports it (the same
 * Snapshot as before), `left_to_full_pull` when the Snapshot file is not the one the Index reports and nothing was read.
 * An Increment reads no Statutes Affected Table, so neither outcome has one.
 */
export type IncrementSnapshotOutcome = { kind: "read" } | { kind: "left_to_full_pull" };

/** What any Pull's Snapshot read gives the Pull while it stores the feed. */
export type SnapshotRead = {
  /**
   * The Testimony rows among these links, each with what the Pull stores for its Agency (ADR-0047). Call it when the Pull
   * stores the rows: a Full pull and an Increment under the reported Snapshot match each row's `Organization` with the
   * Snapshot's registry, and an Increment under another one matches none.
   */
  testimonyRecordsOf(links: readonly DocumentLink[]): TestimonyRecord[];
};

/** A Full pull's Snapshot read, begun. The Pull stores the Testimony rows through it first, and calls `finish` when its documents are stored. */
export type FullPullSnapshotRead = SnapshotRead & {
  /**
   * Reads what is stored and not yet read with the Snapshot, and reports the Snapshot. Nothing is fetched: it reads the
   * text the store holds. A run that stops part-way rejects, and the Index reports the Snapshot of the last run that
   * finished; the next run reads what is still unread.
   *
   * `table` is the Statutes Affected Table the Pull fetched, or nothing when the deployment names none (then the Index's
   * table, if it holds one, is not read again, ADR-0044).
   */
  finish(table: StatutesAffectedTableFetch | undefined): Promise<FullPullSnapshotOutcome>;
};

/** An Increment's Snapshot read, begun. The Pull stores the Testimony rows through it first, and calls `finish` when its documents are stored. */
export type IncrementSnapshotRead = SnapshotRead & {
  /**
   * Reads what is stored and not yet read with the Snapshot and reports it, when the Snapshot file is the one the Index
   * reports, and otherwise reads nothing and leaves it to the next Full pull (ADR-0035, ADR-0047). It takes no table: an
   * Increment fetches none and reads none (ADR-0034). A run that stops part-way rejects, as a Full pull's does.
   */
  finish(): Promise<IncrementSnapshotOutcome>;
};

/** What a Pull does with the Snapshot: reads the Index with it, or leaves that to the next Full pull. */
type Reading = "read" | "left_to_full_pull";

/**
 * What a Pull stores for the Agency a Testimony row's `Organization` names. The match is the Agency Link extractor's
 * (`testimonyAgencyLinks`, spec #1 module 5), made here because the registry is the Snapshot file's and only the worker
 * reads that (ADR-0012). A Pull that leaves the Snapshot to the next Full pull makes no match, so the writer keeps the stored
 * Agency of a row it holds and stores a new row with none (ADR-0047).
 */
function testimonyAgencyOf(details: TestimonyDetails, reading: Reading, snapshot: Snapshot): TestimonyAgency {
  switch (reading) {
    case "read":
      return {
        kind: "matched",
        agencyId: testimonyAgencyLinks(details.organization ?? "", snapshot.agencies)[0]?.agency ?? null,
      };
    case "left_to_full_pull":
      return { kind: "left_to_full_pull" };
    default:
      return reading satisfies never;
  }
}

function testimonyRecordsOf(links: readonly DocumentLink[], reading: Reading, snapshot: Snapshot): TestimonyRecord[] {
  return links.flatMap((link): TestimonyRecord[] =>
    link.testimony === undefined
      ? []
      : [
          {
            link: { ...link, testimony: link.testimony },
            agency: testimonyAgencyOf(link.testimony, reading, snapshot),
          },
        ],
  );
}

/**
 * Reads the Index with the Snapshot, and reports the Snapshot: what a Full pull does, and what an Increment does under the
 * Snapshot the Index reports. Returns what became of the Statutes Affected Table, or nothing when `table` is nothing.
 */
async function readIndexWithSnapshot(
  { writer, session, snapshot }: SnapshotReadStart,
  table: StatutesAffectedTableFetch | undefined,
): Promise<StatutesAffectedTableReport | undefined> {
  // The Statute Links of every stored Version and posting not yet read with this Snapshot, from the text the store
  // holds. Postings that share a file are read once (ADR-0015). A Snapshot that has changed since a file was read
  // makes it unread, because its ranges are expanded against the Snapshot's section list (ADR-0035). This comes
  // before the Agency Links, which are made from these links.
  for (const file of writer.unreadStatuteFiles(session, snapshot.version)) {
    writer.storeStatuteParse(
      statuteParseOf(file, writer.storedText(file.documentId), snapshot.orsSections),
      snapshot.version,
    );
  }
  // The Agency Links of every stored Fiscal Impact Statement, Version and posting not yet read with this Snapshot
  // (ADR-0027), from the text the store holds and the Statute Links just read.
  for (const document of writer.unreadAgencyDocuments(session, snapshot.version)) {
    writer.storeAgencyRead(
      agencyReadOf(
        document,
        writer.storedText(document.documentId),
        writer.statuteLinksOf(document.documentId),
        snapshot,
      ),
      snapshot.version,
    );
  }
  // The series of the Statutes Affected Table the Index holds, expanded against this Snapshot's section list, when the
  // Pull handed the table it fetched (ADR-0044).
  const statutesAffectedTable =
    table === undefined
      ? undefined
      : await readStatutesAffectedTable({
          ...table,
          writer,
          session,
          orsSections: snapshot.orsSections,
          snapshotCommit: snapshot.version.commit,
        });
  // The Index reports this Snapshot only now, when every link in it has been read with it. The Agencies' parents go with it.
  writer.recordSnapshotRead(
    session,
    snapshot.version,
    [...snapshot.agencyParents].map(([agency, parent]) => ({ agency, parent })),
  );
  return statutesAffectedTable;
}

/** Begins a Full pull's Snapshot read, which reads the Index with the Snapshot whatever the Index reports. Call it before the Pull stores any Testimony. */
export function beginFullPullSnapshotRead(start: SnapshotReadStart): FullPullSnapshotRead {
  return {
    testimonyRecordsOf: (links) => testimonyRecordsOf(links, "read", start.snapshot),
    finish: async (table) => {
      const statutesAffectedTable = await readIndexWithSnapshot(start, table);
      return { kind: "read", statutesAffectedTable };
    },
  };
}

/**
 * Begins an Increment's Snapshot read, deciding once for the Pull whether it reads with the Snapshot: it does when the
 * Index reports the Snapshot of the Pull's file, and otherwise leaves it to the next Full pull. Call it before the Pull
 * stores any Testimony.
 */
export function beginIncrementSnapshotRead(start: SnapshotReadStart): IncrementSnapshotRead {
  const reading: Reading =
    start.writer.reportedSnapshotCommit(start.session) === start.snapshot.version.commit ? "read" : "left_to_full_pull";
  return {
    testimonyRecordsOf: (links) => testimonyRecordsOf(links, reading, start.snapshot),
    finish: async () => {
      switch (reading) {
        case "read":
          await readIndexWithSnapshot(start, undefined);
          return { kind: "read" };
        case "left_to_full_pull":
          return { kind: "left_to_full_pull" };
        default:
          return reading satisfies never;
      }
    },
  };
}
