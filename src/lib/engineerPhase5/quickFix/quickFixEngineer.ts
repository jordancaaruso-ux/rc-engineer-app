import "server-only";

import { getOpenAiApiKey } from "@/lib/openaiServerEnv";
import {
  computeOpenAiRetryDelayMs,
  engineerOpenAiUserMessage,
  isOpenAiTpmRateLimitError,
  maxOpenAiRateLimitAttempts,
  parseOpenAiRetryAfterMs,
  sleepMs,
} from "@/lib/openAiRetry";
import { buildQuickFixLlmContext } from "@/lib/engineerPhase5/quickFix/buildQuickFixContext";
import {
  loadQuickFixRunForViewer,
  quickFixRunLabel,
} from "@/lib/engineerPhase5/quickFix/quickFixRunAccess";
import {
  magnitudeTierFromCarRating,
  magnitudeTierLabel,
} from "@/lib/engineerPhase5/quickFix/quickFixMagnitude";
import { parseQuickFixLlmShape, trimQuickFixStr } from "@/lib/engineerPhase5/quickFix/parseQuickFixLlmShape";
import type { QuickFixPayloadV1, QuickFixSuggestionV1 } from "@/lib/engineerPhase5/quickFix/quickFixTypes";

function getModel(): string {
  return (
    process.env.ENGINEER_QUICK_FIX_MODEL?.trim() ||
    process.env.ENGINEER_DASHBOARD_SUGGESTIONS_MODEL?.trim() ||
    "gpt-4o-mini"
  );
}

function modelSupportsCustomTemperature(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (m.startsWith("gpt-5")) return false;
  if (/^o[0-9]/.test(m)) return false;
  return true;
}

function buildDigDeeperPrompt(params: {
  runLabel: string;
  carRating: number | null;
  inferredIssue: string | null;
  suggestions: QuickFixSuggestionV1[];
}): string {
  const ratingBit =
    typeof params.carRating === "number" ? `Car rated ${Math.round(params.carRating)}/10.` : "";
  const issueBit = params.inferredIssue ? `Main issue: ${params.inferredIssue}.` : "";
  const moves =
    params.suggestions.length > 0
      ? `Quick-fix moves I saw: ${params.suggestions
          .slice(0, 4)
          .map((s) => `${s.parameter} — ${s.direction} (${s.amount})`)
          .join("; ")}.`
      : "";
  return [
    `Dig deeper on quick-fix suggestions for ${params.runLabel}.`,
    ratingBit,
    issueBit,
    moves,
    "Walk me through tradeoffs, what to verify on track first, and whether community spread supports each move.",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildEngineerHref(runId: string, prompt: string): string {
  const sp = new URLSearchParams({ runId, prompt });
  return `/engineer?${sp.toString()}`;
}

function buildFallbackSuggestions(ctx: Awaited<ReturnType<typeof buildQuickFixLlmContext>>): QuickFixSuggestionV1[] {
  const lines = ctx.engineeringBrainPromptLines.slice(0, 3);
  if (lines.length === 0) {
    return [
      {
        parameter: "Next session",
        direction: "Verify repeatability",
        amount: "One more run on this setup",
        kbWhy: "Thin logged context — confirm the symptom before larger setup moves.",
        confidence: "low",
        expectedEffect: "Clearer read on whether a change is needed.",
        priority: 1,
      },
    ];
  }
  return lines.map((line, i) => ({
    parameter: "Engineering read",
    direction: "Follow deterministic diagnosis",
    amount: "See note",
    kbWhy: line,
    confidence: "medium" as const,
    expectedEffect: "Aligns with your saved handling + pace signals.",
    priority: i + 1,
  }));
}

async function callQuickFixLlm(ctx: Awaited<ReturnType<typeof buildQuickFixLlmContext>>): Promise<{
  inferredIssue?: string;
  suggestions?: Array<Record<string, unknown>>;
  thinContextNote?: string;
} | null> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return null;

  const model = getModel();
  const tier = magnitudeTierFromCarRating(ctx.carRating);
  const kbText = ctx.kbSnippets.map((s) => `### ${s.title}\n${s.excerpt}`).join("\n\n").slice(0, 7000);

  const system = `You are an RC touring car engineer assistant. Output ONLY valid JSON (no markdown).
JSON shape:
{
  "inferredIssue": string | null,
  "thinContextNote": string,
  "suggestions": [
    {
      "parameter": string,
      "direction": string,
      "amount": string,
      "kbWhy": string,
      "confidence": "high" | "medium" | "low",
      "expectedEffect": string,
      "priority": number
    }
  ]
}

Rules:
- Tone each suggestion as an imperative: "Do this — should help X".
- KB excerpts and parameter-effect catalog conventions ONLY — never invent physics.
- ${ctx.magnitudeTierLine} Match move size to that tier (${magnitudeTierLabel(tier)}).
- ${ctx.communityBoldness}
- Infer the main issue from per-phase balance and car rating; put a one-line summary in inferredIssue.
- engineering brain lines are authoritative diagnosis — explain them, do not contradict.
- authoritativeSetupDiff is the only source for which chassis keys changed vs prior run.
- allowedChassisKeys: only recommend specific chassis hardware whose key is in that array. If empty, give session verification / logging advice — no invented shim/spring moves.
- Still propose suggestions when multiple chassis keys changed last run — prioritize by symptom fit.
- Include as many suggestions as the data supports (1–6 typical).
- kbWhy must cite KB mechanism in plain language (no fake file names).
- When thinContext is true, set thinContextNote asking the driver to add handling ratings/notes next time.
- Scope: ${ctx.scopeLine}`;

  const user = `thinContext: ${ctx.thinContext}
magnitude: ${ctx.magnitudeTierLine}
inferredIssue (deterministic hint): ${ctx.inferredIssue ?? "none"}
recommendation: mode=${ctx.recommendationMode ?? "unknown"}, strength=${ctx.recommendationStrength ?? "soft"}

Engineering brain:
${ctx.engineeringBrainPromptLines.slice(0, 10).join("\n") || "(none)"}

KB physics:
${ctx.kbPhysicsPromptLines.join("\n") || "(none)"}

KB excerpts:
${kbText || "(none)"}

Handling + notes:
${ctx.handlingText}

Suggested/applied text:
Suggested: ${(ctx.suggestedChanges ?? "").slice(0, 800)}
Applied: ${(ctx.appliedChanges ?? "").slice(0, 800)}

authoritativeSetupDiff:
${JSON.stringify(ctx.setupDiffChanged).slice(0, 5000)}

allowedChassisKeys:
${JSON.stringify(ctx.allowedChassisKeys.slice(0, 40))}

Setup vs community (slim):
${JSON.stringify(ctx.spreadSlim).slice(0, 6000)}`;

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

  const maxAttempts = maxOpenAiRateLimitAttempts();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      if (isOpenAiTpmRateLimitError(data, res.status) && attempt < maxAttempts - 1) {
        await sleepMs(computeOpenAiRetryDelayMs(parseOpenAiRetryAfterMs(data), attempt));
        continue;
      }
      const msg = engineerOpenAiUserMessage(
        (data.error as { message?: string } | undefined)?.message ?? "Quick fix failed"
      );
      throw new Error(msg);
    }
    const text = (data.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content?.trim();
    if (!text) return null;
    try {
      return JSON.parse(text) as {
        inferredIssue?: string;
        suggestions?: Array<Record<string, unknown>>;
        thinContextNote?: string;
      };
    } catch {
      return null;
    }
  }
  throw new Error(engineerOpenAiUserMessage("Rate limit exceeded"));
}

