/**
 * Per-user AI spend budgets — the durable cap that `checkApiRateLimit` can't be.
 *
 * That limiter lives in a Map inside one serverless instance, so on Vercel its real ceiling is
 * `limit x instance count`. It stays as a burst brake; these budgets, backed by `AiUsageDaily`,
 * are the actual ceiling on what one account can spend.
 *
 * Pure functions only — no Prisma, no env reads at module scope — so the maths is testable.
 */

import { TIER_LABELS } from "@/lib/brand/brandNames";

export const AI_USAGE_FEATURES = [
  "engineer-chat",
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
  // CORRECTED 2026-07-31. This row said 1.25/10 — that is gpt-5's rate, not gpt-5.5's, so every
  // Engineer answer was priced ~4x under its true cost and the daily cap let ~4x the intended
  // spend through. The measured "~$0.116/answer" bench baseline came off the wrong number; the
  // real figure at ~79K prompt + ~1.7K completion is ~$0.45 uncached.
  "gpt-5.5": { input: 5, output: 30 },
  "gpt-5.5-pro": { input: 30, output: 180 },
  // gpt-5.6 tiers, priced after OpenAI's 2026-07-30 cut (terra 2.50/15 -> 2/12, luna 1/6 -> 0.2/1.2).
  // Each tier needs its own row: modelRate does longest-prefix matching, so a single bare "gpt-5.6"
  // row would price all three off one number and be wrong for two of them.
  "gpt-5.6-sol": { input: 5, output: 30 },
  "gpt-5.6-terra": { input: 2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  // Untiered "gpt-5.6" isn't a real model id, but if one ever arrives it must not fall through to
  // the "gpt-5" prefix and get priced at 1.25/10. Pin it to the dearest tier — over-counting caps
  // early, which is visible; under-counting is not.
  "gpt-5.6": { input: 5, output: 30 },
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
  /**
   * Cap-hit copy overrides for the visible allowances. The paywall decision
   * (MONETISATION_NORTH_STAR.md): a cap hit must SELL the upgrade, never read as a limit error —
   * generic "resets tomorrow" copy can't do that, so tier budgets carry their own lines.
   */
  messages?: { dailyCalls?: string; monthlyCalls?: string };
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
      message:
        budget.messages?.monthlyCalls ??
        "You've used this month's included questions. They reset next month.",
    };
  }
  if (input.featureCallsToday >= budget.dailyCalls) {
    return {
      ok: false,
      reason: "daily-calls",
      message:
        budget.messages?.dailyCalls ??
        "You've used today's allowance for this feature. It resets tomorrow.",
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
 * Tier allowances for Engineer chat (MONETISATION_NORTH_STAR.md; repriced 2026-08-06).
 *
 * Notebook is the notebook with a taste of the Engineer — 1 question a DAY; Race Engineer is the
 * real Engineer tier — a 100-a-MONTH pool, spent whenever. The pitch is no longer raw volume
 * (30 vs 100 is only 3x) but BURST: a Race Engineer can spend a whole weekend's questions on
 * Saturday, which a Notebook member structurally cannot, and gets video + roll-centre with it.
 *
 * Margin, measured against real production usage 2026-08-06 (77 answers, prod `AiUsageDaily`):
 * $0.048/answer blended at a 58% cache hit, $0.097 if nothing caches at all. Against net-of-Stripe
 * revenue of ~US$6.19 (Notebook) and ~US$12.58 (Race Engineer), BOTH tiers stay profitable at a
 * full drain even in the zero-cache case — which is the property these numbers were chosen for.
 * Re-measure before moving them: the old "~$0.055" note assumed a ~79K-token prompt, and the v0 KB
 * rebuild roughly halved that to ~42K.
 */
export const STANDARD_ENGINEER_DAILY_QUESTIONS = 1;
export const PRO_ENGINEER_MONTHLY_QUESTIONS = 100;

/**
 * "1 Engineer question" / "100 Engineer questions". The allowances are constants that have already
 * moved once, and a cap-hit line that reads "today's 1 Engineer questions" undercuts the copy at
 * exactly the moment it is trying to sell an upgrade.
 */
export function engineerQuestionCount(n: number): string {
  return `${n} Engineer question${n === 1 ? "" : "s"}`;
}

/**
 * Shape a feature budget for a paying tier. Only Engineer chat has tier allowances; every other
 * feature keeps its base abuse brakes. Callers must NOT pass grandfathered users through here —
 * comps and pre-paywall testers keep the base (untiered) budget.
 *
 * Notebook: the 1/day allowance REPLACES the daily-call brake (the smaller number wins anyway);
 * no monthly pool. Race Engineer: the 100/month pool sits alongside the base daily brake, which
 * stays as burst protection — a weekend's questions in one day is the tier's whole pitch, but 60
 * every day is not a race weekend.
 */
export function applyEngineerTierBudget(
  budget: AiBudget,
  tier: "standard" | "pro",
): AiBudget {
  if (tier === "standard") {
    return {
      ...budget,
      dailyCalls: Math.min(budget.dailyCalls, STANDARD_ENGINEER_DAILY_QUESTIONS),
      messages: {
        ...budget.messages,
        dailyCalls: `You've used today's ${engineerQuestionCount(STANDARD_ENGINEER_DAILY_QUESTIONS)}. ${TIER_LABELS.pro} includes ${PRO_ENGINEER_MONTHLY_QUESTIONS} a month, to spend whenever you like — upgrade any time on the Subscription page.`,
      },
    };
  }
  return {
    ...budget,
    monthlyCalls: PRO_ENGINEER_MONTHLY_QUESTIONS,
    messages: {
      ...budget.messages,
      monthlyCalls: `You've used this month's ${engineerQuestionCount(PRO_ENGINEER_MONTHLY_QUESTIONS)}. They reset next month.`,
    },
  };
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
