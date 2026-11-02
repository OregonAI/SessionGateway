// The Snapshot read: the one module that reads the Index with a Snapshot (GLOSSARY.md, "Snapshot"; ADR-0027, ADR-0035,
// ADR-0047). The Snapshot is the registry, the ORS section list and the Chapter table, and every link the Index holds is
// made with one, so the Index may report a Snapshot only when every link in it was read with that one. This module holds
// the rule that keeps that true, so that neither the pull that calls it nor the writer has to:
//
// - **the guard.** A Full pull reads the Index with its Snapshot, and switches the Index to it. An Increment reads with the
//   Snapshot the Index reports, when its Snapshot file is that one, and otherwise reads nothing and leaves it to the next
//   Full pull (ADR-0035, ADR-0047);
// - **the order.** The Statute Links of every stored Version and posting not yet read with the Snapshot, then the Agency
//   Links made from them (ADR-0035), and the Snapshot is recorded last, so a run that stops before that leaves the Snapshot
//   of the last run that finished (ADR-0027);
// - **Testimony's Agency**, which the Pull stores with the Testimony rows and not at the end, so that a server reading during
//   a Pull never sees a stored row lose its Agency: matched with the Snapshot's registry when the guard reads, left alone
//   when it does not (ADR-0047).
//
// The reading is the parsers' (`statute-links`, `agency-links`), the storage is the writer's. `database` imports no parser.
import { testimonyAgencyLinks } from "#/packages/agency-links/index.ts";
import type { IndexWriter, TestimonyAgency, TestimonyRecord } from "#/packages/database/writer.ts";
import type { DocumentLink, TestimonyDetails } from "#/packages/domain/documents.ts";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { Snapshot } from "#/packages/oregonai-snapshot/index.ts";
import { agencyReadOf } from "./lib/agency-links.ts";
import { statuteParseOf } from "./lib/statute-parse.ts";

/** The kind of Pull that reads: a Full pull switches the Snapshot the Index reports, an Increment never does. */
export type PullKind = "full_pull" | "increment";

export type SnapshotReadStart = {
  /** The Index's writer: the Snapshot read stores through it, and asks it which Snapshot the Index reports. */
  writer: IndexWriter;
  session: SessionKey;
  /** The Snapshot file the Pull loaded. */
  snapshot: Snapshot;
  pull: PullKind;
};

/**
 * What `finish` did: `read` when the Index was read with the Snapshot and now reports it, `left_to_full_pull` when an
 * Increment under another Snapshot read nothing.
 */
export type SnapshotReadOutcome = { kind: "read" } | { kind: "left_to_full_pull" };

/** A Pull's Snapshot read, begun. The Pull stores the Testimony rows through it first, and calls `finish` when its documents are stored. */
export type SnapshotRead = {
  /**
   * The Testimony rows among these links, each with what the Pull stores for its Agency (ADR-0047). Call it when the Pull
   * stores the rows: a Full pull and an Increment under the reported Snapshot match each row's `Organization` with the
   * Snapshot's registry, and an Increment under another one matches none.
   */
  testimonyRecordsOf(links: readonly DocumentLink[]): TestimonyRecord[];
  /**
   * Reads what is stored and not yet read with the Snapshot, and reports the Snapshot, unless the guard leaves the Snapshot
   * to the next Full pull. Nothing is fetched: it reads the text the store holds. A run that stops part-way rejects, and the
   * Index reports the Snapshot of the last run that finished; the next run reads what is still unread.
   */
  finish(): Promise<SnapshotReadOutcome>;
};

/** What a Pull does with the Snapshot: reads the Index with it, or leaves that to the next Full pull. */
type Reading = "read" | "leave_to_full_pull";

function readingOf({ writer, session, snapshot, pull }: SnapshotReadStart): Reading {
  switch (pull) {
    case "full_pull":
      return "read";
    case "increment":
      return writer.reportedSnapshotCommit(session) === snapshot.version.commit ? "read" : "leave_to_full_pull";
    default:
      return pull satisfies never;
  }
}

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
    case "leave_to_full_pull":
      return { kind: "leftToFullPull" };
    default:
      return reading satisfies never;
  }
}

/** Decides, once for the Pull, whether it reads with the Snapshot. Call it before the Pull stores any Testimony. */
export function beginSnapshotRead(start: SnapshotReadStart): SnapshotRead {
  const { writer, session, snapshot } = start;
  const reading = readingOf(start);
  return {
    testimonyRecordsOf: (links) =>
      links.flatMap((link): TestimonyRecord[] =>
        link.testimony === undefined
          ? []
          : [
              {
                link: { ...link, testimony: link.testimony },
                agency: testimonyAgencyOf(link.testimony, reading, snapshot),
              },
            ],
      ),
    // A run that stops part-way is a rejected promise, whichever step stopped it.
    finish: () =>
      Promise.try((): SnapshotReadOutcome => {
        if (reading === "leave_to_full_pull") return { kind: "left_to_full_pull" };
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
        // The Index reports this Snapshot only now, when every link in it has been read with it. The Agencies' parents go with it.
        writer.recordSnapshotRead(
          session,
          snapshot.version,
          [...snapshot.agencyParents].map(([agency, parent]) => ({ agency, parent })),
        );
        return { kind: "read" };
      }),
  };
}
