import { normalizeSetupData } from "@/lib/runSetup";
import { isPresetWithOtherCompanionKey } from "@/lib/setup/presetWithOther";
import { setupChangedRowsSincePrevious, type SetupChangedRow } from "@/lib/setupCompare/changedSincePrevious";
import { isSetupChangeNoiseKey } from "@/lib/setupCompare/setupChangeNoise";
import { storedValuesToSurface } from "@/lib/setupSheetModels/sheetSurfaceValues";

/**
 * What a comparison calls a difference: every setup value that differs between the two setups,
 * minus the noise every "what changed" list drops (tyres, the sheet's header boxes).
 *
 * The compare pop-up lists these rows and the sheet lights their boxes while it is held — one
 * function, so the list and the paper can never disagree about what changed.
 */
export function comparedSetupDifferences(a: unknown, b: unknown): SetupChangedRow[] {
  return setupChangedRowsSincePrevious(a, b).filter((row) => !isSetupChangeNoiseKey(row.key));
}

/**
 * ============================== EVERY DIFFERENCE, WHILE HELD ==============================
 *
 * The sheet boxes a comparison lights while the driver holds the paper to flip it (founder
 * ruling 2026-09-26, off a bench of real A800RR sheets up to 77 boxes apart). EVERY difference,
 * never a chosen few: "it's too hard to determine what's important and what's not". And only
 * while held — at rest the paper is the driver's own sheet, unmarked, as the 2026-08-14 ruling
 * wanted; the yellow belongs to the flip, it is not a second way of reading the page.
 *
 * Keyed by SHEET BOX, not by setup field. A preset field with an "other ___" line draws on two
 * kinds of box — its option ticks under its own key, its free text under `<key>_other` — and
 * either can be the part that moved. So a box lights when its field is a difference AND what it
 * draws changes between the two sides: a lit box is always one that moves on the flip.
 */
export function heldCompareHighlightKeys(a: unknown, b: unknown): Set<string> {
  const setupA = normalizeSetupData(a);
  const setupB = normalizeSetupData(b);
  const differing = new Set(comparedSetupDifferences(setupA, setupB).map((row) => row.key));
  const lit = new Set<string>();
  if (differing.size === 0) return lit;
  const drawnA = storedValuesToSurface(setupA);
  const drawnB = storedValuesToSurface(setupB);
  for (const key of new Set([...Object.keys(drawnA), ...Object.keys(drawnB)])) {
    const field = isPresetWithOtherCompanionKey(key) ? key.slice(0, -"_other".length) : key;
    if (differing.has(field) && (drawnA[key] ?? "") !== (drawnB[key] ?? "")) lit.add(key);
  }
  return lit;
}
