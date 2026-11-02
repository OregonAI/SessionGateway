// The Pull register (ticket #100; GLOSSARY.md "Pull register"): for each entity set a Pull can read, how a Full pull reads
// it and how an Increment does. It is the one place that says which sets an Increment reads whole, which only for the
// rows changed since the last run, which above the highest id held, and which it leaves to the next Full pull. These are
// the worker's decisions (ADR-0005 for the first three, ADR-0042 for the last, ADR-0045 for ids), so they live in `ingest`
// and not in the OLIS client, which reads whichever set it is asked for in the mode it is given (`PullRead`).
//
// The register is keyed by `pulledEntitySets`, the one list of the feed's sets that `domain` holds, so a name added there
// without an entry here does not compile. The other places that must know every set are keyed by the same list for the same
// reason: what a Pull reads (`readFeed`, index.ts) and what the writer is given to store and to list
// (`FullPullRecord` in database/writer.ts, whose Listing keys each set's rows). `database` and `domain` sit below `ingest`,
// so one shared object holding a set's every rule is not possible; the lists are the same names, checked by the compiler.
//
// How a set is counted is not a column: every set a Pull reads, in any mode, is counted with `/$count` and `$inlinecount`
// (ADR-0005). A Full pull reports a short set in the Build report and stores nothing; an Increment throws on one.
import type { IndexWriter } from "#/packages/database/writer.ts";
import type { PulledEntitySet } from "#/packages/domain/documents.ts";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { PullRead } from "#/packages/olis-client/index.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

/** How a Full pull treats a set: it reads every row, or leaves the set alone. */
type FullPullReading = "whole" | "not_read";

/** How an Increment treats a set, apart from `above_id`, which also says where the highest id held is found. */
type SimpleIncrementReading =
  /** Every row, as a Full pull does: the set is small, or the Pull needs all of it (Legislators and Committees carry the names the rest resolve against). */
  | "whole"
  /** Only the rows OLIS created or modified after the last run less two hours (ADR-0039). */
  | "changed_since"
  /** Nothing: the set is left to the next Full pull (ConveneTimes and LegislativeSessions, ADR-0042). */
  | "not_read";

/** One entity set's entry in the register. */
type PullRegisterEntry =
  | { fullPull: FullPullReading; increment: SimpleIncrementReading }
  | {
      fullPull: FullPullReading;
      /**
       * Only the rows with an id above the highest the Index holds, for a set with no dates to ask by (ADR-0005, ADR-0045).
       * While the Index holds none, the Increment reads the whole set.
       */
      increment: "above_id";
      /** The highest id of the set the Index holds, or undefined while it holds none. */
      highestHeld: (writer: IndexWriter, session: SessionKey) => number | undefined;
    };

/**
 * The five sets that link documents share one entry because the client reads them in one call, in one mode: an analysis
 * document is placed on the Versions read with it (ADR-0013). `readFeed` asks the client for the five through
 * `MeasureDocuments`, so the five entries must agree, and sharing one object makes them.
 */
const documentSet: PullRegisterEntry = { fullPull: "whole", increment: "changed_since" };

/** The register: one entry for each entity set, in the order `pulledEntitySets` lists them. */
export const pullRegister: Record<PulledEntitySet, PullRegisterEntry> = {
  Measures: { fullPull: "whole", increment: "changed_since" },
  Legislators: { fullPull: "whole", increment: "whole" },
  MeasureSponsors: { fullPull: "whole", increment: "changed_since" },
  MeasureHistoryActions: { fullPull: "whole", increment: "changed_since" },
  MeasureVotes: { fullPull: "whole", increment: "changed_since" },
  CommitteeVotes: { fullPull: "whole", increment: "changed_since" },
  Committees: { fullPull: "whole", increment: "whole" },
  CommitteeMeetings: { fullPull: "whole", increment: "changed_since" },
  CommitteeAgendaItems: { fullPull: "whole", increment: "changed_since" },
  MeasureDocuments: documentSet,
  MeasureAnalysisDocuments: documentSet,
  CommitteeMeetingDocuments: documentSet,
  CommitteeProposedAmendments: documentSet,
  CommitteePublicTestimonies: documentSet,
  CommitteeMembers: { fullPull: "whole", increment: "changed_since" },
  ConveneTimes: { fullPull: "whole", increment: "not_read" },
  LegislativeSessions: { fullPull: "whole", increment: "not_read" },
  FloorLetters: {
    fullPull: "whole",
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
export function readOf(entitySet: PulledEntitySet, run: PullRun): PullRead | undefined {
  const entry = pullRegister[entitySet];
  switch (run.kind) {
    case "full_pull":
      return entry.fullPull === "whole" ? { kind: "whole" } : undefined;
    case "increment":
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
    default:
      return run satisfies never;
  }
}
