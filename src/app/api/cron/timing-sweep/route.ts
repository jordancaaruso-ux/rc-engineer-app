import { NextResponse } from "next/server";

import { hasDatabaseUrl } from "@/lib/env";
import { runSweepTick } from "@/lib/sweep/runSweepTick";
import { runEveningPass } from "@/lib/sweep/eveningPass";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The timing sweep's five-minute tick: poll armed tracks, run the 8 pm evening pass where it is
 * 8 pm. Guarded by CRON_SECRET like every cron route, and by `TIMING_SWEEP_ENABLED=1` so a deploy
 * can carry the code dark. A quiet tick reads Blob and nothing else.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Dark on production until the switch is thrown; always live on a dev server so it can be driven.
  const enabled = process.env.TIMING_SWEEP_ENABLED === "1" || process.env.NODE_ENV !== "production";
  if (!enabled) {
    return NextResponse.json({ ok: true, skipped: "TIMING_SWEEP_ENABLED is not 1" });
  }
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  try {
    // `?evening=<trackId>` forces one track's evening pass — a dev-server drive aid only.
    const forced =
      process.env.NODE_ENV !== "production"
        ? new URL(req.url).searchParams.getAll("evening").filter(Boolean)
        : [];
    const report = await runSweepTick(new Date(), {
      evening: runEveningPass,
      ...(forced.length > 0 ? { forceEveningTrackIds: forced } : {}),
    });
    return NextResponse.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "timing sweep failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
