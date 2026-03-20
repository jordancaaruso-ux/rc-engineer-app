import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }
  const user = await getOrCreateLocalUser();
  const { searchParams } = new URL(request.url);
  const tireSetId = searchParams.get("tireSetId");

  if (!tireSetId) {
    return NextResponse.json(
      { error: "tireSetId is required" },
      { status: 400 }
    );
  }

  const last = await prisma.run.findFirst({
    where: { userId: user.id, tireSetId },
    orderBy: { createdAt: "desc" },
    select: { tireRunNumber: true }
  });

  if (last?.tireRunNumber != null) {
    return NextResponse.json({ lastTireRunNumber: last.tireRunNumber });
  }

  const tireSet = await prisma.tireSet.findFirst({
    where: { id: tireSetId, userId: user.id },
    select: { initialRunCount: true },
  });

  return NextResponse.json({ lastTireRunNumber: tireSet?.initialRunCount ?? 0 });
}

