/**
 * Which car a placeholder run is filed under — and when the app must NOT decide.
 *
 * Founder ruling (2026-08-31, kept 2026-09-14): the app never guesses the car. Every source here
 * is a fact the driver established, in this order:
 *
 *   earlier_run  — the nearest earlier run they logged today at this track (the carry rule);
 *   chip         — the transponder is bound to a car in Settings;
 *   only_today   — every run logged today at this track is in one car;
 *   only_car     — the driver owns exactly one car.
 *
 * Anything else returns null and the caller files the session LOOSE (imported, on no run) so
 * the evening summary can ask once. Pure so the order is unit-tested.
 */

export type SweepCarSource = "earlier_run" | "chip" | "only_today" | "only_car";

export type SweepDayRun = {
  carId: string | null;
  /** When the car was on track — `sessionCompletedAt`, else `sortAt`. */
  instant: Date;
};

export function resolveSweepCar(input: {
  /** The session being filed. */
  instant: Date;
  /** The driver's runs today at this track (any confirmation state — a placeholder's car is a fact once chosen). */
  dayRunsAtTrack: readonly SweepDayRun[];
  /** Car the session's transponder is bound to, if the driver said. */
  chipCarId: string | null;
  /** Every car the driver owns. */
  userCarIds: readonly string[];
}): { carId: string; source: SweepCarSource } | null {
  const t = input.instant.getTime();
  const earlier = input.dayRunsAtTrack
    .filter((r) => r.carId && r.instant.getTime() < t)
    .sort((a, b) => b.instant.getTime() - a.instant.getTime());
  if (earlier[0]?.carId) return { carId: earlier[0].carId, source: "earlier_run" };

  if (input.chipCarId && input.userCarIds.includes(input.chipCarId)) {
    return { carId: input.chipCarId, source: "chip" };
  }

  const carsToday = new Set(input.dayRunsAtTrack.map((r) => r.carId).filter((c): c is string => !!c));
  if (carsToday.size === 1) return { carId: [...carsToday][0]!, source: "only_today" };

  if (input.userCarIds.length === 1) return { carId: input.userCarIds[0]!, source: "only_car" };

  return null;
}
