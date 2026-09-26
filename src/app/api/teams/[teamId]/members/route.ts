import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { assertTeamAdmin, assertUserInTeam } from "@/lib/teamAccess";
import { isEmailAuthAllowed } from "@/lib/authAllowlist";
import { checkInviteCreate } from "@/lib/teams/teamInviteRules";
import { notifyUserOfTeamInvite } from "@/lib/teams/notifyTeamInvite";
import { loadTeamMemberName } from "@/lib/teams/teamMemberDisplay";
import { isBlockedPair } from "@/lib/moderation/blocks";
import { removeTeamMember } from "@/lib/teams/removeTeamMember";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ teamId: string }> };

/**
 * Admin **invites** a member by email (existing User, allowlisted).
 *
 * This route used to create the `TeamMembership` row outright, which meant an admin typing your
 * email immediately got mutual, retroactive access to your entire run history with no accept step
 * and no notification. It now only creates a `pending` `TeamInvite` and pushes it; the membership is
 * created by the invited user in `POST /api/teams/invites/[inviteId]`.
 */
export async function POST(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { teamId } = await ctx.params;
  if (!(await assertTeamAdmin(teamId, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { email?: string } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }

  const peer = await prisma.user.findFirst({
    where: { email },
    select: { id: true, email: true, name: true },
  });

  // A block either way stops the invite. Worded so it never says which side blocked.
  if (peer && (await isBlockedPair(user.id, peer.id))) {
    return NextResponse.json({ error: "You can't invite this driver." }, { status: 403 });
  }

  const [existingMembership, existingInvite] = peer
    ? await Promise.all([
        prisma.teamMembership.findFirst({
          where: { teamId, userId: peer.id },
          select: { id: true },
        }),
        prisma.teamInvite.findUnique({
          where: { teamId_invitedUserId: { teamId, invitedUserId: peer.id } },
          select: { id: true, status: true },
        }),
      ])
    : [null, null];

  const decision = checkInviteCreate({
    targetUserId: peer?.id ?? null,
    inviterUserId: user.id,
    targetIsAllowlisted: peer ? await isEmailAuthAllowed(peer.email ?? "") : false,
    targetIsAlreadyMember: Boolean(existingMembership),
    existingInviteStatus: existingInvite?.status ?? null,
  });
  if (!decision.ok) {
    return NextResponse.json({ error: decision.error }, { status: decision.status });
  }
  // `decision.ok` guarantees a resolved target; narrow for TypeScript.
  if (!peer) {
    return NextResponse.json({ error: "No user found with that email" }, { status: 404 });
  }

  // `mode: "reset"` reuses the row a previous decline/revoke left behind — the table is unique per
  // (team, user) for all time, so a re-invite is an update rather than a second row.
  const [invite, inviterName] = await Promise.all([
    prisma.teamInvite.upsert({
      where: { teamId_invitedUserId: { teamId, invitedUserId: peer.id } },
      create: {
        teamId,
        invitedUserId: peer.id,
        invitedByUserId: user.id,
        role: "member",
        status: "pending",
      },
      update: {
        invitedByUserId: user.id,
        role: "member",
        status: "pending",
        respondedAt: null,
      },
      select: { id: true, status: true, createdAt: true, team: { select: { name: true } } },
    }),
    // The name the team shows for the admin, not their email. Best effort: a failed read must not
    // turn a sent invite into an error, so the push falls back to not naming anyone.
    loadTeamMemberName(user.id).catch(() => null),
  ]);

  await notifyUserOfTeamInvite({
    invitedUserId: peer.id,
    teamName: invite.team.name,
    invitedByLabel: inviterName,
  });

  return NextResponse.json({
    invite: {
      id: invite.id,
      status: invite.status,
      createdAt: invite.createdAt.toISOString(),
      invitedUserId: peer.id,
      name: peer.name?.trim() || null,
      email: peer.email?.trim() || null,
    },
  });
}

/**
 * Leave team (`userId` omitted or matches caller) or admin removes `userId`.
 * Last admin leaving promotes the earliest-joined other member to admin; empty team is deleted.
 */
export async function DELETE(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { teamId } = await ctx.params;

  const sp = new URL(request.url).searchParams;
  const targetUserIdRaw = sp.get("userId")?.trim();
  const targetUserId = targetUserIdRaw || user.id;

  if (!(await assertUserInTeam(teamId, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (targetUserId !== user.id) {
    if (!(await assertTeamAdmin(teamId, user.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (!(await removeTeamMember(teamId, targetUserId))) {
    return NextResponse.json({ error: "Not a member" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
