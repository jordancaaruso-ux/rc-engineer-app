import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";

import { hasDatabaseUrl } from "@/lib/env";
import { carsTag, dashboardTag, runsTag, tracksTag } from "@/lib/cacheTags";
import { refreshDemoSeasonDates } from "@/lib/demo/applyDemoDateShift";
import { demoCatalogUserId } from "@/lib/demo/demoAccess";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron entrypoint: keep the public demo's season sitting a couple of days behind today.
 *
 * The demo is a copy of the founder's real season with its real dates, and nearly every panel
 * in the app reads a rolling window. Left alone the copy ages out of all of them at once — on
 * 2026-08-25 the public demo was telling visitors `Runs 30d 0 · Active days 0 · Best streak 0d`
 * off a snapshot that ended 19 July. Re-seeding cannot fix it (the newest row it can copy is
 * the founder's newest real run), so the season is moved instead. Full reasoning in
 * `src/lib/demo/demoDateShift.ts`.
 *
 * Cheap and safe to run daily: one arithmetic UPDATE per table over rows the demo account owns,
 * no deletes, no other user's rows in scope, and it no-ops when the drift is under half a day.
 * Nothing here depends on the previous run having succeeded — a missed fortnight is caught up
 * in one shift.
 *
 * Guarded by CRON_SECRET exactly like `watch-results`; Vercel Cron sends it as a Bearer token.
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
  // Dark until the demo is configured — never guess an id and move somebody's rows.
  if (!process.env.DEMO_USER_ID?.trim()) {
    return NextResponse.json({ ok: true, skipped: "DEMO_USER_ID is not set" });
  }

  try {
    const result = await refreshDemoSeasonDates();

    if (result.applied) {
      /*
       * The rows moved underneath every cached read of the demo garage. Without this the demo
       * keeps serving yesterday's shape until each tag expires on its own — which on the
       * dashboard is exactly the surface the shift exists to fix.
       */
      const userId = demoCatalogUserId();
      for (const tag of [dashboardTag(userId), runsTag(userId), carsTag(userId), tracksTag(userId)]) {
        revalidateTag(tag, { expire: 0 });
      }
      for (const path of ["/", "/analysis", "/runs/history", "/engineer", "/tools", "/demo"]) {
        revalidatePath(path);
      }
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "demo refresh failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
