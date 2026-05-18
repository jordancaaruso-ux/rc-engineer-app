/**
 * The shared "engineering brain" packet.
 *
 * Wraps the deterministic `engineeringRead`, the rating-driven known-good / known-bad
 * memory, and the mechanism analogies that explain how proposed changes relate to
 * past changes. Both the Dashboard "Suggested next steps" tile and "Ask the Engineer"
 * receive the same packet — they only differ in how much depth they expose to the
 * end user.
 */
import "server-only";

import {
  buildEngineeringReadForCarRun,
  buildEngineeringReadForRun,
} from "@/lib/engineerPhase5/engineeringReadFromDb";
import { buildKnownGoodMemoryV1 } from "@/lib/engineerPhase5/knownGoodMemory";
import {
  describeMechanismChange,
  matchProposedChangeToHistory,
  type SetupMechanismChangeDescriptor,
  type SetupMechanismChangeReport,
  type MechanismMatch,
} from "@/lib/engineerPhase5/setupMechanismMap";
import type { EngineeringReadV1 } from "@/lib/engineerPhase5/engineeringRead";
import type { KnownGoodMemoryV1 } from "@/lib/engineerPhase5/knownGoodMemory";

export type EngineeringBrainMechanismAnalogy = {
  proposed: SetupMechanismChangeDescriptor;
  historical: SetupMechanismChangeDescriptor;
  match: MechanismMatch;
};

export type EngineeringBrainV1 = {
  version: 1;
  generatedAtIso: string;
  engineeringRead: EngineeringReadV1;
  knownGoodMemory: KnownGoodMemoryV1 | null;
  /** Mechanism reports for the chassis changes between current and reference run. */
  recentChangeMechanisms: SetupMechanismChangeReport[];
  /**
   * Mechanism analogies pairing each historical change (since a known-good reference) with
   * the most recent changes — so the LLM can say "this move acts on the same mechanism
   * as the one that helped previously" without inventing the link.
   */
  mechanismAnalogiesVsKnownGood: EngineeringBrainMechanismAnalogy[];
  /** Compact prompt lines the LLM can quote. */
  promptLines: string[];
  /** Deterministic fingerprint for caching downstream payloads. */
  fingerprint: string;
};

