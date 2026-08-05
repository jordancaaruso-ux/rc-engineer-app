import "server-only";

import type { EngineeringReadV1 } from "@/lib/engineerPhase5/engineeringRead";
import type {
  PhaseProfileEntryV1,
  ProblemShape,
  ProblemStatementV1,
} from "@/lib/engineerPhase5/reasoningSpine/types";

const PHASE_ORDER: Record<"entry" | "mid" | "exit", number> = { entry: 0, mid: 1, exit: 2 };

function severityForValue(v: number): PhaseProfileEntryV1["severity"] {
  const a = Math.abs(v);
  if (a >= 3) return "severe";
  if (a === 2) return "moderate";
  return "mild";
}

/**
 * Every phase the driver flagged, worst first — the thing that replaced picking a single
 * winner and discarding the rest.
 *
 * Neutral (0) phases are dropped: the driver saying a phase is fine is real information,
 * but it is not a problem and it must not dilute the shape. Ties break in corner order so
 * the lead of an equal-magnitude pair is the one that happens first in the corner.
 */
function buildPhaseProfile(read: EngineeringReadV1): PhaseProfileEntryV1[] {
  const out: PhaseProfileEntryV1[] = [];
  for (const phase of ["entry", "mid", "exit"] as const) {
    const v = read.feelRead.phaseBalance[phase].value;
    if (v == null || v === 0) continue;
    out.push({
      phase,
      value: v,
      severity: severityForValue(v),
      direction: v > 0 ? "oversteer" : "understeer",
      end: v > 0 ? "rear" : "front",
    });
  }
  return out.sort(
    (a, b) => Math.abs(b.value) - Math.abs(a.value) || PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase]
  );
}

function opposedDirections(profile: PhaseProfileEntryV1[]): boolean {
  return (
    profile.some((p) => p.direction === "understeer") &&
    profile.some((p) => p.direction === "oversteer")
  );
}

function shapeFromProfile(profile: PhaseProfileEntryV1[]): ProblemShape {
  if (profile.length === 0) return "unknown";
  if (profile.length === 1) return "localized";
  return opposedDirections(profile) ? "split" : "whole_corner";
}

function balanceSignFromProfile(
  profile: PhaseProfileEntryV1[],
  anyPhaseRated: boolean
): ProblemStatementV1["balanceSign"] {
  // Every rated phase sat at 0 — that is a neutral car, not an understeering one. The old
  // count-based version fell through its `us >= os` branch on 0/0 and returned "understeer".
  if (profile.length === 0) return anyPhaseRated ? "neutral" : "unknown";
  if (opposedDirections(profile)) return "mixed";
  return profile[0]!.direction === "oversteer" ? "oversteer" : "understeer";
}

/**
 * The end owning the LEAD phase. A `split` reports `both` rather than the old `unknown`:
 * both ends are genuinely in play, and `unknown` read as "no idea" at exactly the moment
 * we know most precisely which end owns which phase.
 */
function inferEnd(
  profile: PhaseProfileEntryV1[],
  shape: ProblemShape
): ProblemStatementV1["end"] {
  if (shape === "split") return "both";
  return profile[0]?.end ?? "unknown";
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

/**
 * `diagnosisConfidence` REMOVED 2026-08-04. It scored certainty by looking for reasons to
 * doubt — a tyre change, a track change, too many keys moved, pace disagreeing with feel —
 * and returned "high" when it found none. A driver with no history has none of them
 * *because he has no history*, so the app was most confident about the drivers it knew
 * least, and the narration prompt then read that as licence not to hedge.
 *
 * Nothing replaces it as a grade. `reasoningSpine.comparableRuns` carries the nearest run
 * on file and how close it is on tyre, grip and layout, in plain words, and the model
 * calibrates off that. Founder: "we should give it some sentences in human wording that it
 * can interpret so it knows when to be confident vs not."
 */
export function buildProblemStatementV1(input: {
  engineeringRead: EngineeringReadV1;
  userMessage: string;
}): ProblemStatementV1 {
  const read = input.engineeringRead;

  const phaseProfile = buildPhaseProfile(read);
  const shape = shapeFromProfile(phaseProfile);
  const anyPhaseRated = (["entry", "mid", "exit"] as const).some(
    (p) => read.feelRead.phaseBalance[p].value != null
  );

  return {
    version: 1,
    /**
     * Keyword intent matching DROPPED 2026-08-04 (founder: "intent match is terrible —
     * 5.6 terra should be more than strong enough to interpret what the driver means").
     * These were filled by matching the message against a hand-written phrase list, which
     * "fix my car" and most real phrasings missed entirely. The `end` override was worse
     * than useless: it let the word "rear" appearing anywhere in the message outrank the
     * phase ratings the driver actually gave us.
     */
    goalOutcome: null,
    goalDirection: null,
    matchedPhrase: null,
    end: inferEnd(phaseProfile, shape),
    phase: phaseProfile[0]?.phase ?? "unknown",
    phaseProfile,
    shape,
    // Lead phase's own magnitude. No flagged phase means no measured severity — the
    // vs-last-run chip is a different axis and must not stand in for this one.
    severity: phaseProfile[0]?.severity ?? "unknown",
    balanceSign: balanceSignFromProfile(phaseProfile, anyPhaseRated),
    paceFeelAgreement: read.paceRead.paceFeelAgreement,
    confounders: buildConfounders(read),
    recommendationMode: read.recommendationStrategy.mode,
  };
}
