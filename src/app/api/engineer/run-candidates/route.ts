import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

/**
 * The runs the Engineer's subject bar can pin, newest first. Deliberately lean — no lap blobs,
 * no setup data — unlike /api/runs/for-picker, which ships full setup JSON for the load-setup
 * flow. The client shapes rows with src/lib/engineer/runCandidates.ts (local-calendar labels).
 *
 * Runs only: the Engineer reads a run and nothing else (driverData.ts), so the bar offers
 * nothing else. The 07-30 route also listed saved setups and events for pins the old pipeline
 * understood; those pins went with it on 2026-08-13.
 */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const runs = await prisma.run.findMany({
    where: { userId },
    orderBy: { sortAt: "desc" },
    take: 60,
    select: {
      id: true,
      createdAt: true,
      sortAt: true,
      sessionCompletedAt: true,
      sessionLabel: true,
      sessionType: true,
      meetingSessionType: true,
      meetingSessionCode: true,
      eventId: true,
      carId: true,
      carNameSnapshot: true,
      trackNameSnapshot: true,
      bestLapSeconds: true,
      car: { select: { name: true } },
      track: { select: { name: true } },
      event: { select: { name: true } },
    },
  });

  return NextResponse.json({ runs });
}
