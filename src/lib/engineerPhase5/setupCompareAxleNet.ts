import "server-only";

import type { SetupSnapshotData } from "@/lib/runSetup";
import { parseSetupShimMm } from "@/lib/engineerPhase5/rcEffectHintsFromSetupComparison";
import {
  BULKHEAD_SPLIT_EPS_MM,
  frontUnderLowerBulkheadSplitMm,
  rearUnderLowerBulkheadSplitMm,
  frontUpperInnerBulkheadSplitMm,
  rearUpperInnerBulkheadSplitMm,
  frontUpperInnerAvgMm,
  rearUpperInnerAvgMm,
  upperInnerFrontAvgMinusRearAvgMm,
  frontUnderLowerAvgMm,
  rearUnderLowerAvgMm,
  underLowerFrontAvgMinusRearAvgMm,
} from "@/lib/engineerPhase5/setupBulkheadInnerSplits";

const EPS = 1e-4;
const SPLIT_EPS = BULKHEAD_SPLIT_EPS_MM;
/** Averaged inner delta can hide a material pickup split when per-corner deltas disagree. */
const PICKUP_DELTA_SPREAD_MM = 0.05;
const PICKUP_AVG_SMALL_MM = 0.05;

export type SetupCompareRow = { key: string; label: string; primary: string; compare: string };

function deltaRow(row: SetupCompareRow): number | null {
  const p = parseSetupShimMm(row.primary);
  const c = parseSetupShimMm(row.compare);
  if (p == null || c == null) return null;
  return p - c;
}

function avgDeltaForKeys(rows: SetupCompareRow[], keys: readonly string[]): number | null {
  const map = new Map(rows.map((r) => [r.key, r]));
  const ds: number[] = [];
  for (const k of keys) {
    const row = map.get(k);
    if (!row) continue;
    const d = deltaRow(row);
    if (d != null) ds.push(d);
  }
  if (ds.length === 0) return null;
  return ds.reduce((a, b) => a + b, 0) / ds.length;
}

function deltaForKey(rows: SetupCompareRow[], key: string): number | null {
  const row = rows.find((r) => r.key === key);
  return row ? deltaRow(row) : null;
}

/**
 * True when the two per-corner upper-inner compare→primary deltas differ materially
 * but their average is small — averaged RC line in the axle note can mislead.
 */
function upperInnerAverageHidesPickupDelta(dA: number | null, dB: number | null): boolean {
  if (dA == null || dB == null) return false;
  const avg = (dA + dB) / 2;
  if (Math.abs(dA - dB) < PICKUP_DELTA_SPREAD_MM) return false;
  return Math.abs(avg) < PICKUP_AVG_SMALL_MM;
}

/** RC tendency: -1 = lowers RC, +1 = raises RC (platform rules). */
function contribUpperInner(d: number | null): number {
  if (d == null || Math.abs(d) < EPS) return 0;
  return d > 0 ? -1 : 1;
}

function contribUpperOuter(d: number | null): number {
  if (d == null || Math.abs(d) < EPS) return 0;
  return d < 0 ? -1 : 1;
}

function contribUnderLowerArm(d: number | null): number {
  if (d == null || Math.abs(d) < EPS) return 0;
  return d > 0 ? 1 : -1;
}

/** Flatter (+) vs more angled (-) from upper link only. */
function angleUpperInner(d: number | null): number {
  if (d == null || Math.abs(d) < EPS) return 0;
  return d > 0 ? 1 : -1;
}

function angleUpperOuter(d: number | null): number {
  if (d == null || Math.abs(d) < EPS) return 0;
  return d < 0 ? 1 : -1;
}

