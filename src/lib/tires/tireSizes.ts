import SIZES from "./tireSizes.json";

/**
 * The size a per-class tire list prints for each tire ("1/12 donut, 1.925in", "1/10 pan rear",
 * "1/8 truggy", "1/10 F1 front, 59mm"), for the tire picker to search. Never shown.
 *
 * Why (test drive, 2026-09-26): a 1/12 car shops the pan list, which holds 1/12 and 1/10 pan tires
 * alike, and most names never say the scale. Once a picker listed only what holds every typed word
 * (`matchesEveryWord`), typing "1/12" there found nothing at all. The size is in the seed files but
 * has no column (see `scripts/import-offroad-tires.ts`), so it comes from here, keyed by the model
 * code the import gave the row.
 *
 * Only the per-class lists (`scripts/import-tire-lists.ts`), whose size starts with the class. The
 * 1/10 off-road list's size is a rim ("2.2", "2.2/3.0") and its tread names carry version numbers
 * ("Electron 2.0"), so searching its sizes would list tires for numbers the driver never meant.
 *
 * `tireSizes.json` is built from the seed files. `tireSizes.test.ts` fails when the two drift
 * apart; `UPDATE_TIRE_SIZES=1 npx tsx --test src/lib/tires/tireSizes.test.ts` rebuilds it.
 */
const SIZE_BY_MODEL_CODE: ReadonlyMap<string, string> = new Map(Object.entries(SIZES));

/** The size its list printed, or null: a driver's own tire, or one from a list without sizes. */
export function tireSizeFor(modelCode: string | null | undefined): string | null {
  if (!modelCode) return null;
  return SIZE_BY_MODEL_CODE.get(modelCode) ?? null;
}
