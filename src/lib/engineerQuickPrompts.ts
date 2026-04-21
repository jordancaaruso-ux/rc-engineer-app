/** Canned user messages for Engineer chat — pair with URL runId + compareRunId + optional patternDigest. */

export const ENGINEER_PROMPT_COMPARE_SETUPS =
  "Compare the chassis tuning setup between the target (primary) run and the comparison run using focusedRunPair.setupComparison. Use rcEffectHints, frontAxleNetNote, rearAxleNetNote, and when present frontUpperInnerBulkheadSplitNote, rearUpperInnerBulkheadSplitNote, frontLowerArmAntiGeometryNote and rearLowerArmAntiGeometryNote (bulkhead pickup splits: upper inner + under–lower anti-dive / anti-squat); describe shim changes as compare→primary using raise/lower. Ground handling in setupCompareKbSnippets and vehicleDynamicsKb only.";

export const ENGINEER_PROMPT_COMPARE_LAPTIMES =
  "Compare lap times and pace between the target (primary) run and the comparison run using focusedRunPair.lapComparison and lap summaries in context. Reference best lap delta and avg top 5 / top 10 when available. If compareRunId is not set, explain what is being compared (e.g. previous run on same car) from the summary API.";

export const ENGINEER_PROMPT_SETUP_VS_TYPICAL =
  "Using richEngineerContext.setupVsSpread (state the communityContext label so I know which template · surface · grip bucket you're comparing against, and cite each row's communityGripLevel when it isn't 'any'), explain where my current anchored-run setup sits vs typical for each tuning parameter that has spread data. When richEngineerContext.bulkheadInnerSplits is non-null, also interpret derived FF−FR / RF−RR pickup split mm alongside the per-key upper_inner and under_lower_arm rows. Call out parameters in below_typical / above_typical bands first. If communitySpreadAvailable is false or bands are no_spread_data, say what is missing and what would improve confidence.";

export const ENGINEER_PROMPT_TRACK_SUGGESTIONS =
  "Using richEngineerContext (track gripTags/layoutTags, tires, sessionClass) and conditionalSetupEmpirical when hasEnoughData is true, suggest 2–4 concrete chassis tuning directions for this venue—not motor, pinion, or electronics. If conditionalSetupEmpirical hasEnoughData is false, still use track + setupVsSpread and say what extra logged runs would help.";

export const ENGINEER_PROMPT_SESSION_DEBRIEF =
  "Give a concise debrief of the anchored primary run: session type, tires, track, and lap summary if present. Plain language; no invented lap times. End with one practical question I should answer before the next outing.";

export const ENGINEER_PROMPT_SANITY_CHECK =
  "Scan the anchored run context for anything inconsistent or worth double-checking (setup vs car template, tires vs session, missing track, thin lap data). List issues briefly; if nothing stands out, say so.";

export const ENGINEER_PROMPT_WHAT_CONTEXT =
  "Briefly list what structured context you have for this chat (focused runs, setupVsSpread, conditionalSetupEmpirical, patternDigest if any, run catalog if enabled). Do not invent data—only what is actually in context.";

export const ENGINEER_PROMPT_EXPLAIN_LAP_DELTA_SETUP =
  "The URL has both primary and compare runs. Using focusedRunPair.lapComparison and setupComparison together, discuss which setup differences might plausibly relate to the lap-time delta—use cautious language (correlation not proof). If lap or setup data is missing, say what is absent.";

export const ENGINEER_PROMPT_PRIORITIES_BEFORE_NEXT_OUTING =
  "With primary vs compare runs in context, give a numbered priority list (max 5) of what to verify or adjust before the next track day—setup checks, tire prep, logging gaps. Be specific to the data you see.";

export const ENGINEER_PROMPT_TREND_ACROSS_RUNS =
  "patternDigest is in context: describe trends across those runs (pace vs setup keys that changed). Reference run order oldest→newest. If digest is thin, say so and what extra runs would help.";

export const ENGINEER_PROMPT_LEARN_PARAMETERS =
  "Using richEngineerContext.setupVsSpread and vehicleDynamicsKb, pick up to 4 chassis tuning parameters from the anchored run where I have values but weak or missing spread bands (no_spread_data / not_numeric) or where positionBand is below_typical or above_typical. For each: what the adjustment does in plain RC terms, typical tradeoffs, and what to verify on track. If setupVsSpread is empty, say that a focused run with setup data is needed. Do not discuss motor, pinion, wing, or ESC.";

