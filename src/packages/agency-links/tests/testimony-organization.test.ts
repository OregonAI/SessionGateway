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
  /** The feed row: its CommTestId and the Measure it was submitted on. */
  row: string;
  /** What is special about the value. */
  variant: string;
  /** The `Organization` value, exactly as the feed gives it. */
  organization: string;
};

describe("Testimony Organization", () => {
  describe("an Agency", () => {
    test.for<OrganizationRow & { slug: string }>([
      {
        row: "CommTestId 209256 (HB 3795)",
        variant: "an alias, ODHS",
        organization: "ODHS",
        slug: "department-of-human-services",
      },
      {
        row: "CommTestId 122570 (HB 3027)",
        variant: "a full name",
        organization: "Higher Education Coordinating Commission",
        slug: "higher-education-coordinating-commission",
      },
      {
        row: "CommTestId 196915 (SB 69)",
        variant: "a full name",
        organization: "Bureau of Labor and Industries",
        slug: "bureau-of-labor-and-industries",
      },
    ])("$row: $variant", ({ organization, slug }) => {
      expect(testimonyAgencyLinks(organization, testRegistry)).toEqual([
        { agency: slug, evidence: { kind: "testimony", organization } },
      ]);
    });
  });

  describe("a city is not an Agency", () => {
    test.for<OrganizationRow>([
      { row: "CommTestId 117167 (HB 3131)", variant: "plain value", organization: "Portland" },
      { row: "CommTestId 155753 (SB 121)", variant: "capitals", organization: "PORTLAND" },
      { row: "CommTestId 197756 (HB 3027)", variant: "lower case", organization: "grants pass" },
      { row: "CommTestId 117301 (HB 3131)", variant: "capitals", organization: "OREGON CITY" },
      { row: "CommTestId 117182 (HB 3131)", variant: "a trailing space", organization: "Lakeview " },
    ])("$row: $variant", ({ organization }) => {
      expect(testimonyAgencyLinks(organization, testRegistry)).toEqual([]);
    });
  });

  describe("noise is not an Agency", () => {
    test.for<OrganizationRow>([
      { row: "CommTestId 117281 (SB 64)", variant: "plain value", organization: "Oregon State Senate " },
      { row: "CommTestId 209568 (HB 3795)", variant: "plain value", organization: "Oregon Senate" },
      { row: "CommTestId 148731 (SB 921)", variant: "plain value", organization: "Senate District 1" },
      { row: "CommTestId 195070 (SB 64)", variant: "plain value", organization: "Southern Oregon" },
      {
        row: "CommTestId 117165 (HB 3131)",
        variant: "contains the word Agriculture",
        organization: "Oregon Climate and Agriculture Network",
      },
      {
        row: "CommTestId 150989 (SB 921)",
        variant: "starts like a registry name",
        organization: "Oregon Business and Industry",
      },
      { row: "CommTestId 117206 (HB 3131)", variant: "plain value", organization: "Ducks Unlimited Inc. " },
    ])("$row: $variant", ({ organization }) => {
      expect(testimonyAgencyLinks(organization, testRegistry)).toEqual([]);
    });
  });
});
