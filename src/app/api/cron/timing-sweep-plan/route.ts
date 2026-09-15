import { NextResponse } from "next/server";

import { hasDatabaseUrl } from "@/lib/env";
import { buildSweepPlan } from "@/lib/sweep/buildSweepPlan";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Nightly: rebuild the timing sweep's plan (who listens, at which tracks, on which clock). The
 * only scheduled DB-touching part of the sweep. Same CRON_SECRET guard as the other cron routes.
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
    const built = await buildSweepPlan(new Date());
    return NextResponse.json({ ok: true, ...built });
  } catch (error) {
    const message = error instanceof Error ? error.message : "sweep plan build failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
