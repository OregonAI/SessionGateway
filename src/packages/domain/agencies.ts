// An Agency's id (GLOSSARY.md, "Agency"; ADR-0004): the OregonAI agency registry slug, such as
// `department-of-human-services`. It is minted here, with the other ids (src/CLAUDE.md, "Shape").

/** An Agency's id: its OregonAI registry slug. */
export type AgencyId = string & { readonly brand: "AgencyId" };

const agencyIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Reads a registry slug such as `department-of-human-services` as an Agency id, or undefined if it is not one. */
export function parseAgencyId(text: string): AgencyId | undefined {
  return agencyIdPattern.test(text) ? (text as AgencyId) : undefined;
}
