# Pair with OregonAI by shared ids and a build-time snapshot, never by runtime calls

SessionGateway never calls the OregonAI gateway while serving. Both run on the same deploy box (ADR-0007), so they share its uptime either way. But the gateway's deployed build lags `main` and redeploys on its own schedule, a fan-out call takes 0.1–11 s, and an OregonAI container restart (the shared encoder takes 18.5 s to load) shouldn't fail a SessionGateway answer. Instead SessionGateway emits ids in OregonAI's own forms, and the agent in the MCP client takes them to OregonAI for depth (statute text, implementing rules, budgets, KPMs, audits).

- Measure: `measure-2025r1-hb3318` exactly (lower-case session and prefix, no leading zeros).
- ORS section: `ors-163a.040` exactly; subsections are cut back to the section.
- ORS ranges ("ORS 418.806 to 418.816") are expanded into each section by SessionGateway, because OregonAI resolves a range to its last section only (checked 2026-10-29).
- ORS chapters ("added to and made a part of ORS chapter 657B") have no OregonAI id; SessionGateway mints `ors-chapter-657b` and marks it as not resolvable there.
- Agency: the OregonAI agency registry slug, such as `department-of-environmental-quality`.
- Entities only SessionGateway holds use the same `{kind}-{session}-{key}` shape.

A small slice is copied at build time:

- the agency registry (slug, name, aliases, OAR chapter, DAS number), so that agency names in Fiscal Impact Statements and bill text resolve to slugs;
- the list of ORS section ids, so ranges can be expanded;
- one derived table: for each ORS chapter, the Agencies whose rules implement its sections, from ERF's statute→rule links and each rule's OAR chapter. It lets one call answer "what's new today that touches my agency's statutes".

The split for "how does this affect an agency": SessionGateway returns Agency Links, each labelled with its evidence (named in a Fiscal Impact Statement's "Government Unit(s) Affected", named in the text, submitted Testimony, or derived through a Statute Link and the table above). OregonAI, reached by the agent with these ids, supplies the current statute text, the implementing rules, and the Agency's budget, KPMs and audits.

## Considered Options

- **Agent joins by id only.** Kept for depth, but alone it can't turn "Government Unit(s) Affected: Department of Education" into a slug or expand a range.
- **SessionGateway calls OregonAI per request.** Rejected for the dependency above.
