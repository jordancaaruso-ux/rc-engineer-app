/** When false, chat skips community spread, brain, tire priors, and the full KB system prompt. */
const SETUP_DEEP_RE =
  /\b(setup|shim|spring|droop|caster|camber|toe|diff|wing|balance|handling|understeer|oversteer|grip|compare|change|field|median|spread|damping|roll|steer|anti-?dive|anti-?squat|ride height|bulkhead|gearbox|motor|pinion|mistake|sector)\b/i;

/** Lap pace / history at a track — answered deterministically or via light tier (not full setup context). */
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
}): boolean {
  if (input.runId.trim() || input.compareRunId.trim()) return true;
  const msg = input.lastUserMessage?.trim() ?? "";
  if (msg.length < 5) return false;
  if (engineerChatIsLapHistoryQuestion(msg)) return false;
  if (SETUP_DEEP_RE.test(msg)) return true;
  if (SESSION_SCOPE_RE.test(msg) && /\b(setup|change|compare|outline|happened)\b/i.test(msg)) return true;
  return false;
}

export type EngineerChatContextTier = "light" | "full";

export function engineerChatContextTier(input: {
  lastUserMessage: string | undefined;
  runId: string;
  compareRunId: string;
}): EngineerChatContextTier {
  return engineerChatNeedsDeepContext(input) ? "full" : "light";
}
