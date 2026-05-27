import type { CornerPhase } from "@/lib/runHandlingAssessment";

/** 180° hairpin: chute in → semicircle arc → chute out. C = (60, 50), R = 35. */
export const HAIRPIN_CX = 60;
export const HAIRPIN_CY = 50;
export const HAIRPIN_R = 35;
export const HAIRPIN_ENTRY_X = 25;
export const HAIRPIN_EXIT_X = 95;

const L1 = 50;
const L2 = HAIRPIN_R * Math.PI;
const L3 = 50;
export const HAIRPIN_L_TOTAL = L1 + L2 + L3;

export const HAIRPIN_PATH_D = `M 25 100 L 25 50 A 35 35 0 1 1 95 50 L 95 100`;

export function phaseT(phase: CornerPhase): number {
  switch (phase) {
    case "entry":
      return 0.22;
    case "mid":
      return 0.5;
    case "exit":
      return 0.78;
    default:
      return 0.5;
  }
}

/** Normalized distance t ∈ [0,1] along centerline → point + tangent (degrees, SVG y-down). */
export function hairpinPointAndTangent(t: number): { x: number; y: number; tangentDeg: number } {
  const u = Math.min(1, Math.max(0, t));
  const s = u * HAIRPIN_L_TOTAL;
  if (s <= L1) {
    const p = s / L1;
    const y = 100 - p * 50;
    return { x: HAIRPIN_ENTRY_X, y, tangentDeg: -90 };
  }
  if (s <= L1 + L2) {
    const sa = s - L1;
    const p = sa / L2;
    const theta = Math.PI * (1 - p);
    const x = HAIRPIN_CX + HAIRPIN_R * Math.cos(theta);
    const y = HAIRPIN_CY - HAIRPIN_R * Math.sin(theta);
    const dxDtheta = -HAIRPIN_R * Math.sin(theta);
    const dyDtheta = -HAIRPIN_R * Math.cos(theta);
    return { x, y, tangentDeg: (Math.atan2(dyDtheta, dxDtheta) * 180) / Math.PI };
  }
  const s3 = s - L1 - L2;
  const p = s3 / L3;
  const y = 50 + p * 50;
  return { x: HAIRPIN_EXIT_X, y, tangentDeg: 90 };
}

/** Unit vector for “push wide” (understeer) in SVG coords; oversteer uses the opposite. */
export function slipOffsetUnit(tangentDeg: number, mode: "understeer" | "oversteer" | "neutral"): {
  ox: number;
  oy: number;
} {
  if (mode === "neutral") return { ox: 0, oy: 0 };
  const rad = (tangentDeg * Math.PI) / 180;
  const tx = Math.cos(rad);
  const ty = Math.sin(rad);
  const leftNx = -ty;
  const leftNy = tx;
  const sign = mode === "understeer" ? 1 : -1;
  return { ox: leftNx * sign, oy: leftNy * sign };
}

export function sampleCenterline(n: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = n <= 1 ? 0.5 : i / (n - 1);
    const { x, y } = hairpinPointAndTangent(t);
    out.push({ x, y });
  }
  return out;
}

export function pathFromPoints(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
  return d;
}
