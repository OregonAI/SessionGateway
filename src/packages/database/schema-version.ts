// The schema version, for a gate that decides before a deploy whether an image may run against a database (ticket #146,
// OregonAI/platform-deploy#45). It is read-only: it never opens a file for writing and never upgrades one.
export { readRecordedVersion as databaseSchemaVersion, schemaVersion as imageSchemaVersion } from "./lib/connection.ts";
