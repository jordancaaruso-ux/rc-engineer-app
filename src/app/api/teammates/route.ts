import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { listTeamPeerUserIds } from "@/lib/teamAccess";

/**
 * People the caller may compare against: mutual team members, nothing else.
 *
 * There is deliberately no POST here any more. It used to create a one-way `TeammateLink` from any
 * email, which handed the caller another user's run history without that user agreeing to anything.
 * Peer access is now granted only by accepting a team invite — see `POST /api/teams/[teamId]/members`
 * and `POST /api/teams/invites/[inviteId]`.
 */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teamPeerIds = await listTeamPeerUserIds(user.id);
  const teamPeers =
    teamPeerIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: teamPeerIds } },
          select: { id: true, name: true, email: true },
        });

  return NextResponse.json({
    teammates: teamPeers.map((p) => ({
      id: `team:${p.id}`,
      peerUserId: p.id,
      name: p.name?.trim() || null,
      email: p.email?.trim() || null,
      source: "team" as const,
    })),
  });
}