function buildPromptLines(input: {
  read: EngineeringReadV1;
  knownGood: KnownGoodMemoryV1 | null;
  mechanismAnalogies: EngineeringBrainMechanismAnalogy[];
  recentChangeMechanisms: SetupMechanismChangeReport[];
}): string[] {
  const lines: string[] = [];

  // Run quality
  lines.push(`Run quality: ${input.read.runQuality.summary}`);

  // Feel
  const feel = input.read.feelRead;
  if (feel.betterWorse.direction !== "unknown") {
    lines.push(
      `Feel vs last run chip: ${feel.betterWorse.direction}${feel.betterWorse.magnitudeWord ? ` (${feel.betterWorse.magnitudeWord})` : ""}.`
    );
  }
  const phaseLines: string[] = [];
  for (const phase of ["entry", "mid", "exit"] as const) {
    const p = feel.phaseBalance[phase];
    if (p.value == null) continue;
    const directionWord = p.direction.replace("_", " ");
    const neutralNote =
      p.movedTowardNeutral === true
        ? "moved toward neutral"
        : p.movedTowardNeutral === false
          ? "moved away from neutral"
          : null;
    phaseLines.push(`${phase}: ${directionWord} (${p.value})${neutralNote ? ` (${neutralNote})` : ""}`);
  }
  if (phaseLines.length > 0) lines.push(`Phase balance — ${phaseLines.join("; ")}.`);

  // Pace
  lines.push(`Pace shape: ${input.read.paceRead.interpretation}.`);
  if (input.read.paceRead.paceFeelAgreement === "disagree") {
    lines.push("Pace and driver feel disagree — explicitly surface that conflict; do not hide it.");
  }

  // Change attribution
  const change = input.read.changeRead;
  if (change.tireChangeSignificance === "compound_change") {
    lines.push(
      "Tyres: compound / product line changed vs reference — dominant variable; chassis advice is secondary until tyres are understood."
    );
  } else if (change.tireChangeSignificance === "new_set_same_compound") {
    lines.push(
      "Tyres: same compound on a different physical set vs reference — expect some grip shift; do not narrate like a compound swap."
    );
  } else if (change.tireChangeSignificance === "wear_index_only") {
    lines.push(
      "Tyres: same set stepped to a new tyre-run index — wear/scrub progression only; do not treat like a compound change."
    );
  }
  if (change.chassisChangedKeyCount > 0) {
    const sample = change.chassisChangedKeys.slice(0, 4).map((k) => k.label).join(", ");
    lines.push(
      `Chassis changes since reference: ${change.chassisChangedKeyCount} key${change.chassisChangedKeyCount === 1 ? "" : "s"}${sample ? ` (${sample}${change.chassisChangedKeys.length > 4 ? ", …" : ""})` : ""}.`
    );
  }
  if (input.recentChangeMechanisms.length > 0) {
    const summaries = input.recentChangeMechanisms
      .flatMap((r) => r.perMechanism.map((m) => `${r.key} → ${m.description}`))
      .slice(0, 5);
    if (summaries.length) lines.push(`Mechanism reads: ${summaries.join("; ")}.`);
  }

  // Hypotheses
  for (const h of input.read.hypotheses.slice(0, 2)) {
    lines.push(`Hypothesis (${h.confidence}): ${h.cause.replace("_", " ")} — ${h.reasons.join(" ")}`);
  }

  // Strategy
  const s = input.read.recommendationStrategy;
  lines.push(
    `Strategy: ${s.mode} (${s.strength}). Advice: ${s.primaryAdvice}${s.fallbackIfWrong ? ` Fallback: ${s.fallbackIfWrong}` : ""}`
  );

  // Known good / bad references
  if (input.knownGood) {
    lines.push(`Rating trend (recent runs on this car): ${input.knownGood.ratingTrend}.`);
    for (const ref of input.knownGood.bestReferences.slice(0, 2)) {
      lines.push(`Known-good reference: ${ref.summary}`);
    }
    for (const ref of input.knownGood.worstReferences.slice(0, 1)) {
      lines.push(`Known-bad reference: ${ref.summary}`);
    }
  }

  // Mechanism analogies
  for (const a of input.mechanismAnalogies.slice(0, 3)) {
    lines.push(
      `Mechanism analogy: proposed/recent change on ${a.proposed.key} vs historical change on ${a.historical.key} — ${a.match.reason}`
    );
  }

  return lines;
}

