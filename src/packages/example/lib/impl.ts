/** Hidden implementation: reachable only through the package's entry points. */
export function describeSession(sessionKey: string): string {
  return `Session ${sessionKey}`;
}
