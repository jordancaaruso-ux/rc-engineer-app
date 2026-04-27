import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { assertTeamAdmin, assertUserInTeam } from "@/lib/teamAccess";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ teamId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { teamId } = await ctx.params;
  if (!(await assertUserInTeam(teamId, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const team = await prisma.team.findFirst({
    where: { id: teamId },
    select: {
      id: true,
      name: true,
      createdAt: true,
      memberships: {
        orderBy: { joinedAt: "asc" },
        select: {
          id: true,
          userId: true,
          role: true,
          joinedAt: true,
          user: { select: { name: true, email: true } },
        },
      },
    },
  });
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  const viewerMembership = team.memberships.find((m) => m.userId === user.id);
  const viewerRole = viewerMembership?.role ?? "member";

  return NextResponse.json({
    team: {
      id: team.id,
      name: team.name,
      createdAt: team.createdAt.toISOString(),
      viewerUserId: user.id,
      viewerRole,
      members: team.memberships.map((m) => ({
        userId: m.userId,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
        name: m.user.name?.trim() || null,
        email: m.user.email?.trim() || null,
      })),
    },
  });
}

export async function PATCH(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { teamId } = await ctx.params;
  if (!(await assertTeamAdmin(teamId, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Team name is required" }, { status: 400 });
  }
  const team = await prisma.team.update({
    where: { id: teamId },
    data: { name },
    select: { id: true, name: true },
  });
  return NextResponse.json({ team });
}
