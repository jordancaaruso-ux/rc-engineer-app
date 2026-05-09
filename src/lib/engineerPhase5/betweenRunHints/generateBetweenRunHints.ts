import "server-only";

import { getOpenAiApiKey } from "@/lib/openaiServerEnv";
import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import type {
  BetweenRunHintPayloadV2,
  BetweenRunHintScopeV1,
  BetweenRunHintSignal,
  BetweenRunRecentSessionSnapshotV1,
} from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";
import type { VehicleDynamicsKbSnippet } from "@/lib/engineerPhase5/vehicleDynamicsKb";
import type { PatternDigestV1 } from "@/lib/engineerPhase5/patternDigestTypes";

function getHintsModel(): string {
  return process.env.ENGINEER_BETWEEN_RUN_HINTS_MODEL?.trim() || "gpt-4o-mini";
}

function modelSupportsCustomTemperature(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (m.startsWith("gpt-5")) return false;
  if (/^o[0-9]/.test(m)) return false;
  return true;
}

export function buildKbQueryForBetweenRunHints(params: {
  summary: EngineerRunSummaryV2;
  handlingProblems: string | null;
}): string {
  const keys = params.summary.setupChanges.map((r) => r.key).slice(0, 12);
  const labels = params.summary.setupChanges.map((r) => r.label).slice(0, 8);
  const feelBits = [params.handlingProblems?.trim() ?? ""].filter(Boolean);
  return [
    ...keys,
    ...labels,
    "RC touring car setup",
    params.summary.lapOutcome.best.flag === "regressed" ? "lap time slower tuning" : "",
    params.summary.lapOutcome.avgTop5.flag === "regressed" ? "pace consistency" : "",
    ...feelBits,
  ]
    .filter(Boolean)
    .join(" ");
}

type LlmShape = {
  headline?: string;
  bullets?: string[];
  avoidRepeating?: string | null;
};

function safeTrimArray(arr: unknown, max: number, maxLen: number): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const item of arr.slice(0, max)) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (!t) continue;
    out.push(t.length > maxLen ? `${t.slice(0, maxLen - 1)}…` : t);
  }
  return out;
}

function buildFallbackCopy(params: {
  summary: EngineerRunSummaryV2;
  signals: BetweenRunHintSignal[];
}): LlmShape {
  const interp = params.summary.interpretation.trim();
  const bullets: string[] = [];
  if (interp) {
    const parts = interp.split(/(?<=[.!?])\s+/).filter(Boolean);
    for (const p of parts.slice(0, 3)) {
      if (p.length > 12) bullets.push(p.trim());
      if (bullets.length >= 3) break;
    }
  }
  if (bullets.length === 0) {
    bullets.push("Compare this run to your previous session on the Engineer page for lap and setup detail.");
  }
  let avoid: string | null = null;
  if (
    params.signals.includes("lap_regressed") &&
    params.signals.includes("meaningful_setup_change")
  ) {
    avoid =
      "Avoid stacking more changes in the same direction as the last session until you confirm pace; consider reverting part of the last change set and retest.";
  } else if (params.signals.includes("feel_worse") && params.signals.includes("meaningful_setup_change")) {
    avoid =
      "If the car felt worse after those adjustments, consider walking back the largest setup move for the next outing and change one item at a time.";
  }
  let headline = params.signals.includes("lap_regressed")
    ? "Pace dropped vs your previous session on this car."
    : "Review last session vs prior before stacking more changes.";
  if (interp) {
    const firstSentence = interp.split(/(?<=[.!?])\s+/)[0]?.trim();
    if (firstSentence && firstSentence.length <= 140) headline = firstSentence;
  }

  return {
    headline,
    bullets: bullets.slice(0, 4),
    avoidRepeating: avoid,
  };
}

