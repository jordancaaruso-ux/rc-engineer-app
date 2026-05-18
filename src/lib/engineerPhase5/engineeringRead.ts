/**
 * Shared engineering brain. Builds a structured `EngineeringReadV1` from a focused
 * "current run + optional prior run" pair, applying the priority rules described in
 * the data-enhanced-engineer plan:
 *
 * - Required car rating + better/worse chip are the strongest feel/outcome signals.
 * - Phase balance chips are evaluated per `entry` / `mid` / `exit`.
 * - Pace metrics are described as a fluid shape (peak vs repeatability) rather than
 *   single hard-coded indicators.
 * - Tire choices are treated as a fundamental setup choice, scored alongside chassis
 *   changes in `hypotheses` rather than as an external variable.
 * - Notes are descriptive context only — they never outweigh chips/rating.
 *
 * Suggested next steps + Ask the Engineer both consume this object so they share a
 * single diagnosis. The LLM is asked to explain `engineeringRead`, not to re-derive
 * conclusions from raw notes + spread.
 */
import { createHash } from "node:crypto";

import {
  getAverageTopN,
  getIncludedLapDashboardMetrics,
  primaryLapRowsFromRun,
  type IncludedLapDashboardMetrics,
} from "@/lib/lapAnalysis";
import {
  parseHandlingAssessmentJson,
  type BalanceByPhaseMap,
  type CornerPhase,
  type PhaseBalance,
  type RunHandlingAssessmentParsed,
} from "@/lib/runHandlingAssessment";
import { listSetupKeysChangedBetweenSnapshots } from "@/lib/setupCompare/listSetupKeysChangedBetweenSnapshots";
import { isTuningComparisonKey } from "@/lib/setupComparison/tuningComparisonKeys";
import { compareSetupField } from "@/lib/setupCompare/compare";
import { normalizeSetupData, DEFAULT_SETUP_FIELDS } from "@/lib/runSetup";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import { buildCatalogFromTemplate, buildFieldMetaMap } from "@/lib/setupFieldCatalog";

export type EngineeringReadConfidence = "high" | "medium" | "low";
export type EngineeringReadDirection = "improved" | "regressed" | "flat" | "unknown";

export type RunQualityV1 = {
  carRating: number | null;
  source: "required_user_rating" | "missing";
  confidence: EngineeringReadConfidence;
  /** Plain-English line for the LLM (e.g. "Rated 8/10 — driver liked the car"). */
  summary: string;
};

export type FeelReadPhase = {
  /** Sign of the phase balance: negative = understeer, positive = oversteer. */
  direction: "more_understeer" | "neutral" | "more_oversteer" | "unknown";
  /** Raw chip value (-3..+3) when supplied. */
  value: PhaseBalance | null;
  /**
   * True when this phase moved closer to 0 vs. the previous run's same-phase chip,
   * which the engineer reads as "more balanced in that phase".
   */
  movedTowardNeutral: boolean | null;
};

export type FeelReadV1 = {
  /** Single explicit better/worse chip (-3..+3). */
  betterWorse: {
    direction: "better" | "worse" | "same" | "unknown";
    value: PhaseBalance | null;
    magnitudeWord: "mild" | "moderate" | "strong" | null;
  };
  phaseBalance: Record<CornerPhase, FeelReadPhase>;
  traits: {
    feelSteering: PhaseBalance | null;
    feelGeneral: PhaseBalance | null;
    driveEase: PhaseBalance | null;
    tractionRoll: PhaseBalance | null;
  };
  /** Free notes are quoted verbatim only; they never score chip-style agreement. */
  notesContext: string[];
};

export type PaceMetricBasis = "best_lap" | "avg_top_3" | "median" | "avg_top_10";

export type PaceReadAxis = {
  /** Which metric(s) most informed this read. */
  metricBasis: PaceMetricBasis[];
  /** Direction of the change vs. reference run. */
  direction: EngineeringReadDirection;
  /**
   * Signed seconds delta (current minus reference) on the chosen anchor metric.
   * Negative = improved.
   */
  deltaSeconds: number | null;
};

