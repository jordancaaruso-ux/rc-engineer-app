import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

/**
 * Entities the Engineer's attach picker can anchor to, newest first. Deliberately
 * lean — no lap blobs, no setup data — unlike /api/runs/for-picker, which ships
 * full setup JSON for the load-setup flow. The client shapes rows into candidates
 * with src/lib/engineerPhase5/anchorCandidates.ts (local-calendar labels).
 */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [runs, setups, events] = await Promise.all([
    prisma.run.findMany({
      where: { userId },
      orderBy: { sortAt: "desc" },
      take: 60,
      select: {
        id: true,
        createdAt: true,
        sortAt: true,
        sessionCompletedAt: true,
        loggingCompletedAt: true,
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
    }),
    prisma.setupSnapshot.findMany({
      where: { userId, isLibrary: true },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        name: true,
        createdAt: true,
        carId: true,
        car: { select: { name: true } },
      },
    }),
    prisma.eventParticipation.findMany({
      where: { userId },
      orderBy: { event: { startDate: "desc" } },
      take: 20,
      select: {
        event: {
          select: {
            id: true,
            name: true,
            startDate: true,
            endDate: true,
            trackNameSnapshot: true,
            track: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  return NextResponse.json({
    runs,
    setups,
    events: events.map((p) => p.event).filter(Boolean),
  });
}
