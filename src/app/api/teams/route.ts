import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser, getAuthenticatedApiUserId } from "@/lib/currentUser";
import { listTeamsForUser } from "@/lib/teamAccess";
import { teamJoinLock, teamLockMessage } from "@/lib/teams/teamLimit";

export const dynamic = "force-dynamic";

/** Teams the current user belongs to (pilot: for Sessions filter + future UI). */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const teams = await listTeamsForUser(userId);
  return NextResponse.json({ teams });
}

/**
 * Create a team; creator becomes admin member. Starting a team counts toward the plan's team limit
 * (`teamLimitFor`): Starter has none, Notebook one. The Teams page draws the lock first; this is
 * the second lock, for a stale page or a direct call.
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = user.id;
  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Team name is required" }, { status: 400 });
  }

  const lock = await teamJoinLock({ id: user.id, email: user.email ?? null });
  if (lock) return NextResponse.json({ error: teamLockMessage(lock.includedIn) }, { status: 402 });

  const team = await prisma.team.create({
    data: {
      name,
      createdByUserId: userId,
      memberships: {
        create: { userId: userId, role: "admin" },
      },
    },
    select: { id: true, name: true, createdAt: true },
  });

  return NextResponse.json({ team });
}
