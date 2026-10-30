import { z } from "zod";
import {
  orsChaptersOf,
  parseAgencySlug,
  parseOrsChapterId,
  parseOrsSectionId,
  type AgencySlug,
  type OrsChapterId,
  type OrsSectionId,
  type SnapshotVersion,
} from "#/packages/domain/oregonai.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

const agencySlug = z.string().transform((text, context) => {
  const slug = parseAgencySlug(text);
  if (slug === undefined) {
    context.addIssue({
      code: "custom",
      message: "must be an agency registry slug such as department-of-human-services",
    });
    return z.NEVER;
  }
  return slug;
});

const orsSectionId = z.string().transform((text, context) => {
  const id = parseOrsSectionId(text);
  if (id === undefined) {
    context.addIssue({ code: "custom", message: "must be an ORS section id such as ors-468.130" });
    return z.NEVER;
  }
  return id;
});

/** A commit date in Pacific time with its offset in force: -07:00 in daylight time, -08:00 otherwise. */
const pacificCommitDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[78]:00$/, "must be Pacific time with its UTC offset, to the second")
  .transform((text) => text as Timestamp);

const versionSchema = z.strictObject({
  source: z.literal("executive-regulatory-frameworks"),
  commit: z.string().regex(/^[0-9a-f]{40}$/, "must be a full 40-character commit SHA"),
  commitDate: pacificCommitDate,
});

const agencySchema = z.strictObject({
  slug: agencySlug,
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  oarChapter: z.string().regex(/^\d+$/).nullable(),
  dasAgencyNumber: z.string().regex(/^\d+$/).nullable(),
});

/**
 * The snapshot file (`formatVersion` 1), parsed. Besides the shape of each part it checks that the
 * parts agree: no Agency or ORS section twice, every Agency a chapter's row names is in the registry,
 * and every chapter with a row has a section in the list.
 */
export const snapshotSchema = z
  .strictObject({
    formatVersion: z.literal(1),
    version: versionSchema,
    agencies: z.array(agencySchema),
    orsSections: z.array(orsSectionId),
    chapterAgencies: z.record(z.string(), z.array(agencySlug).min(1)),
  })
  .transform((file, context) => {
    const slugs = new Set<AgencySlug>();
    for (const agency of file.agencies) {
      if (slugs.has(agency.slug)) {
        context.addIssue({ code: "custom", path: ["agencies"], message: `the agency ${agency.slug} is listed twice` });
      }
      slugs.add(agency.slug);
    }
    const sections = new Set<OrsSectionId>();
    for (const section of file.orsSections) {
      if (sections.has(section)) {
        context.addIssue({ code: "custom", path: ["orsSections"], message: `${section} is listed twice` });
      }
      sections.add(section);
    }
    const chaptersWithSections = orsChaptersOf(file.orsSections);
    const chapterAgencies = new Map<OrsChapterId, AgencySlug[]>();
    for (const [chapter, agencies] of Object.entries(file.chapterAgencies)) {
      const id = parseOrsChapterId(chapter);
      if (id === undefined) {
        context.addIssue({
          code: "custom",
          path: ["chapterAgencies", chapter],
          message: "the key must be an ORS chapter id such as ors-chapter-657b",
        });
        continue;
      }
      if (!chaptersWithSections.has(id)) {
        context.addIssue({
          code: "custom",
          path: ["chapterAgencies", chapter],
          message: `${chapter} has no section in orsSections`,
        });
      }
      for (const slug of agencies) {
        if (!slugs.has(slug)) {
          context.addIssue({
            code: "custom",
            path: ["chapterAgencies", chapter],
            message: `the agency ${slug} is not in the registry`,
          });
        }
      }
      chapterAgencies.set(id, agencies);
    }
    return {
      formatVersion: file.formatVersion,
      version: file.version satisfies SnapshotVersion,
      agencies: file.agencies,
      orsSections: file.orsSections,
      chapterAgencies,
    };
  });

/** The snapshot file as JSON holds it: what the build script writes. */
export type SnapshotFile = z.input<typeof snapshotSchema>;
