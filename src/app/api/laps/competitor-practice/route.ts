import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { discoverSpeedhivePracticeSessionsForChip } from "@/lib/speedhive/discoverSpeedhivePracticeSessionsForChip";

/**
 * "Show me their practice at this track" — a pull, on a button, never on a timer.
 *
 * POST rather than GET because it reaches out to MYLAPS: it is an action with a cost at the
 * other end, and nothing should be able to trigger it by prefetching a link.
 */

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    transponder?: string;
    trackId?: string;
  } | null;

  const transponder = body?.transponder?.trim();
  const trackId = body?.trackId?.trim();
  if (!transponder) {
    return NextResponse.json({ error: "A transponder number is required." }, { status: 400 });
  }
  if (!trackId) {
    return NextResponse.json({ error: "Pick a track to look at." }, { status: 400 });
  }

  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: { name: true, speedhiveUrl: true },
  });
  if (!track?.speedhiveUrl?.trim()) {
    return NextResponse.json(
      { error: "That track has no MYLAPS practice page saved." },
      { status: 400 }
    );
  }

  const result = await discoverSpeedhivePracticeSessionsForChip({
    userId,
    trackSpeedhiveUrl: track.speedhiveUrl,
    transponder,
  });

  return NextResponse.json({
    ...result,
    trackLabel: result.trackLabel ?? track.name,
  });
}
