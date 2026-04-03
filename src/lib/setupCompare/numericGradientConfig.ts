/**
 * V1 per-field numeric comparison scales for setup diff gradients.
 * Tune `strongDifferenceScale`: |Δ| equal to this value (after normalization) yields full intensity (before cap).
 * Optional `aggregationSurface` reserved for future carpet/asphalt-aware thresholds — unused in v1.
 */

import { canonicalGeometrySignedValue, isGeometrySignCanonicalKey } from "@/lib/setup/geometrySignNormalize";
import { parseNumericFromSetupString } from "@/lib/setup/parseSetupNumeric";

export type NumericGradientNormalization = "plain" | "geometry_sign";

export type NumericGradientFieldConfig = {
  label: string;
  normalization: NumericGradientNormalization;
  /** |a−b| at this magnitude maps to full intensity (subject to intensityCap). */
  strongDifferenceScale: number;
  intensityCap?: number;
  equalityTolerance?: number;
  aggregationSurface?: "agnostic";
};

const DEFAULT_CAP = 1;

/** Δ → raw intensity in [0, cap], then divided by cap for UI (0–1). */
export function gradientIntensityFromDelta(deltaAbs: number, cfg: NumericGradientFieldConfig): number {
  const cap = cfg.intensityCap ?? DEFAULT_CAP;
  if (cap <= 0 || !Number.isFinite(deltaAbs)) return 0;
  const raw = Math.min(deltaAbs / cfg.strongDifferenceScale, cap);
  return raw / cap;
}

