import { describeSession } from "./lib/impl.ts";

/** A copy-me template: the package's entry point, delegating to its hidden implementation. */
export function greet(sessionKey: string): string {
  return describeSession(sessionKey);
}
