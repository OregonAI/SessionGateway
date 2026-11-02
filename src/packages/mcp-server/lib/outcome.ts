/**
 * What a tool's function returns: its answer, or a fault, which is an expected outcome that the agent is told of as a
 * tool error (an unknown id, a page past the last). A bug or an infrastructure failure is not a fault: it throws.
 */
export type Outcome<Answer, Fault> = { kind: "answer"; answer: Answer } | { kind: "fault"; fault: Fault };

/** The `faultMessage` of a tool that has no faults: its `Fault` is `never`, so there is no value to call it with. */
export function noFault(fault: never): never {
  throw new Error("A tool that has no faults reported one", { cause: fault });
}
