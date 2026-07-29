/**
 * Human labels for the Engineer chat SSE `status` phases.
 *
 * The server emits opaque slugs (`engineerChatPipeline.ts` for the context build,
 * `openaiEngineer.ts` for the model + tool loop, `api/engineer/chat/route.ts` for the
 * coarse boundaries). This module is the ONLY place that turns them into user-visible
 * text, so a slug never reaches the screen raw — an old client talking to a new server
 * shows "Working…", not `tool:some_new_thing`.
 *
 * Every phase is emitted immediately before work that is genuinely about to be awaited.
 * If you add a slug, keep that rule: this line is a status, not decoration. The rotating
 * trivia in `engineerLoadingFacts.ts` is the decorative half, and it is kept visually and
 * structurally separate for exactly that reason.
 */

/** Context-build and model-loop phases. Tool phases live in the map below. */
export const ENGINEER_CHAT_STATUS_LABELS: Readonly<Record<string, string>> = {
  preparing: "Preparing context…",
  context_runs: "Loading your runs and setups…",
  context_kb: "Pulling vehicle-dynamics reference…",
  context_history: "Reviewing tire life and setup history…",
  thinking: "Thinking it through…",
  reviewing: "Working through what it found…",
  focus_rebuild: "Rebuilding context for that run…",
  done: "Wrapping up…",
};

/** Keyed by tool name — the wire slug is `tool:<name>`. */
export const ENGINEER_CHAT_TOOL_LABELS: Readonly<Record<string, string>> = {
  kb_search: "Checking the vehicle-dynamics reference…",
  search_runs: "Searching your run history…",
  get_param_spread: "Comparing setup values across runs…",
  compare_tires: "Comparing tire compounds…",
  tire_history_at_track: "Looking up tires at that track…",
  list_linked_teammates: "Checking linked teammates…",
  apply_engineer_focus: "Focusing on that run…",
};

export const ENGINEER_CHAT_STATUS_FALLBACK = "Working…";
export const ENGINEER_CHAT_TOOL_FALLBACK = "Checking your data…";

/** Slug → label. Returns null only for an absent phase; never returns a raw slug. */
export function engineerChatStatusLabel(phase: string | null | undefined): string | null {
  if (typeof phase !== "string") return null;
  const key = phase.trim();
  if (!key) return null;
  if (key.startsWith("tool:")) {
    const tool = key.slice(5).trim();
    if (!tool) return ENGINEER_CHAT_TOOL_FALLBACK;
    return ENGINEER_CHAT_TOOL_LABELS[tool] ?? ENGINEER_CHAT_TOOL_FALLBACK;
  }
  return ENGINEER_CHAT_STATUS_LABELS[key] ?? ENGINEER_CHAT_STATUS_FALLBACK;
}
