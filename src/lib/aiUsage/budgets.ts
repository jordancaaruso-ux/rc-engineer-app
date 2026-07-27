/**
 * Per-user AI spend budgets — the durable cap that `checkApiRateLimit` can't be.
 *
 * That limiter lives in a Map inside one serverless instance, so on Vercel its real ceiling is
 * `limit x instance count`. It stays as a burst brake; these budgets, backed by `AiUsageDaily`,
 * are the actual ceiling on what one account can spend.
 *
 * Pure functions only — no Prisma, no env reads at module scope — so the maths is testable.
 */

export const AI_USAGE_FEATURES = [
  "engineer-chat",
  "engineer-quick-fix",
  "setup-extract",
] as const;

export type AiUsageFeature = (typeof AI_USAGE_FEATURES)[number];

/**
 * Cost per 1M tokens, in USD.
 *
 * These drive the *cap*, not billing — OpenAI's invoice is the truth. Verify against
 * platform.openai.com/pricing when you touch model choice. Unknown models fall back to
 * `UNKNOWN_MODEL_RATE`, which is deliberately expensive so a new model can't slip past the
 * ceiling by being unpriced.
 */
const MODEL_RATES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5.5": { input: 1.25, output: 10 },
};

/** Conservative (high) fallback: better to cap early than to under-count a model we don't know. */
const UNKNOWN_MODEL_RATE = { input: 5, output: 20 };

export function modelRate(model: string): { input: number; output: number } {
  const key = model.trim().toLowerCase();
  if (MODEL_RATES_USD_PER_MTOK[key]) return MODEL_RATES_USD_PER_MTOK[key];
  // Dated snapshots ("gpt-4o-2024-11-20") price as their base model.
  const base = Object.keys(MODEL_RATES_USD_PER_MTOK)
    .filter((m) => key.startsWith(m))
    .sort((a, b) => b.length - a.length)[0];
  return base ? MODEL_RATES_USD_PER_MTOK[base] : UNKNOWN_MODEL_RATE;
}

/**
 * Fraction of the input rate charged for tokens served from OpenAI's prompt cache.
 *
 * The Engineer resends a large, stable prefix (full-KB system block, then the rules prompt) on
 * every tool-loop round, so a big share of its input can be cached — counting those at full price
 * overstates real spend and makes the caps bite far earlier than the invoice justifies.
 * Verify against platform.openai.com/pricing when you touch model choice.
 */
const CACHED_INPUT_RATE_MULTIPLIER = 0.1;

export function estimateCostUsd(input: {
  model: string;
  promptTokens: number;
  completionTokens: number;
  /**
   * Subset of `promptTokens` served from cache (OpenAI's
   * `usage.prompt_tokens_details.cached_tokens`). Omit or 0 when unknown — that prices every
   * input token at full rate, which over-counts rather than under-counts.
   */
  cachedPromptTokens?: number;
}): number {
  const rate = modelRate(input.model);
  const prompt = Math.max(0, input.promptTokens);
  const completion = Math.max(0, input.completionTokens);
  // Never let a bogus cached count exceed the prompt and manufacture a discount.
  const cached = Math.min(prompt, Math.max(0, input.cachedPromptTokens ?? 0));
  const fresh = prompt - cached;
  const promptCost = fresh * rate.input + cached * rate.input * CACHED_INPUT_RATE_MULTIPLIER;
  return (promptCost + completion * rate.output) / 1_000_000;
}

export type AiBudget = {
  /** Hard stop: calls per day for this feature. */
  dailyCalls: number;
  /** Hard stop: USD per day across ALL features. */
  dailyCostUsd: number;
  /** Hard stop: USD per rolling 30 days across ALL features. */
  monthlyCostUsd: number;
  /**
   * Hard stop: calls per rolling 30 days for THIS feature. Undefined = unlimited.
   *
   * This is the countable product allowance ("12 of 15 questions left"), as opposed to the dollar
   * caps, which are abuse brakes the user never sees. A tier allowance must be expressed here and
   * NOT emulated with `monthlyCostUsd` — a racer needs a number they can plan around, and a dollar
   * cap silently moves as prompt sizes and model rates change.
   */
  monthlyCalls?: number;
};

/**
 * Defaults sized for a real racer's weekend — a big day of Engineer chat plus a stack of setup
 * sheets — while making a scripted account hit the wall fast. Tune via env once there is real
 * usage data in `AiUsageDaily`.
 */
