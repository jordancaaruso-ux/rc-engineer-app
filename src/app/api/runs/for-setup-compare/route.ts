import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import {
  canViewPeerRuns,
  isRunSharedWithTeam,
  peerAccessIsTeamOnly,
} from "@/lib/teammateRunAccess";
import { setupSheetScopeFromCar } from "@/lib/setupCompare/setupSheetScope";
import { carIdsMatchingSetupSheetScopeForUser } from "@/lib/carSetupScope";

const pickerRunSelect = {
  id: true,
  userId: true,
  createdAt: true,
  sessionCompletedAt: true,
  loggingCompletedAt: true,
  sortAt: true,
  sessionLabel: true,
  sessionType: true,
  meetingSessionType: true,
  meetingSessionCode: true,
  eventId: true,
  carId: true,
  carNameSnapshot: true,
  trackNameSnapshot: true,
  lapTimes: true,
  tireRunNumber: true,
  setupSnapshot: { select: { id: true, data: true } },
  car: {
    select: {
      id: true,
      name: true,
      setupSheetTemplate: true,
      setupSheetModelId: true,
    },
  },
  track: { select: { id: true, name: true } },
  tireSet: { select: { id: true, label: true, setNumber: true } },
  event: { select: { name: true } },
} as const;

/**
 * Runs the viewer may pick when comparing setup to `runId` (team Sessions + own history).
 * Merges runs on the anchor car with the viewer's runs on cars sharing the same sheet scope.
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const runId = new URL(request.url).searchParams.get("runId")?.trim() ?? "";
  if (!runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }

  const anchor = await prisma.run.findFirst({
    where: { id: runId },
    select: {
      id: true,
      userId: true,
      carId: true,
      shareWithTeam: true,
      car: {
        select: {
          id: true,
          setupSheetTemplate: true,
          setupSheetModelId: true,
        },
      },
    },
  });
  if (!anchor) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const canView = await canViewPeerRuns(user.id, anchor.userId);
  if (!canView) {
    return NextResponse.json({ error: "Not allowed to view this run" }, { status: 403 });
  }
  if (anchor.userId !== user.id && !isRunSharedWithTeam(anchor)) {
    return NextResponse.json({ error: "Run is not shared with team" }, { status: 403 });
  }

  const scope = setupSheetScopeFromCar(anchor.car);
  const byId = new Map<string, Awaited<ReturnType<typeof loadPickerRuns>>[number]>();

  if (anchor.carId) {
    const teamOnlyPeer = await peerAccessIsTeamOnly(user.id, anchor.userId);
    const onCar = await loadPickerRuns(
      { carId: anchor.carId, userId: anchor.userId },
      teamOnlyPeer
    );
    for (const r of onCar) byId.set(r.id, r);
  }

  if (scope) {
    const viewerCarIds = await carIdsMatchingSetupSheetScopeForUser(user.id, scope);
    if (viewerCarIds.length > 0) {
      const mine = await loadPickerRuns({
        userId: user.id,
        carId: { in: viewerCarIds },
      });
      for (const r of mine) byId.set(r.id, r);
    }
  } else if (anchor.userId === user.id && anchor.carId) {
    const mine = await loadPickerRuns({ userId: user.id, carId: anchor.carId! });
    for (const r of mine) byId.set(r.id, r);
  }

  const runs = [...byId.values()].sort((a, b) => {
    const ta = new Date(a.sortAt ?? a.createdAt).getTime();
    const tb = new Date(b.sortAt ?? b.createdAt).getTime();
    return tb - ta;
  });

  return NextResponse.json({ runs });
}

async function loadPickerRuns(
  where: { userId: string; carId?: string | { in: string[] } },
  teamOnlyPeer?: boolean
) {
  return prisma.run.findMany({
    where: {
      ...where,
      ...(teamOnlyPeer ? { shareWithTeam: true } : {}),
    },
    orderBy: { sortAt: "desc" },
    take: 200,
    select: pickerRunSelect,
  });
}
