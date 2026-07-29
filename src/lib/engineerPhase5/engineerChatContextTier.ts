/** Lap pace / history at a track — answered deterministically or via the lookup prompt. */
const LAP_HISTORY_SIGNAL_RE =
  /\b(best|fastest|quickest|how\s+fast)\b[\s\S]{0,40}\b(lap|time|pace|laptime)s?\b|\b(lap\s*time|laptime)s?\b[\s\S]{0,40}\b(at|on)\b|\bwhat(?:'s| is)\s+my\s+(best|fastest)\b/i;

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

/**
 * `lookup` = read numbers back out of the run log (best lap at a track, which run was
 * fastest). `full` = everything else, which is to say every question that could possibly
 * want advice.
 *
 * This picks the PROMPT and the context budget. It does NOT pick the model (2026-07-28:
 * the old tier chose a cheap model from message vocabulary, so the drivers who couldn't
 * name what was wrong got the weakest answers) and it does NOT pick the context depth
 * (2026-07-29: the old `needsDeep` regex silently withheld the engineering brain, outcome
 * memory, tyre priors and community spread from any advice question whose wording missed
 * a keyword list — "doesn't feel right" and "where would you start?" both missed it, and
 * no eval had ever exercised that path. Deleted: every full-tier turn now builds full
 * context. Over-serving a simple question costs cents; under-serving a real one costs
 * the driver's trust.)
 *
 * The rule stays deliberately narrow and allow-listed: ONLY a recognised lap-history
 * question with no run in focus takes the lookup path. Anything unrecognised is `full`.
 */
export type EngineerChatContextTier = "lookup" | "full";

export function engineerChatContextTier(input: {
  lastUserMessage: string | undefined;
  runId: string;
  compareRunId: string;
  /**
   * A user-pinned anchor always takes the full path — a pinned setup or event carries no
   * run id, and the lookup prompt knows nothing about anchors.
   */
  anchorPinned?: boolean;
}): EngineerChatContextTier {
  if (input.anchorPinned) return "full";
  if (input.runId.trim() || input.compareRunId.trim()) return "full";
  return engineerChatIsLapHistoryQuestion(input.lastUserMessage) ? "lookup" : "full";
}

/**
 * Deep context (brain, memory, priors, spread, full KB) is built for every full-tier
 * turn — depth is a property of the TIER, never of the message's vocabulary.
 */
export function engineerChatNeedsDeepContext(input: {
  lastUserMessage: string | undefined;
  runId: string;
  compareRunId: string;
  anchorPinned?: boolean;
}): boolean {
  return engineerChatContextTier(input) === "full";
}
