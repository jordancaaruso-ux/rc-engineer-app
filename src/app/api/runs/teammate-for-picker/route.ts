import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { listTeamPeerUserIds } from "@/lib/teamAccess";
import { withIncludedBestLapForPicker } from "@/lib/lapAnalysis";

/**
 * Teammate-visible runs for unanchored pickers (Roll Center Lab setup slots).
 * Unlike {@link file://./../teammate-for-setup-compare}, there is no anchor run
 * or sheet scope — callers filter to what they can use (the Lab keeps only
 * snapshots that fingerprint a geometry pack). Peers reached only via mutual
 * team (no one-way TeammateLink) are gated by `Run.shareWithTeam`; linked
 * teammates are not.
 */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Peers = one-way linked teammates ∪ mutual team members.
  const links = await prisma.teammateLink.findMany({
    where: { userId: user.id },
    select: { peerUserId: true },
  });
  const linkedPeerIds = new Set(links.map((l) => l.peerUserId));
  const teamPeerIds = await listTeamPeerUserIds(user.id);
  const allPeerIds = [...new Set([...linkedPeerIds, ...teamPeerIds])].filter((id) => id !== user.id);
  const hasTeammates = allPeerIds.length > 0;
  if (!hasTeammates) {
    return NextResponse.json({ runs: [], memberDisplayByUserId: {}, hasTeammates });
  }

  const teamOnlyPeerIds = allPeerIds.filter((id) => !linkedPeerIds.has(id));

  const runs = await prisma.run.findMany({
    where: {
      OR: [
        { userId: { in: [...linkedPeerIds] } },
        // `not: false` keeps null/legacy runs (treated as shared).
        { userId: { in: teamOnlyPeerIds }, shareWithTeam: { not: false } },
      ],
    },
    orderBy: { sortAt: "desc" },
    take: 200,
    select: {
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
      lapSession: true,
      bestLapSeconds: true,
      setupSnapshot: { select: { id: true, data: true } },
      car: { select: { name: true, setupSheetTemplate: true } },
      track: { select: { name: true } },
      event: { select: { name: true } },
    },
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

  return NextResponse.json({
    runs: runs.map(withIncludedBestLapForPicker),
    memberDisplayByUserId,
    hasTeammates,
  });
}
