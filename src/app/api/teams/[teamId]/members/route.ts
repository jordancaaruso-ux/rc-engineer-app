import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { assertTeamAdmin, assertUserInTeam } from "@/lib/teamAccess";
import { isEmailAuthAllowed } from "@/lib/authAllowlist";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ teamId: string }> };

/** Admin adds a member by email (existing User, allowlisted). */
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
  if (!peer) {
    return NextResponse.json({ error: "No user found with that email" }, { status: 404 });
  }
  if (peer.id === user.id) {
    return NextResponse.json({ error: "You are already on this team" }, { status: 400 });
  }

  const allowed = await isEmailAuthAllowed(peer.email ?? "");
  if (!allowed) {
    return NextResponse.json(
      { error: "That user’s email is not on the sign-in allowlist for this app." },
      { status: 403 }
    );
  }

  try {
    await prisma.teamMembership.create({
      data: { teamId, userId: peer.id, role: "member" },
    });
  } catch {
    return NextResponse.json({ error: "User is already a member" }, { status: 409 });
  }

  return NextResponse.json({
    member: {
      userId: peer.id,
      role: "member",
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

  const membership = await prisma.teamMembership.findFirst({
    where: { teamId, userId: targetUserId },
    select: { id: true, role: true },
  });
  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    if (membership.role === "admin") {
      const adminCount = await tx.teamMembership.count({
        where: { teamId, role: "admin" },
      });
      if (adminCount === 1) {
        const next = await tx.teamMembership.findFirst({
          where: { teamId, userId: { not: targetUserId } },
          orderBy: { joinedAt: "asc" },
          select: { userId: true },
        });
        if (next) {
          await tx.teamMembership.update({
            where: { teamId_userId: { teamId, userId: next.userId } },
            data: { role: "admin" },
          });
        }
      }
    }

    await tx.teamMembership.delete({
      where: { teamId_userId: { teamId, userId: targetUserId } },
    });

    const remaining = await tx.teamMembership.count({ where: { teamId } });
    if (remaining === 0) {
      await tx.team.delete({ where: { id: teamId } });
    }
  });

  return NextResponse.json({ ok: true });
}