async function callLlmBetweenRunHints(params: {
  scopeLine: string;
  signals: BetweenRunHintSignal[];
  summary: EngineerRunSummaryV2;
  patternDigest: PatternDigestV1 | null;
  kbSnippets: VehicleDynamicsKbSnippet[];
  recentSessions: BetweenRunRecentSessionSnapshotV1[];
  driverContextPack: { combinedNotesAndHandling: string; currentSetupLines: string[] };
}): Promise<LlmShape | null> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return null;

  const model = getHintsModel();
  const digestNote = params.patternDigest
    ? JSON.stringify({
        filters: params.patternDigest.filters,
        runTail: params.patternDigest.runs.slice(-6).map((r) => ({
          runId: r.runId,
          best: r.lapSummary.bestLapSeconds,
          keys: r.setupKeysChangedFromPrevious,
          notes: r.notesPreview,
        })),
      }).slice(0, 6500)
    : "null";

  const kbText = params.kbSnippets
    .map((s) => `### ${s.title}\n${s.excerpt.slice(0, 1200)}`)
    .join("\n\n")
    .slice(0, 8000);

  const summaryJson = JSON.stringify({
    lapOutcome: params.summary.lapOutcome,
    setupChanges: params.summary.setupChanges,
    interpretation: params.summary.interpretation,
    softPriors: params.summary.softPriors.slice(0, 8),
    referenceLabel: params.summary.referenceLabel,
  }).slice(0, 6000);

  const recentJson = JSON.stringify(params.recentSessions).slice(0, 8000);
  const driverCtxJson = JSON.stringify({
    combinedNotesAndHandling: params.driverContextPack.combinedNotesAndHandling,
    currentSetupLines: params.driverContextPack.currentSetupLines.slice(0, 30),
  }).slice(0, 4000);

  const system = `You are an RC touring car engineer assistant. Output ONLY valid JSON (no markdown).
The JSON object must have exactly these keys:
- "headline": string, under 120 chars, actionable setup guidance (not generic motivation)
- "bullets": array of 2 to 4 short strings (each under 220 chars), concrete suggestions or test plans
- "avoidRepeating": string or null — when lap metrics regressed OR driver feel worsened AND there were setup changes since the reference run, give ONE short line about not repeating the same direction of changes until verified; when a regression lines up with a specific documented setup move across recentSessions, you may name reverting that move; otherwise null

Rules:
- You receive up to three recentSessions objects in chronological order **newest first** (index 0 = latest run). Each includes best lap, avg top 5, avg top 10 (when lap counts allow), vs-prior flags when a reference exists, optional paceVsFieldSummary / paceVsFieldMetrics from imported timing, setupChangesFromPrevious, notesPreview, handlingPreview.
- Use recentSessions together with driverContextPack (notes/handling + currentSetupLines) to propose **positive** setup experiments OR **explicit revert** ideas when lap flags (best or multi-lap) are regressed and setupChangesFromPrevious plausibly correlate.
- Ground technical claims ONLY in the provided KB excerpts and the structured JSON (summary, recentSessions, driverContextPack). If unsure, hedge with "test" / "verify".
- Do not invent exact setup numbers not present in the JSON.
- Prefer one-change-at-a-time discipline when recommending reversals.
- Scope context: ${params.scopeLine}
- Signals (machine tags): ${params.signals.join(", ")}`;

  const user = `KB excerpts:\n${kbText || "(none)"}\n\nPattern digest tail:\n${digestNote}\n\nEngineer summary JSON (latest vs its immediate reference):\n${summaryJson}\n\nRecent sessions (newest first, up to 3):\n${recentJson}\n\nDriver context pack:\n${driverCtxJson}`;

  const body: Record<string, unknown> = {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (modelSupportsCustomTemperature(model)) {
    body.temperature = 0.35;
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return null;
  const text = (data.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content?.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as LlmShape;
  } catch {
    return null;
  }
}

function buildScopeLine(scope: BetweenRunHintScopeV1): string {
  const parts: string[] = [scope.carLabel];
  if (scope.trackLabel) parts.push(scope.trackLabel);
  if (scope.eventLabel) parts.push(scope.eventLabel);
  return parts.join(" · ");
}

function buildSourcesNote(params: {
  scope: BetweenRunHintScopeV1;
  referenceLabel: string | null;
}): string {
  const scopeBits = [params.scope.carLabel];
  if (params.scope.trackLabel) scopeBits.push(params.scope.trackLabel);
  if (params.scope.eventLabel) scopeBits.push(params.scope.eventLabel);
  const ref = params.referenceLabel?.trim() || "previous session on this car";
  return `Based on your latest run versus ${ref}. Context: ${scopeBits.join(" · ")}.`;
}

export async function assembleBetweenRunHintPayload(params: {
  scope: BetweenRunHintScopeV1;
  summary: EngineerRunSummaryV2;
  signals: BetweenRunHintSignal[];
  patternDigest: PatternDigestV1 | null;
  kbSnippets: VehicleDynamicsKbSnippet[];
  referenceLabel: string | null;
  recentSessions: BetweenRunRecentSessionSnapshotV1[];
  driverContextPack: { combinedNotesAndHandling: string; currentSetupLines: string[] };
}): Promise<BetweenRunHintPayloadV2> {
  const engineerHref =
    params.summary.referenceRunId != null
      ? `/engineer?${new URLSearchParams({
          runId: params.summary.currentRunId,
          compareRunId: params.summary.referenceRunId,
        }).toString()}`
      : `/engineer?${new URLSearchParams({ runId: params.summary.currentRunId }).toString()}`;

  const scopeLine = buildScopeLine(params.scope);
  const fromLlm = await callLlmBetweenRunHints({
    scopeLine,
    signals: params.signals,
    summary: params.summary,
    patternDigest: params.patternDigest,
    kbSnippets: params.kbSnippets,
    recentSessions: params.recentSessions,
    driverContextPack: params.driverContextPack,
  });
  const fb = buildFallbackCopy({ summary: params.summary, signals: params.signals });
  const llm = fromLlm ?? fb;

  const interp = params.summary.interpretation.trim();
  let headline =
    typeof llm.headline === "string" && llm.headline.trim()
      ? llm.headline.trim().slice(0, 200)
      : params.signals.includes("lap_regressed")
        ? "Pace dropped vs your previous session on this car."
        : "Review last session vs prior before stacking more changes.";
  if (interp && (!fromLlm || !fromLlm.headline?.trim())) {
    const firstSentence = interp.split(/(?<=[.!?])\s+/)[0]?.trim();
    if (firstSentence && firstSentence.length <= 140) headline = firstSentence;
  }

  let bullets = safeTrimArray(llm.bullets, 4, 220);
  if (bullets.length < 2) {
    bullets = safeTrimArray(fb.bullets, 4, 220);
  }

  let avoidRepeating: string | null =
    typeof llm.avoidRepeating === "string" && llm.avoidRepeating.trim() ? llm.avoidRepeating.trim().slice(0, 400) : null;
  if (!avoidRepeating && fb.avoidRepeating) avoidRepeating = fb.avoidRepeating;

  return {
    version: 2,
    scope: params.scope,
    basedOnRunIds: {
      primary: params.summary.currentRunId,
      reference: params.summary.referenceRunId,
    },
    signals: params.signals,
    headline,
    bullets: bullets.slice(0, 4),
    avoidRepeating,
    sourcesNote: buildSourcesNote({ scope: params.scope, referenceLabel: params.referenceLabel }),
    engineerHref,
    recentSessions: params.recentSessions,
    driverContextPack: params.driverContextPack,
  };
}
