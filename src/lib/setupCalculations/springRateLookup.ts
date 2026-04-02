import type { SetupSnapshotData } from "@/lib/runSetup";
import { parseNumericFromSetupString } from "@/lib/setup/parseSetupNumeric";
import {
  SPRING_RATE_GAP_MAX_MM,
  SPRING_RATE_GAP_MIN_MM,
  SPRING_RATE_GAP_STEP_MM,
  SPRING_RATE_TABLE_GF_MM,
} from "@/lib/setupCalculations/springRateLookupTable";

export type SpringLookupResolutionCode =
  | "computed_ok"
  | "missing_input_value"
  | "missing_input_mapping"
  | "unsupported_lookup_value"
  | "lookup_missing";

export type SpringHardness = "hard" | "soft";
export type SrsKey = "I" | "II";

export type SpringLookupSideInput = {
  springRaw: string;
  springHardness: SpringHardness | null;
  srsRaw: string;
  srs: SrsKey | null;
  springGap: number | null;
  lowerArmExtension: number;
  effectiveSpringGap: number | null;
  snappedGapKey: string | null;
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

/** std → hard, s → soft (table keys only; not persisted). No other tokens accepted. */
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
 * Snap effective gap to 0.2 mm steps; returns null if outside [SPRING_RATE_GAP_MIN_MM, SPRING_RATE_GAP_MAX_MM].
 */
export function snapEffectiveSpringGapToTableKey(gapMm: number): { key: string; snapped: number } | null {
  const snapped = Math.round(gapMm / SPRING_RATE_GAP_STEP_MM) * SPRING_RATE_GAP_STEP_MM;
  const fixed = Number(snapped.toFixed(1));
  if (fixed < SPRING_RATE_GAP_MIN_MM - 1e-6 || fixed > SPRING_RATE_GAP_MAX_MM + 1e-6) return null;
  return { key: fixed.toFixed(1), snapped: fixed };
}

export function lookupSpringRateGfMmFromTable(args: {
  side: "front" | "rear";
  srs: SrsKey;
  hardness: SpringHardness;
  gapKey: string;
}): number | null {
  const block = SPRING_RATE_TABLE_GF_MM[args.srs][args.side][args.hardness];
  const v = (block as Record<string, number | undefined>)[args.gapKey];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * effectiveSpringGap = springGap - lowerArmExtension (extension defaults to 0 if unset).
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
    effectiveSpringGap: null,
    snappedGapKey: null,
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

  const effective = springGap - ext;
  const snap = snapEffectiveSpringGapToTableKey(effective);
  if (snap == null) {
    return {
      rate: null,
      resolution: "unsupported_lookup_value",
      input: { ...baseInput, effectiveSpringGap: effective, snappedGapKey: null },
    };
  }

  const rate = lookupSpringRateGfMmFromTable({
    side,
    srs,
    hardness,
    gapKey: snap.key,
  });
  if (rate == null) {
    return {
      rate: null,
      resolution: "lookup_missing",
      input: { ...baseInput, effectiveSpringGap: effective, snappedGapKey: snap.key },
    };
  }

  return {
    rate,
    resolution: "computed_ok",
    input: {
      ...baseInput,
      effectiveSpringGap: effective,
      snappedGapKey: snap.key,
    },
  };
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
      return `${sideLabel}: could not map spring or SRS for lookup.`;
    case "unsupported_lookup_value":
      return `${sideLabel}: effective gap ${input.effectiveSpringGap != null ? input.effectiveSpringGap.toFixed(2) : "?"} mm (after spring gap − lower arm extension) is outside table range ${SPRING_RATE_GAP_MIN_MM}–${SPRING_RATE_GAP_MAX_MM} mm.`;
    case "lookup_missing":
      return `${sideLabel}: table has no entry for gap ${input.snappedGapKey ?? "?"}.`;
    default:
      return "";
  }
}
