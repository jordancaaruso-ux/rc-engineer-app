import { parseDiscipline } from "@/lib/cars/carClasses";
import type { TireEndBox } from "@/lib/tires/tireFitment";

/**
 * What a car's discipline means for its TIRES — which slice of the catalog it shops from, whether
 * the Tires step asks for one tire or a front and a rear, and which boxes each end carries.
 *
 * Why this exists (founder call, 2026-09-19): the catalog went past touring, and a touring driver
 * was being handed 584 off-road tires while an off-road driver had nowhere to say that a mounted
 * tire is a wheel, a tire and an insert glued together, front and rear being different products
 * that wear at different rates. The log-run form now reads differently depending on the car.
 *
 * Founder call, 2026-09-25: "every discipline should have the required boxes to fill their
 * tires", built the way off-road was. The boxes per class come from what the manufacturers' own
 * setup sheets ask (all 232 chassis sheets in the app, read 2026-09-25):
 *
 * - Touring and front-wheel drive: one tire. Most sheets print a single tire line.
 * - 1/12, 1/10 pan, formula and 1/8 on-road: a front and a rear, each with its DIAMETER — nearly
 *   every one of their sheets that names tires asks it, because foam is trued down run by run.
 * - Off-road, 1/10 and 1/8: a front and a rear, each with insert and wheel.
 * - Every front/rear end also gets the one free-text Modifications box (side-wall glue, trued,
 *   holes — the driver's own words; 2026-09-19 ruling).
 *
 * Founder "Yes", 2026-09-25, to two follow-ups:
 *
 * - Touring and FWD keep one tire but offer a "Different front and rear" switch — a few sheets
 *   (Infinity IF14, RC Maker SP1F) print both ends.
 * - Tire prep (additive) starts FOLDED on off-road, one tap to open. Nearly every on-road sheet
 *   asks for additive (1/12 15 of 15, touring 22 of 24); off-road sheets almost never do (1/10
 *   6 of 55, 1/8 0 of 27). Folded, not removed: the few who sauce on carpet still can.
 *
 * Founder call, 2026-09-25, on the Infinity IF15II: "one-tenth nitro uses foam tires … it should
 * have front tires different to rear tires." So 1/10 NITRO touring is the one class where power
 * changes the tires: foam, front and rear, each with its diameter, like the pan cars (both IF15II
 * sheets print a front, a rear and a diameter). It shops its own foam list: the touring list is all
 * rubber.
 *
 * The `bucket` is the COARSE catalog slice (`TireType.discipline`), not the race class — founder
 * call 2026-09-18: "1/10 offroad is fine for now, they can search for stuff". A class whose tires
 * nobody has imported yet gets `bucket: null`, which means the whole list, exactly as before. An
 * empty bucket would be worse than no filter: the driver would open the picker onto nothing, so
 * the catalog read fails open while a bucket holds no imported rows (`tireCatalogScopeWhere`).
 *
 * Founder "fix all of these issues", 2026-09-26, over the review's "pan cars, 1/12, formula,
 * nitro and 1/8 cars pick from buggy and touring tires": each of those got its own list, swept
 * from the makers' and big shops' pages the way the 1/10 off-road list was (`seeds/tires_*.json`,
 * `scripts/import-tire-lists.ts`). 1/8 off-road (buggy and truggy share one list, like 1/10 buggy
 * and short course), 1/8 on-road (track cars and GT), the pan cars (1/12 and 1/10), formula, and
 * 1/10 touring foam for nitro touring.
 *
 * Pure on purpose — the form, the API and the tests all ask the same question.
 */

/** The values `TireType.discipline` holds. Widen this when a new sweep is imported. */
export const TIRE_BUCKETS = [
  "touring",
  "offroad-10th",
  "offroad-8th",
  "onroad-8th",
  "pan",
  "formula",
  "touring-foam",
] as const;
export type TireBucket = (typeof TIRE_BUCKETS)[number];

export type TireProfile = {
  /** Catalog slice the picker is limited to. Null = no filter (unknown car, or no catalog yet). */
  bucket: TireBucket | null;
  /** Front and rear are logged separately, each with its own run count. */
  split: boolean;
  /**
   * The boxes each end carries beside its tire, in screen order. Only meaningful when `split` —
   * a one-tire car logs the tire alone. Empty = the tire and its count, nothing else.
   */
  boxes: readonly TireEndBox[];
  /**
   * A one-tire car that may still log its ends apart: the Tires step shows a "Different front
   * and rear" switch. Never set with `split` — that car always logs both ends.
   */
  frontRearSwitch: boolean;
  /** Tire prep (additive + applications) starts folded behind one tap. */
  foldPrep: boolean;
};

/** A car nothing can place, or a class with nothing tire-specific yet: today's form, whole list. */
export const NO_TIRE_PROFILE: TireProfile = {
  bucket: null,
  split: false,
  boxes: [],
  frontRearSwitch: false,
  foldPrep: false,
};

const OFFROAD_BOXES: readonly TireEndBox[] = ["insert", "wheel", "mods"];
const FOAM_BOXES: readonly TireEndBox[] = ["diameter", "mods"];

