import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { listTeamsForUser } from "@/lib/teamAccess";

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

/** Create a team; creator becomes admin member. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Team name is required" }, { status: 400 });
  }

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
