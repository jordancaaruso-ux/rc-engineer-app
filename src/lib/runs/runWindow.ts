import "server-only";
import { getEntitlementFor } from "@/lib/entitlement";
import { STARTER_RUN_WINDOW, type Tier } from "@/lib/entitlementLogic";
import { prisma, runsIncludingHidden } from "@/lib/prisma";

export type RunWindowResult = {
  /** The owner's tier as resolved for this pass — "starter" is the only one that hides. */
  tier: Tier;
  /** Runs stamped hidden by this pass. */
  hidden: number;
  /** Runs un-hidden by this pass. */
  revealed: number;
};

/**
 * Make a member's runs match their plan (docs/STARTER_TIER_PLAN.md).
 *
 * Starter keeps the `STARTER_RUN_WINDOW` most recent runs by `sortAt` — the Sessions list's own
 * order — and everything older is stamped `hiddenByPlanAt`. Any other tier (Notebook, Race
 * Engineer, admin, billing dark, lapsed) clears every stamp the member has. Keyed on the OWNER of
 * the runs, never the viewer: a teammate looking at a Starter member's runs sees ten.
 *
 * Idempotent and cheap (one read, at most two `updateMany`), so it is called after every write
 * that can move the window — run created, deleted or reordered, plan changed — and once a night
 * as a safety net (`/api/cron/run-window-sweep`). Every run row counts, drafts included: a
 * started-and-abandoned run is a session they started, and drafts expire on their own.
 *
 * Reads and writes through `runsIncludingHidden`: the ordinary client cannot see what this has
 * to hide and reveal.
 */
export async function applyRunWindow(userId: string): Promise<RunWindowResult> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return { tier: "none", hidden: 0, revealed: 0 };
  const { tier } = await getEntitlementFor(userId, user.email ?? null);

  if (tier !== "starter") {
    const revealed = await runsIncludingHidden.updateMany({
      where: { userId, hiddenByPlanAt: { not: null } },
      data: { hiddenByPlanAt: null },
    });
    return { tier, hidden: 0, revealed: revealed.count };
  }

  const keep = await runsIncludingHidden.findMany({
    where: { userId },
    // The Sessions list's order, with ties broken so two runs stamped in the same millisecond
    // cannot swap places between passes.
    orderBy: [{ sortAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: STARTER_RUN_WINDOW,
    select: { id: true },
  });
  const keepIds = keep.map((r) => r.id);

  // Hide first, reveal second: a crash between the two leaves at most one run too few on screen
  // until the next pass, never one too many.
  const hidden = await runsIncludingHidden.updateMany({
    where: { userId, id: { notIn: keepIds }, hiddenByPlanAt: null },
    data: { hiddenByPlanAt: new Date() },
  });
  const revealed = await runsIncludingHidden.updateMany({
    where: { userId, id: { in: keepIds }, hiddenByPlanAt: { not: null } },
    data: { hiddenByPlanAt: null },
  });
  return { tier, hidden: hidden.count, revealed: revealed.count };
}

/** How many of a member's runs their plan is hiding — the number on the Sessions foot. */
export async function countRunsHiddenByPlan(userId: string): Promise<number> {
  return runsIncludingHidden.count({ where: { userId, hiddenByPlanAt: { not: null } } });
}

/**
 * Every member the nightly sweep should pass over: anyone on Starter, plus anyone still carrying
 * a stamp — the trace a missed plan-change webhook leaves behind.
 */
export async function usersNeedingRunWindowPass(): Promise<string[]> {
  const [starters, stamped] = await Promise.all([
    prisma.subscription.findMany({ where: { tier: "starter" }, select: { userId: true } }),
    runsIncludingHidden.findMany({
      where: { hiddenByPlanAt: { not: null } },
      distinct: ["userId"],
      select: { userId: true },
    }),
  ]);
  return [...new Set([...starters, ...stamped].map((row) => row.userId))];
}
