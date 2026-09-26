import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { canViewPeerRuns } from "@/lib/teammateRunAccess";
import { listTeamPeerUserIds } from "@/lib/teamAccess";
import { setupSheetScopeFromCar } from "@/lib/setupCompare/setupSheetScope";
import { withIncludedBestLapForPicker } from "@/lib/lapAnalysis";

const pickerRunSelect = {
  id: true,
  userId: true,
  createdAt: true,
  sessionCompletedAt: true,
  loggingCompletedAt: true,
  sortAt: true,
  importedLapTimeSessionId: true,
  sessionLabel: true,
  sessionType: true,
  meetingSessionType: true,
  meetingSessionCode: true,
  eventId: true,
  carId: true,
  carNameSnapshot: true,
  trackNameSnapshot: true,
  lapTimes: true,
  lapSession: true,
  bestLapSeconds: true,
  tireRunNumber: true,
  setupSnapshot: { select: { id: true, data: true } },
  car: {
    select: { id: true, name: true, setupSheetTemplate: true, setupSheetModelId: true },
  },
  track: { select: { id: true, name: true } },
  tireType: { select: { id: true, displayName: true } },
    tireStintId: true,
    tireAgeKnown: true,
  // The front end of a front/rear run, and what each end is glued to.
  frontTireType: { select: { id: true, displayName: true } },
  frontTireStintId: true,
  frontTireAgeKnown: true,
  frontTireRunNumber: true,
  tireFitment: true,
  event: { select: { name: true } },
} as const;

/**
 * Teammate-visible runs on the anchor run's setup sheet, for the "Teammates"
 * compare source. Unlike {@link file://../for-setup-compare}, this works even
 * when the anchor is the viewer's OWN run (their Sessions) — the whole point is
 * "open my setup, compare to my teammate." Peers come from mutual team
 * membership and are always gated by `Run.shareWithTeam`. Returns `hasTeammates`
 * so the segment stays discoverable even when a peer hasn't logged this car yet.
 *
 * The anchor itself is never in the list: on a teammate's run it used to be, and picking it
 * compared the run with itself ("No differences"). `teammateRunsOnOtherCars` says why an empty
 * list is empty when teammates HAVE shared runs, just on other cars — the compare paints the other
 * setup into this sheet's boxes, so another chassis cannot be one (test drive, 2026-09-26).
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const runId = new URL(request.url).searchParams.get("runId")?.trim() ?? "";
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

  const anchor = await prisma.run.findFirst({
    where: { id: runId },
    select: {
      userId: true,
      car: { select: { setupSheetModelId: true, setupSheetTemplate: true } },
    },
  });
  if (!anchor) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (anchor.userId !== user.id) {
    const canView = await canViewPeerRuns(user.id, anchor.userId);
    if (!canView) {
      return NextResponse.json({ error: "Not allowed to view this run" }, { status: 403 });
    }
  }

  const empty = {
    runs: [],
    memberDisplayByUserId: {},
    hasTeammates: false,
    teammateRunsOnOtherCars: false,
  };

  const allPeerIds = (await listTeamPeerUserIds(user.id)).filter((id) => id !== user.id);
  const hasTeammates = allPeerIds.length > 0;
  if (!hasTeammates) return NextResponse.json(empty);

  const scope = setupSheetScopeFromCar(anchor.car);
  if (!scope) return NextResponse.json({ ...empty, hasTeammates });

  const scopeWhere = scope.setupSheetModelId
    ? { setupSheetModelId: scope.setupSheetModelId }
    : { setupSheetTemplate: { equals: scope.setupSheetTemplate!, mode: "insensitive" as const } };

  const peerCars = await prisma.car.findMany({
    where: { userId: { in: allPeerIds }, ...scopeWhere },
    select: { id: true },
  });
  const peerCarIds = peerCars.map((c) => c.id);

  /**
   * Teammates' shared runs on any car that is not on this sheet. One row answers it, and a failed
   * read only costs the explanation, never the list.
   */
  const sharedRunsOnOtherCars = async () =>
    (await prisma.run
      .findFirst({
        where: {
          userId: { in: allPeerIds },
          shareWithTeam: { not: false },
          carId: { not: null, notIn: peerCarIds },
        },
        select: { id: true },
      })
      .catch(() => null)) != null;

  if (peerCarIds.length === 0) {
    return NextResponse.json({
      ...empty,
      hasTeammates,
      teammateRunsOnOtherCars: await sharedRunsOnOtherCars(),
    });
  }

  const runs = await prisma.run.findMany({
    where: {
      // Not the run being looked at: comparing it with itself only ever says "No differences".
      id: { not: runId },
      carId: { in: peerCarIds },
      userId: { in: allPeerIds },
      // `not: false` keeps null/legacy runs (treated as shared).
      shareWithTeam: { not: false },
    },
    orderBy: { sortAt: "desc" },
    take: 200,
    select: pickerRunSelect,
  });
  if (runs.length === 0) {
    return NextResponse.json({
      ...empty,
      hasTeammates,
      teammateRunsOnOtherCars: await sharedRunsOnOtherCars(),
    });
  }

  const presentUserIds = [...new Set(runs.map((r) => r.userId))];
  const members = presentUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: presentUserIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const memberDisplayByUserId = Object.fromEntries(
    members.map((m) => [m.id, m.name?.trim() || m.email?.trim() || m.id.slice(0, 8)] as const)
  );

  return NextResponse.json({
    runs: runs.map(withIncludedBestLapForPicker),
    memberDisplayByUserId,
    hasTeammates,
    teammateRunsOnOtherCars: false,
  });
}