function buildOneAxleNetNote(
  end: "Front" | "Rear",
  dUI: number | null,
  dUO: number | null,
  dULA: number | null,
  bulkheadPickupCaveat: string | null
): string | null {
  if (
    (dUI == null || Math.abs(dUI) < EPS) &&
    (dUO == null || Math.abs(dUO) < EPS) &&
    (dULA == null || Math.abs(dULA) < EPS)
  ) {
    return bulkheadPickupCaveat ? `${end} axle (compare→primary): ${bulkheadPickupCaveat}` : null;
  }

  const parts: string[] = [];
  if (dUI != null && Math.abs(dUI) >= EPS) {
    parts.push(
      dUI > 0
        ? "upper inner raised → **lowers** RC on this axle (platform rule)"
        : "upper inner lowered → **raises** RC on this axle (platform rule)"
    );
  }
  if (dUO != null && Math.abs(dUO) >= EPS) {
    parts.push(
      dUO < 0
        ? "upper outer lowered → **flatter** link, tends **lower** RC on this axle"
        : "upper outer raised → **more angled** link, tends **higher** RC on this axle"
    );
  }
  if (dULA != null && Math.abs(dULA) >= EPS) {
    parts.push(
      dULA > 0
        ? "under lower arm raised → **raises** RC on this axle (platform rule)"
        : "under lower arm lowered → **lowers** RC on this axle (platform rule)"
    );
  }

  const cUI = contribUpperInner(dUI);
  const cUO = contribUpperOuter(dUO);
  const cULA = contribUnderLowerArm(dULA);
  const sum = cUI + cUO + cULA;
  const nonzero = [cUI, cUO, cULA].filter((x) => x !== 0);

  let netSentence: string;
  if (sum < 0) {
    netSentence =
      "combined shims **tend toward lower** roll centre vs compare on this axle (deterministic sign sum).";
  } else if (sum > 0) {
    netSentence =
      "combined shims **tend toward higher** roll centre vs compare on this axle (deterministic sign sum).";
  } else if (nonzero.length >= 2) {
    netSentence =
      "**mixed / opposing** RC effects on this axle—do not state a single raise-or-lower RC in the summary.";
  } else {
    netSentence = "no net RC shift from the listed shims on this axle.";
  }

  const hasUpperLink =
    (dUI != null && Math.abs(dUI) >= EPS) || (dUO != null && Math.abs(dUO) >= EPS);
  let angleBit = "";
  if (hasUpperLink) {
    const angSum = angleUpperInner(dUI) + angleUpperOuter(dUO);
    if (angSum > 0) angleBit = " Upper-link-only angle: **flatter**.";
    else if (angSum < 0) angleBit = " Upper-link-only angle: **more angled**.";
    else angleBit = " Upper-link angle: **mixed** (inner vs outer oppose).";
  }

  const caveatBit = bulkheadPickupCaveat ? ` ${bulkheadPickupCaveat}` : "";
  return `${end} axle (compare→primary): ${parts.join(" ")} **Combined RC tendency:** ${netSentence}${angleBit}${caveatBit}`;
}

/**
 * Deterministic per-axle text so the model does not invert RC when summarizing multiple shims.
 * Uses the same compare→primary mm deltas as setupComparison.changedRows (pre-collapse keys).
 */
export function buildFrontRearAxleNetNotes(rows: SetupCompareRow[]): {
  frontAxleNetNote: string | null;
  rearAxleNetNote: string | null;
} {
  const dUIff = deltaForKey(rows, "upper_inner_shims_ff");
  const dUIfr = deltaForKey(rows, "upper_inner_shims_fr");
  const dUIrf = deltaForKey(rows, "upper_inner_shims_rf");
  const dUIrr = deltaForKey(rows, "upper_inner_shims_rr");

  const dUIFront = avgDeltaForKeys(rows, ["upper_inner_shims_ff", "upper_inner_shims_fr"]);
  const dUIRear = avgDeltaForKeys(rows, ["upper_inner_shims_rf", "upper_inner_shims_rr"]);

  const map = new Map(rows.map((r) => [r.key, r]));
  const dUOFront = map.has("upper_outer_shims_front")
    ? deltaRow(map.get("upper_outer_shims_front")!)
    : null;
  const dUORear = map.has("upper_outer_shims_rear")
    ? deltaRow(map.get("upper_outer_shims_rear")!)
    : null;

  const dULAFront = avgDeltaForKeys(rows, ["under_lower_arm_shims_ff", "under_lower_arm_shims_fr"]);
  const dULARear = avgDeltaForKeys(rows, ["under_lower_arm_shims_rf", "under_lower_arm_shims_rr"]);

  const frontCaveat = upperInnerAverageHidesPickupDelta(dUIff, dUIfr)
    ? "**Pickup split:** averaged upper-inner delta is small but FF vs FR compare→primary deltas **differ materially**—read **frontUpperInnerBulkheadSplitNote**; do not treat the average alone as the full upper-inner story."
    : null;
  const rearCaveat = upperInnerAverageHidesPickupDelta(dUIrf, dUIrr)
    ? "**Pickup split:** averaged upper-inner delta is small but RF vs RR compare→primary deltas **differ materially**—read **rearUpperInnerBulkheadSplitNote**; do not treat the average alone as the full upper-inner story."
    : null;

  return {
    frontAxleNetNote: buildOneAxleNetNote("Front", dUIFront, dUOFront, dULAFront, frontCaveat),
    rearAxleNetNote: buildOneAxleNetNote("Rear", dUIRear, dUORear, dULARear, rearCaveat),
  };
}

