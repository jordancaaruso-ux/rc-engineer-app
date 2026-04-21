import type { CSSProperties } from "react";
import type { FieldCompareResult } from "@/lib/setupCompare/types";
import { clamp01, getDifferenceColor, getDifferenceColorForRole } from "@/lib/setupCompare/differenceColor";

/** Non–IQR-scored differences (categorical, text, unknown, etc.): single fixed red strength. */
const FIXED_NON_GRADIENT_INTENSITY = 0.6;

export type CompareColumnRole = "a" | "b";

function intensityToRowHighlight(
  intensity: number,
  role?: CompareColumnRole
): { className: string; style: CSSProperties } {
  const t = clamp01(intensity);
  if (t <= 0) return { className: "", style: {} };
  const borderAlpha = Math.min(1, Math.max(0.12, t));
  const bg =
    role === "a" || role === "b" ? getDifferenceColorForRole(t, role) : getDifferenceColor(t);
  const borderLeft =
    role === "a"
      ? `rgba(14, 165, 233, ${borderAlpha})`
      : role === "b"
        ? `rgba(255, 0, 0, ${borderAlpha})`
        : `rgba(255, 0, 0, ${borderAlpha})`;
  return {
    className: "border-l-[3px]",
    style: {
      backgroundColor: bg,
      borderLeftColor: borderLeft,
    },
  };
}

/** @deprecated Prefer compareResultToHighlight; kept for callers that only have a 0–1 intensity. */
export function gradientIntensityToHighlightStyle(intensity: number): { className: string; style: CSSProperties } {
  return intensityToRowHighlight(intensity);
}

export function compareResultToHighlight(
  r: FieldCompareResult,
  role?: CompareColumnRole
): { className: string; style?: CSSProperties } {
  if (r.areEqual || r.severity === "same") return { className: "", style: undefined };
  if (r.gradientIntensity != null && r.gradientIntensity > 0) {
    return intensityToRowHighlight(r.gradientIntensity, role);
  }
  return intensityToRowHighlight(FIXED_NON_GRADIENT_INTENSITY, role);
}
