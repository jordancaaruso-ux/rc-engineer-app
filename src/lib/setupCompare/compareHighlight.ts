import type { CSSProperties } from "react";
import type { FieldCompareResult } from "@/lib/setupCompare/types";
import type { CompareSeverity } from "@/lib/setupCompare/types";

function compareSeverityTailwindClass(sev: CompareSeverity): string {
  if (sev === "same") return "";
  if (sev === "minor") return "bg-sky-500/[0.04] border-l-[3px] border-l-sky-500/40";
  if (sev === "moderate") return "bg-amber-500/[0.07] border-l-[3px] border-l-amber-500/50";
  if (sev === "major") return "bg-rose-500/[0.06] border-l-[3px] border-l-rose-500/55";
  // unknown / low-confidence: bar was too easy to miss on muted cards — add a faint cool wash, still below sky/amber/rose/gradient
  return "bg-slate-500/[0.08] dark:bg-slate-400/[0.09] border-l-[3px] border-l-muted-foreground/40";
}

/** Continuous heat: yellow → orange → red; intensity is 0–1 (0 = no highlight). */
export function gradientIntensityToHighlightStyle(intensity: number): { className: string; style: CSSProperties } {
  const t = Math.min(1, Math.max(0, intensity));
  if (t <= 0) return { className: "", style: {} };
  const hue = 55 - t * 55;
  const sat = 90;
  const lightBg = 58 - t * 8;
  // Slightly higher floor so very low scores read as tinted row, not “bar only”
  const alphaBg = 0.09 + t * 0.25;
  const borderAlpha = 0.35 + t * 0.45;
  return {
    className: "border-l-[3px]",
    style: {
      backgroundColor: `hsla(${hue}, ${sat}%, ${lightBg}%, ${alphaBg})`,
      borderLeftColor: `hsla(${Math.max(hue - 6, 0)}, ${Math.min(96, sat + 4)}%, 42%, ${borderAlpha})`,
    },
  };
}

export function compareResultToHighlight(r: FieldCompareResult): { className: string; style?: CSSProperties } {
  if (r.areEqual || r.severity === "same") return { className: "", style: undefined };
  if (r.gradientIntensity != null && r.gradientIntensity > 0) {
    return gradientIntensityToHighlightStyle(r.gradientIntensity);
  }
  return { className: compareSeverityTailwindClass(r.severity), style: undefined };
}
