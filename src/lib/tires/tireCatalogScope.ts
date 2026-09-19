import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { TireBucket } from "@/lib/cars/tireProfile";
import { tireCatalogWhere } from "@/lib/tires/tireCatalogFilter";

/**
 * Ceiling on a catalog read. The pickers download the list once and search it in the browser, so
 * a row past this is not merely last — it cannot be found at all. Headroom, not a page size.
 */
export const TIRE_CATALOG_MAX = 2000;

/**
 * The slice of the catalog a car's picker may see. Fails OPEN: a bucket nobody has imported
 * tires for returns the whole list, because the alternative is a picker that opens onto nothing.
 * Production sat in exactly that state for off-road until its import ran. Only IMPORTED rows
 * count — one tire a driver added from a buggy must not be what closes the filter to a single row.
 */
export async function tireCatalogScopeWhere(
  bucket: TireBucket | null,
  userId: string
): Promise<Prisma.TireTypeWhereInput> {
  if (!bucket) return {};
  const imported = await prisma.tireType.count({
    where: { discipline: bucket, createdByUserId: null },
  });
  return imported > 0 ? tireCatalogWhere(bucket, userId) : {};
}
