import "server-only";

import { prisma } from "@/lib/prisma";
import {
  SETUP_SHEET_MODEL_SLUG_A800RR,
  SETUP_SHEET_TEMPLATE_A800RR,
} from "@/lib/setupSheetTemplateId";
import { AUTHORIZED_CHASSIS_CATALOG } from "@/lib/setupSheetModels/authorizedCatalog";
import { buildA800SeedSchema } from "@/lib/setupSheetModels/seedA800Model";
import { mergeMissingA800CatalogFields } from "@/lib/setupSheetModels/mergeA800CatalogFields";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { getSuppressedCatalogSlugs } from "@/lib/setupSheetModels/catalogSuppression";

// Per-process memo: the catalog is global and idempotent, so once a warm instance has ensured it we
// skip the round-trip on subsequent page loads.
let ensured = false;

export function invalidateAuthorizedSetupSheetCatalogCache(): void {
  ensured = false;
}

/**
 * Ensure the globally-shared Authorized chassis catalog exists. Idempotent and user-agnostic:
 *  - creates any missing catalog rows (userId: null, isAuthorized: true),
 *  - marks an existing row for a catalog slug as authorized (adopting a user-created row),
 *  - keeps the Awesomatix schema enriched with newly-added catalog fields,
 *  - links legacy A800 cars (template string, no model link) to the global A800 model.
 *
 * Replaces the old per-user `ensureA800SetupSheetModelForUser`.
 */
export async function ensureAuthorizedSetupSheetCatalog(): Promise<void> {
  if (ensured) return;

  const suppressed = await getSuppressedCatalogSlugs();
  const slugs = AUTHORIZED_CHASSIS_CATALOG.map((c) => c.slug).filter((s) => !suppressed.has(s));
  const existingRows = await prisma.setupSheetModel.findMany({
    where: { slug: { in: slugs } },
    orderBy: [{ isAuthorized: "desc" }, { createdAt: "asc" }],
    select: { id: true, slug: true, isAuthorized: true, schemaJson: true },
  });
  // Keep the best row per slug (authorized first, then oldest) when transitional duplicates exist.
  const bySlug = new Map<string, (typeof existingRows)[number]>();
  for (const row of existingRows) {
    if (!bySlug.has(row.slug)) bySlug.set(row.slug, row);
  }

  for (const entry of AUTHORIZED_CHASSIS_CATALOG) {
    if (suppressed.has(entry.slug)) continue;
    const found = bySlug.get(entry.slug);
    if (!found) {
      await prisma.setupSheetModel.create({
        data: {
          name: entry.name,
          slug: entry.slug,
          schemaJson: entry.buildSchema() as object,
          isAuthorized: true,
          userId: null,
        },
      });
      continue;
    }

    const patch: { isAuthorized?: boolean; schemaJson?: object } = {};
    if (!found.isAuthorized) patch.isAuthorized = true;
    if (entry.slug === SETUP_SHEET_MODEL_SLUG_A800RR) {
      const parsed = parseSetupSheetModelSchema(found.schemaJson);
      if (parsed) {
        const merged = mergeMissingA800CatalogFields(parsed, buildA800SeedSchema());
        if (merged) patch.schemaJson = merged as object;
      }
    }
    if (Object.keys(patch).length > 0) {
      await prisma.setupSheetModel.update({ where: { id: found.id }, data: patch });
    }
  }

  await linkLegacyA800Cars();
  ensured = true;
}

/** Point legacy A800 cars (any user) at the global A800 model so they resolve a setup sheet. */
async function linkLegacyA800Cars(): Promise<void> {
  const a800 = await prisma.setupSheetModel.findFirst({
    where: { slug: SETUP_SHEET_MODEL_SLUG_A800RR },
    orderBy: [{ isAuthorized: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  if (!a800) return;
  await prisma.car.updateMany({
    where: {
      setupSheetTemplate: SETUP_SHEET_TEMPLATE_A800RR,
      setupSheetModelId: null,
    },
    data: { setupSheetModelId: a800.id },
  });
}