export type PaceReadV1 = {
  /** Peak pace shape — leans on avg top 3 and best lap, mentioning the disagreement when relevant. */
  peakPace: PaceReadAxis;
  /** Usable / repeatable pace combining median and avg top 10 into a single derived feel. */
  repeatability: PaceReadAxis;
  /** Whether chips and laps disagree — flagged so the Engineer surfaces it. */
  paceFeelAgreement: "agree" | "disagree" | "unknown";
  /** Plain-English summary the LLM can quote. */
  interpretation: string;
  /** Underlying numbers, optionally for grounding. */
  metrics: {
    current: {
      bestLap: number | null;
      avgTop3: number | null;
      median: number | null;
      avgTop10: number | null;
      lapCount: number;
    };
    reference: {
      bestLap: number | null;
      avgTop3: number | null;
      median: number | null;
      avgTop10: number | null;
      lapCount: number;
    } | null;
  };
};

export type ChangeReadV1 = {
  /** Was a different tire set/label used vs. the reference run? */
  tireSetChanged: boolean | null;
  tireLabelChanged: boolean | null;
  /** Always informative when the linked tire set is the same: did the run number step forward? */
  tireRunNumberDelta: number | null;
  /** Number of chassis tuning keys that changed (filtered by tuningComparisonKeys). */
  chassisChangedKeyCount: number;
  /** Sample of the chassis keys that changed, in arbitrary order, capped. */
  chassisChangedKeys: Array<{ key: string; label: string; before: string; after: string }>;
  /** Heuristic flag: was at least one chassis change a "big" knob (spring/oil/major shim)? */
  hasLargeChassisChange: boolean;
  /** Track / event continuity vs reference run. */
  sameTrack: boolean | null;
  sameEvent: boolean | null;
};

export type HypothesisV1 = {
  cause:
    | "tire_choice"
    | "chassis_setup_change"
    | "driving_or_external"
    | "no_change_or_unknown";
  confidence: EngineeringReadConfidence;
  reasons: string[];
};

export type RecommendationStrategyV1 = {
  mode: "diagnose" | "verify" | "suggest_test" | "suggest_compensation" | "celebrate";
  strength: "soft" | "normal" | "strong";
  primaryAdvice: string;
  expectedEffect: string;
  fallbackIfWrong: string | null;
  /** When true, dashboard suggestion tile should nudge the user to open Engineer chat. */
  preferEngineerChat: boolean;
};

export type EngineeringReadV1 = {
  version: 1;
  generatedAtIso: string;
  anchorRunId: string;
  referenceRunId: string | null;
  runQuality: RunQualityV1;
  feelRead: FeelReadV1;
  paceRead: PaceReadV1;
  changeRead: ChangeReadV1;
  hypotheses: HypothesisV1[];
  recommendationStrategy: RecommendationStrategyV1;
  /** Stable digest of the inputs that fed this read — used by fingerprint payloads. */
  fingerprint: string;
};

export type EngineeringReadRunInput = {
  id: string;
  /** ISO string (used for stable fingerprints). */
  sortAtIso: string;
  trackId: string | null;
  eventId: string | null;
  tireSetId: string | null;
  /** Label of the tire set (compound + set number). */
  tireLabel: string | null;
  tireRunNumber: number;
  carRating: number | null;
  handlingAssessmentJson: unknown;
  notes: string | null;
  driverNotes: string | null;
  handlingProblems: string | null;
  lapTimes: unknown;
  lapSession: unknown;
  setupSnapshotData: unknown;
};

const DEFAULT_FIELD_LABELS = new Map(DEFAULT_SETUP_FIELDS.map((f) => [f.key, f]));
const A800RR_FIELD_LABELS = buildFieldMetaMap(buildCatalogFromTemplate(A800RR_SETUP_SHEET_V1));

const LARGE_CHASSIS_KEY_HINTS: Array<RegExp> = [
  /spring/,
  /damper_oil/,
  /diff_oil/,
  /under_lower_arm_shims/,
  /upper_inner_shims/,
  /upper_outer_shims/,
  /toe_/,
  /camber_/,
  /ride_height/,
  /arb/,
  /under_hub_shims/,
];

const PACE_EPS_SECONDS = 0.03;

function labelForKey(key: string): string {
  const a = DEFAULT_FIELD_LABELS.get(key);
  if (a) return a.label + (a.unit ? ` (${a.unit})` : "");
  const b = A800RR_FIELD_LABELS.get(key);
  if (b) return b.label + (b.unit ? ` (${b.unit})` : "");
  return key.replace(/_/g, " ");
}

function stableReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as object)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = (value as Record<string, unknown>)[k];
        return acc;
      }, {});
  }
  return value;
}

