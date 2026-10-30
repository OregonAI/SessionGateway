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
  CommitteeCode: z.string().nullable(),
  PresessionFiledMessage: z.string().nullable(),
});

type SponsorRow = z.infer<typeof sponsorRow>;

/** The kind of row it is decides which of its columns the feed fills; a row that lacks its column is a fault. */
function sponsorshipOf(session: SessionKey, row: SponsorRow): Sponsorship {
  const common = {
    id: row.MeasureSponsorId,
    measure: { session, prefix: row.MeasurePrefix, number: row.MeasureNumber },
    level: row.SponsorLevel === "Chief" ? ("chief" as const) : ("regular" as const),
    printOrder: row.PrintOrder,
  };
  const lacks = (column: string): Error =>
    new Error(
      `OLIS sent a ${row.SponsorType} sponsor row (MeasureSponsorId ${row.MeasureSponsorId}) with no ${column}`,
    );
  switch (row.SponsorType) {
    case "Member":
      if (row.LegislatoreCode === null) throw lacks("LegislatoreCode");
      return { ...common, kind: "member", legislatorCode: row.LegislatoreCode };
    case "Committee":
      if (row.CommitteeCode === null) throw lacks("CommitteeCode");
      return { ...common, kind: "committee", committeeCode: row.CommitteeCode };
    case "Presession":
      if (row.PresessionFiledMessage === null) throw lacks("PresessionFiledMessage");
      return { ...common, kind: "presession", message: row.PresessionFiledMessage };
    default:
      return row.SponsorType satisfies never;
  }
}

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
    sponsorships.push(sponsorshipOf(session, row));
  }
  return sponsorships;
}
