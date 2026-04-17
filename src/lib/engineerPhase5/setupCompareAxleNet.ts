import "server-only";

import type { SetupSnapshotData } from "@/lib/runSetup";
import { parseSetupShimMm } from "@/lib/engineerPhase5/rcEffectHintsFromSetupComparison";

const EPS = 1e-4;
/** Left–right inner-lower split treated as symmetric below this (mm). */
const SPLIT_EPS = 0.02;

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
  dULA: number | null
): string | null {
  if (
    (dUI == null || Math.abs(dUI) < EPS) &&
    (dUO == null || Math.abs(dUO) < EPS) &&
    (dULA == null || Math.abs(dULA) < EPS)
  ) {
    return null;
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

  return `${end} axle (compare→primary): ${parts.join(" ")} **Combined RC tendency:** ${netSentence}${angleBit}`;
}

/**
 * Deterministic per-axle text so the model does not invert RC when summarizing multiple shims.
 * Uses the same compare→primary mm deltas as setupComparison.changedRows (pre-collapse keys).
 */
export function buildFrontRearAxleNetNotes(rows: SetupCompareRow[]): {
  frontAxleNetNote: string | null;
  rearAxleNetNote: string | null;
} {
  const dUIFront = avgDeltaForKeys(rows, ["upper_inner_shims_ff", "upper_inner_shims_fr"]);
  const dUIRear = avgDeltaForKeys(rows, ["upper_inner_shims_rf", "upper_inner_shims_rr"]);

  const map = new Map(rows.map((r) => [r.key, r]));
  const dUOFront = map.has("upper_outer_shims_front")
    ? deltaRow(map.get("upper_outer_shims_front")!)
    : null;
  const dUORear = map.has("upper_outer_shims_rear")
    ? deltaRow(map.get("upper_outer_shims_rear")!)
    : null;

  /** Averaged per axle — intended for roll-centre / support net with upper link; not left–right anti geometry. */
  const dULAFront = avgDeltaForKeys(rows, ["under_lower_arm_shims_ff", "under_lower_arm_shims_fr"]);
  const dULARear = avgDeltaForKeys(rows, ["under_lower_arm_shims_rf", "under_lower_arm_shims_rr"]);

  return {
    frontAxleNetNote: buildOneAxleNetNote("Front", dUIFront, dUOFront, dULAFront),
    rearAxleNetNote: buildOneAxleNetNote("Rear", dUIRear, dUORear, dULARear),
  };
}

function shimMm(data: SetupSnapshotData, key: string): number | null {
  const v = data[key];
  if (v == null) return null;
  return parseSetupShimMm(String(v));
}

/** FF − FR (mm). Null if either corner missing/unparseable. */
export function frontLowerArmLeftRightSplitMm(data: SetupSnapshotData): number | null {
  const ff = shimMm(data, "under_lower_arm_shims_ff");
  const fr = shimMm(data, "under_lower_arm_shims_fr");
  if (ff == null || fr == null) return null;
  return ff - fr;
}

/** RF − RR (mm). Null if either corner missing/unparseable. */
export function rearLowerArmLeftRightSplitMm(data: SetupSnapshotData): number | null {
  const rf = shimMm(data, "under_lower_arm_shims_rf");
  const rr = shimMm(data, "under_lower_arm_shims_rr");
  if (rf == null || rr == null) return null;
  return rf - rr;
}

function formatSplitMm(split: number): string {
  const s = split.toFixed(2);
  return split >= 0 ? `+${s}` : s;
}

function buildAntiGeometryLine(params: {
  end: "Front" | "Rear";
  antiLabel: "anti-dive" | "anti-squat";
  diffLabel: "FF−FR" | "RF−RR";
  splitPrimary: number | null;
  splitCompare: number | null;
}): string | null {
  const { end, antiLabel, diffLabel, splitPrimary, splitCompare } = params;
  if (splitPrimary == null && splitCompare == null) return null;

  const parts: string[] = [];
  parts.push(
    `${end} inner-lower left–right split (${diffLabel} mm) — **${antiLabel}** geometry (side-view lower-arm asymmetry); separate from **averaged** under–lower-arm RC height in ${end.toLowerCase()}AxleNetNote.`
  );

  if (splitPrimary != null) {
    const sym = Math.abs(splitPrimary) < SPLIT_EPS;
    if (sym) {
      parts.push(`Primary: **symmetric** (${diffLabel} ${formatSplitMm(splitPrimary)}).`);
    } else {
      const hi =
        diffLabel === "FF−FR"
          ? splitPrimary > 0
            ? "FF"
            : "FR"
          : splitPrimary > 0
            ? "RF"
            : "RR";
      const lo =
        diffLabel === "FF−FR"
          ? splitPrimary > 0
            ? "FR"
            : "FF"
          : splitPrimary > 0
            ? "RR"
            : "RF";
      parts.push(
        `Primary: **asymmetric** (${diffLabel} ${formatSplitMm(splitPrimary)}; ${hi} inner-lower stack higher than ${lo}).`
      );
    }
  } else {
    parts.push("Primary: inner-lower FF/FR or RF/RR values incomplete — split unknown.");
  }

  if (splitCompare != null) {
    const sym = Math.abs(splitCompare) < SPLIT_EPS;
    parts.push(
      sym
        ? `Compare: **symmetric** (${diffLabel} ${formatSplitMm(splitCompare)}).`
        : `Compare: **asymmetric** (${diffLabel} ${formatSplitMm(splitCompare)}).`
    );
  } else {
    parts.push("Compare: inner-lower values incomplete — split unknown.");
  }

  if (splitPrimary != null && splitCompare != null) {
    const dSplit = splitPrimary - splitCompare;
    if (Math.abs(dSplit) < SPLIT_EPS) {
      parts.push("Left–right split **unchanged** compare→primary.");
    } else {
      parts.push(
        `Split change compare→primary: **${formatSplitMm(dSplit)}** mm (${dSplit > 0 ? "more" : "less"} asymmetry on primary).`
      );
    }
  }

  return parts.join(" ");
}

/**
 * Left–right inner lower arm positions (FF vs FR, RF vs RR) for anti-dive / anti-squat reasoning.
 * Roll-centre net on each axle still uses averaged under–lower-arm delta in `buildFrontRearAxleNetNotes`.
 */
export function buildLowerArmAntiGeometryNotes(
  primarySetup: SetupSnapshotData,
  compareSetup: SetupSnapshotData
): {
  frontLowerArmAntiGeometryNote: string | null;
  rearLowerArmAntiGeometryNote: string | null;
} {
  const sp = frontLowerArmLeftRightSplitMm(primarySetup);
  const sc = frontLowerArmLeftRightSplitMm(compareSetup);
  const srP = rearLowerArmLeftRightSplitMm(primarySetup);
  const srC = rearLowerArmLeftRightSplitMm(compareSetup);

  return {
    frontLowerArmAntiGeometryNote: buildAntiGeometryLine({
      end: "Front",
      antiLabel: "anti-dive",
      diffLabel: "FF−FR",
      splitPrimary: sp,
      splitCompare: sc,
    }),
    rearLowerArmAntiGeometryNote: buildAntiGeometryLine({
      end: "Rear",
      antiLabel: "anti-squat",
      diffLabel: "RF−RR",
      splitPrimary: srP,
      splitCompare: srC,
    }),
  };
}
