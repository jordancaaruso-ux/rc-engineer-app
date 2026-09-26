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
  const active = await activeTireBucket(bucket);
  return active ? tireCatalogWhere(active, userId) : {};
}

/**
 * `bucket` once it holds imported rows, else null: the fail-open rule above, for a caller that
 * filters rows itself ("Recently used"). A class mapped to a list the database hasn't been given
 * yet (code deployed before the import ran) keeps seeing everything, never nothing.
 */
export async function activeTireBucket(bucket: TireBucket | null): Promise<TireBucket | null> {
  if (!bucket) return null;
  const imported = await prisma.tireType.count({
    where: { discipline: bucket, createdByUserId: null },
  });
  return imported > 0 ? bucket : null;
}