function formatSplitMm(split: number): string {
  const s = split.toFixed(2);
  return split >= 0 ? `+${s}` : s;
}

function higherKeyForSplit(diffLabel: "FF−FR" | "RF−RR", split: number): string {
  if (diffLabel === "FF−FR") return split > 0 ? "FF" : "FR";
  return split > 0 ? "RF" : "RR";
}

function lowerKeyForSplit(diffLabel: "FF−FR" | "RF−RR", split: number): string {
  if (diffLabel === "FF−FR") return split > 0 ? "FR" : "FF";
  return split > 0 ? "RR" : "RF";
}

function buildUpperInnerBulkheadSplitLine(params: {
  end: "Front" | "Rear";
  diffLabel: "FF−FR" | "RF−RR";
  splitPrimary: number | null;
  splitCompare: number | null;
}): string | null {
  const { end, diffLabel, splitPrimary, splitCompare } = params;
  if (splitPrimary == null && splitCompare == null) return null;

  const parts: string[] = [];
  parts.push(
    `${end} **upper-inner bulkhead pickup split** (${diffLabel} mm) — differential between the two chassis-side upper-inner stacks on this axle (forward vs rearward along the bulkhead); steers **upper-link angle along the car**. Separate from **averaged** upper-inner wording in ${end === "Front" ? "front" : "rear"}AxleNetNote; combine with upper outer + vehicleDynamicsKb for **net** link line / RC.`
  );

  if (splitPrimary != null) {
    if (Math.abs(splitPrimary) < SPLIT_EPS) {
      parts.push(`Primary: **no pickup differential** (${diffLabel} ${formatSplitMm(splitPrimary)}).`);
    } else {
      const hi = higherKeyForSplit(diffLabel, splitPrimary);
      const lo = lowerKeyForSplit(diffLabel, splitPrimary);
      parts.push(
        `Primary: **non-zero pickup differential** (${diffLabel} ${formatSplitMm(splitPrimary)}; **${hi}** inner stack higher than **${lo}**).`
      );
    }
  } else {
    parts.push("Primary: upper-inner FF/FR or RF/RR values incomplete — split unknown.");
  }

  if (splitCompare != null) {
    if (Math.abs(splitCompare) < SPLIT_EPS) {
      parts.push(`Compare: **no pickup differential** (${diffLabel} ${formatSplitMm(splitCompare)}).`);
    } else {
      parts.push(`Compare: **non-zero pickup differential** (${diffLabel} ${formatSplitMm(splitCompare)}).`);
    }
  } else {
    parts.push("Compare: upper-inner values incomplete — split unknown.");
  }

  if (splitPrimary != null && splitCompare != null) {
    const dSplit = splitPrimary - splitCompare;
    if (Math.abs(dSplit) < SPLIT_EPS) {
      parts.push("Pickup split **unchanged** compare→primary.");
    } else {
      parts.push(
        `Split change compare→primary: **${formatSplitMm(dSplit)}** mm (${dSplit > 0 ? "more" : "less"} pickup differential on primary).`
      );
    }
  }

  return parts.join(" ");
}

