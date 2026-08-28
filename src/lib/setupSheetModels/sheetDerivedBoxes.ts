import {
  computeA800rrDerived,
  DERIVED_FINAL_DRIVE_RATIO_KEY,
  DERIVED_FRONT_SPRING_RATE_KEY,
  DERIVED_REAR_SPRING_RATE_KEY,
} from "@/lib/setupCalculations/a800rrDerived";
import { SPRING_RATE_DECIMALS } from "@/lib/setupCalculations/springRateFormula";

/**
 * The boxes a setup sheet works out for itself.
 *
 * ============================== THE PROBLEM THIS SOLVES ==============================
 *
 * Some boxes on a manufacturer's sheet are not measurements — they are the answer to the boxes
 * beside them. Spring rate follows the spring, the SRS arrangement, the spring gap and the lower
 * arm extension; final drive is 1.9 × spur ÷ pinion. The driver never measures either one, and on
 * the paper they are printed as results. Both formulas are the SHEET's own, lifted out of the
 * PDF's form layer — see `springRateFormula.ts`.
 *
 * The app knew both formulas already (`a800rrDerived`) and ran them on every SAVE, so a stored
 * setup was almost always right — measured 2026-08-26 across 1,456 A800RR snapshots: 10 stale
 * spring rates out of 2,880, 4 stale ratios out of 1,451. What it never did was run them while
 * the driver was EDITING. `SheetFillSurface` seeds its value state once and only ever changes a
 * box the driver touched, so moving the spring gap from 0 to 2.0 left the rate sitting at 68.4
 * with nothing to say it was now wrong. Reproduced in a browser, `scripts/dev-derived-box-repro.ts`.
 *
 * Worse on one door: the run's Setup face and the saved-setup editor both go through
 * `SheetSetupEditorClient`, which had no derivation at all — so a correction there SAVED the stale
 * number. That is where those 14 stale rows will have come from.
 *
 * ============================== WHY THE SHEET IS THE GATE ==============================
 *
 * The formulas are Awesomatix's, not everybody's — 1.9 is the A800RR's internal ratio, and a Mugen
 * or a Schumacher would need its own. So a derived box is only ever written when THIS SHEET PRINTS
 * ONE: the plan has to declare the key. Measured against every chassis in the database on
 * 2026-08-26 — Mugen MTC3, Schumacher Mi10 and two drivers' own sheets all carry `spur` and
 * `pinion`, and not one of them carries `final_drive_ratio`; only the A800RR does. A sheet born
 * from somebody's PDF mints its keys from the PDF's own field names, so it cannot collide with a
 * hand-authored canonical key by accident.
 *
 * That gate also means no new prop has to be threaded through the six callers of the fill surface,
 * and nothing can silently switch the feature off by passing a null chassis id.
 */

/** Every box any sheet can work out for itself. */
export const DERIVED_SHEET_BOX_KEYS: readonly string[] = [
  DERIVED_FRONT_SPRING_RATE_KEY,
  DERIVED_REAR_SPRING_RATE_KEY,
  DERIVED_FINAL_DRIVE_RATIO_KEY,
];

/** Which of them THIS sheet prints. Nothing is written into a box the paper does not have. */
export function derivedBoxKeysOnSheet(fieldKeys: Iterable<string>): Set<string> {
  const printed = new Set<string>();
  const declared = fieldKeys instanceof Set ? fieldKeys : new Set(fieldKeys);
  for (const key of DERIVED_SHEET_BOX_KEYS) {
    if (declared.has(key)) printed.add(key);
  }
  return printed;
}

/**
 * Written the way the store writes it, so a sheet edit and a form edit leave the same bytes.
 *
 * `applyA800rrDerivedToSetup` stores `Number(n.toFixed(places))`, which drops trailing zeros — 61.4,
 * not 61.40. Doing the same here is what keeps "what changed since your last run" from reporting a
 * spring rate that did not move.
 *
 * The rate's places come from the SHEET's own format action (`AFNumber_Format(1, …)`), so the box
 * reads the way Acrobat would fill it — see `SPRING_RATE_DECIMALS`.
 */
function drawnNumber(n: number, places: number): string {
  return String(Number(n.toFixed(places)));
}

/**
 * Recompute the derived boxes this sheet prints.
 *
 * A box whose inputs are incomplete is CLEARED rather than left standing: a rate worked out from a
 * spring gap the driver has just erased is not a reading, it is the last one, and leaving it there
 * is the exact lie this whole change exists to stop. `""` is the surface's own deletion marker (see
 * `mergeSheetValuesIntoSnapshot`), so a cleared derived box travels the same way a cleared text box
 * does and the server drops the key.
 *
 * Returns the SAME object when nothing moved, so a caller can hand it straight to `setValues`
 * without a wasted render — which matters here because the surface reports every value change to
 * its parent, and on the log-run wizard that means a draft written to the server.
 */
export function applyDerivedSheetBoxes(
  values: Record<string, string>,
  printed: ReadonlySet<string>
): Record<string, string> {
  if (printed.size === 0) return values;

  const { computed } = computeA800rrDerived(values);
  const next: Record<string, string> = { ...values };
  let moved = false;

  /**
   * The `?? ""` also keeps an ABSENT box absent when there is no answer for it: a marker means
   * "this had a value and the driver removed it", and minting one for a box nobody ever filled
   * would put a delete instruction for every derived box into every payload, forever.
   */
  const write = (key: string, value: string) => {
    if (!printed.has(key)) return;
    if ((values[key] ?? "") === value) return;
    next[key] = value;
    moved = true;
  };

  write(
    DERIVED_FRONT_SPRING_RATE_KEY,
    computed.frontSpringRateGfMm == null ? "" : drawnNumber(computed.frontSpringRateGfMm, SPRING_RATE_DECIMALS)
  );
  write(
    DERIVED_REAR_SPRING_RATE_KEY,
    computed.rearSpringRateGfMm == null ? "" : drawnNumber(computed.rearSpringRateGfMm, SPRING_RATE_DECIMALS)
  );
  write(
    DERIVED_FINAL_DRIVE_RATIO_KEY,
    computed.finalDriveRatio == null ? "" : drawnNumber(computed.finalDriveRatio, 4)
  );

  return moved ? next : values;
}
