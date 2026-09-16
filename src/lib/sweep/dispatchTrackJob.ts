import "server-only";

import type { SweepTrackJob } from "@/lib/sweep/sweepDocs";

export const TRACK_WORKER_PATH = "/api/cron/timing-sweep/track";

/**
 * Where the tick reaches its own worker route. On Vercel that is the project's production domain
 * (never deployment-protected, unlike the `*.vercel.app` deployment URL); on a laptop it is the
 * dev server the tick was called on. `SWEEP_SELF_ORIGIN` overrides both.
 */
export function selfOrigin(req: Request): string {
  const configured = process.env.SWEEP_SELF_ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (process.env.VERCEL && production) return `https://${production}`;
  return new URL(req.url).origin;
}

/**
 * Hands one track's look to the worker route and returns once the worker has accepted it (HTTP
 * 202). The worker does its reading, filing and sending after it has answered, so this resolves in
 * well under a second whatever the track has in store. Anything but a 202 is a failed hand-off:
 * the tick gives the claim back and the next tick tries again.
 */
export async function dispatchTrackJob(origin: string, secret: string, job: SweepTrackJob): Promise<void> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
  };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  const res = await fetch(`${origin}${TRACK_WORKER_PATH}`, {
    method: "POST",
    headers,
    body: JSON.stringify(job),
    cache: "no-store",
  });
  if (res.status !== 202) {
    throw new Error(`worker answered HTTP ${res.status} for ${job.slot} ${job.trackId} ${job.ymd}`);
  }
}