function hashMaterial(material: unknown): string {
  return createHash("sha256").update(JSON.stringify(material, stableReplacer), "utf8").digest("hex");
}

function ratingToConfidence(rating: number | null): EngineeringReadConfidence {
  if (rating == null) return "low";
  return "high";
}

function summarizeRating(rating: number | null): string {
  if (rating == null) return "No driver rating supplied (drafts only — completed runs require one).";
  if (rating >= 9) return `Rated ${rating}/10 — the driver felt the car was excellent.`;
  if (rating >= 7) return `Rated ${rating}/10 — the driver felt the car was good.`;
  if (rating >= 5) return `Rated ${rating}/10 — the driver felt the car was workable.`;
  if (rating >= 3) return `Rated ${rating}/10 — the driver felt the car was off pace / hard to drive.`;
  return `Rated ${rating}/10 — the driver felt the car was very bad.`;
}

function buildRunQuality(rating: number | null): RunQualityV1 {
  return {
    carRating: rating,
    source: rating == null ? "missing" : "required_user_rating",
    confidence: ratingToConfidence(rating),
    summary: summarizeRating(rating),
  };
}

function phaseDirection(value: PhaseBalance | null): FeelReadPhase["direction"] {
  if (value == null) return "unknown";
  if (value === 0) return "neutral";
  return value < 0 ? "more_understeer" : "more_oversteer";
}

function phaseMagnitudeWord(v: PhaseBalance | null): "mild" | "moderate" | "strong" | null {
  if (v == null || v === 0) return null;
  const a = Math.abs(v);
  if (a === 1) return "mild";
  if (a === 2) return "moderate";
  return "strong";
}

function movedTowardNeutral(current: PhaseBalance | null, previous: PhaseBalance | null): boolean | null {
  if (current == null || previous == null) return null;
  return Math.abs(current) < Math.abs(previous);
}

function buildPhaseRead(
  current: PhaseBalance | null,
  previous: PhaseBalance | null
): FeelReadPhase {
  return {
    direction: phaseDirection(current),
    value: current,
    movedTowardNeutral: movedTowardNeutral(current, previous),
  };
}

function lookupBalance(map: BalanceByPhaseMap | undefined, phase: CornerPhase): PhaseBalance | null {
  if (!map) return null;
  const v = map[phase];
  return v == null ? null : v;
}

function gatherNotesContext(run: EngineeringReadRunInput): string[] {
  const fragments: string[] = [];
  const push = (text: string | null) => {
    if (!text) return;
    const t = text.trim();
    if (!t) return;
    fragments.push(t.length > 240 ? `${t.slice(0, 237)}…` : t);
  };
  push(run.notes);
  push(run.driverNotes);
  push(run.handlingProblems);
  return fragments.slice(0, 3);
}

function buildFeelRead(
  current: EngineeringReadRunInput,
  reference: EngineeringReadRunInput | null
): FeelReadV1 {
  const parsedCurrent = parseHandlingAssessmentJson(current.handlingAssessmentJson);
  const parsedReference = reference
    ? parseHandlingAssessmentJson(reference.handlingAssessmentJson)
    : null;
  const better = parsedCurrent?.feelVsLastRun ?? null;
  const directionFromFeel = (v: PhaseBalance | null): FeelReadV1["betterWorse"]["direction"] => {
    if (v == null) return "unknown";
    if (v === 0) return "same";
    return v < 0 ? "worse" : "better";
  };
  const traits = {
    feelSteering: parsedCurrent?.feelSteering ?? null,
    feelGeneral: parsedCurrent?.feelGeneral ?? null,
    driveEase: parsedCurrent?.driveEase ?? null,
    tractionRoll: parsedCurrent?.tractionRoll ?? null,
  };
  const phases = (["entry", "mid", "exit"] as CornerPhase[]).reduce(
    (acc, phase) => {
      acc[phase] = buildPhaseRead(
        lookupBalance(parsedCurrent?.balanceByPhase, phase),
        lookupBalance(parsedReference?.balanceByPhase, phase)
      );
      return acc;
    },
    { entry: {} as FeelReadPhase, mid: {} as FeelReadPhase, exit: {} as FeelReadPhase }
  );
  return {
    betterWorse: {
      direction: directionFromFeel(better),
      value: better,
      magnitudeWord: phaseMagnitudeWord(better),
    },
    phaseBalance: phases,
    traits,
    notesContext: gatherNotesContext(current),
  };
}

