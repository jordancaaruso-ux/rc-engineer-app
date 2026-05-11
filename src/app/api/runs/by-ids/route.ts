import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { canViewPeerRuns, isRunSharedWithTeam, peerAccessIsTeamOnly } from "@/lib/teammateRunAccess";

const runSelectForPairCompare = {
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
  lapTimes: true,
  lapSession: true,
  setupSnapshot: { select: { id: true, data: true } },
  car: { select: { name: true, setupSheetTemplate: true } },
  track: { select: { name: true } },
  event: { select: { name: true } },
  userId: true,
  shareWithTeam: true,
} as const;

async function viewerMayAccessRun(
  viewerId: string,
  run: { userId: string; shareWithTeam: boolean | null }
): Promise<boolean> {
  if (run.userId === viewerId) return true;
  if (!(await canViewPeerRuns(viewerId, run.userId))) return false;
  if (await peerAccessIsTeamOnly(viewerId, run.userId)) {
    return isRunSharedWithTeam(run);
  }
  return true;
}

/**
 * Load 2–3 runs by id for Engineer pair compare (setup + laps).
 * Each run must be owned by the viewer or visible under teammate/team rules.
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("ids")?.trim() ?? "";
  const ids = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 3);
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids query required (comma-separated run ids, max 3)" }, { status: 400 });
  }
  if (ids.length > 3) {
    return NextResponse.json({ error: "At most 3 run ids" }, { status: 400 });
  }

  const runs = await prisma.run.findMany({
    where: { id: { in: ids } },
    select: runSelectForPairCompare,
  });

  const byId = new Map(runs.map((r) => [r.id, r]));
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) {
      return NextResponse.json({ error: "Run not found", missingId: id }, { status: 404 });
    }
    if (!(await viewerMayAccessRun(user.id, r))) {
      return NextResponse.json({ error: "Forbidden", runId: id }, { status: 403 });
    }
  }

  const ordered = ids.map((id) => {
    const r = byId.get(id)!;
    const { userId: _u, shareWithTeam: _s, ...rest } = r;
    return rest;
  });

  return NextResponse.json({ runs: ordered });
}