function buildUnderLowerBulkheadSplitLine(params: {
  end: "Front" | "Rear";
  antiLabel: "anti-dive" | "anti-squat";
  diffLabel: "FF−FR" | "RF−RR";
  splitPrimary: number | null;
  splitCompare: number | null;
}): string | null {
  const { end, antiLabel, diffLabel, splitPrimary, splitCompare } = params;
  if (splitPrimary == null && splitCompare == null) return null;

  const antiExplain =
    end === "Front"
      ? "**Anti-dive** — **FF vs FR** inner-lower stacks (pickup split FF−FR)."
      : "**Anti-squat** — **RF vs RR** inner-lower stacks (pickup split RF−RR).";

  const parts: string[] = [];
  parts.push(
    `${end} **under–lower-arm bulkhead pickup split** (${diffLabel} mm) — ${antiExplain} Side-view geometry between forward vs rearward chassis pickups; separate from **averaged** under–lower-arm RC height in ${end === "Front" ? "front" : "rear"}AxleNetNote.`
  );

  if (splitPrimary != null) {
    if (Math.abs(splitPrimary) < SPLIT_EPS) {
      parts.push(`Primary: **no pickup differential** (${diffLabel} ${formatSplitMm(splitPrimary)}).`);
    } else {
      const hi = higherKeyForSplit(diffLabel, splitPrimary);
      const lo = lowerKeyForSplit(diffLabel, splitPrimary);
      parts.push(
        `Primary: **non-zero pickup differential** (${diffLabel} ${formatSplitMm(splitPrimary)}; **${hi}** inner-lower stack higher than **${lo}**).`
      );
    }
  } else {
    parts.push("Primary: inner-lower FF/FR or RF/RR values incomplete — split unknown.");
  }

  if (splitCompare != null) {
    if (Math.abs(splitCompare) < SPLIT_EPS) {
      parts.push(`Compare: **no pickup differential** (${diffLabel} ${formatSplitMm(splitCompare)}).`);
    } else {
      parts.push(`Compare: **non-zero pickup differential** (${diffLabel} ${formatSplitMm(splitCompare)}).`);
    }
  } else {
    parts.push("Compare: inner-lower values incomplete — split unknown.");
  }

  if (splitPrimary != null && splitCompare != null) {
    const dSplit = splitPrimary - splitCompare;
    if (Math.abs(dSplit) < SPLIT_EPS) {
      parts.push("Pickup split **unchanged** compare→primary.");
    } else {
      parts.push(
        `Split change compare→primary: **${formatSplitMm(dSplit)}** mm (${dSplit > 0 ? "more" : "less"} pickup differential on primary).`
      );
    }
  }

  return parts.join(" ");
}

export function buildUpperInnerBulkheadSplitNotes(
  primarySetup: SetupSnapshotData,
  compareSetup: SetupSnapshotData
): {
  frontUpperInnerBulkheadSplitNote: string | null;
  rearUpperInnerBulkheadSplitNote: string | null;
} {
  return {
    frontUpperInnerBulkheadSplitNote: buildUpperInnerBulkheadSplitLine({
      end: "Front",
      diffLabel: "FF−FR",
      splitPrimary: frontUpperInnerBulkheadSplitMm(primarySetup),
      splitCompare: frontUpperInnerBulkheadSplitMm(compareSetup),
    }),
    rearUpperInnerBulkheadSplitNote: buildUpperInnerBulkheadSplitLine({
      end: "Rear",
      diffLabel: "RF−RR",
      splitPrimary: rearUpperInnerBulkheadSplitMm(primarySetup),
      splitCompare: rearUpperInnerBulkheadSplitMm(compareSetup),
    }),
  };
}

/**
 * Under–lower-arm bulkhead pickup split (FF−FR / RF−RR) for anti-dive / anti-squat vs averaged RC on the axle.
 */
