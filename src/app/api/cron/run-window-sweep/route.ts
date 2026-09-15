import { NextResponse } from "next/server";

import { hasDatabaseUrl } from "@/lib/env";
import { revalidateAfterRunMutation } from "@/lib/revalidateUser";
import { applyRunWindow, usersNeedingRunWindowPass } from "@/lib/runs/runWindow";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Nightly safety net for the Starter run window (docs/STARTER_TIER_PLAN.md).
 *
 * The window is applied on every write that can move it — run created, deleted, reordered, plan
 * changed — so on a good day this finds nothing to do. It exists for the bad day: a Stripe
 * webhook that never arrived (a downgrade that should have hidden, an upgrade that should have
 * revealed), or a write path added later that forgot to call `applyRunWindow`. One pass per
 * member on Starter or carrying a stamp; each pass is idempotent.
 *
 * Guarded by CRON_SECRET exactly like `refresh-demo`; Vercel Cron sends it as a Bearer token.
 * Unset secret ⇒ 401, so the endpoint is inert on any deploy that hasn't configured it.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  try {
    const userIds = await usersNeedingRunWindowPass();
    let changedUsers = 0;
    let hidden = 0;
    let revealed = 0;
    for (const userId of userIds) {
      const result = await applyRunWindow(userId);
      if (result.hidden + result.revealed === 0) continue;
      changedUsers += 1;
      hidden += result.hidden;
      revealed += result.revealed;
      revalidateAfterRunMutation(userId);
    }
    return NextResponse.json({ ok: true, users: userIds.length, changedUsers, hidden, revealed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "run window sweep failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
