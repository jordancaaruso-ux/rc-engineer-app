import { isSamePlatform } from "@/lib/cars/carClasses";

/**
 * What a mid-context car change does to each layer of the run (founder
 * interview 2026-07-17 evening). The day context — event / track / session /
 * laps / notes — ALWAYS stays: you didn't teleport. The car-bound layers:
 *
 * - **Tires + prep**: carry between cars on the same platform (the same wheels
 *   bolt on); a cross-platform swap re-derives them from the new car's own last
 *   run. Unknown platform on either car counts as the same platform (safe
 *   default). The platform is inferred from the car's chassis — it used to come
 *   from a user-set `Car.carClass` picker, dropped 2026-07-22.
 * - **Setup**: always car-specific → reload from the new car's last run,
 *   EXCEPT when the driver hand-edited setup values this session AND both cars
 *   read the same setup-sheet model — then the edits transfer meaningfully and
 *   are kept.
 */

export type CarSwapCar = {
  /** `CHASSIS_PLATFORMS` id, resolved from the car's chassis. Null = unknown. */
  platform?: string | null;
  setupSheetModelId?: string | null;
  /** Legacy template id — the sheet identity fallback for pre-model cars. */
  setupSheetTemplate?: string | null;
};

export type CarSwapPlan = {
  /** Re-derive tire set + prep from the new car's last run (cross-platform swap). */
  rederiveTiresPrep: boolean;
  /** Load the new car's last-run setup ("replace") or keep the hand edits ("keep"). */
  setup: "replace" | "keep";
};

function sheetIdentity(car: CarSwapCar): string | null {
  return car.setupSheetModelId ?? car.setupSheetTemplate ?? null;
}

/** Same sheet only when both identities are known and equal — an unknown sheet
 *  can't guarantee hand edits transfer, so they don't. */
export function isSameSetupSheet(a: CarSwapCar, b: CarSwapCar): boolean {
  const ia = sheetIdentity(a);
  const ib = sheetIdentity(b);
  return ia != null && ib != null && ia === ib;
}

export function planCarSwap(
  from: CarSwapCar,
  to: CarSwapCar,
  opts: { setupHandEdited: boolean },
): CarSwapPlan {
  const samePlatform = isSamePlatform(from.platform, to.platform);
  const keepEdits = opts.setupHandEdited && isSameSetupSheet(from, to);
  return {
    rederiveTiresPrep: !samePlatform,
    setup: keepEdits ? "keep" : "replace",
  };
}
