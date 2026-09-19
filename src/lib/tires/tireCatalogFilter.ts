import type { Prisma } from "@prisma/client";
import { TIRE_BUCKETS, type TireBucket } from "@/lib/cars/tireProfile";

/**
 * Which catalog rows a car's picker is handed, and which end of the car a row belongs on.
 *
 * Two different strengths, deliberately:
 *
 * - The BUCKET is a hard filter. A touring driver never needs a 2.2" pin tire, and the picker
 *   searches in the browser, so every row it is sent costs every keystroke.
 * - The POSITION (front / rear) is only a sort. It comes from an AI sweep of manufacturer pages
 *   (`fits[]` in `seeds/tires_offroad_10th.json`), and a row the picker never receives cannot be
 *   found by typing either — the driver would add a duplicate of a tire that exists. So the right
 *   end's tires lead and the rest of the bucket follows; nothing is hidden on the strength of a tag.
 *
 * Pure: the only Prisma here is a type.
 */

export type TireEnd = "front" | "rear";
export type TirePosition = TireEnd | "all";

/** A `?bucket=` value, or null for anything the catalog has no slice for. */
export function parseTireBucket(raw: string | null | undefined): TireBucket | null {
  const value = raw?.trim();
  return (TIRE_BUCKETS as readonly string[]).includes(value ?? "") ? (value as TireBucket) : null;
}

/**
 * The rows a bucket's picker may see:
 *
 * - the bucket's own rows;
 * - rows with NO bucket — the 32 legacy bare-name rows and anything a driver added before buckets
 *   were stamped on create. Nobody knows what they fit, and hiding a tire a driver is already
 *   running is the one outcome worse than a slightly long list;
 * - anything this driver created themselves, whatever it was stamped as.
 *
 * No bucket means no filter, which is exactly the list every car saw before 2026-09-19.
 */
export function tireCatalogWhere(
  bucket: TireBucket | null,
  userId: string
): Prisma.TireTypeWhereInput {
  if (!bucket) return {};
  return { OR: [{ discipline: bucket }, { discipline: null }, { createdByUserId: userId }] };
}

/**
 * Whether a row is tagged for this end. Untagged (every touring row, every driver-added row) and
 * "all" fit both — the tag can promote a tire, never rule one out.
 */
export function tireFitsEnd(position: string | null | undefined, end: TireEnd): boolean {
  return position == null || position === "" || position === "all" || position === end;
}

/**
 * Collapse a seed row's per-class fitment to one tag. The UNION across classes, on purpose: 169
 * of the 584 rows fit different ends on different classes (a 2.2" pin that is a buggy rear and a
 * stadium-truck all-round), and a union can only ever be too generous. Anything that fits both
 * ends anywhere is "all".
 */
export function positionFromFits(
  fits: readonly { position?: string | null }[] | null | undefined
): TirePosition | null {
  const seen = new Set<string>();
  for (const fit of fits ?? []) {
    const p = fit?.position?.trim().toLowerCase();
    if (p === "front" || p === "rear" || p === "all") seen.add(p);
  }
  if (seen.size === 0) return null;
  if (seen.has("all") || (seen.has("front") && seen.has("rear"))) return "all";
  return seen.has("front") ? "front" : "rear";
}