export const DEFAULT_AI_BUDGET: AiBudget = {
  dailyCalls: 60,
  dailyCostUsd: 3,
  monthlyCostUsd: 25,
};

const FEATURE_DAILY_CALLS: Record<AiUsageFeature, number> = {
  "engineer-chat": 60,
  "engineer-quick-fix": 40,
  "setup-extract": 25,
};

function envNumber(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Budget for a feature, with env overrides (`AI_DAILY_COST_LIMIT_USD`, etc.).
 *
 * `monthlyCalls` is omitted entirely unless configured, so the monthly call quota stays OFF until
 * tiers set it (Phase 2) — today's behaviour is unchanged.
 */
export function resolveAiBudget(
  feature: AiUsageFeature,
  env: Record<string, string | undefined> = process.env
): AiBudget {
  const monthlyCalls = envNumber(env.AI_MONTHLY_CALL_LIMIT);
  return {
    dailyCalls: envNumber(env.AI_DAILY_CALL_LIMIT) ?? FEATURE_DAILY_CALLS[feature],
    dailyCostUsd: envNumber(env.AI_DAILY_COST_LIMIT_USD) ?? DEFAULT_AI_BUDGET.dailyCostUsd,
    monthlyCostUsd: envNumber(env.AI_MONTHLY_COST_LIMIT_USD) ?? DEFAULT_AI_BUDGET.monthlyCostUsd,
    ...(monthlyCalls != null ? { monthlyCalls } : {}),
  };
}

/** Remaining calls in this feature's monthly allowance, or null when there is no allowance. */
export function remainingMonthlyCalls(
  budget: AiBudget,
  featureCallsMonth: number
): number | null {
  if (budget.monthlyCalls == null) return null;
  return Math.max(0, budget.monthlyCalls - Math.max(0, featureCallsMonth));
}

export type AiBudgetVerdict =
  | { ok: true }
  | {
      ok: false;
      reason: "daily-calls" | "daily-cost" | "monthly-cost" | "monthly-calls";
      message: string;
    };

/** Messages are phrased for a driver, not an operator — this surfaces in the Engineer panel. */
export function evaluateAiBudget(input: {
  budget: AiBudget;
  /** Calls already made today, for this feature. */
  featureCallsToday: number;
  /** USD already spent today, across all features. */
  costTodayUsd: number;
  /** USD already spent in the last 30 days, across all features. */
  costMonthUsd: number;
  /** Calls already made in the last 30 days, for this feature. Omit when no monthly quota. */
  featureCallsMonth?: number;
}): AiBudgetVerdict {
  const { budget } = input;
  // Checked FIRST: this is the visible product allowance, so it should be the reason a user is
  // told about, ahead of the dollar/burst brakes they were never shown a number for.
  if (
    budget.monthlyCalls != null &&
    (input.featureCallsMonth ?? 0) >= budget.monthlyCalls
  ) {
    return {
      ok: false,
      reason: "monthly-calls",
      message: "You've used this month's included questions. They reset next month.",
    };
  }
  if (input.featureCallsToday >= budget.dailyCalls) {
    return {
      ok: false,
      reason: "daily-calls",
      message: "You've used today's allowance for this feature. It resets tomorrow.",
    };
  }
  if (input.costTodayUsd >= budget.dailyCostUsd) {
    return {
      ok: false,
      reason: "daily-cost",
      message: "You've used today's AI allowance. It resets tomorrow.",
    };
  }
  if (input.costMonthUsd >= budget.monthlyCostUsd) {
    return {
      ok: false,
      reason: "monthly-cost",
      message: "You've used this month's AI allowance. Get in touch if you need more.",
    };
  }
  return { ok: true };
}

/**
 * Calendar day key (YYYY-MM-DD) for the ledger, in a FIXED zone.
 *
 * Deliberately not the viewer's zone: a spend cap keyed on a device time zone resets early for
 * anyone who changes it. Day-window display code still follows the per-user-zone doctrine.
 */
export const AI_USAGE_TIME_ZONE_DEFAULT = "Australia/Sydney";

export function aiUsageTimeZone(env: Record<string, string | undefined> = process.env): string {
  return env.AI_USAGE_TIME_ZONE?.trim() || AI_USAGE_TIME_ZONE_DEFAULT;
}
