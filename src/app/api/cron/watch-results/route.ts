import { NextResponse } from "next/server";

import { hasDatabaseUrl } from "@/lib/env";
import { runLogReminderNudge } from "@/lib/lapWatch/logReminderNudge";
import { runResultWatch } from "@/lib/lapWatch/speedhiveResultWatch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron entrypoint: poll Speedhive for new results for users on an active event day
 * and push "new run — tap to log it". Guarded by CRON_SECRET — Vercel Cron sends it
 * automatically as a Bearer token when the env var is set; an external scheduler can
 * send the same header. Windowing keeps this near-zero-cost off race days.
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
    const now = new Date();
    const [result, reminders] = await Promise.all([
      runResultWatch(now),
      runLogReminderNudge(now),
    ]);
    return NextResponse.json({ ok: true, ...result, reminders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "watch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