const NUMERIC_GRADIENT_BY_KEY: Record<string, NumericGradientFieldConfig> = {
  ride_height_front: {
    label: "Ride height front",
    normalization: "plain",
    strongDifferenceScale: 1,
    equalityTolerance: 0.02,
    aggregationSurface: "agnostic",
  },
  ride_height_rear: {
    label: "Ride height rear",
    normalization: "plain",
    strongDifferenceScale: 1,
    equalityTolerance: 0.02,
    aggregationSurface: "agnostic",
  },
  droop_front: {
    label: "Droop front",
    normalization: "plain",
    strongDifferenceScale: 0.5,
    equalityTolerance: 0.02,
    aggregationSurface: "agnostic",
  },
  droop_rear: {
    label: "Droop rear",
    normalization: "plain",
    strongDifferenceScale: 0.5,
    equalityTolerance: 0.02,
    aggregationSurface: "agnostic",
  },
  camber_front: {
    label: "Camber front",
    normalization: "geometry_sign",
    strongDifferenceScale: 0.25,
    equalityTolerance: 0.02,
    aggregationSurface: "agnostic",
  },
  camber_rear: {
    label: "Camber rear",
    normalization: "geometry_sign",
    strongDifferenceScale: 0.25,
    equalityTolerance: 0.02,
    aggregationSurface: "agnostic",
  },
  caster_front: {
    label: "Caster front",
    normalization: "geometry_sign",
    strongDifferenceScale: 0.35,
    equalityTolerance: 0.02,
    aggregationSurface: "agnostic",
  },
  caster_rear: {
    label: "Caster rear",
    normalization: "geometry_sign",
    strongDifferenceScale: 0.35,
    equalityTolerance: 0.02,
    aggregationSurface: "agnostic",
  },
  toe_front: {
    label: "Toe front",
    normalization: "geometry_sign",
    strongDifferenceScale: 0.04,
    equalityTolerance: 0.01,
    aggregationSurface: "agnostic",
  },
  toe_rear: {
    label: "Toe rear",
    normalization: "geometry_sign",
    strongDifferenceScale: 0.04,
    equalityTolerance: 0.01,
    aggregationSurface: "agnostic",
  },
  under_lower_arm_shims_ff: {
    label: "Lower inner shims FF",
    normalization: "plain",
    strongDifferenceScale: 0.15,
    equalityTolerance: 0.02,
    aggregationSurface: "agnostic",
  },
  under_lower_arm_shims_fr: {
    label: "Lower inner shims FR",
    normalization: "plain",
    strongDifferenceScale: 0.15,
    equalityTolerance: 0.02,
    aggregationSurface: "agnostic",
  },
  under_lower_arm_shims_rf: {
    label: "Lower inner shims RF",
    normalization: "plain",
    strongDifferenceScale: 0.15,
    equalityTolerance: 0.02,
    aggregationSurface: "agnostic",
  },
  under_lower_arm_shims_rr: {
    label: "Lower inner shims RR",
    normalization: "plain",
    strongDifferenceScale: 0.15,
    equalityTolerance: 0.02,
    aggregationSurface: "agnostic",
  },
  upper_inner_shims_ff: {
    label: "Upper inner shims FF",
    normalization: "plain",
    strongDifferenceScale: 0.15,
    equalityTolerance: 0.02,
    aggregationSurface: "agnostic",
  },
  upper_inner_shims_fr: {
    label: "Upper inner shims FR",
    normalization: "plain",
    strongDifferenceScale: 0.15,
    equalityTolerance: 0.02,
    aggregationSurface: "agnostic",
  },
  upper_inner_shims_rf: {
    label: "Upper inner shims RF",
    normalization: "plain",
    strongDifferenceScale: 0.15,
    equalityTolerance: 0.02,
    aggregationSurface: "agnostic",
  },
  upper_inner_shims_rr: {
    label: "Upper inner shims RR",
    normalization: "plain",
    strongDifferenceScale: 0.15,
    equalityTolerance: 0.02,
    aggregationSurface: "agnostic",
  },
  upper_outer_shims_front: {
    label: "Upper outer shims front",
    normalization: "plain",
    strongDifferenceScale: 0.15,
    equalityTolerance: 0.02,
    aggregationSurface: "agnostic",
  },
  upper_outer_shims_rear: {
    label: "Upper outer shims rear",
    normalization: "plain",
    strongDifferenceScale: 0.15,
    equalityTolerance: 0.02,
    aggregationSurface: "agnostic",
  },
  front_spring_rate_gf_mm: {
    label: "Front spring rate",
    normalization: "plain",
    strongDifferenceScale: 80,
    equalityTolerance: 0.05,
    aggregationSurface: "agnostic",
  },
  rear_spring_rate_gf_mm: {
    label: "Rear spring rate",
    normalization: "plain",
    strongDifferenceScale: 80,
    equalityTolerance: 0.05,
    aggregationSurface: "agnostic",
  },
  arb_front: {
    label: "ARB front",
    normalization: "plain",
    strongDifferenceScale: 0.18,
    equalityTolerance: 0.02,
    aggregationSurface: "agnostic",
  },
  arb_rear: {
    label: "ARB rear",
    normalization: "plain",
    strongDifferenceScale: 0.18,
    equalityTolerance: 0.02,
    aggregationSurface: "agnostic",
  },
  damper_oil_front: {
    label: "Damper oil front",
    normalization: "plain",
    strongDifferenceScale: 120,
    equalityTolerance: 0.5,
    aggregationSurface: "agnostic",
  },
  damper_oil_rear: {
    label: "Damper oil rear",
    normalization: "plain",
    strongDifferenceScale: 120,
    equalityTolerance: 0.5,
    aggregationSurface: "agnostic",
  },
  damper_percent_front: {
    label: "Damper % front",
    normalization: "plain",
    strongDifferenceScale: 8,
    equalityTolerance: 0.25,
    aggregationSurface: "agnostic",
  },
  damper_percent_rear: {
    label: "Damper % rear",
    normalization: "plain",
    strongDifferenceScale: 8,
    equalityTolerance: 0.25,
    aggregationSurface: "agnostic",
  },
  diff_oil: {
    label: "Diff oil",
    normalization: "plain",
    strongDifferenceScale: 200,
    equalityTolerance: 0.5,
    aggregationSurface: "agnostic",
  },
};

export function getNumericGradientConfig(key: string): NumericGradientFieldConfig | undefined {
  return NUMERIC_GRADIENT_BY_KEY[key];
}

/** Keys with v1 gradient scoring (for docs/tests). */
export const NUMERIC_GRADIENT_V1_KEYS = Object.freeze(Object.keys(NUMERIC_GRADIENT_BY_KEY));

export function normalizeNumericForGradientCompare(
  key: string,
  normalization: NumericGradientNormalization,
  raw: unknown
): number | null {
  if (normalization === "geometry_sign") {
    if (!isGeometrySignCanonicalKey(key)) return null;
    const c = canonicalGeometrySignedValue(key, raw);
    if (c !== undefined) return c;
    return null;
  }
  return parseNumericFromSetupString(raw, { allowKSuffix: false });
}

function numbersWithinTolerance(a: number, b: number, absTol: number): boolean {
  return Math.abs(a - b) <= absTol;
}

export function numericGradientEqual(a: number, b: number, cfg: NumericGradientFieldConfig): boolean {
  const tol = cfg.equalityTolerance ?? 1e-5;
  return numbersWithinTolerance(a, b, tol);
}
