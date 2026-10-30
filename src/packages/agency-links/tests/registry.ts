// The agency registry the seam-2 tables pass in: a small literal table of real OregonAI registry
// rows (slug, name, aliases). The extractor takes its registry as a parameter, so no table here
// reads the OregonAI snapshot, and nothing here calls OregonAI.
//
// Source: OregonAI's executive-regulatory-frameworks repository, `_meta/catalog/agencies.yml`
// (190 rows), read from a local checkout at HEAD 58e1839d441addf3ac1e1748c91ce3de78d3f342
// (2026-09-13). The file was last changed in 009ecc2cfaa47766bfc45d9b0d0d07e59b9c66c2 and the
// checkout had no local edit to it. Each row below copies that row's `slug`, `name` and `aliases`;
// a row with no `aliases` key in the catalog has an empty list here.
//
// One alias is NOT in the catalog and is marked TEST-ONLY: "ODHS". Spec #1 story 33 and ticket #7
// name it, and the fixture's own documents use it (HB 3795 Testimony 209256, Organization
// "ODHS"; the Digest of HB 3795 Introduced), but the catalog row for the Department of Human
// Services has no `aliases` key at that commit. It is added here so the tables can show an alias
// resolving. The extractor reads aliases only from the registry it is given, so against the
// catalog as it stands "ODHS" resolves to nothing. Where the product gets it from (the registry's
// owner adding it, or a supplement merged in when the snapshot is built, #16) is open.

import { parseAgencyId, type AgencyId } from "#/packages/domain/agencies.ts";
import type { RegistryAgency } from "../index.ts";

/** An Agency id for a table row: the slug as the catalog writes it. A slug that is not one fails the test run. */
export function testAgencyId(slug: string): AgencyId {
  const id = parseAgencyId(slug);
  if (id === undefined) throw new Error(`not an Agency id: ${slug}`);
  return id;
}

/** The rows as the catalog gives them, with the slug a plain string. */
const rows: readonly { slug: string; name: string; aliases: readonly string[] }[] = [
  { slug: "bureau-of-labor-and-industries", name: "Bureau of Labor and Industries", aliases: [] },
  { slug: "department-of-administrative-services", name: "Department of Administrative Services", aliases: [] },
  {
    slug: "department-of-agriculture",
    name: "Department of Agriculture",
    aliases: [],
  },
  {
    slug: "department-of-consumer-and-business-services",
    name: "Department of Consumer and Business Services",
    aliases: [],
  },
  {
    slug: "department-of-human-services",
    name: "Department of Human Services",
    // TEST-ONLY alias: "ODHS" is absent from the catalog row (see the header comment).
    aliases: ["ODHS"],
  },
  { slug: "department-of-justice", name: "Department of Justice", aliases: [] },
  { slug: "department-of-revenue", name: "Department of Revenue", aliases: [] },
  { slug: "employment-department", name: "Employment Department", aliases: [] },
  {
    slug: "higher-education-coordinating-commission",
    name: "Higher Education Coordinating Commission",
    aliases: ["Higher Education Coordinating Commission"],
  },
  { slug: "judicial-department", name: "Judicial Department", aliases: [] },
  { slug: "legislative-assembly", name: "Legislative Assembly", aliases: [] },
  { slug: "legislative-revenue-office", name: "Legislative Revenue Office", aliases: [] },
  {
    slug: "oregon-business-development-department",
    name: "Oregon Business Development Department",
    aliases: [],
  },
  { slug: "oregon-department-of-education", name: "Oregon Department of Education", aliases: [] },
  {
    slug: "oregon-department-of-education-early-learning-division",
    name: "Oregon Department of Education, Early Learning Division",
    aliases: [
      "Department of Early Learning and Care",
      "Early Learning Division",
      "Early Learning Division of the Department of Education",
    ],
  },
  { slug: "oregon-health-authority", name: "Oregon Health Authority", aliases: [] },
  {
    slug: "oregon-housing-and-community-services-department",
    name: "Oregon Housing and Community Services Department",
    aliases: [],
  },
  {
    slug: "oregon-liquor-control-commission",
    name: "Oregon Liquor Control Commission",
    aliases: ["Liquor and Cannabis Commission", "Oregon Liquor and Cannabis Commission"],
  },
  {
    slug: "oregon-state-treasury",
    name: "Oregon State Treasury",
    aliases: ["Office of the State Treasurer", "State Treasurer"],
  },
  {
    slug: "oregon-watershed-enhancement-board",
    name: "Oregon Watershed Enhancement Board",
    aliases: [],
  },
  { slug: "secretary-of-state", name: "Secretary of State", aliases: [] },
];

export const testRegistry: readonly RegistryAgency[] = rows.map((row) => ({ ...row, slug: testAgencyId(row.slug) }));
