// The Agency id is a branded type (src/CLAUDE.md, "Shape": ids are branded types, so a MeasureId
// can't stand in for another id). Most of this file is checked by `npm run typecheck`: each
// `@ts-expect-error` below is an error the compiler must report, and if it stops reporting it
// the directive itself is an error.

import { describe, expect, test } from "vitest";
import { measureIdOf, parseSessionKey } from "#/packages/domain/index.ts";
import { parseAgencyId } from "#/packages/domain/agencies.ts";
import type { AgencyLink, RegistryAgency } from "../index.ts";

describe("Agency ids", () => {
  test("a registry slug is read as an Agency id, and a phrase is not", () => {
    // Slugs copied from the OregonAI catalog rows named in ./registry.ts.
    expect(parseAgencyId("department-of-human-services")).toBe("department-of-human-services");
    expect(parseAgencyId("oregon-529-savings-board")).toBe("oregon-529-savings-board");
    expect(parseAgencyId("Department of Human Services")).toBeUndefined();
    expect(parseAgencyId("")).toBeUndefined();
  });

  test("a Measure id can't stand in for an Agency id", () => {
    const session = parseSessionKey("2025R1");
    if (session === undefined) throw new Error("2025R1 is a Session key");
    const measure = measureIdOf({ session, prefix: "SB", number: 69 });
    // @ts-expect-error a MeasureId is not an AgencyId
    const link: AgencyLink = { agency: measure, evidence: { kind: "testimony", organization: "ODHS" } };
    // @ts-expect-error a plain string is not an AgencyId
    const row: RegistryAgency = {
      slug: "department-of-human-services",
      name: "Department of Human Services",
      aliases: [],
    };
    expect([link.agency, row.slug]).toEqual(["measure-2025r1-sb69", "department-of-human-services"]);
  });
});
