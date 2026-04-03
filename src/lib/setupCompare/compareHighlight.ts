import type { CSSProperties } from "react";
import type { FieldCompareResult } from "@/lib/setupCompare/types";
import { clamp01, getDifferenceColor } from "@/lib/setupCompare/differenceColor";

/** Non–IQR-scored differences (categorical, text, unknown, etc.): single fixed red strength. */
const FIXED_NON_GRADIENT_INTENSITY = 0.6;

function intensityToRowHighlight(intensity: number): { className: string; style: CSSProperties } {
  const t = clamp01(intensity);
  if (t <= 0) return { className: "", style: {} };
  const borderAlpha = Math.min(1, Math.max(0.12, t));
  return {
    className: "border-l-[3px]",
    style: {
      backgroundColor: getDifferenceColor(t),
      borderLeftColor: `rgba(255, 0, 0, ${borderAlpha})`,
    },
  };
}

/** @deprecated Prefer compareResultToHighlight; kept for callers that only have a 0–1 intensity. */
export function gradientIntensityToHighlightStyle(intensity: number): { className: string; style: CSSProperties } {
  return intensityToRowHighlight(intensity);
}

export function compareResultToHighlight(r: FieldCompareResult): { className: string; style?: CSSProperties } {
  if (r.areEqual || r.severity === "same") return { className: "", style: undefined };
  if (r.gradientIntensity != null && r.gradientIntensity > 0) {
    return intensityToRowHighlight(r.gradientIntensity);
  }
  return intensityToRowHighlight(FIXED_NON_GRADIENT_INTENSITY);
}
