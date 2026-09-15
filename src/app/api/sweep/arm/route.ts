import { NextResponse, after } from "next/server";

import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { getEntitlementFor } from "@/lib/entitlement";
import { armAndPollTrackNow } from "@/lib/sweep/runSweepTick";
import { reportSweepFailure } from "@/lib/observability/reportSweep";
import { isSweepListenerEmail, sweepListenerAllowlist } from "@/lib/sweep/sweepListeners";

export const dynamic = "force-dynamic";

/**
 * "I'm at this track" — the app opened with a track in play. Arms the track for the rest of its
 * day and looks at the timing site once, after the response, so the dashboard is never slower
 * for it. Body: `{ trackId }`.
 */
export async function POST(req: Request): Promise<Response> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let trackId: string | null = null;
  try {
    const body = (await req.json()) as { trackId?: unknown };
    trackId = typeof body?.trackId === "string" && body.trackId.trim() ? body.trackId.trim() : null;
  } catch {
    trackId = null;
  }
  if (!trackId) return NextResponse.json({ error: "trackId required" }, { status: 400 });

  if (!isSweepListenerEmail(user.email, sweepListenerAllowlist())) {
    return NextResponse.json({ ok: false, reason: "not a listener" });
  }
  const entitlement = await getEntitlementFor(user.id, user.email ?? null);
  if (!entitlement.entitled) return NextResponse.json({ ok: false, reason: "not entitled" });

  const id = trackId;
  after(async () => {
    try {
      await armAndPollTrackNow({ trackId: id, userId: user.id, armedBy: "app_open" });
    } catch (err) {
      reportSweepFailure(err, { stage: "arm", trackId: id, userId: user.id });
    }
  });
  return NextResponse.json({ ok: true });
}