function fingerprintBrain(input: {
  read: EngineeringReadV1;
  knownGood: KnownGoodMemoryV1 | null;
  mechanismAnalogies: EngineeringBrainMechanismAnalogy[];
}): string {
  const material = JSON.stringify({
    v: 1,
    readFp: input.read.fingerprint,
    knownGood: input.knownGood
      ? {
          best: input.knownGood.bestReferences.map((r) => r.runId).slice(0, 3),
          worst: input.knownGood.worstReferences.map((r) => r.runId).slice(0, 3),
          trend: input.knownGood.ratingTrend,
        }
      : null,
    analogies: input.mechanismAnalogies.map((a) => ({
      p: a.proposed.key,
      h: a.historical.key,
      m: a.match.mechanism,
      t: a.match.tier,
      e: a.match.effect,
    })),
  });
  // Use Node's crypto via a small inline import would normally be ideal, but to keep
  // this module isomorphic-friendly we use a simple FNV-style hash over the material
  // string. Engineers care about stable invalidation, not cryptographic strength here.
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < material.length; i++) {
    hash = (hash ^ BigInt(material.charCodeAt(i))) * 0x100000001b3n;
    hash &= 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

export type BuildEngineeringBrainOptions = {
  userId: string;
  carId: string;
  anchorRunId: string;
  /** Optional explicit reference run (e.g. when comparing two runs in the Engineer UI). */
  referenceRunId?: string | null;
};

export async function buildEngineeringBrainV1(
  opts: BuildEngineeringBrainOptions
): Promise<EngineeringBrainV1 | null> {
  const read = await buildEngineeringReadForCarRun({
    userId: opts.userId,
    carId: opts.carId,
    anchorRunId: opts.anchorRunId,
    referenceRunId: opts.referenceRunId,
  });
  if (!read) return null;

  const knownGood = await buildKnownGoodMemoryV1({
    userId: opts.userId,
    carId: opts.carId,
    anchorRunId: opts.anchorRunId,
  }).catch(() => null);

  const recentChangeMechanisms = read.changeRead.chassisChangedKeys.map((c) =>
    describeMechanismChange({ key: c.key, before: c.before, after: c.after })
  );

  const mechanismAnalogiesVsKnownGood: EngineeringBrainMechanismAnalogy[] = [];
  if (knownGood) {
    const historicalCandidates = knownGood.bestReferences
      .flatMap((ref) => ref.changedSinceKeys.map((row) => ({ key: row.key, before: row.previous, after: row.current })));
    for (const recent of read.changeRead.chassisChangedKeys) {
      const proposed: SetupMechanismChangeDescriptor = {
        key: recent.key,
        before: recent.before,
        after: recent.after,
      };
      for (const historical of historicalCandidates) {
        const match = matchProposedChangeToHistory(proposed, historical);
        if (!match) continue;
        mechanismAnalogiesVsKnownGood.push({ proposed, historical, match });
        if (mechanismAnalogiesVsKnownGood.length >= 6) break;
      }
      if (mechanismAnalogiesVsKnownGood.length >= 6) break;
    }
  }

  const promptLines = buildPromptLines({
    read,
    knownGood,
    mechanismAnalogies: mechanismAnalogiesVsKnownGood,
    recentChangeMechanisms,
  });

  return {
    version: 1,
    generatedAtIso: new Date().toISOString(),
    engineeringRead: read,
    knownGoodMemory: knownGood,
    recentChangeMechanisms,
    mechanismAnalogiesVsKnownGood,
    promptLines,
    fingerprint: fingerprintBrain({
      read,
      knownGood,
      mechanismAnalogies: mechanismAnalogiesVsKnownGood,
    }),
  };
}

/** Convenience: build brain without a known carId, falling back to the anchor run's car. */
export async function buildEngineeringBrainFromRun(params: {
  userId: string;
  anchorRunId: string;
  referenceRunId?: string | null;
}): Promise<EngineeringBrainV1 | null> {
  const read = await buildEngineeringReadForRun({
    userId: params.userId,
    anchorRunId: params.anchorRunId,
    referenceRunId: params.referenceRunId,
  });
  if (!read) return null;
  // Anchor run id has been validated as belonging to user; we still need carId for memory.
  // To avoid a second DB hit when caller has carId, we expose the carId-required variant.
  // This convenience returns the brain *without* knownGoodMemory when carId isn't reachable.
  return {
    version: 1,
    generatedAtIso: new Date().toISOString(),
    engineeringRead: read,
    knownGoodMemory: null,
    recentChangeMechanisms: read.changeRead.chassisChangedKeys.map((c) =>
      describeMechanismChange({ key: c.key, before: c.before, after: c.after })
    ),
    mechanismAnalogiesVsKnownGood: [],
    promptLines: buildPromptLines({
      read,
      knownGood: null,
      mechanismAnalogies: [],
      recentChangeMechanisms: read.changeRead.chassisChangedKeys.map((c) =>
        describeMechanismChange({ key: c.key, before: c.before, after: c.after })
      ),
    }),
    fingerprint: fingerprintBrain({
      read,
      knownGood: null,
      mechanismAnalogies: [],
    }),
  };
}
