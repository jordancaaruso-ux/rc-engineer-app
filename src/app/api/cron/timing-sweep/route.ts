import { NextResponse } from "next/server";

import { hasDatabaseUrl } from "@/lib/env";
import { runSweepTick } from "@/lib/sweep/runSweepTick";
import { dispatchTrackJob, selfOrigin } from "@/lib/sweep/dispatchTrackJob";
import { runTrackLook } from "@/lib/sweep/trackLook";
import { isValidYmd } from "@/lib/sweep/getMyDayDays";
import { previousLocalYmd, trackLocalYmd, type SweepTrackJob } from "@/lib/sweep/sweepDocs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The timing sweep's five-minute tick — the dispatcher. Finds every track whose clock says a look
 * is due (8 pm today, or 8 am for a track that owes last night), claims each, and hands it to the
 * worker route (`track/route.ts`), one function per track. It reads no timing site itself and is
 * over in seconds. That is the sweep's only look of the day — no daytime polling (founder ruling
 * 2026-09-15). Guarded by CRON_SECRET like every cron route, and by `TIMING_SWEEP_ENABLED=1` so a
 * deploy can carry the code dark. A quiet tick reads Blob and nothing else.
 *
 * Dev drive aids (never on production): `?evening=<trackId>` runs that track's 8 pm look for
 * today; `?morning=<trackId>` its 8 am look for yesterday (`&ymd=` picks another day). Forced
 * looks run in this process and return their report, so a drive sees the outcome; add
 * `&dispatch=1` to go through the worker hand-off instead, the way production does.
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
    const now = new Date();
    const origin = selfOrigin(req);
    const params = new URL(req.url).searchParams;
    const dev = process.env.NODE_ENV !== "production";
    const forced = dev ? forcedJobs(params, now) : { jobs: [] as SweepTrackJob[], viaWorker: true };
    const inlineReports: unknown[] = [];

    const report = await runSweepTick(now, {
      dispatch: async (job, track, plan) => {
        if (forced.jobs.length > 0 && !forced.viaWorker) {
          // A forced look runs here and now, so the drive gets the outcome back.
          inlineReports.push(await runTrackLook({ track, plan, job, now }));
          return;
        }
        await dispatchTrackJob(origin, secret, job);
      },
      ...(forced.jobs.length > 0 ? { force: forced.jobs } : {}),
    });
    return NextResponse.json(inlineReports.length > 0 ? { ...report, looks: inlineReports } : report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "timing sweep failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** The dev-only force parameters, as jobs. The zone is read from the plan by the tick. */
function forcedJobs(params: URLSearchParams, now: Date): { jobs: SweepTrackJob[]; viaWorker: boolean } {
  const jobs: SweepTrackJob[] = [];
  const ymdParam = params.get("ymd");
  const zone = params.get("zone") || "Australia/Sydney";
  for (const trackId of params.getAll("evening").filter(Boolean)) {
    jobs.push({ trackId, ymd: isValidYmd(ymdParam) ? ymdParam : trackLocalYmd(zone, now), slot: "evening" });
  }
  for (const trackId of params.getAll("morning").filter(Boolean)) {
    jobs.push({ trackId, ymd: isValidYmd(ymdParam) ? ymdParam : previousLocalYmd(zone, now), slot: "morning" });
  }
  return { jobs, viaWorker: params.get("dispatch") === "1" };
}
