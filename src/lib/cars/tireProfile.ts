import { parseDiscipline } from "@/lib/cars/carClasses";

/**
 * What a car's discipline means for its TIRES — which slice of the catalog it shops from, and
 * whether the Tires step asks for one tire or a front and a rear.
 *
 * Why this exists (founder call, 2026-09-19): the catalog went past touring, and a touring driver
 * was being handed 584 off-road tires while an off-road driver had nowhere to say that a mounted
 * tire is a wheel, a tire and an insert glued together, front and rear being different products
 * that wear at different rates. The log-run form now reads differently depending on the car.
 *
 * The `bucket` is the COARSE catalog slice (`TireType.discipline`), not the race class — founder
 * call 2026-09-18: "1/10 offroad is fine for now, they can search for stuff". A class whose tires
 * nobody has imported yet gets `bucket: null`, which means the whole list, exactly as before. An
 * empty bucket would be worse than no filter: the driver would open the picker onto nothing.
 *
 * Pure on purpose — the form, the API and the tests all ask the same question.
 */

/** The values `TireType.discipline` holds. Widen this when a new sweep is imported. */
export const TIRE_BUCKETS = ["touring", "offroad-10th"] as const;
export type TireBucket = (typeof TIRE_BUCKETS)[number];

export type TireProfile = {
  /** Catalog slice the picker is limited to. Null = no filter (unknown car, or no catalog yet). */
  bucket: TireBucket | null;
  /** Front and rear are logged separately, each with its own run count. */
  split: boolean;
  /** Each end also carries the glued-set details: insert, wheel, modifications. */
  extras: boolean;
};

/** A car nothing can place, or a class with nothing tire-specific yet: today's form, whole list. */
export const NO_TIRE_PROFILE: TireProfile = { bucket: null, split: false, extras: false };

const TOURING: TireProfile = { bucket: "touring", split: false, extras: false };
const OFFROAD_10TH: TireProfile = { bucket: "offroad-10th", split: true, extras: true };
/** Off-road, but no tires imported for the scale yet — front/rear form over the whole list. */
const OFFROAD_UNCATALOGUED: TireProfile = { bucket: null, split: true, extras: true };

/**
 * One explicit row per class id, so adding a class to `RACE_CLASSES` without deciding its tires
 * fails `tireProfile.test.ts` instead of silently falling through to "whole list".
 *
 * Pan cars, formula and GT run a different front and rear too (founder ruling 2026-09-16), but
 * they have no catalog and their foam-tire details are not the off-road ones — they stay on the
 * single-tire form until that is designed. Flip `split` here when it is.
 */
const PROFILE_BY_CLASS: Readonly<Record<string, TireProfile>> = {
  // Onroad
  touring: TOURING,
  fwd: TOURING,
  "pan-10th": NO_TIRE_PROFILE,
  "pan-12th": NO_TIRE_PROFILE,
  "gt-8th": NO_TIRE_PROFILE,
  "pan-8th": NO_TIRE_PROFILE,
  "gt-5th": NO_TIRE_PROFILE,
  formula: NO_TIRE_PROFILE,
  "other-onroad": NO_TIRE_PROFILE,
  // Offroad
  "buggy-2wd": OFFROAD_10TH,
  "buggy-4wd": OFFROAD_10TH,
  "truggy-10th": OFFROAD_10TH,
  "short-course": OFFROAD_10TH,
  "stadium-truck": OFFROAD_10TH,
  "truggy-8th": OFFROAD_UNCATALOGUED,
  "buggy-8th-2wd": OFFROAD_UNCATALOGUED,
  "buggy-8th-4wd": OFFROAD_UNCATALOGUED,
  "other-offroad": OFFROAD_UNCATALOGUED,
  // Retired ids a pre-2026-09-03 row can still hold (see `LEGACY_CLASS_LABELS`).
  "buggy-8th": OFFROAD_UNCATALOGUED,
  truggy: OFFROAD_UNCATALOGUED,
  gt: NO_TIRE_PROFILE,
  "m-chassis": NO_TIRE_PROFILE,
  rally: NO_TIRE_PROFILE,
  crawler: NO_TIRE_PROFILE,
};

/**
 * The tire profile for a stored discipline (an encoded `carClasses.ts` value — resolve the car
 * with `disciplineForCar` first). Power never matters here: nitro and electric buggies bolt on
 * the same tires.
 */
export function tireProfileForDiscipline(discipline: string | null | undefined): TireProfile {
  const classId = parseDiscipline(discipline)?.classId;
  if (!classId) return NO_TIRE_PROFILE;
  return PROFILE_BY_CLASS[classId] ?? NO_TIRE_PROFILE;
}

/** True when the class id has an explicit row above — the test's hook, not for app code. */
export function hasTireProfileEntry(classId: string): boolean {
  return Object.prototype.hasOwnProperty.call(PROFILE_BY_CLASS, classId);
}