const TOURING: TireProfile = {
  bucket: "touring",
  split: false,
  boxes: [],
  frontRearSwitch: true,
  foldPrep: false,
};
const OFFROAD_10TH: TireProfile = {
  bucket: "offroad-10th",
  split: true,
  boxes: OFFROAD_BOXES,
  frontRearSwitch: false,
  foldPrep: true,
};
/** 1/8 buggy and truggy: the 1/10 off-road step over their own list. */
const OFFROAD_8TH: TireProfile = { ...OFFROAD_10TH, bucket: "offroad-8th" };
/** Off-road with no list of its own ("Other") — front/rear form over the whole list. */
const OFFROAD_UNCATALOGUED: TireProfile = { ...OFFROAD_10TH, bucket: null };
/**
 * 1/12, 1/10 and 1/8 pan, formula, 1/8 on-road and 1/10 nitro touring: front and rear, each
 * trued to a diameter. Each shops its own list (below).
 */
const ONROAD_FRONT_REAR: TireProfile = {
  bucket: null,
  split: true,
  boxes: FOAM_BOXES,
  frontRearSwitch: false,
  foldPrep: false,
};
const PAN: TireProfile = { ...ONROAD_FRONT_REAR, bucket: "pan" };
/** 1/8 on-road track cars and 1/8 GT: one list, as the catalog files both classes' cars alike. */
const ONROAD_8TH: TireProfile = { ...ONROAD_FRONT_REAR, bucket: "onroad-8th" };
const FORMULA: TireProfile = { ...ONROAD_FRONT_REAR, bucket: "formula" };
/** 1/10 nitro touring: the touring list is all rubber, so foam has its own. */
const TOURING_FOAM: TireProfile = { ...ONROAD_FRONT_REAR, bucket: "touring-foam" };
/**
 * 1/5 GT: no chassis in the app to read a sheet from. Front and rear (the widths differ), and
 * Modifications only — a guess to confirm with Jordan, not a sheet's answer. No list either.
 */
const GT_5TH: TireProfile = { ...ONROAD_FRONT_REAR, boxes: ["mods"] };

/**
 * One explicit row per class id, so adding a class to `RACE_CLASSES` without deciding its tires
 * fails `tireProfile.test.ts` instead of silently falling through to "whole list".
 */
const PROFILE_BY_CLASS: Readonly<Record<string, TireProfile>> = {
  // Onroad
  touring: TOURING,
  fwd: TOURING,
  "pan-10th": PAN,
  "pan-12th": PAN,
  "gt-8th": ONROAD_8TH,
  "pan-8th": ONROAD_8TH,
  "gt-5th": GT_5TH,
  formula: FORMULA,
  "other-onroad": NO_TIRE_PROFILE,
  // Offroad
  "buggy-2wd": OFFROAD_10TH,
  "buggy-4wd": OFFROAD_10TH,
  "truggy-10th": OFFROAD_10TH,
  "short-course": OFFROAD_10TH,
  "stadium-truck": OFFROAD_10TH,
  "truggy-8th": OFFROAD_8TH,
  "buggy-8th-2wd": OFFROAD_8TH,
  "buggy-8th-4wd": OFFROAD_8TH,
  "other-offroad": OFFROAD_UNCATALOGUED,
  // Retired ids a pre-2026-09-03 row can still hold (see `LEGACY_CLASS_LABELS`).
  "buggy-8th": OFFROAD_8TH,
  truggy: OFFROAD_8TH,
  gt: NO_TIRE_PROFILE,
  "m-chassis": NO_TIRE_PROFILE,
  rally: NO_TIRE_PROFILE,
  crawler: NO_TIRE_PROFILE,
};

/**
 * The few classes where power changes the tires, keyed `class~power`. Checked before
 * `PROFILE_BY_CLASS`; a legacy bare id (no power) falls through to the class row.
 */
const PROFILE_BY_CLASS_AND_POWER: Readonly<Record<string, TireProfile>> = {
  // 1/10 nitro touring runs foam, front and rear (founder call 2026-09-25, header above).
  "touring~nitro": TOURING_FOAM,
};

/**
 * The tire profile for a stored discipline (an encoded `carClasses.ts` value — resolve the car
 * with `disciplineForCar` first). Power only matters where `PROFILE_BY_CLASS_AND_POWER` says so:
 * nitro and electric buggies bolt on the same tires, nitro and electric touring cars don't.
 */
export function tireProfileForDiscipline(discipline: string | null | undefined): TireProfile {
  const parsed = parseDiscipline(discipline);
  if (!parsed) return NO_TIRE_PROFILE;
  if (parsed.power) {
    const byPower = PROFILE_BY_CLASS_AND_POWER[`${parsed.classId}~${parsed.power}`];
    if (byPower) return byPower;
  }
  return PROFILE_BY_CLASS[parsed.classId] ?? NO_TIRE_PROFILE;
}

/** True when the class id has an explicit row above — the test's hook, not for app code. */
export function hasTireProfileEntry(classId: string): boolean {
  return Object.prototype.hasOwnProperty.call(PROFILE_BY_CLASS, classId);
}
