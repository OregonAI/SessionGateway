// The Pull register (ticket #100, ADR-0050): how an Increment reads each entity set. It is the one place that says which
// sets an Increment reads whole, which only for the rows changed since the last run, which above the highest id held, and
// which it leaves to the next Full pull. These are the worker's decisions (ADR-0005 for the first three, ADR-0042 for the
// last, ADR-0045 for ids), so they live in `ingest` and not in the OLIS client, which reads whichever set it is asked for in
// the mode it is given (`PullRead`). A Full pull reads every set whole, so the register holds nothing for it: a Full pull
// that skipped a set would leave every row of it to be marked No longer listed after two pulls (ADR-0005, ADR-0030).
//
// The register is keyed by `pulledEntitySets`, the one list of the feed's sets that `domain` holds, so a name added there
// without an entry here does not compile. The other places that must know every set are keyed by the same list for the same
// reason: what a Pull reads (`readFeed`, index.ts) and what the writer is given and lists (`FullPullRecord`, whose Listing
// keys each set's rows). `database` and `domain` sit below `ingest`, so one shared object holding a set's every rule is not
// possible; the lists are the same names, checked by the compiler.
//
// How a set is counted is not here: every set a Pull reads, in any mode, is counted with `/$count` and `$inlinecount`
// (ADR-0005). A Full pull reports a short set in the Build report and stores nothing; an Increment throws on one.
import type { IndexWriter } from "#/packages/database/writer.ts";
import type { PulledEntitySet } from "#/packages/domain/documents.ts";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { DocumentSets, PullRead } from "#/packages/olis-client/index.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

/** How an Increment treats a set, apart from `above_id`, which also says where the highest id held is found. */
type SimpleIncrementReading =
  /** Every row, as a Full pull does: the set is small, or the Pull needs all of it (Legislators and Committees carry the names the rest resolve against). */
  | "whole"
  /** Only the rows OLIS created or modified after the last run less two hours (ADR-0039). */
  | "changed_since"
  /** Nothing: the set is left to the next Full pull (ConveneTimes and LegislativeSessions, ADR-0042). */
  | "not_read";

/** One entity set's entry in the register: how an Increment reads it. */
type PullRegisterEntry =
  | { increment: SimpleIncrementReading }
  | {
      /**
       * Only the rows with an id above the highest the Index holds, for a set with no dates to ask by (ADR-0005, ADR-0045).
       * While the Index holds none, the Increment reads the whole set.
       */
      increment: "above_id";
      /** The highest id of the set the Index holds, or undefined while it holds none. */
      highestHeld: (writer: IndexWriter, session: SessionKey) => number | undefined;
    };

/**
 * The register: one entry for each entity set, in the order `pulledEntitySets` lists them. The five sets that link
 * documents have an entry each, and `documentSetsReadOf` reads them from those entries and refuses entries that differ.
 */
const pullRegister: Readonly<Record<PulledEntitySet, PullRegisterEntry>> = {
  Measures: { increment: "changed_since" },
  Legislators: { increment: "whole" },
  MeasureSponsors: { increment: "changed_since" },
  MeasureHistoryActions: { increment: "changed_since" },
  MeasureVotes: { increment: "changed_since" },
  CommitteeVotes: { increment: "changed_since" },
  Committees: { increment: "whole" },
  CommitteeMeetings: { increment: "changed_since" },
  CommitteeAgendaItems: { increment: "changed_since" },
  MeasureDocuments: { increment: "changed_since" },
  MeasureAnalysisDocuments: { increment: "changed_since" },
  CommitteeMeetingDocuments: { increment: "changed_since" },
  CommitteeProposedAmendments: { increment: "changed_since" },
  CommitteePublicTestimonies: { increment: "changed_since" },
  CommitteeMembers: { increment: "changed_since" },
  ConveneTimes: { increment: "not_read" },
  LegislativeSessions: { increment: "not_read" },
  FloorLetters: {
    increment: "above_id",
    highestHeld: (writer, session) => writer.highestFloorLetterId(session),
  },
};

/** What a Pull is doing, with what the register's readings need of it. */
export type PullRun =
  | { kind: "full_pull" }
  | {
      kind: "increment";
      /** The time an Increment reads changes after: the last run's start less the overlap (ADR-0039). */
      since: Timestamp;
      /** What the Index holds, for the set that is read above the highest id held. */
      writer: IndexWriter;
      session: SessionKey;
    };

/** How the run reads a set, as the client is asked to read it, or undefined when the run leaves the set alone. */
export function pullReadOf(entitySet: PulledEntitySet, run: PullRun): PullRead | undefined {
  switch (run.kind) {
    case "full_pull":
      return { kind: "whole" };
    case "increment": {
      const entry = pullRegister[entitySet];
      switch (entry.increment) {
        case "whole":
          return { kind: "whole" };
        case "changed_since":
          return { kind: "changed_since", since: run.since };
        case "above_id": {
          const id = entry.highestHeld(run.writer, run.session);
          return id === undefined ? { kind: "whole" } : { kind: "above_id", id };
        }
        case "not_read":
          return undefined;
        default:
          return entry satisfies never;
      }
    }
    default:
      return run satisfies never;
  }
}

/**
 * The five entity sets whose rows link documents, the ones `readDocumentLinks` returns (the OLIS client). It reads them in
 * one call, because an analysis document is placed on the Versions read with it (ADR-0013), so it takes one mode for all.
 */
const documentSets: readonly (keyof DocumentSets)[] = [
  "MeasureDocuments",
  "MeasureAnalysisDocuments",
  "CommitteeMeetingDocuments",
  "CommitteeProposedAmendments",
  "CommitteePublicTestimonies",
];

/**
 * How the run reads the five sets that link documents, or undefined when it leaves them alone. Each set's own entry says
 * how, and the client reads them in one call, so entries that differ are a bug in the register and throw: the call would
 * otherwise read all five as one of the entries says, and the others would never take effect.
 */
export function documentSetsReadOf(run: PullRun): PullRead | undefined {
  const reads = documentSets.map((entitySet) => pullReadOf(entitySet, run));
  const readings = reads.map((read) => (read === undefined ? "not read" : JSON.stringify(read)));
  if (readings.some((reading) => reading !== readings[0])) {
    const which = documentSets.map((entitySet, index) => `${entitySet}: ${readings[index]}`);
    throw new Error(
      `The Pull register reads the sets that link documents in different ways, and the client reads them in one call (${which.join("; ")})`,
    );
  }
  return reads[0];
}
