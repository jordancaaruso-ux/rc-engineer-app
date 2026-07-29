import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";

export const dynamic = "force-dynamic";

/**
 * The caller's own pending team invites, for the `/teams` card and the dashboard card.
 *
 * Scoped to `invitedUserId = caller` — this is the invitee's inbox, not an admin view. Admins see
 * outstanding invites for their team on `GET /api/teams/[teamId]` instead.
 */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const invites = await prisma.teamInvite.findMany({
    where: { invitedUserId: userId, status: "pending" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      team: { select: { id: true, name: true } },
      invitedBy: { select: { name: true, email: true } },
    },
  });

  return NextResponse.json({
    invites: invites.map((i) => ({
      id: i.id,
      teamId: i.team.id,
      teamName: i.team.name,
      invitedByLabel: i.invitedBy?.name?.trim() || i.invitedBy?.email?.trim() || null,
      createdAt: i.createdAt.toISOString(),
    })),
  });
}
