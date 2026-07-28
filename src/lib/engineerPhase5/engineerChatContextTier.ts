import type { EngineerChatMode } from "@/lib/engineerPhase5/engineerChatMode";

/** When false, chat skips community spread, brain, tire priors, and the full KB system prompt. */
const SETUP_DEEP_RE =
  /\b(setup|shim|spring|droop|caster|camber|toe|diff|wing|balance|handling|understeer|oversteer|grip|compare|change|field|median|spread|damping|roll|steer|anti-?dive|anti-?squat|ride height|bulkhead|gearbox|motor|pinion|mistake|sector|push(?:es|ing|y)?|loose|corner|turn-?in|entry|exit|rotation|bite|edgy|nervous|hook(?:s|ed|ing)?|slid(?:e|es|ing)|snap(?:s|py|ping)?)\b/i;

/** Lap pace / history at a track — answered deterministically or via the lookup prompt. */
const LAP_HISTORY_SIGNAL_RE =
  /\b(best|fastest|quickest|how\s+fast)\b[\s\S]{0,40}\b(lap|time|pace|laptime)s?\b|\b(lap\s*time|laptime)s?\b[\s\S]{0,40}\b(at|on)\b|\bwhat(?:'s| is)\s+my\s+(best|fastest)\b/i;

const SESSION_SCOPE_RE =
  /\b(practice|qualifying|race|session|meeting|weekend|yesterday|today|last\s+\d+\s+(day|week|month)|last\s+(week|month|year))\b/i;

const LAP_HISTORY_FOLLOWUP_RE =
  /\b(?:what(?:'s| is)\s+(?:my\s+)?)?(?:next|second|2nd|third|3rd|\d+(?:st|nd|rd|th)?)\s+best\b/i;

export function engineerChatIsLapHistoryQuestion(message: string | undefined): boolean {
  const msg = message?.trim() ?? "";
  if (msg.length < 4) return false;
  if (/\b(setup|shim|camber|toe|spring|diff|wing|balance|handling)\b/i.test(msg)) return false;
  if (LAP_HISTORY_FOLLOWUP_RE.test(msg)) return true;
  if (msg.length < 8) return false;
  if (!LAP_HISTORY_SIGNAL_RE.test(msg)) return false;
  return /\b(at|on)\s+[a-z0-9]/i.test(msg);
}

export function engineerChatNeedsDeepContext(input: {
  lastUserMessage: string | undefined;
  runId: string;
  compareRunId: string;
  mode?: EngineerChatMode;
}): boolean {
  if (input.runId.trim() || input.compareRunId.trim()) return true;
  const msg = input.lastUserMessage?.trim() ?? "";
  if (msg.length < 5) return false;
  if (engineerChatIsLapHistoryQuestion(msg)) return false;
  // ENGINEER_NORTH_STAR.md: quick and deep are explicit advice situations — never the
  // lookup tier (no thin context on the advice path). Lap history above stays lookup.
  if (input.mode === "quick" || input.mode === "deep") return true;
  if (SETUP_DEEP_RE.test(msg)) return true;
  if (SESSION_SCOPE_RE.test(msg) && /\b(setup|change|compare|outline|happened)\b/i.test(msg)) return true;
  return false;
}

/**
 * `lookup` = read numbers back out of the run log (best lap at a track, which run was
 * fastest). `full` = everything else, which is to say every question that could possibly
 * want advice.
 *
 * This picks the PROMPT and the context budget. It does NOT pick the model — see
 * getEngineerChatModelAndTemperature. That separation is the whole point of the
 * 2026-07-28 rework: the previous tier bundled "thin context" with "cheap model", and
 * decided both from the vocabulary in the message. A driver who cannot name what is
 * wrong ("doesn't feel right", "where would you start?") does not use setup words — so
 * the drivers who needed the most help were routed to the weakest model and a prompt
 * that told it to ask for a focused run. The reply read as a form, not an engineer.
 *
 * The rule is now deliberately narrow and allow-listed: ONLY a recognised lap-history
 * question with no run in focus takes the lookup path. Anything unrecognised falls to
 * `full`, because the cost of over-serving a simple question is a few cents and the cost
 * of under-serving a real one is the driver deciding the Engineer is useless.
 */
export type EngineerChatContextTier = "lookup" | "full";

export function engineerChatContextTier(input: {
  lastUserMessage: string | undefined;
  runId: string;
  compareRunId: string;
  mode?: EngineerChatMode;
}): EngineerChatContextTier {
  if (input.runId.trim() || input.compareRunId.trim()) return "full";
  if (input.mode === "quick" || input.mode === "deep") return "full";
  return engineerChatIsLapHistoryQuestion(input.lastUserMessage) ? "lookup" : "full";
}
