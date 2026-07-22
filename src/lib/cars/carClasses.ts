/**
 * Chassis **platform** — the physical family a car belongs to (touring, 1/8 buggy, …).
 *
 * Why this exists: the log-run wizard's car-swap rule. Switching cars keeps the day context
 * (event/track/session/laps/notes always); tires + prep carry only between cars on the SAME
 * platform (the same wheels bolt on), while a cross-platform swap re-derives them from the new
 * car's own last run. Setup is always car-specific and swaps regardless.
 *
 * History (2026-07-22): this used to be a user-facing `Car.carClass` picker offering
 * touring / buggy / crawler / … Nothing consumed it but the swap rule, no car ever had one set,
 * and on a touring-only app the picker read as noise — so the field was dropped and the platform
 * is now **inferred from the car's chassis** (`platformForChassisSlug` in
 * `setupSheetModels/authorizedCatalog.ts`). Drivers never see it. `Car.carClass` stays in the DB,
 * dormant and unread.
 *
 * Racing class (17.5, Modified, …) is a *different* concept and already lives on the run/event as
 * `raceClass`; if it ever needs to drive behaviour it belongs there, not here.
 */

export type ChassisPlatform = { id: string; label: string };

export const CHASSIS_PLATFORMS: readonly ChassisPlatform[] = [
  { id: "touring", label: "Touring car" },
  { id: "formula", label: "Formula (F1)" },
  { id: "pan-12th", label: "1/12th pan car" },
  { id: "gt", label: "GT / world GT" },
  { id: "m-chassis", label: "M-chassis / mini" },
  { id: "buggy-2wd", label: "1/10 buggy 2WD" },
  { id: "buggy-4wd", label: "1/10 buggy 4WD" },
  { id: "stadium-truck", label: "Stadium truck" },
  { id: "short-course", label: "Short course" },
  { id: "buggy-8th", label: "1/8 buggy" },
  { id: "truggy", label: "Truggy" },
  { id: "rally", label: "Rally" },
  { id: "crawler", label: "Crawler / trail" },
] as const;

export type ChassisPlatformId = (typeof CHASSIS_PLATFORMS)[number]["id"];

export function chassisPlatformLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return CHASSIS_PLATFORMS.find((p) => p.id === id)?.label ?? id;
}

/**
 * Same-platform check for the car-swap rule. Unknown (null) on either side counts as SAME — the
 * safe default: a car whose chassis isn't in the catalog keeps today's behaviour (tires/prep carry
 * across the swap) rather than silently re-deriving them.
 */
export function isSamePlatform(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return true;
  return a === b;
}