export function buildLowerArmAntiGeometryNotes(
  primarySetup: SetupSnapshotData,
  compareSetup: SetupSnapshotData
): {
  frontLowerArmAntiGeometryNote: string | null;
  rearLowerArmAntiGeometryNote: string | null;
} {
  return {
    frontLowerArmAntiGeometryNote: buildUnderLowerBulkheadSplitLine({
      end: "Front",
      antiLabel: "anti-dive",
      diffLabel: "FF−FR",
      splitPrimary: frontUnderLowerBulkheadSplitMm(primarySetup),
      splitCompare: frontUnderLowerBulkheadSplitMm(compareSetup),
    }),
    rearLowerArmAntiGeometryNote: buildUnderLowerBulkheadSplitLine({
      end: "Rear",
      antiLabel: "anti-squat",
      diffLabel: "RF−RR",
      splitPrimary: rearUnderLowerBulkheadSplitMm(primarySetup),
      splitCompare: rearUnderLowerBulkheadSplitMm(compareSetup),
    }),
  };
}

function fmtAvg(n: number): string {
  return n.toFixed(2);
}

/**
 * Front mean (FF+FR)/2 vs rear mean (RF+RR)/2 for upper inner and under lower — compare→primary deltas of (f_avg − r_avg).
 */
export function buildBulkheadFrontVsRearAvgCompareNote(
  primarySetup: SetupSnapshotData,
  compareSetup: SetupSnapshotData
): string | null {
  const uPf = frontUpperInnerAvgMm(primarySetup);
  const uPr = rearUpperInnerAvgMm(primarySetup);
  const uCf = frontUpperInnerAvgMm(compareSetup);
  const uCr = rearUpperInnerAvgMm(compareSetup);
  const uBalP = upperInnerFrontAvgMinusRearAvgMm(primarySetup);
  const uBalC = upperInnerFrontAvgMinusRearAvgMm(compareSetup);

  const lPf = frontUnderLowerAvgMm(primarySetup);
  const lPr = rearUnderLowerAvgMm(primarySetup);
  const lCf = frontUnderLowerAvgMm(compareSetup);
  const lCr = rearUnderLowerAvgMm(compareSetup);
  const lBalP = underLowerFrontAvgMinusRearAvgMm(primarySetup);
  const lBalC = underLowerFrontAvgMinusRearAvgMm(compareSetup);

  const parts: string[] = [];

  if (uPf != null && uPr != null && uCf != null && uCr != null && uBalP != null && uBalC != null) {
    const dBal = uBalP - uBalC;
    parts.push(
      `Upper inner **front avg vs rear avg** (mean(FF,FR) mm vs mean(RF,RR) mm): primary front ${fmtAvg(uPf)} rear ${fmtAvg(uPr)} (**f_avg − r_avg** ${formatSplitMm(uBalP)}); compare front ${fmtAvg(uCf)} rear ${fmtAvg(uCr)} (**f_avg − r_avg** ${formatSplitMm(uBalC)}); change in (**f_avg − r_avg**) compare→primary **${formatSplitMm(dBal)}** mm.`
    );
  }

  if (lPf != null && lPr != null && lCf != null && lCr != null && lBalP != null && lBalC != null) {
    const dBal = lBalP - lBalC;
    parts.push(
      `Under lower **front avg vs rear avg**: primary front ${fmtAvg(lPf)} rear ${fmtAvg(lPr)} (**f_avg − r_avg** ${formatSplitMm(lBalP)}); compare front ${fmtAvg(lCf)} rear ${fmtAvg(lCr)} (**f_avg − r_avg** ${formatSplitMm(lBalC)}); change compare→primary **${formatSplitMm(dBal)}** mm. **Anti-dive** = FF−FR split; **anti-squat** = RF−RR split (separate from these axle means).`
    );
  }

  return parts.length ? parts.join(" ") : null;
}

/** @deprecated Use frontUnderLowerBulkheadSplitMm from setupBulkheadInnerSplits. */
export const frontLowerArmLeftRightSplitMm = frontUnderLowerBulkheadSplitMm;
/** @deprecated Use rearUnderLowerBulkheadSplitMm from setupBulkheadInnerSplits. */
export const rearLowerArmLeftRightSplitMm = rearUnderLowerBulkheadSplitMm;
