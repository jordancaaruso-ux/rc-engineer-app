import { NextResponse } from "next/server";

import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { runWatchTest } from "@/lib/lapWatch/speedhiveResultWatch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * On-demand test of the result-detection pipeline (Settings → Notifications).
 * Body: { speedhiveUrl?: string, force?: boolean }. Uses the pasted URL if given,
 * else falls back to a Speedhive-enabled track the user owns.
 */
export async function POST(req: Request): Promise<Response> {
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { speedhiveUrl?: string; force?: boolean } = {};
  try {
    body = (await req.json()) as { speedhiveUrl?: string; force?: boolean };
  } catch {
    /* empty body is fine */
  }

  let speedhiveUrl = typeof body.speedhiveUrl === "string" ? body.speedhiveUrl.trim() : "";
  if (!speedhiveUrl) {
    const track = await prisma.track.findFirst({
      where: { userId: userId, speedhiveUrl: { not: null } },
      select: { speedhiveUrl: true },
    });
    speedhiveUrl = track?.speedhiveUrl?.trim() ?? "";
  }

  if (!speedhiveUrl) {
    return NextResponse.json(
      { error: "No Speedhive URL — paste one, or set one on a track first." },
      { status: 400 },
    );
  }

  try {
    const report = await runWatchTest(
      { userId: userId, speedhiveUrl, force: body.force === true },
      new Date(),
    );
    return NextResponse.json({ ok: true, ...report });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Watch test failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
