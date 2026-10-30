import { z } from "zod";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { Sponsorship } from "#/packages/domain/legislators.ts";
import { readEntitySet } from "./feed.ts";
import type { OlisClientOptions } from "./options.ts";

// The feed serializes decimal keys as strings: "MeasureSponsorId":"154809", "PrintOrder":"1"
// (docs/research/olis-odata.md section 8, gotcha 7).
const decimalKey = z
  .string()
  .regex(/^\d+$/)
  .transform((text) => Number(text));

const sponsorRow = z.looseObject({
  SessionKey: z.string(),
  MeasurePrefix: z.string(),
  MeasureNumber: z.number().int(),
  MeasureSponsorId: decimalKey,
  SponsorType: z.enum(["Member", "Presession", "Committee"]),
  SponsorLevel: z.enum(["Chief", "Regular"]),
  PrintOrder: decimalKey,
  // The property name is misspelled in the feed (gotcha 1): LegislatoreCode.
  LegislatoreCode: z.string().nullable(),
});

export async function readSponsorshipRows(
  options: OlisClientOptions,
  session: SessionKey,
  signal: AbortSignal,
): Promise<Sponsorship[]> {
  const rows = await readEntitySet(options, "MeasureSponsors", `SessionKey eq '${session}'`, sponsorRow, signal);
  const sponsorships: Sponsorship[] = [];
  for (const row of rows) {
    // A row of another Session is never taken for this one: measure numbers restart every Session.
    if (row.SessionKey !== session) continue;
    const common = {
      id: row.MeasureSponsorId,
      measure: { session, prefix: row.MeasurePrefix, number: row.MeasureNumber },
      level: row.SponsorLevel === "Chief" ? ("chief" as const) : ("regular" as const),
      printOrder: row.PrintOrder,
    };
    if (row.SponsorType === "Member") {
      if (row.LegislatoreCode === null) {
        throw new Error(
          `OLIS sent a Member sponsor row (MeasureSponsorId ${row.MeasureSponsorId}) with no LegislatoreCode`,
        );
      }
      sponsorships.push({ ...common, kind: "member", legislatorCode: row.LegislatoreCode });
    } else {
      sponsorships.push({ ...common, kind: row.SponsorType === "Committee" ? "committee" : "presession" });
    }
  }
  return sponsorships;
}
