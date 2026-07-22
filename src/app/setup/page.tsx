import { redirect } from "next/navigation";

/**
 * "My setups" merged into Cars (founder call 2026-07-22): one Garage entry, one index, and a car's
 * setups live on the car page. The upload button, the unattached-sheet link and the admin link all
 * moved to `/cars`. `?carId=` is preserved so the upload preselect still works.
 */
export default async function LegacySetupIndexPage({
  searchParams,
}: {
  searchParams?: Promise<{ carId?: string }>;
}): Promise<never> {
  const { carId } = (await searchParams) ?? {};
  redirect(carId?.trim() ? `/cars?carId=${encodeURIComponent(carId.trim())}` : "/cars");
}
