import "server-only";

import { prisma } from "@/lib/prisma";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { todayYmdInTimeZone } from "@/lib/eventActive";
import {
  aiUsageTimeZone,
  applyEngineerTierBudget,
  estimateCostUsd,
  evaluateAiBudget,
  resolveAiBudget,
  type AiBudgetVerdict,
  type AiUsageFeature,
} from "@/lib/aiUsage/budgets";

/**
 * DB side of the AI spend cap: read today's/this month's totals to decide, then increment.
 * Budget maths lives in `budgets.ts` (pure, unit-tested); this file only talks to Prisma.
 */

/** A `@db.Date` column stores the calendar date — build it from the local YMD, not `new Date()`. */
function dayValue(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function dayValueDaysAgo(ymd: string, days: number): Date {
  return new Date(dayValue(ymd).getTime() - days * 86_400_000);
}

/**
 * Can this user make another AI call? Admins are exempt, matching `checkApiRateLimit`.
 * Fails OPEN on a DB error — a ledger hiccup must not take the Engineer down.
 */
export async function checkAiBudget(input: {
  userId: string;
  userEmail?: string | null;
  feature: AiUsageFeature;
  /**
   * Paying tier, when billing is enforced and the user is NOT grandfathered — shapes the Engineer
   * allowance (Standard 2/day, Pro 300/mo pool). Omit for grandfathered/comped users and while
   * enforcement is dark: they keep the base budget, exactly today's behaviour.
   */
  tier?: "standard" | "pro";
}): Promise<AiBudgetVerdict> {
  if (isAuthAdminEmail(input.userEmail)) return { ok: true };

  const base = resolveAiBudget(input.feature);
  const budget =
    input.tier && input.feature === "engineer-chat"
      ? applyEngineerTierBudget(base, input.tier)
      : base;
  const ymd = todayYmdInTimeZone(aiUsageTimeZone());
  const today = dayValue(ymd);

  try {
    const monthStart = dayValueDaysAgo(ymd, 29);
    const [todayRows, monthAgg, monthCallsAgg] = await Promise.all([
      prisma.aiUsageDaily.findMany({
        where: { userId: input.userId, day: today },
        select: { feature: true, calls: true, costUsd: true },
      }),
      prisma.aiUsageDaily.aggregate({
        where: { userId: input.userId, day: { gte: monthStart, lte: today } },
        _sum: { costUsd: true },
      }),
      // Only queried when a monthly allowance actually exists, so accounts without one pay no
      // extra round trip. `monthAgg` above sums cost across ALL features; a countable question
      // quota has to be per-feature, hence the separate aggregate.
      budget.monthlyCalls != null
        ? prisma.aiUsageDaily.aggregate({
            where: {
              userId: input.userId,
              feature: input.feature,
              day: { gte: monthStart, lte: today },
            },
            _sum: { calls: true },
          })
        : Promise.resolve(null),
    ]);

    return evaluateAiBudget({
      budget,
      featureCallsToday: todayRows.find((r) => r.feature === input.feature)?.calls ?? 0,
      costTodayUsd: todayRows.reduce((sum, r) => sum + r.costUsd, 0),
      costMonthUsd: monthAgg._sum.costUsd ?? 0,
      featureCallsMonth: monthCallsAgg?._sum.calls ?? 0,
    });
  } catch (error) {
    console.error("[aiUsage] budget check failed; allowing the call", error);
    return { ok: true };
  }
}

/**
 * Engineer-chat usage counts for the quota meter: questions today and over the rolling 30 days.
 * Read-only; returns zeros on a DB error (the meter is decoration, never a gate).
 */
export async function engineerQuotaSnapshot(
  userId: string,
): Promise<{ today: number; month: number }> {
  const ymd = todayYmdInTimeZone(aiUsageTimeZone());
  try {
    const [todayRow, monthAgg] = await Promise.all([
      prisma.aiUsageDaily.findUnique({
        where: { userId_day_feature: { userId, day: dayValue(ymd), feature: "engineer-chat" } },
        select: { calls: true },
      }),
      prisma.aiUsageDaily.aggregate({
        where: {
          userId,
          feature: "engineer-chat",
          day: { gte: dayValueDaysAgo(ymd, 29), lte: dayValue(ymd) },
        },
        _sum: { calls: true },
      }),
    ]);
    return { today: todayRow?.calls ?? 0, month: monthAgg._sum.calls ?? 0 };
  } catch (error) {
    console.error("[aiUsage] quota snapshot failed", error);
    return { today: 0, month: 0 };
  }
}

/**
 * Record what a call actually cost. Call AFTER the AI responds, with real token counts.
 * Never throws — losing a ledger row is better than failing a request the user already paid for
 * in latency, and the next check still sees every row that did land.
 */
export async function recordAiUsage(input: {
  userId: string;
  feature: AiUsageFeature;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** Subset of `promptTokens` served from OpenAI's prompt cache, when the response reported it. */
  cachedPromptTokens?: number;
  /** Calls with no usage reported still count as 1 against the per-day call limit. */
  calls?: number;
}): Promise<void> {
  const costUsd = estimateCostUsd({
    model: input.model,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    cachedPromptTokens: input.cachedPromptTokens,
  });

  // Set AI_USAGE_DEBUG=1 to see whether the Engineer's stable KB prefix is actually being cached.
  // Cache hit rate is the single biggest lever on Engineer unit cost, and it is otherwise
  // invisible — `costUsd` alone can't tell you a cheap call from a well-cached expensive one.
  if (process.env.AI_USAGE_DEBUG === "1") {
    const cached = input.cachedPromptTokens ?? 0;
    const pct = input.promptTokens > 0 ? Math.round((cached / input.promptTokens) * 100) : 0;
    console.log(
      `[aiUsage] ${input.feature} ${input.model} prompt=${input.promptTokens} ` +
        `cached=${cached} (${pct}%) completion=${input.completionTokens} cost=$${costUsd.toFixed(5)}`
    );
  }
  const day = dayValue(todayYmdInTimeZone(aiUsageTimeZone()));
  const calls = input.calls ?? 1;

  try {
    await prisma.aiUsageDaily.upsert({
      where: { userId_day_feature: { userId: input.userId, day, feature: input.feature } },
      create: {
        userId: input.userId,
        day,
        feature: input.feature,
        calls,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        costUsd,
      },
      update: {
        calls: { increment: calls },
        promptTokens: { increment: input.promptTokens },
        completionTokens: { increment: input.completionTokens },
        costUsd: { increment: costUsd },
      },
    });
  } catch (error) {
    console.error("[aiUsage] failed to record usage", error);
  }
}

/**
 * Record a flat estimated cost for work whose token counts aren't plumbed out.
 *
 * Setup-sheet extraction fans out across OCR consensus passes and two extract models deep inside
 * `processImport` / `imageExtractPipeline`; threading real usage out of all of them is its own
 * job. What actually needs capping is the *number of imports* an account can run, and that this
 * does exactly. Treat the dollar figure as a ceiling input, not accounting.
 */
export async function recordEstimatedAiUsage(input: {
  userId: string;
  feature: AiUsageFeature;
  estimatedCostUsd: number;
}): Promise<void> {
  const day = dayValue(todayYmdInTimeZone(aiUsageTimeZone()));
  try {
    await prisma.aiUsageDaily.upsert({
      where: {
        userId_day_feature: { userId: input.userId, day, feature: input.feature },
      },
      create: {
        userId: input.userId,
        day,
        feature: input.feature,
        calls: 1,
        costUsd: input.estimatedCostUsd,
      },
      update: {
        calls: { increment: 1 },
        costUsd: { increment: input.estimatedCostUsd },
      },
    });
  } catch (error) {
    console.error("[aiUsage] failed to record estimated usage", error);
  }
}

/** Rough measured cost of one full setup-sheet import (OCR consensus + two extract passes). */
export const SETUP_EXTRACT_ESTIMATED_COST_USD = 0.12;

export type AiUsageSummaryRow = {
  userId: string;
  email: string | null;
  calls: number;
  costUsd: number;
};

/** Admin view: heaviest AI users over the last `days` days, so the bill is visible as it forms. */
export async function topAiSpenders(days = 30, take = 20): Promise<AiUsageSummaryRow[]> {
  const ymd = todayYmdInTimeZone(aiUsageTimeZone());
  const grouped = await prisma.aiUsageDaily.groupBy({
    by: ["userId"],
    where: { day: { gte: dayValueDaysAgo(ymd, days - 1), lte: dayValue(ymd) } },
    _sum: { calls: true, costUsd: true },
  });

  const users = await prisma.user.findMany({
    where: { id: { in: grouped.map((g) => g.userId) } },
    select: { id: true, email: true },
  });
  const emailById = new Map(users.map((u) => [u.id, u.email]));

  return grouped
    .map((g) => ({
      userId: g.userId,
      email: emailById.get(g.userId) ?? null,
      calls: g._sum.calls ?? 0,
      costUsd: g._sum.costUsd ?? 0,
    }))
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, take);
}
