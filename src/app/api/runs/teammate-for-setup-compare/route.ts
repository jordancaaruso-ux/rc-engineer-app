import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { canViewPeerRuns } from "@/lib/teammateRunAccess";
import { listTeamPeerUserIds } from "@/lib/teamAccess";
import { setupSheetScopeFromCar } from "@/lib/setupCompare/setupSheetScope";

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
    select: { id: true, name: true, setupSheetTemplate: true, setupSheetModelId: true },
  },
  track: { select: { id: true, name: true } },
  tireSet: { select: { id: true, label: true, setNumber: true } },
  event: { select: { name: true } },
} as const;

/**
 * Teammate-visible runs on the anchor run's setup sheet, for the "Teammates"
 * compare source. Unlike {@link file://../for-setup-compare}, this works even
 * when the anchor is the viewer's OWN run (their Sessions) — the whole point is
 * "open my setup, compare to my teammate." Peers reached only via mutual team
 * (no one-way TeammateLink) are gated by `Run.shareWithTeam`; linked teammates
 * are not. Returns `hasTeammates` so the segment stays discoverable even when a
 * peer hasn't logged this car yet.
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

  const empty = { runs: [], memberDisplayByUserId: {}, hasTeammates: false };

  // Peers = one-way linked teammates ∪ mutual team members.
  const links = await prisma.teammateLink.findMany({
    where: { userId: user.id },
    select: { peerUserId: true },
  });
  const linkedPeerIds = new Set(links.map((l) => l.peerUserId));
  const teamPeerIds = await listTeamPeerUserIds(user.id);
  const allPeerIds = [...new Set([...linkedPeerIds, ...teamPeerIds])].filter((id) => id !== user.id);
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
  if (peerCarIds.length === 0) return NextResponse.json({ ...empty, hasTeammates });

  const teamOnlyPeerIds = allPeerIds.filter((id) => !linkedPeerIds.has(id));

  const runs = await prisma.run.findMany({
    where: {
      carId: { in: peerCarIds },
      OR: [
        { userId: { in: [...linkedPeerIds] } },
        // `not: false` keeps null/legacy runs (treated as shared).
        { userId: { in: teamOnlyPeerIds }, shareWithTeam: { not: false } },
      ],
    },
    orderBy: { sortAt: "desc" },
    take: 200,
    select: pickerRunSelect,
  });

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

  return NextResponse.json({ runs, memberDisplayByUserId, hasTeammates });
}
