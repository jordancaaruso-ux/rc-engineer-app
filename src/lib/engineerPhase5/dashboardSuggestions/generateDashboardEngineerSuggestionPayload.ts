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
  allowedChassisKeys: string[];
  tireChangeSignificance: string | null;
  spreadSlim: Array<Record<string, unknown>>;
  suggestedChanges: string | null;
  appliedChanges: string | null;
  notesPreview: string;
  summaryJson: string | null;
  setupOutcomeCaveats: string[];
  engineeringBrainPromptLines: string[];
  recommendationMode: string | null;
  recommendationStrength: string | null;
  preferEngineerChat: boolean;
}): Promise<LlmShape | null> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return null;

  const model = getModel();
  const kbText = params.kbSnippets
    .map((s) => `### ${s.title}\n${s.excerpt.slice(0, 1200)}`)
    .join("\n\n")
    .slice(0, 8000);

  const allowKeysJson = JSON.stringify(params.allowedChassisKeys.slice(0, 40));
  const tireSig = params.tireChangeSignificance ?? "none";

  const system = `You are an RC touring car engineer assistant. Output ONLY valid JSON (no markdown).
The JSON object must have exactly these keys:
- "headline": string, under 140 chars, actionable for the driver's **next** session
- "bullets": array of 3 to 6 short strings (each under 240 chars). Tie each bullet to: (a) a handling/notes issue they reported, (b) a setup-versus-typical position (below_typical / above_typical / mid), (c) a documented pairwise setup change when provided, (d) the engineering-brain read, and/or (e) KB excerpts — say which when you use it.
- "tryNextSession": array of 2 to 4 very short checklist strings (each under 120 chars) for what to verify or try first.

Rules:
- The "engineering brain" lines are the deterministic diagnosis. Treat them as the spine of the response: explain the conclusions in driver-friendly language; do not re-derive them or contradict them from raw notes.
- Driver rating + handling chips outrank free notes. Quote notes only as context.
- **Tyre tiering (tireChangeSignificance):** When it is **compound_change**, tyres are the headline story — isolate tyre effects before chassis tuning. When **new_set_same_compound**, acknowledge fresher rubber but do **not** narrate it like a compound swap. When **wear_index_only** or **none**, do **not** invent a tyre-swap explanation for handling deltas.
- **Measured tuning diff (hard rule):** The JSON array **authoritativeSetupDiff** is the **only** source of truth for which **chassis tuning keys** changed between saved setup snapshots vs the previous run. Do **not** claim any chassis key changed — and do **not** quote before/after values — unless that **key** appears in authoritativeSetupDiff. The Engineer summary JSON in this prompt **does not** include setupChanges; never infer missing deltas from it.
- **Free-text discipline:** suggestedChanges / appliedChanges are the driver's notes about intent or plans — **never** treat them as proof that a setup field changed on the sheet, and **never** use them to invent numeric before/after for a key.
- **Chassis allow-list:** allowedChassisKeys duplicates the keys in authoritativeSetupDiff. For **any** forward-looking chassis adjustment (including "consider", "explore", "might help", "verify whether…"), you may only name knobs whose **key** is in that array. If a lever is **not** in the list, you must **not** name it or suggest moving it — including droop, downstop, shim packs, arms, toe, camber, springs, roll bars, ride height, oils, etc. KB text may explain handling concepts **only in generic terms** unless a KB line is tied to a key that is in the list.
- If **allowedChassisKeys** is an empty array \`[]\`, you must **not** recommend any specific chassis hardware change; stick to tyres (per tireChangeSignificance), pace / repeatability verification, community spread context without naming absent keys, and/or opening Engineer chat.
- **No silent cross-lever analogies:** do not substitute a different chassis lever for one in the diff unless a KB excerpt in this prompt explicitly links the mechanism for this symptom.
- Do not state pace metrics as rigid roles (best lap ≠ "the peak", etc.). Lean on the pace shape interpretation provided.
- Respect community position bands: if a parameter is already "below_typical" or "above_typical", do not recommend pushing further in that extreme direction unless you add an explicit hedge ("only if you still see X on track").
- Prefer one-change-at-a-time when suggesting new setup moves; honour the engineering brain's recommendation strategy mode and strength.
- Setup outcome caveats are prior history for this car only. If present, include **at most one** concise caveat inside the bullets; do **not** change, reverse, or rank the setup suggestions because of them.
- When the brain says preferEngineerChat=true OR data is thin, include one tryNextSession line suggesting the user open Ask the Engineer for a deeper look.
- Scope: ${params.scopeLine}`;

  const brainText = params.engineeringBrainPromptLines.length > 0
    ? params.engineeringBrainPromptLines.slice(0, 12).join("\n")
    : "(no engineering brain — fall back to KB + setup spread.)";
  const strategyLine =
    params.recommendationMode && params.recommendationStrength
      ? `mode=${params.recommendationMode}, strength=${params.recommendationStrength}, preferEngineerChat=${params.preferEngineerChat}`
      : `mode=unknown, strength=soft, preferEngineerChat=${params.preferEngineerChat}`;

  const user = `Engineering brain (deterministic diagnosis — explain, don't re-derive):\n${brainText}\n\nRecommendation strategy: ${strategyLine}\n\ntireChangeSignificance: ${tireSig}\nallowedChassisKeys (must mirror authoritativeSetupDiff keys):\n${allowKeysJson}\n\nKB excerpts:\n${kbText || "(none)"}\n\nNotes + handling (may overlap):\n${params.notesPreview.slice(0, 4000)}\n\nSuggested / applied changes text:\nSuggested: ${(params.suggestedChanges ?? "").slice(0, 1200)}\nApplied: ${(params.appliedChanges ?? "").slice(0, 1200)}\n\nSetup outcome caveats (caveat-only, do not alter recommendation):\n${JSON.stringify(params.setupOutcomeCaveats.slice(0, 5)).slice(0, 1800)}\n\nauthoritativeSetupDiff — tuning keys that changed vs previous run (sole source for chassis deltas; Engineer compare engine):\n${JSON.stringify(params.setupDiffChanged).slice(0, 6000)}\n\nSetup vs community (slim rows):\n${JSON.stringify(params.spreadSlim).slice(0, 8000)}\n\nEngineer summary (pace + interpretation only; no per-key setup list):\n${params.summaryJson ?? "null"}`;

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
  allowedChassisKeys: string[];
  tireChangeSignificance?: string | null;
  spreadSlim: Array<Record<string, unknown>>;
  suggestedChanges: string | null;
  appliedChanges: string | null;
  notesPreview: string;
  summaryJson: string | null;
  setupOutcomeCaveats?: string[];
  engineeringBrainPromptLines?: string[];
  recommendationMode?: string | null;
  recommendationStrength?: string | null;
  preferEngineerChat?: boolean;
  engineerHref: string;
}): Promise<DashboardEngineerSuggestionPayloadV1> {
  const llm = await callLlm({
    scopeLine: params.scopeLine,
    kbSnippets: params.kbSnippets,
    setupDiffChanged: params.setupDiffChanged,
    allowedChassisKeys: params.allowedChassisKeys,
    tireChangeSignificance: params.tireChangeSignificance ?? null,
    spreadSlim: params.spreadSlim,
    suggestedChanges: params.suggestedChanges,
    appliedChanges: params.appliedChanges,
    notesPreview: params.notesPreview,
    summaryJson: params.summaryJson,
    setupOutcomeCaveats: params.setupOutcomeCaveats ?? [],
    engineeringBrainPromptLines: params.engineeringBrainPromptLines ?? [],
    recommendationMode: params.recommendationMode ?? null,
    recommendationStrength: params.recommendationStrength ?? null,
    preferEngineerChat: params.preferEngineerChat ?? false,
  });

  const brainFallbackBullets = (params.engineeringBrainPromptLines ?? []).slice(0, 4);
  const fb = buildFallback({
    headline:
      params.recommendationMode === "celebrate"
        ? "Car was rated well — bank this setup as a known-good reference before changing more."
        : params.recommendationMode === "verify"
          ? "Pace and feel disagree — verify with another run on this setup before chasing changes."
          : params.recommendationMode === "diagnose"
            ? "Diagnose first — open Engineer chat with this run loaded."
            : "Review handling notes against setup vs typical before the next session.",
    bullets:
      brainFallbackBullets.length > 0
        ? brainFallbackBullets
        : [
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
  if (
    params.preferEngineerChat &&
    !tryNext.some((t) => t.toLowerCase().includes("engineer"))
  ) {
    tryNext = [
      ...tryNext.slice(0, 3),
      "Open Ask the Engineer with this run for a deeper diagnosis.",
    ];
  }

  return {
    version: 1,
    generatedAtIso: new Date().toISOString(),
    primaryRunId: params.primaryRunId,
    headline,
    bullets: bullets.slice(0, 6),
    tryNextSession: tryNext.slice(0, 4),
    sourcesNote: `Grounded in your saved run, setup vs typical for this car${
      params.setupDiffChanged.length
        ? ", and tuning diffs vs the previous run on this car (same compare engine as Engineer)"
        : ""
    }. KB excerpts are retrieved, not invented.`,
    engineerHref: params.engineerHref,
  };
}
