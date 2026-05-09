import "server-only";

import type { EngineerFocusedRunPairContext } from "@/lib/engineerPhase5/contextPacket";
import { PARAMETER_EFFECT_CATALOG } from "@/lib/engineerPhase5/parameterEffects/catalog";
import type { Outcome } from "@/lib/engineerPhase5/parameterEffects/types";
import { parseHandlingAssessmentJson } from "@/lib/runHandlingAssessment";

export type SetupHandlingPaceBundleV1 = {
  version: 1;
  /** Deterministic tags for prompts — facts only, not prescriptions. */
  correlationHints: string[];
  changedKeys: string[];
  /** Catalog outcomes that mention these parameter keys (read-only catalog join). */
  catalogOutcomeTags: Array<{ parameterKey: string; outcomes: Outcome[] }>;
  lapAvgTop10DeltaPrimaryMinusCompareSeconds: number | null;
  lapAvgTop10Regressed: boolean | null;
  feelWorse: boolean | null;
  feelBetter: boolean | null;
};

export function buildSetupHandlingPaceBundle(
  focused: EngineerFocusedRunPairContext | null
): SetupHandlingPaceBundleV1 | null {
  if (!focused) return null;

  const hints: string[] = [];
  const changedKeys =
    focused.setupComparison?.comparable === true
      ? focused.setupComparison.changedRows.map((r) => r.key)
      : [];

  if (changedKeys.length > 0) hints.push("setup_keys_changed");

  const lapDelta = focused.lapComparison?.avgTop10DeltaSeconds ?? null;
  let lapAvgTop10Regressed: boolean | null = null;
  if (lapDelta != null && Number.isFinite(lapDelta)) {
    if (lapDelta > 1e-6) {
      lapAvgTop10Regressed = true;
      hints.push("lap_avg_top_10_regressed");
    } else if (lapDelta < -1e-6) {
      lapAvgTop10Regressed = false;
      hints.push("lap_avg_top_10_improved");
    } else {
      lapAvgTop10Regressed = false;
      hints.push("lap_avg_top_10_flat");
    }
  }

  const parsedPrimary = parseHandlingAssessmentJson(
    focused.handlingAssessmentJsonByRun.primary
  );
  let feelWorse: boolean | null = null;
  let feelBetter: boolean | null = null;
  const feel = parsedPrimary?.feelVsLastRun;
  if (typeof feel === "number") {
    if (feel < 0) {
      feelWorse = true;
      hints.push("feel_worse");
    }
    if (feel > 0) {
      feelBetter = true;
      hints.push("feel_better");
    }
  }

  const keySet = new Set(changedKeys);
  const catalogOutcomeTags: Array<{ parameterKey: string; outcomes: Outcome[] }> = [];
  for (const entry of PARAMETER_EFFECT_CATALOG) {
    if (!keySet.has(entry.parameterKey)) continue;
    const outcomes = Object.keys(entry.effects) as Outcome[];
    if (outcomes.length > 0) {
      catalogOutcomeTags.push({ parameterKey: entry.parameterKey, outcomes });
    }
  }

  return {
    version: 1,
    correlationHints: hints,
    changedKeys,
    catalogOutcomeTags,
    lapAvgTop10DeltaPrimaryMinusCompareSeconds: lapDelta,
    lapAvgTop10Regressed,
    feelWorse,
    feelBetter,
  };
}
