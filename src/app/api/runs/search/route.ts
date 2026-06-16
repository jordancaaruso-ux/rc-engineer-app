import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { canViewPeerRuns, peerAccessIsTeamOnly } from "@/lib/teammateRunAccess";
import {
  applyRunHistoryPostFilters,
  buildRunHistoryPrismaWhere,
  parseRunHistoryFilters,
  sortRunsForHistory,
} from "@/lib/runs/runHistoryFilters";

/** Filtered runs for Engineer compare pickers + search (same shape as for-picker). */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const raw: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    raw[key] = value;
  });
  const filters = parseRunHistoryFilters(raw);
  const forUserIdRaw = searchParams.get("forUserId")?.trim() || null;
  const take = Math.min(300, Math.max(1, Number(searchParams.get("take")) || 200));

  let runOwnerId = user.id;
  let teamOnlyPeer = false;
  if (forUserIdRaw && forUserIdRaw !== user.id) {
    const ok = await canViewPeerRuns(user.id, forUserIdRaw);
    if (!ok) {
      return NextResponse.json({ error: "Not allowed to list this user’s runs" }, { status: 403 });
    }
    runOwnerId = forUserIdRaw;
    teamOnlyPeer = await peerAccessIsTeamOnly(user.id, forUserIdRaw);
  }

  const baseWhere = {
    userId: runOwnerId,
    ...(teamOnlyPeer ? { shareWithTeam: true } : {}),
  };
  const where = buildRunHistoryPrismaWhere(filters, baseWhere);
  const displayTimeZone = await getExplicitTimeZoneForRunFormatting();

  const runs = await prisma.run.findMany({
    where,
    orderBy: { sortAt: "desc" },
    take,
    select: {
      id: true,
      createdAt: true,
      sessionCompletedAt: true,
      loggingCompletedAt: true,
      sortAt: true,
      sessionLabel: true,
      sessionType: true,
      meetingSessionType: true,
      meetingSessionCode: true,
      eventId: true,
      trackId: true,
      carId: true,
      carNameSnapshot: true,
      trackNameSnapshot: true,
      raceClass: true,
      bestLapSeconds: true,
      lapTimes: true,
      lapSession: true,
      notes: true,
      driverNotes: true,
      handlingProblems: true,
      setupSnapshot: { select: { id: true, data: true } },
      car: { select: { name: true, setupSheetTemplate: true } },
      track: { select: { name: true } },
      event: { select: { name: true } },
      tireSet: { select: { label: true, setNumber: true } },
    },
  });

  const filtered = sortRunsForHistory(
    applyRunHistoryPostFilters(runs, filters, displayTimeZone),
    filters.sort
  );

  return NextResponse.json({ runs: filtered });
}
