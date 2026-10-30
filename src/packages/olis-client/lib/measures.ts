import { z } from "zod";
import type { Measure, SessionKey } from "#/packages/domain/index.ts";
import type { OlisClientOptions } from "./options.ts";

const page = z.object({
  value: z.array(
    z.looseObject({
      SessionKey: z.string(),
      MeasurePrefix: z.string(),
      MeasureNumber: z.number().int(),
      CatchLine: z.string().nullable(),
    }),
  ),
});

export async function readMeasureRows(
  options: OlisClientOptions,
  session: SessionKey,
  signal: AbortSignal,
): Promise<Measure[]> {
  const url = new URL("Measures", options.baseUrl);
  url.searchParams.set("$filter", `SessionKey eq '${session}'`);
  const response = await options.fetch(url, {
    headers: { accept: "application/json;odata=nometadata" },
    signal,
  });
  if (!response.ok) throw new Error(`OLIS answered ${response.status} to ${url.pathname}`);
  const body = page.parse(await response.json());
  return body.value.map((row) => ({
    session,
    prefix: row.MeasurePrefix,
    number: row.MeasureNumber,
    catchline: row.CatchLine,
  }));
}
