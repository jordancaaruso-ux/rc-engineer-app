import type { SetupSnapshotData } from "@/lib/runSetup";
import { parseNumericFromSetupString } from "@/lib/setup/parseSetupNumeric";
import {
  computeSpringRateFromSheetFormula,
  type SpringRateHardness,
  type SpringRateSrs,
} from "@/lib/setupCalculations/springRateFormula";

/**
 * Reading the three boxes the A800RR's spring rate is worked out from, and handing them to the
 * sheet's own formula.
 *
 * This used to own a 0.2 mm snap and a 0–5 mm table lookup; both are gone with the table. See
 * `springRateFormula.ts` for where the maths came from and what the table got wrong.
 */

export type SpringLookupResolutionCode =
  | "computed_ok"
  | "missing_input_value"
  | "missing_input_mapping"
  | "unsupported_lookup_value";

export type SpringHardness = SpringRateHardness;
export type SrsKey = SpringRateSrs;

export type SpringLookupSideInput = {
  springRaw: string;
  springHardness: SpringHardness | null;
  srsRaw: string;
  srs: SrsKey | null;
  springGap: number | null;
  lowerArmExtension: number;
  /**
   * The gap actually fed to the formula: the typed gap, less 4 mm on SRS II.
   *
   * NOT "gap − extension". The table's arithmetic put the extension here; the sheet's formula puts
   * it in a lever ratio instead (see `leverRatio`), which is the substantive difference between
   * the two and the reason this field was renamed rather than reused.
   */
  srsAdjustedGap: number | null;
  /** `lever² / (lever + extension)²`. 1 whenever the extension is zero, which is nearly always. */
  leverRatio: number | null;
};

/** Gap / extension are always mm — do not interpret "7.5K" as 7500. */
function toNumber(raw: unknown): number | null {
  return parseNumericFromSetupString(raw, { allowKSuffix: false });
}

function readStringTrim(data: SetupSnapshotData, keys: string[]): string {
  for (const k of keys) {
    const v = data[k];
    if (v == null) continue;
    const s = Array.isArray(v) ? v.join(",") : String(v).trim();
    if (s) return s;
  }
  return "";
}

/** std → hard, s → soft (formula branches only; not persisted). No other tokens accepted. */
export function normalizeSpringHardnessForLookup(raw: string): SpringHardness | null {
  const t = raw.trim().toLowerCase();
  if (t === "std") return "hard";
  if (t === "s") return "soft";
  return null;
}

/** I / II (Roman numerals only), case-insensitive. */
export function normalizeSrsArrangementForLookup(raw: string): SrsKey | null {
  const t = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (t === "I") return "I";
  if (t === "II") return "II";
  return null;
}

/**
 * The extension defaults to 0 when unset, which is also the value 2,911 of 2,912 recorded sides
 * actually hold — at 0 the lever ratio is exactly 1 and the extension drops out of the sum.
 */
export function computeSpringRateLookupForSide(
  setup: SetupSnapshotData,
  side: "front" | "rear"
): {
  rate: number | null;
  resolution: SpringLookupResolutionCode;
  input: SpringLookupSideInput;
} {
  const springKey = side === "front" ? "spring_front" : "spring_rear";
  const srsKey = side === "front" ? "srs_arrangement_front" : "srs_arrangement_rear";
  const gapKey = side === "front" ? "spring_gap_front" : "spring_gap_rear";
  const extKey = side === "front" ? "lower_arm_extension_front" : "lower_arm_extension_rear";

  const springRaw = readStringTrim(setup, [springKey]);
  const srsRaw = readStringTrim(setup, [srsKey]);
  const springGap = toNumber(setup[gapKey]);
  const ext = toNumber(setup[extKey]) ?? 0;

  const hardness = normalizeSpringHardnessForLookup(springRaw);
  const srs = normalizeSrsArrangementForLookup(srsRaw);

  const baseInput: SpringLookupSideInput = {
    springRaw,
    springHardness: hardness,
    srsRaw,
    srs,
    springGap,
    lowerArmExtension: ext,
    srsAdjustedGap: null,
    leverRatio: null,
  };

  if (!springRaw.trim()) {
    return { rate: null, resolution: "missing_input_value", input: baseInput };
  }
  if (hardness == null) {
    return { rate: null, resolution: "missing_input_mapping", input: baseInput };
  }
  if (!srsRaw.trim()) {
    return { rate: null, resolution: "missing_input_value", input: baseInput };
  }
  if (srs == null) {
    return { rate: null, resolution: "missing_input_mapping", input: baseInput };
  }
  if (springGap == null) {
    return { rate: null, resolution: "missing_input_value", input: baseInput };
  }

  const result = computeSpringRateFromSheetFormula({
    side,
    srs,
    hardness,
    gapMm: springGap,
    lowerArmExtensionMm: ext,
  });
  const input: SpringLookupSideInput = {
    ...baseInput,
    srsAdjustedGap: result.srsAdjustedGapMm,
    leverRatio: result.leverRatio,
  };

  if (result.rateGfMm == null) {
    // The only way here: an extension at or beyond minus the lever length, which divides by zero
    // or flips the ratio's sign. Not a rate either way.
    return { rate: null, resolution: "unsupported_lookup_value", input };
  }
  return { rate: result.rateGfMm, resolution: "computed_ok", input };
}

export function hintForSpringLookup(
  sideLabel: "Front" | "Rear",
  input: SpringLookupSideInput,
  code: SpringLookupResolutionCode
): string {
  if (code === "computed_ok") return "";
  switch (code) {
    case "missing_input_value":
      return `${sideLabel}: need spring (std/s), SRS arrangement (I/II), and spring gap.`;
    case "missing_input_mapping":
      if (input.springHardness == null && input.springRaw.trim()) {
        return `${sideLabel}: spring "${input.springRaw}" is not std/s — cannot map to hard/soft.`;
      }
      if (input.srs == null && input.srsRaw.trim()) {
        return `${sideLabel}: SRS "${input.srsRaw}" is not I/II.`;
      }
      return `${sideLabel}: could not map spring or SRS for the rate formula.`;
    case "unsupported_lookup_value":
      return `${sideLabel}: lower arm extension ${input.lowerArmExtension} mm cancels the lever length — no rate can be worked out.`;
    default:
      return "";
  }
}
