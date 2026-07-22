import { redirect } from "next/navigation";

/**
 * A car's setups moved onto the car page (founder call 2026-07-22) — one surface per car instead
 * of two half-complete ones. Kept as a redirect so old links, bookmarks and the PWA's cached
 * history still land somewhere sensible.
 *
 * Static siblings (`/setup/admin`, `/setup/comparison`, `/setup/bulk-import`,
 * `/setup/aggregations-debug`) win over this dynamic segment, so they are unaffected.
 */
export default async function LegacyCarSetupsPage(props: {
  params: Promise<{ carId: string }>;
}): Promise<never> {
  const { carId } = await props.params;
  redirect(`/cars/${carId}`);
}