function paceMetricsForRun(run: EngineeringReadRunInput): {
  metrics: PaceReadV1["metrics"]["current"];
  dashboard: IncludedLapDashboardMetrics;
} {
  const rows = primaryLapRowsFromRun({ lapTimes: run.lapTimes, lapSession: run.lapSession });
  const dashboard = getIncludedLapDashboardMetrics(rows);
  return {
    metrics: {
      bestLap: dashboard.bestLap,
      avgTop3: getAverageTopN(rows, 3),
      median: dashboard.median,
      avgTop10: dashboard.lapCount >= 10 ? dashboard.avgTop10 : null,
      lapCount: dashboard.lapCount,
    },
    dashboard,
  };
}

function classifyPaceDelta(
  current: number | null,
  reference: number | null,
  eps = PACE_EPS_SECONDS
): EngineeringReadDirection {
  if (current == null || reference == null) return "unknown";
  const delta = current - reference;
  if (Math.abs(delta) < eps) return "flat";
  return delta < 0 ? "improved" : "regressed";
}

function pickAnchorMetric(values: Array<{ key: PaceMetricBasis; cur: number | null; ref: number | null }>): {
  basis: PaceMetricBasis[];
  direction: EngineeringReadDirection;
  deltaSeconds: number | null;
} {
  const usable = values.filter((v) => v.cur != null && v.ref != null);
  if (usable.length === 0) {
    return { basis: [], direction: "unknown", deltaSeconds: null };
  }
  // Score: prefer the metric with the largest absolute delta but also include other metrics
  // that agree on direction so the read remains fluid.
  const scored = usable
    .map((v) => ({
      key: v.key,
      cur: v.cur as number,
      ref: v.ref as number,
      delta: (v.cur as number) - (v.ref as number),
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const anchor = scored[0]!;
  const direction = classifyPaceDelta(anchor.cur, anchor.ref);
  const basis = [anchor.key, ...scored.slice(1).filter((s) => Math.sign(s.delta) === Math.sign(anchor.delta)).map((s) => s.key)];
  return { basis, direction, deltaSeconds: anchor.delta };
}

function derivedRepeatabilityAverage(median: number | null, avgTop10: number | null): number | null {
  if (median == null && avgTop10 == null) return null;
  if (median != null && avgTop10 != null) return (median + avgTop10) / 2;
  return median ?? avgTop10;
}

function buildPaceRead(
  current: EngineeringReadRunInput,
  reference: EngineeringReadRunInput | null,
  feel: FeelReadV1
): PaceReadV1 {
  const cur = paceMetricsForRun(current);
  const ref = reference ? paceMetricsForRun(reference) : null;

  const peakPace = pickAnchorMetric([
    { key: "avg_top_3", cur: cur.metrics.avgTop3, ref: ref?.metrics.avgTop3 ?? null },
    { key: "best_lap", cur: cur.metrics.bestLap, ref: ref?.metrics.bestLap ?? null },
  ]);

  const curRepeat = derivedRepeatabilityAverage(cur.metrics.median, cur.metrics.avgTop10);
  const refRepeat = ref ? derivedRepeatabilityAverage(ref.metrics.median, ref.metrics.avgTop10) : null;
  const repeatDirection = classifyPaceDelta(curRepeat, refRepeat);
  const repeatDelta = curRepeat != null && refRepeat != null ? curRepeat - refRepeat : null;
  const repeatBasis: PaceMetricBasis[] = [];
  if (cur.metrics.median != null && ref?.metrics.median != null) repeatBasis.push("median");
  if (cur.metrics.avgTop10 != null && ref?.metrics.avgTop10 != null) repeatBasis.push("avg_top_10");

  const interpretation = buildPaceInterpretation({
    peakDirection: peakPace.direction,
    repeatDirection,
    feelDirection: feel.betterWorse.direction,
    bestLap: cur.metrics.bestLap,
    refBestLap: ref?.metrics.bestLap ?? null,
    avgTop3: cur.metrics.avgTop3,
    refAvgTop3: ref?.metrics.avgTop3 ?? null,
  });

  const paceFeelAgreement = computePaceFeelAgreement(peakPace.direction, repeatDirection, feel.betterWorse.direction);

  return {
    peakPace: {
      metricBasis: peakPace.basis,
      direction: peakPace.direction,
      deltaSeconds: peakPace.deltaSeconds,
    },
    repeatability: {
      metricBasis: repeatBasis,
      direction: repeatDirection,
      deltaSeconds: repeatDelta,
    },
    paceFeelAgreement,
    interpretation,
    metrics: {
      current: cur.metrics,
      reference: ref?.metrics ?? null,
    },
  };
}

function computePaceFeelAgreement(
  peak: EngineeringReadDirection,
  repeat: EngineeringReadDirection,
  feel: FeelReadV1["betterWorse"]["direction"]
): PaceReadV1["paceFeelAgreement"] {
  if (feel === "unknown") return "unknown";
  if (peak === "unknown" && repeat === "unknown") return "unknown";
  const paceBetter = peak === "improved" || repeat === "improved";
  const paceWorse = peak === "regressed" || repeat === "regressed";
  if (feel === "better" && paceWorse && !paceBetter) return "disagree";
  if (feel === "worse" && paceBetter && !paceWorse) return "disagree";
  return "agree";
}

function buildPaceInterpretation(input: {
  peakDirection: EngineeringReadDirection;
  repeatDirection: EngineeringReadDirection;
  feelDirection: FeelReadV1["betterWorse"]["direction"];
  bestLap: number | null;
  refBestLap: number | null;
  avgTop3: number | null;
  refAvgTop3: number | null;
}): string {
  const peakBetter = input.peakDirection === "improved";
  const peakWorse = input.peakDirection === "regressed";
  const repeatBetter = input.repeatDirection === "improved";
  const repeatWorse = input.repeatDirection === "regressed";

  if (peakBetter && repeatBetter) return "peak pace and usable average pace both improved";
  if (peakWorse && repeatWorse) return "peak pace and usable average pace both regressed";
  if (peakBetter && repeatWorse) return "peak potential improved but usable average pace regressed — flag inconsistency";
  if (peakWorse && repeatBetter) return "peak pace dropped but usable average pace improved — possibly safer / more repeatable car";
  if (peakBetter && input.repeatDirection === "flat") return "peak pace improved while usable average pace stayed roughly the same";
  if (peakWorse && input.repeatDirection === "flat") return "peak pace dropped while usable average pace stayed roughly the same";
  if (input.peakDirection === "flat" && repeatBetter) return "usable average pace improved while peak pace stayed roughly the same";
  if (input.peakDirection === "flat" && repeatWorse) return "usable average pace regressed while peak pace stayed roughly the same";
  if (input.peakDirection === "flat" && input.repeatDirection === "flat") return "pace shape unchanged vs reference run";
  if (input.bestLap != null && input.refBestLap == null) return "no reference pace available to compare against";
  if (input.feelDirection === "better" && input.peakDirection === "unknown") return "driver felt better but pace data is sparse";
  if (input.feelDirection === "worse" && input.peakDirection === "unknown") return "driver felt worse but pace data is sparse";
  return "pace shape unclear";
}

function buildChangeRead(
  current: EngineeringReadRunInput,
  reference: EngineeringReadRunInput | null
): ChangeReadV1 {
  if (!reference) {
    return {
      tireSetChanged: null,
      tireLabelChanged: null,
      tireRunNumberDelta: null,
      chassisChangedKeyCount: 0,
      chassisChangedKeys: [],
      hasLargeChassisChange: false,
      sameTrack: null,
      sameEvent: null,
    };
  }
  const sameTrack = current.trackId && reference.trackId ? current.trackId === reference.trackId : null;
  const sameEvent = current.eventId && reference.eventId ? current.eventId === reference.eventId : null;
  const tireSetChanged = current.tireSetId && reference.tireSetId ? current.tireSetId !== reference.tireSetId : null;
  const tireLabelChanged = current.tireLabel && reference.tireLabel ? current.tireLabel !== reference.tireLabel : null;
  const tireRunNumberDelta =
    typeof current.tireRunNumber === "number" && typeof reference.tireRunNumber === "number"
      ? current.tireRunNumber - reference.tireRunNumber
      : null;

  const cur = normalizeSetupData(current.setupSnapshotData);
  const prev = normalizeSetupData(reference.setupSnapshotData);
  const changedKeys = listSetupKeysChangedBetweenSnapshots(cur, prev, {
    keyFilter: isTuningComparisonKey,
  });
  const detailed: ChangeReadV1["chassisChangedKeys"] = [];
  for (const key of changedKeys.slice(0, 20)) {
    const cmp = compareSetupField({ key, a: cur[key], b: prev[key], numericAggregationByKey: null });
    if (cmp.areEqual) continue;
    detailed.push({
      key,
      label: labelForKey(key),
      before: cmp.normalizedB,
      after: cmp.normalizedA,
    });
  }
  const hasLargeChassisChange = changedKeys.some((k) => LARGE_CHASSIS_KEY_HINTS.some((re) => re.test(k)));

  return {
    tireSetChanged,
    tireLabelChanged,
    tireRunNumberDelta,
    chassisChangedKeyCount: changedKeys.length,
    chassisChangedKeys: detailed,
    hasLargeChassisChange,
    sameTrack,
    sameEvent,
  };
}

function buildHypotheses(
  feel: FeelReadV1,
  pace: PaceReadV1,
  change: ChangeReadV1,
  runQuality: RunQualityV1
): HypothesisV1[] {
  const noFeelChange = feel.betterWorse.direction === "same" || feel.betterWorse.direction === "unknown";
  const significantFeelChange = !noFeelChange;
  const noChassisChange = change.chassisChangedKeyCount === 0;
  const tireChanged = change.tireSetChanged === true || change.tireLabelChanged === true;

  if (!significantFeelChange && pace.peakPace.direction === "unknown" && pace.repeatability.direction === "unknown") {
    return [
      {
        cause: "no_change_or_unknown",
        confidence: "low",
        reasons: ["Insufficient evidence to attribute a difference vs reference."],
      },
    ];
  }

  const hypotheses: HypothesisV1[] = [];

  if (tireChanged) {
    const reasons = [
      "Tire compound / set switched vs reference run — tires are a fundamental setup choice and usually dominate handling delta when changed.",
    ];
    if (change.chassisChangedKeyCount <= 2) {
      reasons.push("Few chassis-side changes alongside the tire change, so attribution leans tire-heavy.");
    } else if (change.hasLargeChassisChange) {
      reasons.push("Large chassis change also present — tire vs chassis attribution should be considered jointly.");
    }
    const confidence: EngineeringReadConfidence =
      change.chassisChangedKeyCount <= 2 || change.hasLargeChassisChange === false ? "medium" : "low";
    hypotheses.push({ cause: "tire_choice", confidence, reasons });
  }

  if (change.chassisChangedKeyCount > 0) {
    const reasons: string[] = [
      `${change.chassisChangedKeyCount} chassis tuning key${change.chassisChangedKeyCount === 1 ? "" : "s"} changed vs reference.`,
    ];
    if (change.hasLargeChassisChange) {
      reasons.push("At least one change is a major knob (spring, oil, key shim group).");
    }
    if (tireChanged) reasons.push("Tire choice also changed — chassis explanation must compete with tire effect.");
    let confidence: EngineeringReadConfidence = change.hasLargeChassisChange ? "medium" : "low";
    if (!tireChanged && change.hasLargeChassisChange) confidence = "high";
    hypotheses.push({ cause: "chassis_setup_change", confidence, reasons });
  }

  if (!tireChanged && noChassisChange && significantFeelChange) {
    hypotheses.push({
      cause: "driving_or_external",
      confidence: "low",
      reasons: [
        "Feel/pace shifted but neither tires nor chassis setup changed — look at driving, track evolution, or temperature.",
      ],
    });
  }

  if (runQuality.carRating != null && runQuality.carRating >= 8 && pace.peakPace.direction === "improved") {
    hypotheses.unshift({
      cause: "no_change_or_unknown",
      confidence: "medium",
      reasons: ["Car was rated high and pace improved — current direction is working; verify before changing more."],
    });
  }

  return hypotheses;
}

function buildRecommendationStrategy(
  feel: FeelReadV1,
  pace: PaceReadV1,
  change: ChangeReadV1,
  hypotheses: HypothesisV1[],
  runQuality: RunQualityV1
): RecommendationStrategyV1 {
  const carRating = runQuality.carRating;
  const topHypothesis = hypotheses[0]?.cause ?? "no_change_or_unknown";
  const topConfidence = hypotheses[0]?.confidence ?? "low";

  // Rated high + improving = celebrate / verify, not chase.
  if (carRating != null && carRating >= 8 && pace.paceFeelAgreement !== "disagree") {
    return {
      mode: "celebrate",
      strength: "soft",
      primaryAdvice:
        "Car was rated highly and the data agrees. Bank the current setup as a known-good reference; do another run before chasing changes.",
      expectedEffect: "Confirm repeatability and lock in this baseline before introducing new variables.",
      fallbackIfWrong: null,
      preferEngineerChat: false,
    };
  }

  // Rated low or strong negative feel = diagnose / suggest a tested compensation.
  const strongNegativeFeel = feel.betterWorse.direction === "worse" && (feel.betterWorse.magnitudeWord === "moderate" || feel.betterWorse.magnitudeWord === "strong");
  if ((carRating != null && carRating <= 4) || strongNegativeFeel) {
    if (topHypothesis === "tire_choice" && topConfidence !== "low") {
      return {
        mode: "diagnose",
        strength: "normal",
        primaryAdvice:
          "Treat the tire switch as the likely dominant variable. Re-run with the prior tire choice before chasing chassis changes.",
        expectedEffect: "Isolate how much of the worse feel is tire-driven before changing setup.",
        fallbackIfWrong:
          "If feel does not return with the prior tires, revisit the chassis changes that moved alongside the swap.",
        preferEngineerChat: false,
      };
    }
    if (topHypothesis === "chassis_setup_change") {
      return {
        mode: "suggest_compensation",
        strength: "normal",
        primaryAdvice:
          "Roll back the most recent chassis change closest to the symptom or apply a known compensating move (e.g. ARB / spring / shim direction) one step.",
        expectedEffect: "Recover the prior balance without giving up the rest of the new setup.",
        fallbackIfWrong:
          "If the symptom persists, undo the original change entirely and re-baseline before exploring new directions.",
        preferEngineerChat: true,
      };
    }
    return {
      mode: "diagnose",
      strength: "soft",
      primaryAdvice:
        "Feel/rating is poor but the attribution is unclear from data alone. Open Engineer chat to walk through the full pair and pick a test.",
      expectedEffect: "Build a clearer picture before changing more parameters.",
      fallbackIfWrong: null,
      preferEngineerChat: true,
    };
  }

  // Pace vs feel disagreement = verify.
  if (pace.paceFeelAgreement === "disagree") {
    return {
      mode: "verify",
      strength: "soft",
      primaryAdvice:
        "Lap data and driver feel disagree. Add another run on the same setup before deciding — keeps a single fluke session from driving setup changes.",
      expectedEffect: "Confirm whether the pace shape or the driver impression is the right read.",
      fallbackIfWrong: null,
      preferEngineerChat: true,
    };
  }

  // Mid case: suggest one tested move with hedging.
  if (topHypothesis === "chassis_setup_change" && topConfidence !== "low") {
    return {
      mode: "suggest_test",
      strength: "normal",
      primaryAdvice:
        "Pick the single most recent chassis change most relevant to the symptom and test one step in that direction next run.",
      expectedEffect: "Move balance by a small, recoverable amount toward the desired direction.",
      fallbackIfWrong: "If the symptom worsens, revert and try a different mechanism with similar effect.",
      preferEngineerChat: false,
    };
  }

  return {
    mode: "suggest_test",
    strength: "soft",
    primaryAdvice:
      "Plausible directions exist but evidence is thin. Try one small move and verify; open Engineer chat for a deeper look if you want options.",
    expectedEffect: "Gather another data point without burning a stack of changes at once.",
    fallbackIfWrong: null,
    preferEngineerChat: true,
  };
}

export function buildEngineeringReadV1(input: {
  anchor: EngineeringReadRunInput;
  reference: EngineeringReadRunInput | null;
  generatedAtIso?: string;
}): EngineeringReadV1 {
  const runQuality = buildRunQuality(input.anchor.carRating);
  const feelRead = buildFeelRead(input.anchor, input.reference);
  const paceRead = buildPaceRead(input.anchor, input.reference, feelRead);
  const changeRead = buildChangeRead(input.anchor, input.reference);
  const hypotheses = buildHypotheses(feelRead, paceRead, changeRead, runQuality);
  const recommendationStrategy = buildRecommendationStrategy(
    feelRead,
    paceRead,
    changeRead,
    hypotheses,
    runQuality
  );

  const fingerprint = hashMaterial({
    v: 1,
    anchor: {
      id: input.anchor.id,
      sortAtIso: input.anchor.sortAtIso,
      carRating: input.anchor.carRating,
      feel: feelRead,
      paceShape: {
        peak: paceRead.peakPace.direction,
        peakDelta: paceRead.peakPace.deltaSeconds,
        repeat: paceRead.repeatability.direction,
        repeatDelta: paceRead.repeatability.deltaSeconds,
      },
      change: {
        tireSet: changeRead.tireSetChanged,
        tireLabel: changeRead.tireLabelChanged,
        chassisCount: changeRead.chassisChangedKeyCount,
        chassisKeys: changeRead.chassisChangedKeys.map((r) => r.key),
        largeChange: changeRead.hasLargeChassisChange,
      },
      hypotheses: hypotheses.map((h) => ({ c: h.cause, conf: h.confidence })),
      reco: { mode: recommendationStrategy.mode, strength: recommendationStrategy.strength },
    },
    reference: input.reference ? { id: input.reference.id, sortAtIso: input.reference.sortAtIso } : null,
  });

  return {
    version: 1,
    generatedAtIso: input.generatedAtIso ?? new Date().toISOString(),
    anchorRunId: input.anchor.id,
    referenceRunId: input.reference?.id ?? null,
    runQuality,
    feelRead,
    paceRead,
    changeRead,
    hypotheses,
    recommendationStrategy,
    fingerprint,
  };
}

/**
 * Compact human-readable lines describing the read, intended for inclusion in LLM
 * prompts so the model explains the engineering brain's conclusions rather than
 * re-deriving them.
 */
export function summarizeEngineeringReadAsLines(read: EngineeringReadV1): string[] {
  const lines: string[] = [];
  lines.push(`Run quality: ${read.runQuality.summary}`);
  if (read.feelRead.betterWorse.direction !== "unknown") {
    lines.push(
      `Feel vs last run: ${read.feelRead.betterWorse.direction}${
        read.feelRead.betterWorse.magnitudeWord ? ` (${read.feelRead.betterWorse.magnitudeWord})` : ""
      }`
    );
  }
  for (const phase of ["entry", "mid", "exit"] as CornerPhase[]) {
    const p = read.feelRead.phaseBalance[phase];
    if (p.value == null) continue;
    const neutralNote = p.movedTowardNeutral === true ? " — moved toward neutral" : p.movedTowardNeutral === false ? " — moved away from neutral" : "";
    lines.push(`${phase} balance: ${p.direction.replace("_", " ")} (${p.value})${neutralNote}`);
  }
  lines.push(`Pace read: ${read.paceRead.interpretation}.`);
  if (read.paceRead.paceFeelAgreement === "disagree") {
    lines.push("Pace and driver feel disagree — surface the conflict, don't hide it.");
  }
  if (read.changeRead.chassisChangedKeyCount > 0) {
    const sample = read.changeRead.chassisChangedKeys.slice(0, 3).map((k) => k.label).join(", ");
    lines.push(
      `Chassis changes since reference: ${read.changeRead.chassisChangedKeyCount} key${
        read.changeRead.chassisChangedKeyCount === 1 ? "" : "s"
      }${sample ? ` (${sample}${read.changeRead.chassisChangedKeys.length > 3 ? ", …" : ""})` : ""}`
    );
  }
  if (read.changeRead.tireSetChanged === true || read.changeRead.tireLabelChanged === true) {
    lines.push("Tire set / label changed vs reference run — treat as a fundamental setup choice.");
  }
  if (read.hypotheses.length > 0) {
    const top = read.hypotheses[0]!;
    lines.push(`Top hypothesis: ${top.cause.replace("_", " ")} (${top.confidence} confidence) — ${top.reasons.join(" ")}`);
  }
  lines.push(
    `Recommendation strategy: ${read.recommendationStrategy.mode} (${read.recommendationStrategy.strength}) — ${read.recommendationStrategy.primaryAdvice}`
  );
  return lines;
}

/** Convenience: turn raw parsed handling into a `FeelReadV1`-shaped pace-agreement helper. */
export function feelDirectionFromParsedHandling(parsed: RunHandlingAssessmentParsed | null): FeelReadV1["betterWorse"]["direction"] {
  const v = parsed?.feelVsLastRun ?? null;
  if (v == null) return "unknown";
  if (v === 0) return "same";
  return v < 0 ? "worse" : "better";
}
