// Seam 2 (test/CLAUDE.md): a Testimony row's `Organization` goes in, Agency Links come out. Each
// row quotes the `Organization` of a CommitteePublicTestimonies row in test/fixtures/olis-2025R1/
// (feed/CommitteePublicTestimonies.json) exactly as the feed gives it, stray spaces and capitals
// included, and names the row by its CommTestId. The field is free text typed by the person who
// submitted, so most values are a city or something else that is not an Agency (spec #1, "Further
// Notes").

import { describe, expect, test } from "vitest";
import { testimonyAgencyLinks } from "../index.ts";
import { testRegistry } from "./registry.ts";

type OrganizationRow = {
  /** The row's CommTestId and the Measure it was submitted on. */
  source: string;
  /** The `Organization` value, exactly as the feed gives it. */
  organization: string;
};

describe("Testimony Organization", () => {
  describe("an Agency", () => {
    test.for<OrganizationRow & { slug: string }>([
      {
        source: "CommTestId 209256 (HB 3795): an alias, ODHS",
        organization: "ODHS",
        slug: "department-of-human-services",
      },
      {
        source: "CommTestId 122570 (HB 3027): a full name",
        organization: "Higher Education Coordinating Commission",
        slug: "higher-education-coordinating-commission",
      },
      {
        source: "CommTestId 196915 (SB 69): a full name",
        organization: "Bureau of Labor and Industries",
        slug: "bureau-of-labor-and-industries",
      },
    ])("$source", ({ organization, slug }) => {
      expect(testimonyAgencyLinks(organization, testRegistry)).toEqual([
        { agency: slug, evidence: { kind: "testimony", organization } },
      ]);
    });
  });

  describe("a city is not an Agency", () => {
    test.for<OrganizationRow>([
      { source: "CommTestId 117167 (HB 3131)", organization: "Portland" },
      { source: "CommTestId 155753 (SB 121): capitals", organization: "PORTLAND" },
      { source: "CommTestId 197756 (HB 3027): lower case", organization: "grants pass" },
      { source: "CommTestId 117301 (HB 3131): capitals", organization: "OREGON CITY" },
      { source: "CommTestId 117182 (HB 3131): a trailing space", organization: "Lakeview " },
    ])("$source", ({ organization }) => {
      expect(testimonyAgencyLinks(organization, testRegistry)).toEqual([]);
    });
  });

  describe("noise is not an Agency", () => {
    test.for<OrganizationRow>([
      { source: "CommTestId 117281 (SB 64)", organization: "Oregon State Senate " },
      { source: "CommTestId 209568 (HB 3795)", organization: "Oregon Senate" },
      { source: "CommTestId 148731 (SB 921)", organization: "Senate District 1" },
      { source: "CommTestId 195070 (SB 64)", organization: "Southern Oregon" },
      {
        source: "CommTestId 117165 (HB 3131): contains the word Agriculture",
        organization: "Oregon Climate and Agriculture Network",
      },
      {
        source: "CommTestId 150989 (SB 921): starts like a registry name",
        organization: "Oregon Business and Industry",
      },
      { source: "CommTestId 117206 (HB 3131)", organization: "Ducks Unlimited Inc. " },
    ])("$source", ({ organization }) => {
      expect(testimonyAgencyLinks(organization, testRegistry)).toEqual([]);
    });
  });
});
