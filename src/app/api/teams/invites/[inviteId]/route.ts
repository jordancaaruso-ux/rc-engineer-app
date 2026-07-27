import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { isEmailAuthAllowed } from "@/lib/authAllowlist";
import { checkInviteResponse, parseInviteAction } from "@/lib/teams/teamInviteRules";
import { notifyAdminOfTeamInviteReply } from "@/lib/teams/notifyTeamInvite";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ inviteId: string }> };

/**
 * The invited user accepts or declines. This is the **only** path that creates a `TeamMembership`
 * from an invite, and `checkInviteResponse` allows nobody but `invitedUserId` through it — an admin
 * accepting on someone's behalf would recreate exactly the flaw this replaced.
 *
 * Accepting is a real disclosure: team access is mutual and retroactive over the whole run history,
 * which is why the UI spells that out before this call is made.
 */
export async function POST(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { inviteId } = await ctx.params;

  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  const action = parseInviteAction(body?.action);
  if (!action) {
    return NextResponse.json({ error: "action must be \"accept\" or \"decline\"" }, { status: 400 });
  }

  const invite = await prisma.teamInvite.findUnique({
    where: { id: inviteId },
    select: {
      id: true,
      status: true,
      role: true,
      teamId: true,
      invitedUserId: true,
      invitedByUserId: true,
      team: { select: { name: true } },
    },
  });

  const decision = checkInviteResponse({
    invite: invite ? { invitedUserId: invite.invitedUserId, status: invite.status } : null,
    responderUserId: user.id,
    action,
  });
  if (!decision.ok) {
    return NextResponse.json({ error: decision.error }, { status: decision.status });
  }
  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  // Re-checked at accept time, not just at invite time: an email can be removed from the allowlist
  // while an invite sits pending, and accepting must not be a way back in.
  if (action === "accept" && !(await isEmailAuthAllowed(user.email ?? ""))) {
    return NextResponse.json(
      { error: "Your email is not on the sign-in allowlist for this app." },
      { status: 403 }
    );
  }

  // One transaction so a membership can never exist alongside a still-pending invite.
  await prisma.$transaction(async (tx) => {
    await tx.teamInvite.update({
      where: { id: invite.id },
      data: { status: decision.nextStatus, respondedAt: new Date() },
    });
    if (decision.nextStatus === "accepted") {
      await tx.teamMembership.createMany({
        // Ignores the conflict if a membership somehow already exists (double-tap, or an admin added
        // them by other means) — the invite still lands in `accepted` either way.
        data: [{ teamId: invite.teamId, userId: invite.invitedUserId, role: invite.role }],
        skipDuplicates: true,
      });
    }
  });

  if (invite.invitedByUserId) {
    await notifyAdminOfTeamInviteReply({
      adminUserId: invite.invitedByUserId,
      teamName: invite.team.name,
      responderLabel: user.name?.trim() || user.email?.trim() || null,
      accepted: decision.nextStatus === "accepted",
    });
  }

  return NextResponse.json({
    ok: true,
    status: decision.nextStatus,
    teamId: invite.teamId,
    teamName: invite.team.name,
  });
}
