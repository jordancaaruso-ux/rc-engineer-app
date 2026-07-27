/**
 * Coherence gate — only internally-consistent scenarios reach Jordan's eyes.
 *
 * The bar is INTERNAL CONSISTENCY, not real telemetry: the complaint has to fit the setup,
 * conditions and history shown. An incoherent bundle would produce a bad answer for reasons
 * that aren't the engine's fault, and we'd log a phantom flaw.
 *
 * IMPORTANT: sparse is NOT incoherent. A minimalist with no handling data and no rating is a
 * real user, and thin-data behaviour is exactly what's being hunted — the rules below must
 * never reject a scenario merely for being empty.
 */
import type { Scenario } from "./types";
import { llmChat, parseJsonLoose } from "./provider/llmChat";
import type { LlmProviderId } from "./provider/resolveProvider";

export type CoherenceResult = {
  verdict: "pass" | "fail";
  reason: string;
  checkedBy: string;
};

/** Cheap structural checks. Catch impossible worlds, never punish sparse ones. */
export function checkRules(scn: Scenario): CoherenceResult | null {
  const w = scn.world;
  if (!w.runs.length) return { verdict: "fail", reason: "no runs in world", checkedBy: "rules" };
  if (w.focusRunIndex < 0 || w.focusRunIndex >= w.runs.length) {
    return { verdict: "fail", reason: "focusRunIndex out of range", checkedBy: "rules" };
  }
  if (!scn.question.trim()) return { verdict: "fail", reason: "empty question", checkedBy: "rules" };

  for (const [i, r] of w.runs.entries()) {
    if (!r.setupData || Object.keys(r.setupData).length === 0) {
      return { verdict: "fail", reason: `run ${i} has no setup data`, checkedBy: "rules" };
    }
    const laps = r.lapTimes ?? [];
    if (laps.some((l) => !Number.isFinite(l) || l <= 0 || l > 120)) {
      return { verdict: "fail", reason: `run ${i} has implausible lap times`, checkedBy: "rules" };
    }
    if (laps.length && r.bestLapSeconds != null && r.bestLapSeconds < Math.min(...laps) - 0.001) {
      return { verdict: "fail", reason: `run ${i} bestLap is below its own fastest lap`, checkedBy: "rules" };
    }
    if (r.carRating != null && (r.carRating < 1 || r.carRating > 10)) {
      return { verdict: "fail", reason: `run ${i} carRating out of range`, checkedBy: "rules" };
    }
    if (r.tireRunNumber != null && r.tireRunNumber < 1) {
      return { verdict: "fail", reason: `run ${i} tireRunNumber < 1`, checkedBy: "rules" };
    }
  }

  // A "debrief across the day" question needs a day to debrief.
  if (scn.axes?.questionShape === "debrief" && w.runs.length < 3) {
    return { verdict: "fail", reason: "debrief question but fewer than 3 runs logged", checkedBy: "rules" };
  }
  // Lap-time-dependent conflict needs lap times.
  if (scn.axes?.dataConflict === "felt-worse-but-faster" && !(w.runs[w.focusRunIndex]?.lapTimes?.length)) {
    return { verdict: "fail", reason: "feel-vs-data conflict but no lap times logged", checkedBy: "rules" };
  }
  return null; // no rule violated — defer to the LLM check
}

/** One cheap LLM read: would a real racer describe this car this way in this situation? */
export async function checkWithLlm(
  scn: Scenario,
  opts: { provider: LlmProviderId; model: string }
): Promise<CoherenceResult> {
  const focus = scn.world.runs[scn.world.focusRunIndex];
  const system = [
    "You check whether an RC touring-car race scenario is INTERNALLY CONSISTENT.",
    "Consistent = the driver's complaint and question plausibly fit the conditions, tire age, history and session shown.",
    "IMPORTANT: missing data is NOT inconsistent. Many real users log almost nothing — no handling detail, no rating, no notes, no lap times. Never fail a scenario for being sparse.",
    "Fail ONLY for genuine contradictions (e.g. complains about something impossible in the situation, or asks about a whole day when only one run exists).",
    'Return ONLY JSON: {"verdict":"pass"|"fail","reason":"one short sentence"}',
  ].join("\n");

  const user = JSON.stringify({
    question: scn.question,
    complaint: focus?.handlingProblems ?? null,
    hasStructuredHandling: Boolean(focus?.handlingAssessmentJson),
    hasLapTimes: (focus?.lapTimes?.length ?? 0) > 0,
    carRating: focus?.carRating ?? null,
    runsLogged: scn.world.runs.length,
    grip: scn.axes?.gripLevel,
    airTempC: focus?.conditionsAirTempC ?? null,
    trackTempC: focus?.conditionsTrackTempC ?? null,
    tireRunNumber: focus?.tireRunNumber ?? null,
    sessionType: focus?.sessionType,
    symptom: scn.axes?.problemType,
  });

  try {
    const res = await llmChat({
      provider: opts.provider,
      model: opts.model,
      temperature: 0,
      responseFormatJson: true,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const parsed = parseJsonLoose<{ verdict?: string; reason?: string }>(res.content);
    if (parsed?.verdict === "fail") {
      return { verdict: "fail", reason: parsed.reason ?? "model judged incoherent", checkedBy: opts.model };
    }
    return { verdict: "pass", reason: parsed?.reason ?? "coherent", checkedBy: opts.model };
  } catch (err) {
    // Never lose a scenario to a transport error — rules already passed it.
    return {
      verdict: "pass",
      reason: `llm check unavailable (${err instanceof Error ? err.message : String(err)})`,
      checkedBy: "rules-only",
    };
  }
}

export async function gateScenario(
  scn: Scenario,
  opts: { provider: LlmProviderId; model: string; skipLlm?: boolean }
): Promise<CoherenceResult> {
  const ruleFail = checkRules(scn);
  if (ruleFail) return ruleFail;
  if (opts.skipLlm) return { verdict: "pass", reason: "rules only", checkedBy: "rules" };
  return checkWithLlm(scn, opts);
}
