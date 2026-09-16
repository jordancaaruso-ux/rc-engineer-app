import { NextResponse, after } from "next/server";

import { hasDatabaseUrl } from "@/lib/env";
import { readDoc } from "@/lib/sweep/blobStore";
import { PLAN_DOC_KEY } from "@/lib/sweep/buildSweepPlan";
import { isValidYmd } from "@/lib/sweep/getMyDayDays";
import { runTrackLook } from "@/lib/sweep/trackLook";
import { reportSweepFailure } from "@/lib/observability/reportSweep";
import type { SweepPlanDoc, SweepTrackJob } from "@/lib/sweep/sweepDocs";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The timing sweep's worker: one track, one day, one look (`trackLook.ts`). The five-minute tick
 * (`../route.ts`) claims the track and POSTs the job here; this answers 202 at once and does the
 * work after the response, so every track gets its own function and its own two minutes instead
 * of a share of the tick's. Bearer `CRON_SECRET` like every cron route. `?inline=1` (dev only)
 * runs the look before answering and returns its report — the drive aid.
 */
export async function POST(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const enabled = process.env.TIMING_SWEEP_ENABLED === "1" || process.env.NODE_ENV !== "production";
  if (!enabled) {
    return NextResponse.json({ ok: true, skipped: "TIMING_SWEEP_ENABLED is not 1" });
  }
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const job = parseJob(await req.json().catch(() => null));
  if (!job) return NextResponse.json({ error: "Bad job" }, { status: 400 });

  const plan = await readDoc<SweepPlanDoc>(PLAN_DOC_KEY);
  const track = plan?.tracks[job.trackId];
  if (!plan || !track) return NextResponse.json({ error: "Track not in plan" }, { status: 404 });

  const now = new Date();
  const inline = process.env.NODE_ENV !== "production" && new URL(req.url).searchParams.get("inline") === "1";
  if (inline) {
    const report = await runTrackLook({ track, plan, job, now });
    return NextResponse.json({ ok: true, report });
  }
  after(async () => {
    try {
      await runTrackLook({ track, plan, job, now });
    } catch (err) {
      reportSweepFailure(err, { stage: "evening", trackId: track.id });
    }
  });
  return NextResponse.json({ ok: true, accepted: job }, { status: 202 });
}

function parseJob(body: unknown): SweepTrackJob | null {
  if (!body || typeof body !== "object") return null;
  const { trackId, ymd, slot } = body as Record<string, unknown>;
  if (typeof trackId !== "string" || !trackId.trim()) return null;
  if (!isValidYmd(ymd)) return null;
  if (slot !== "evening" && slot !== "morning") return null;
  return { trackId: trackId.trim(), ymd, slot };
}