export type EngineerQuickPromptSurface = "run_summary" | "chat_panel";

export type EngineerQuickPromptDefinition = {
  id: string;
  /** Button label in compact UI */
  label: string;
  prompt: string;
  /** If true, disable unless URL has compareRunId */
  requiresCompare?: boolean;
  /** If true, disable unless pattern digest was loaded into chat */
  requiresPatternDigest?: boolean;
  /**
   * If false, button stays enabled without `runId` in the URL.
   * Omitted means a focused run is required for a useful answer.
   */
  requiresRunId?: boolean;
  surfaces: EngineerQuickPromptSurface[];
};

const DEFS: EngineerQuickPromptDefinition[] = [
  {
    id: "compare_setups",
    label: "Compare setups",
    prompt: ENGINEER_PROMPT_COMPARE_SETUPS,
    requiresCompare: true,
    surfaces: ["run_summary", "chat_panel"],
  },
  {
    id: "compare_laptimes",
    label: "Compare lap times",
    prompt: ENGINEER_PROMPT_COMPARE_LAPTIMES,
    /** Prompt already handles missing compare (e.g. vs previous on same car). */
    surfaces: ["run_summary", "chat_panel"],
  },
  {
    id: "setup_vs_typical",
    label: "Setup vs typical",
    prompt: ENGINEER_PROMPT_SETUP_VS_TYPICAL,
    surfaces: ["run_summary", "chat_panel"],
  },
  {
    id: "learn_parameters",
    label: "Learn setup parameters",
    prompt: ENGINEER_PROMPT_LEARN_PARAMETERS,
    surfaces: ["run_summary", "chat_panel"],
  },
  {
    id: "track_suggestions",
    label: "What to try at this track",
    prompt: ENGINEER_PROMPT_TRACK_SUGGESTIONS,
    surfaces: ["run_summary", "chat_panel"],
  },
  {
    id: "session_debrief",
    label: "Session debrief",
    prompt: ENGINEER_PROMPT_SESSION_DEBRIEF,
    surfaces: ["run_summary", "chat_panel"],
  },
  {
    id: "sanity_check",
    label: "Sanity check",
    prompt: ENGINEER_PROMPT_SANITY_CHECK,
    surfaces: ["run_summary", "chat_panel"],
  },
  {
    id: "what_context",
    label: "What can you see?",
    prompt: ENGINEER_PROMPT_WHAT_CONTEXT,
    requiresRunId: false,
    surfaces: ["chat_panel"],
  },
  {
    id: "explain_delta",
    label: "Explain lap delta + setup",
    prompt: ENGINEER_PROMPT_EXPLAIN_LAP_DELTA_SETUP,
    requiresCompare: true,
    surfaces: ["run_summary", "chat_panel"],
  },
  {
    id: "priorities_next",
    label: "Priorities before next outing",
    prompt: ENGINEER_PROMPT_PRIORITIES_BEFORE_NEXT_OUTING,
    requiresCompare: true,
    surfaces: ["run_summary", "chat_panel"],
  },
  {
    id: "trend_digest",
    label: "Trend across runs",
    prompt: ENGINEER_PROMPT_TREND_ACROSS_RUNS,
    requiresPatternDigest: true,
    requiresRunId: false,
    surfaces: ["chat_panel"],
  },
];

export function engineerQuickPromptsForSurface(surface: EngineerQuickPromptSurface): EngineerQuickPromptDefinition[] {
  return DEFS.filter((d) => d.surfaces.includes(surface));
}

export function getEngineerQuickPromptById(id: string): EngineerQuickPromptDefinition | null {
  return DEFS.find((d) => d.id === id) ?? null;
}

export function engineerQuickPromptDisabled(
  def: EngineerQuickPromptDefinition,
  ctx: { hasRunId: boolean; hasCompareRunId: boolean; hasPatternDigest: boolean }
): boolean {
  if (def.requiresRunId !== false && !ctx.hasRunId) return true;
  if (def.requiresCompare && !ctx.hasCompareRunId) return true;
  if (def.requiresPatternDigest && !ctx.hasPatternDigest) return true;
  return false;
}
