import "server-only";

import type { SetupSnapshotData } from "@/lib/runSetup";
import { parseSetupShimMm } from "@/lib/engineerPhase5/rcEffectHintsFromSetupComparison";

/** Inner pickup stacks equal within this (mm) → treat split as zero. */
export const BULKHEAD_SPLIT_EPS_MM = 0.02;

function shimMm(data: SetupSnapshotData, key: string): number | null {
  const v = data[key];
  if (v == null) return null;
  return parseSetupShimMm(String(v));
}

/**
 * Front axle: difference between the two chassis-side **upper inner** bulkhead stacks (FF − FR, mm).
 * Non-null only when both values parse.
 */
export function frontUpperInnerBulkheadSplitMm(data: SetupSnapshotData): number | null {
  const ff = shimMm(data, "upper_inner_shims_ff");
  const fr = shimMm(data, "upper_inner_shims_fr");
  if (ff == null || fr == null) return null;
  return ff - fr;
}

/** Rear axle: RF − RR (mm). */
export function rearUpperInnerBulkheadSplitMm(data: SetupSnapshotData): number | null {
  const rf = shimMm(data, "upper_inner_shims_rf");
  const rr = shimMm(data, "upper_inner_shims_rr");
  if (rf == null || rr == null) return null;
  return rf - rr;
}

/** Front under–lower-arm inner pickup split: FF − FR (mm). */
export function frontUnderLowerBulkheadSplitMm(data: SetupSnapshotData): number | null {
  const ff = shimMm(data, "under_lower_arm_shims_ff");
  const fr = shimMm(data, "under_lower_arm_shims_fr");
  if (ff == null || fr == null) return null;
  return ff - fr;
}

/** Rear: RF − RR (mm). */
export function rearUnderLowerBulkheadSplitMm(data: SetupSnapshotData): number | null {
  const rf = shimMm(data, "under_lower_arm_shims_rf");
  const rr = shimMm(data, "under_lower_arm_shims_rr");
  if (rf == null || rr == null) return null;
  return rf - rr;
}

/** Mean of FF and FR upper-inner stacks (mm). */
export function frontUpperInnerAvgMm(data: SetupSnapshotData): number | null {
  const ff = shimMm(data, "upper_inner_shims_ff");
  const fr = shimMm(data, "upper_inner_shims_fr");
  if (ff == null || fr == null) return null;
  return (ff + fr) / 2;
}

/** Mean of RF and RR upper-inner stacks (mm). */
export function rearUpperInnerAvgMm(data: SetupSnapshotData): number | null {
  const rf = shimMm(data, "upper_inner_shims_rf");
  const rr = shimMm(data, "upper_inner_shims_rr");
  if (rf == null || rr == null) return null;
  return (rf + rr) / 2;
}

/** Front upper-inner mean minus rear upper-inner mean (mm). */
export function upperInnerFrontAvgMinusRearAvgMm(data: SetupSnapshotData): number | null {
  const f = frontUpperInnerAvgMm(data);
  const r = rearUpperInnerAvgMm(data);
  if (f == null || r == null) return null;
  return f - r;
}

/** Mean of FF and FR under–lower-arm stacks (mm). */
export function frontUnderLowerAvgMm(data: SetupSnapshotData): number | null {
  const ff = shimMm(data, "under_lower_arm_shims_ff");
  const fr = shimMm(data, "under_lower_arm_shims_fr");
  if (ff == null || fr == null) return null;
  return (ff + fr) / 2;
}

/** Mean of RF and RR under–lower-arm stacks (mm). */
export function rearUnderLowerAvgMm(data: SetupSnapshotData): number | null {
  const rf = shimMm(data, "under_lower_arm_shims_rf");
  const rr = shimMm(data, "under_lower_arm_shims_rr");
  if (rf == null || rr == null) return null;
  return (rf + rr) / 2;
}

/** Front under–lower mean minus rear under–lower mean (mm). */
export function underLowerFrontAvgMinusRearAvgMm(data: SetupSnapshotData): number | null {
  const f = frontUnderLowerAvgMm(data);
  const r = rearUnderLowerAvgMm(data);
  if (f == null || r == null) return null;
  return f - r;
}

export type BulkheadInnerSplitsMm = {
  /** Upper inner: FF − FR (mm), front-axle pickup split. */
  frontUpperInnerMm: number | null;
  /** Upper inner: RF − RR (mm), rear-axle pickup split. */
  rearUpperInnerMm: number | null;
  /** Under lower: FF − FR (mm); differential drives **anti-dive** geometry. */
  frontUnderLowerMm: number | null;
  /** Under lower: RF − RR (mm); differential drives **anti-squat** geometry. */
  rearUnderLowerMm: number | null;
  /** Upper inner: mean(FF,FR) (mm). */
  frontUpperInnerAvgMm: number | null;
  /** Upper inner: mean(RF,RR) (mm). */
  rearUpperInnerAvgMm: number | null;
  /** Upper inner: front mean − rear mean (mm). */
  upperInnerFrontAvgMinusRearAvgMm: number | null;
  /** Under lower: mean(FF,FR) (mm). */
  frontUnderLowerAvgMm: number | null;
  /** Under lower: mean(RF,RR) (mm). */
  rearUnderLowerAvgMm: number | null;
  /** Under lower: front mean − rear mean (mm). */
  underLowerFrontAvgMinusRearAvgMm: number | null;
};

export function computeBulkheadInnerSplitsMm(data: SetupSnapshotData): BulkheadInnerSplitsMm {
  return {
    frontUpperInnerMm: frontUpperInnerBulkheadSplitMm(data),
    rearUpperInnerMm: rearUpperInnerBulkheadSplitMm(data),
    frontUnderLowerMm: frontUnderLowerBulkheadSplitMm(data),
    rearUnderLowerMm: rearUnderLowerBulkheadSplitMm(data),
    frontUpperInnerAvgMm: frontUpperInnerAvgMm(data),
    rearUpperInnerAvgMm: rearUpperInnerAvgMm(data),
    upperInnerFrontAvgMinusRearAvgMm: upperInnerFrontAvgMinusRearAvgMm(data),
    frontUnderLowerAvgMm: frontUnderLowerAvgMm(data),
    rearUnderLowerAvgMm: rearUnderLowerAvgMm(data),
    underLowerFrontAvgMinusRearAvgMm: underLowerFrontAvgMinusRearAvgMm(data),
  };
}

/** Short legend for JSON context (Engineer prompt). */
export const BULKHEAD_INNER_SPLIT_SIGN_NOTE =
  "Relevant derived numbers (mm): (1) **Pickup splits** — front FF−FR and rear RF−RR — for upper inner (link angle along the bulkhead) and separately for under lower arm. (2) **Front avg vs rear avg** — mean(FF,FR) vs mean(RF,RR); JSON fields upperInnerFrontAvgMinusRearAvgMm (upper) and underLowerFrontAvgMinusRearAvgMm (lower) are **front mean minus rear mean**. Combine upper-inner splits + upper outer + KB for net upper-link / RC. **Under lower arm:** **FF vs FR** pickup split → **anti-dive**; **RF vs RR** pickup split → **anti-squat**. Averaged under–lower height on an axle (RC) is separate from those splits — see axle net notes.";
