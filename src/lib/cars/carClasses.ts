/**
 * Chassis **platform** — the physical family a car belongs to (touring, 1/8 buggy, …).
 *
 * Why this exists: the log-run wizard's car-swap rule. Switching cars keeps the day context
 * (event/track/session/laps/notes always); tires + prep carry only between cars on the SAME
 * platform (the same wheels bolt on), while a cross-platform swap re-derives them from the new
 * car's own last run. Setup is always car-specific and swaps regardless.
 *
 * How a car gets one — inference first, override second (`disciplineForCar` in
 * `chassisPlatform.ts` is the only correct way to ask):
 *
 *  1. The chassis catalog (`platformForChassisSlug`). Answers for every catalogued chassis and
 *     costs the driver nothing.
 *  2. `Car.carClass`, set from the picker on the car page — which renders ONLY when step 1 comes
 *     back null, i.e. a hand-built or user-created chassis.
 *
 * History: this was an always-on `Car.carClass` picker until 2026-07-22, when it was dropped for
 * reading as noise on a touring-only app (nothing consumed it but the swap rule and no car ever
 * had one set). The column survived. It came back 2026-08-03 as the fallback half above, because
 * scoping a teammate's lap comparisons by discipline needs an answer for cars the catalog can't
 * place. Note every entry in `CHASSIS_PLATFORM_BY_SLUG` is still `touring`, so on current data a
 * discipline comparison cannot discriminate — see the note on `disciplineForCar`.
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
