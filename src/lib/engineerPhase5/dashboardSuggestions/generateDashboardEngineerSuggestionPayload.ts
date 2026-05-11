import "server-only";

import { getOpenAiApiKey } from "@/lib/openaiServerEnv";
import type { VehicleDynamicsKbSnippet } from "@/lib/engineerPhase5/vehicleDynamicsKb";
import type { DashboardEngineerSuggestionPayloadV1 } from "@/lib/engineerPhase5/dashboardSuggestions/dashboardSuggestionTypes";

function getModel(): string {
  return process.env.ENGINEER_DASHBOARD_SUGGESTIONS_MODEL?.trim() || "gpt-4o-mini";
}

function modelSupportsCustomTemperature(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (m.startsWith("gpt-5")) return false;
  if (/^o[0-9]/.test(m)) return false;
  return true;
}

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

type LlmShape = {
  headline?: string;
  bullets?: string[];
  tryNextSession?: string[];
};

function buildFallback(params: { headline: string; bullets: string[] }): DashboardEngineerSuggestionPayloadV1 {
  return {
    version: 1,
    generatedAtIso: new Date().toISOString(),
    primaryRunId: "",
    headline: params.headline,
    bullets: params.bullets.slice(0, 5),
    tryNextSession: ["Open Engineer with this run and your prior session to compare lap + setup detail."],
    sourcesNote:
      "Suggestions use your saved notes, handling checklist, setup vs typical, and prior-run diffs when available.",
    engineerHref: "/engineer",
  };
}

async function callLlm(params: {
  scopeLine: string;
  kbSnippets: VehicleDynamicsKbSnippet[];
  setupDiffChanged: Array<{ key: string; label: string; previous: string | null; current: string }>;
  spreadSlim: Array<Record<string, unknown>>;
  suggestedChanges: string | null;
  appliedChanges: string | null;
  notesPreview: string;
  summaryJson: string | null;
}): Promise<LlmShape | null> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return null;

  const model = getModel();
  const kbText = params.kbSnippets
    .map((s) => `### ${s.title}\n${s.excerpt.slice(0, 1200)}`)
    .join("\n\n")
    .slice(0, 8000);

  const system = `You are an RC touring car engineer assistant. Output ONLY valid JSON (no markdown).
The JSON object must have exactly these keys:
- "headline": string, under 140 chars, actionable for the driver's **next** session
- "bullets": array of 3 to 6 short strings (each under 240 chars). Tie each bullet to: (a) a handling/notes issue they reported, (b) a setup-versus-typical position (below_typical / above_typical / mid), (c) a prior-run setup change when provided, and/or (d) KB excerpts — say which when you use it.
- "tryNextSession": array of 2 to 4 very short checklist strings (each under 120 chars) for what to verify or try first.

Rules:
- Ground claims ONLY in the provided JSON and KB excerpts. If data is missing, say what is missing instead of inventing numbers.
- Respect community position bands: if a parameter is already "below_typical" or "above_typical", do not recommend pushing further in that same extreme direction unless you add an explicit hedge ("only if you still see X on track").
- Prefer one-change-at-a-time when suggesting new setup moves.
- suggestedChanges / appliedChanges are free-text the driver wrote about what they changed or plan to change — treat as intent, not measured truth.
- Scope: ${params.scopeLine}`;

  const user = `KB excerpts:\n${kbText || "(none)"}\n\nNotes + handling (may overlap):\n${params.notesPreview.slice(0, 4000)}\n\nSuggested / applied changes text:\nSuggested: ${(params.suggestedChanges ?? "").slice(0, 1200)}\nApplied: ${(params.appliedChanges ?? "").slice(0, 1200)}\n\nSetup vs prior run (changed rows only):\n${JSON.stringify(params.setupDiffChanged).slice(0, 6000)}\n\nSetup vs community (slim rows):\n${JSON.stringify(params.spreadSlim).slice(0, 8000)}\n\nEngineer summary (optional, latest vs reference when present):\n${params.summaryJson ?? "null"}`;

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

export async function generateDashboardEngineerSuggestionPayload(params: {
  primaryRunId: string;
  scopeLine: string;
  kbSnippets: VehicleDynamicsKbSnippet[];
  setupDiffChanged: Array<{ key: string; label: string; previous: string | null; current: string }>;
  spreadSlim: Array<Record<string, unknown>>;
  suggestedChanges: string | null;
  appliedChanges: string | null;
  notesPreview: string;
  summaryJson: string | null;
  engineerHref: string;
}): Promise<DashboardEngineerSuggestionPayloadV1> {
  const llm = await callLlm({
    scopeLine: params.scopeLine,
    kbSnippets: params.kbSnippets,
    setupDiffChanged: params.setupDiffChanged,
    spreadSlim: params.spreadSlim,
    suggestedChanges: params.suggestedChanges,
    appliedChanges: params.appliedChanges,
    notesPreview: params.notesPreview,
    summaryJson: params.summaryJson,
  });

  const fb = buildFallback({
    headline: "Review handling notes against setup vs typical before the next session.",
    bullets: [
      "Cross-check the parameters you moved last time with how the car felt in notes.",
      "Use Engineer compare when you have a prior run on this car loaded as compare.",
    ],
  });

  const headline =
    typeof llm?.headline === "string" && llm.headline.trim()
      ? llm.headline.trim().slice(0, 200)
      : fb.headline;
  let bullets = safeTrimArray(llm?.bullets, 6, 240);
  if (bullets.length < 2) bullets = fb.bullets;
  let tryNext = safeTrimArray(llm?.tryNextSession, 4, 120);
  if (tryNext.length < 1) tryNext = fb.tryNextSession;

  return {
    version: 1,
    generatedAtIso: new Date().toISOString(),
    primaryRunId: params.primaryRunId,
    headline,
    bullets: bullets.slice(0, 6),
    tryNextSession: tryNext.slice(0, 4),
    sourcesNote: `Grounded in your saved run, setup vs typical for this car${params.setupDiffChanged.length ? ", and diffs vs your prior run on this car" : ""}. KB excerpts are retrieved, not invented.`,
    engineerHref: params.engineerHref,
  };
}
