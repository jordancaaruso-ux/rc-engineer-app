/**
 * The A800RR's spring rate, calculated the way ITS OWN SHEET calculates it.
 *
 * ============================== WHERE THIS CAME FROM ==============================
 *
 * Not derived, not fitted, not transcribed from a printed table: read out of the PDF. A fillable
 * setup sheet can carry its own maths — each computed field holds an additional-action dictionary
 * (`/AA → /C → /JS`) whose script Acrobat runs, and the AcroForm lists them in a calculation order
 * (`/CO`). `scripts/dev-sheet-formula-probe.ts` opens a blank and prints them.
 *
 * Probed 2026-08-26 across all 8 stored blanks. Only the A800RR carries any (three: both spring
 * rates and the final drive) — Xray X4 '25 and '26, Mugen MTC3, Schumacher Mi10, Axon TC10/4 and
 * ARC A11 have none at all. **Both** A800RR editions carry byte-identical maths under different
 * field names, so this is Awesomatix's real formula rather than one file's quirk.
 *
 * The front script, verbatim from `Text91` (the field names resolved against the calibration:
 * Text15 = spring gap, Text81 = lower arm extension, CheckBox8 = spring, CheckBox11 = SRS):
 *
 *     event.value = (0.81 * 84.497 * Math.exp(0.1087 * a.value)
 *                    * (28.7*28.7) / ((28.7 + b.value) * (28.7 + b.value)));
 *
 * with `a.value - 4` on the second SRS arrangement, and the whole thing multiplied by 0.797 on the
 * softer spring.
 *
 * ============================== WHAT THIS REPLACED ==============================
 *
 * A 249-line hand-typed lookup table (`springRateLookupTable.ts`, kept as the regression fixture).
 * It reproduced this formula EXACTLY to a 4.0 mm gap and then went linear — +1.7 per 0.2 mm step —
 * while the real curve keeps compounding, reading 3.1% low by 5.0 mm. It also snapped every gap to
 * the nearest 0.2 mm and refused anything outside 0–5 mm outright. Measured against real data:
 * 36 of 2,908 recorded gaps sat above 4.0 mm, 58 were off-step, 7 fell outside the table.
 *
 * ============================== THE REAR'S 28.7 IS AWESOMATIX'S, NOT A TYPO OF MINE ==========
 *
 * The rear script uses a lever length of **25.841 on the standard spring and 28.7 on the soft one**
 * — the front's number, in the rear's soft branches. It is almost certainly a copy-paste slip in
 * Awesomatix's own file, and it is reproduced here deliberately and exactly, because the point of
 * this module is that a driver checking their sheet in Acrobat sees the number we show them.
 * "Correcting" it would rebuild the disagreement this change exists to remove.
 *
 * It is also unobservable in practice: the lever length only matters when the lower arm extension
 * is non-zero, and exactly **1 of 2,912** recorded sides has ever had one.
 */

/** Base rate at zero gap, before the side and hardness factors. gf/mm. */
export const SPRING_RATE_BASE_GF_MM = 84.497;

/** The gap enters as `e^(0.1087 × gap)`, so rate compounds ~2.2% per 0.2 mm. */
export const SPRING_RATE_GAP_EXPONENT = 0.1087;

/** The front runs a shorter effective spring; the rear takes the base rate unscaled. */
export const SPRING_RATE_SIDE_FACTOR = { front: 0.81, rear: 1 } as const;

/** The softer spring is a flat 0.797 of the standard one, both ends. */
export const SPRING_RATE_SOFT_FACTOR = 0.797;

/** The second SRS arrangement acts as 4 mm less gap. */
export const SPRING_RATE_SRS_II_GAP_OFFSET_MM = -4;

/**
 * Lever length the lower arm extension is measured against, in mm.
 *
 * `rear.soft` is 28.7 rather than 25.841 in Awesomatix's own script — see the header. Left exactly
 * as the sheet has it.
 */
export const SPRING_RATE_LEVER_MM = {
  front: { hard: 28.7, soft: 28.7 },
  rear: { hard: 25.841, soft: 28.7 },
} as const;

/**
 * Decimal places the sheet itself prints a rate to.
 *
 * Not a taste call: both rate fields carry a FORMAT action beside their calculate action, and it
 * reads `AFNumber_Format(1, 1, 0, 0, "", false)` — one decimal. So Acrobat shows the driver 61.4
 * where the raw formula gives 61.39344, and so do we.
 *
 * (The final drive field's is `AFNumber_Format(2, …)`, two decimals. We deliberately keep storing
 * that one at four: 1,424 saved setups already hold 4.5238, and rounding them all to 4.52 would
 * rewrite every one of them and put a phantom "final drive changed" in every change list, to show
 * less. Worth revisiting only if a driver ever notices the sheet says 4.52.)
 */
export const SPRING_RATE_DECIMALS = 1;

export type SpringRateSide = "front" | "rear";
export type SpringRateHardness = "hard" | "soft";
export type SpringRateSrs = "I" | "II";

export type SpringRateFormulaInput = {
  side: SpringRateSide;
  srs: SpringRateSrs;
  hardness: SpringRateHardness;
  /** As typed on the sheet, mm. */
  gapMm: number;
  /** As typed on the sheet, mm. Absent reads as 0 — see `computeSpringRateLookupForSide`. */
  lowerArmExtensionMm: number;
};

export type SpringRateFormulaResult = {
  rateGfMm: number | null;
  /** The gap actually fed to the exponent: the typed gap, less 4 mm on SRS II. */
  srsAdjustedGapMm: number;
  /** `lever² / (lever + extension)²` — 1 whenever the extension is zero, which is nearly always. */
  leverRatio: number | null;
  leverMm: number;
};

/**
 * No range check, deliberately.
 *
 * The retired table refused any gap outside 0–5 mm, which was a limit of the transcription and not
 * of the car — a driver on 5.4 mm was shown nothing at all where their own sheet shows 123.1. The
 * script in the PDF has no bound either, so neither does this: type an absurd gap and you get the
 * absurd number Acrobat would give you, in the box you typed it next to.
 *
 * The one thing genuinely guarded is the divisor. A lower arm extension of −28.7 mm would divide by
 * zero, and anything beyond it flips the lever ratio's sign; both give a number that is not a rate.
 */
export function computeSpringRateFromSheetFormula(
  input: SpringRateFormulaInput
): SpringRateFormulaResult {
  const leverMm = SPRING_RATE_LEVER_MM[input.side][input.hardness];
  const srsAdjustedGapMm =
    input.srs === "II" ? input.gapMm + SPRING_RATE_SRS_II_GAP_OFFSET_MM : input.gapMm;

  const divisor = leverMm + input.lowerArmExtensionMm;
  if (!(divisor > 0)) {
    return { rateGfMm: null, srsAdjustedGapMm, leverRatio: null, leverMm };
  }

  const leverRatio = (leverMm * leverMm) / (divisor * divisor);
  const base =
    SPRING_RATE_SIDE_FACTOR[input.side] *
    SPRING_RATE_BASE_GF_MM *
    Math.exp(SPRING_RATE_GAP_EXPONENT * srsAdjustedGapMm) *
    leverRatio;
  const rate = input.hardness === "soft" ? SPRING_RATE_SOFT_FACTOR * base : base;

  return {
    rateGfMm: Number.isFinite(rate) && rate > 0 ? rate : null,
    srsAdjustedGapMm,
    leverRatio,
    leverMm,
  };
}
