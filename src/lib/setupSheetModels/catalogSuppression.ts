import "server-only";

import { prisma } from "@/lib/prisma";
import { AUTHORIZED_CHASSIS_CATALOG } from "@/lib/setupSheetModels/authorizedCatalog";

const CATALOG_SLUGS = new Set(AUTHORIZED_CHASSIS_CATALOG.map((c) => c.slug));

export function isAuthorizedCatalogSlug(slug: string): boolean {
  return CATALOG_SLUGS.has(slug);
}

export async function getSuppressedCatalogSlugs(): Promise<Set<string>> {
  const rows = await prisma.setupSheetCatalogSuppression.findMany({
    select: { slug: true },
  });
  return new Set(rows.map((r) => r.slug));
}

export async function suppressCatalogSlug(slug: string, userId: string | null): Promise<void> {
  if (!CATALOG_SLUGS.has(slug)) return;
  await prisma.setupSheetCatalogSuppression.upsert({
    where: { slug },
    create: { slug, suppressedBy: userId },
    update: { suppressedAt: new Date(), suppressedBy: userId },
  });
}
