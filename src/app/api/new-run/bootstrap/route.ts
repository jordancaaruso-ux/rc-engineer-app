import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }
  const userId = await getAuthenticatedApiUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [cars, tracks] = await Promise.all([
    prisma.car.findMany({
      where: { userId: userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true }
    }),
    prisma.track.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        location: true,
        liveRcUrl: true,
        latitude: true,
        longitude: true,
        gripTags: true,
        layoutTags: true,
      },
    })
  ]);

  return NextResponse.json({ cars, tracks });
}