export async function generateQuickFixPayload(
  viewerId: string,
  runId: string
): Promise<QuickFixPayloadV1 | null> {
  const loaded = await loadQuickFixRunForViewer(viewerId, runId);
  if (!loaded) return null;

  const { run, contextUserId } = loaded;
  const scopeLine = quickFixRunLabel(run);
  const ctx = await buildQuickFixLlmContext({ contextUserId, run, scopeLine });

  const llm = await callQuickFixLlm(ctx);

  let suggestions = llm ? parseQuickFixLlmShape(llm) : [];
  if (suggestions.length === 0) suggestions = buildFallbackSuggestions(ctx);

  const inferredIssue = trimQuickFixStr(llm?.inferredIssue, 200) || ctx.inferredIssue;
  const tier = magnitudeTierFromCarRating(ctx.carRating);
  const thinContextNote =
    trimQuickFixStr(llm?.thinContextNote, 300) ||
    (ctx.thinContext
      ? "Add a car rating and per-corner handling chips next run so quick-fix can size moves better."
      : "Grounded in your saved run, setup vs community, and KB excerpts.");

  const digDeeperPrompt = buildDigDeeperPrompt({
    runLabel: scopeLine,
    carRating: ctx.carRating,
    inferredIssue,
    suggestions,
  });

  return {
    version: 1,
    generatedAtIso: new Date().toISOString(),
    runId: run.id,
    runLabel: scopeLine,
    magnitudeTier: tier,
    magnitudeNote: ctx.magnitudeTierLine,
    inferredIssue,
    suggestions,
    thinContextNote,
    digDeeperPrompt,
    engineerHref: buildEngineerHref(run.id, digDeeperPrompt),
  };
}
