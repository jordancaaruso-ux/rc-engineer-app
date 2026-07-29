import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { assertTeamAdmin } from "@/lib/teamAccess";
import { checkInviteRevoke } from "@/lib/teams/teamInviteRules";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ teamId: string; inviteId: string }> };

/**
 * Admin withdraws a pending invite ("sent it to the wrong Dave").
 *
 * Nested under the team so `checkInviteRevoke` can verify the invite actually belongs to the team
 * the caller is admin of — otherwise an admin of any team could revoke invites for any other.
 * Marked `revoked` rather than deleted so the row stays available for a later re-invite and there is
 * a record that it happened.
 */
export async function DELETE(_request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { teamId, inviteId } = await ctx.params;

  const invite = await prisma.teamInvite.findUnique({
    where: { id: inviteId },
    select: { id: true, teamId: true, status: true },
  });

  const decision = checkInviteRevoke({
    invite: invite ? { teamId: invite.teamId, status: invite.status } : null,
    teamId,
    viewerIsTeamAdmin: await assertTeamAdmin(teamId, userId),
  });
  if (!decision.ok) {
    return NextResponse.json({ error: decision.error }, { status: decision.status });
  }

  await prisma.teamInvite.update({
    where: { id: inviteId },
    data: { status: "revoked", respondedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
