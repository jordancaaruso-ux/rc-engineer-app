import "server-only";

import type { EngineeringReadV1 } from "@/lib/engineerPhase5/engineeringRead";
import type { CornerPhase } from "@/lib/runHandlingAssessment";
import { detectOutcomeIntent } from "@/lib/engineerPhase5/parameterEffects/intentFromMessage";
import type { ProblemStatementV1 } from "@/lib/engineerPhase5/reasoningSpine/types";

function dominantPhase(read: EngineeringReadV1): ProblemStatementV1["phase"] {
  let best: CornerPhase | null = null;
  let bestMag = 0;
  for (const phase of ["entry", "mid", "exit"] as const) {
    const v = read.feelRead.phaseBalance[phase].value;
    if (v == null) continue;
    const mag = Math.abs(v);
    if (mag > bestMag) {
      bestMag = mag;
      best = phase;
    }
  }
  return best ?? "unknown";
}

function balanceSignFromPhase(read: EngineeringReadV1): ProblemStatementV1["balanceSign"] {
  const phases = (["entry", "mid", "exit"] as const)
    .map((p) => read.feelRead.phaseBalance[p])
    .filter((p) => p.value != null);
  if (phases.length === 0) return "unknown";
  const us = phases.filter((p) => p.direction === "more_understeer").length;
  const os = phases.filter((p) => p.direction === "more_oversteer").length;
  if (us > 0 && os > 0) return "mixed";
  if (us >= os) return "understeer";
  if (os > us) return "oversteer";
  return "neutral";
}

function inferEnd(read: EngineeringReadV1, intentPhrase: string | null): ProblemStatementV1["end"] {
  const lower = (intentPhrase ?? "").toLowerCase();
  if (/\b(rear|back)\b/.test(lower)) return "rear";
  if (/\b(front|nose)\b/.test(lower)) return "front";
  const sign = balanceSignFromPhase(read);
  if (sign === "understeer") return "front";
  if (sign === "oversteer") return "rear";
  return "unknown";
}

function severityFromFeel(read: EngineeringReadV1): ProblemStatementV1["severity"] {
  const w = read.feelRead.betterWorse.magnitudeWord;
  if (w === "strong") return "severe";
  if (w === "moderate") return "moderate";
  if (w === "mild") return "mild";
  return "unknown";
}

function buildConfounders(read: EngineeringReadV1): string[] {
  const lines: string[] = [];
  const ch = read.changeRead;
  if (ch.tireChangeSignificance === "compound_change") {
    lines.push("Tire compound changed vs reference — chassis attribution is unreliable.");
  } else if (ch.tireChangeSignificance === "new_set_same_compound") {
    lines.push("Fresh tire set (same compound) — pace/feel may be rubber as much as setup.");
  } else if (ch.tireChangeSignificance === "wear_index_only" && (ch.tireRunNumberDelta ?? 0) > 0) {
    lines.push("Higher tire run index on the same set — tire life may explain pace delta.");
  }
  if (!ch.sameTrack) lines.push("Different track vs reference run.");
  if (!ch.sameEvent) lines.push("Different event vs reference run.");
  if (ch.chassisChangedKeyCount > 3) {
    lines.push(`${ch.chassisChangedKeyCount} chassis keys changed — not a one-variable test.`);
  }
  if (read.paceRead.paceFeelAgreement === "disagree") {
    lines.push("Lap pace and feel chips disagree — verify before committing to setup changes.");
  }
  if (read.recommendationStrategy.mode === "diagnose") {
    lines.push("Recommendation mode is diagnose-first — clarify the complaint before changing setup.");
  }
  return lines;
}

function diagnosisConfidence(read: EngineeringReadV1): ProblemStatementV1["diagnosisConfidence"] {
  if (read.recommendationStrategy.mode === "diagnose" || read.paceRead.paceFeelAgreement === "disagree") {
    return "low";
  }
  if (
    read.changeRead.tireChangeSignificance === "compound_change" ||
    read.changeRead.chassisChangedKeyCount > 4
  ) {
    return "low";
  }
  const hasFeel =
    read.feelRead.betterWorse.direction !== "unknown" ||
    Object.values(read.feelRead.phaseBalance).some((p) => p.value != null);
  if (!hasFeel && read.runQuality.carRating == null) return "low";
  if (read.recommendationStrategy.mode === "verify") return "medium";
  return "high";
}

export function buildProblemStatementV1(input: {
  engineeringRead: EngineeringReadV1;
  userMessage: string;
}): ProblemStatementV1 {
  const intent = detectOutcomeIntent(input.userMessage);
  const read = input.engineeringRead;

  return {
    version: 1,
    goalOutcome: intent?.outcome ?? null,
    goalDirection: intent?.direction ?? null,
    matchedPhrase: intent?.matchedPhrase ?? null,
    end: inferEnd(read, intent?.matchedPhrase ?? null),
    phase: dominantPhase(read),
    severity: severityFromFeel(read),
    balanceSign: balanceSignFromPhase(read),
    paceFeelAgreement: read.paceRead.paceFeelAgreement,
    confounders: buildConfounders(read),
    diagnosisConfidence: diagnosisConfidence(read),
    recommendationMode: read.recommendationStrategy.mode,
  };
}
