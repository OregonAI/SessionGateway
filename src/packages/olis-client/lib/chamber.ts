import { z } from "zod";
import type { Chamber } from "#/packages/domain/index.ts";

/** The feed names a chamber by one letter: "H" or "S". Anything else is not a chamber the client knows. */
export const feedChamber = z.enum(["H", "S"]).transform((letter): Chamber => (letter === "H" ? "house" : "senate"));
