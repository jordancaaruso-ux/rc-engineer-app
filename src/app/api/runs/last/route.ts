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
  const carId = searchParams.get("carId");

  if (!carId) {
    return NextResponse.json({ error: "carId is required" }, { status: 400 });
  }

  const lastRun = await prisma.run.findFirst({
    where: { userId: user.id, carId },
    orderBy: { createdAt: "desc" },
    include: {
      track: { select: { id: true, name: true } },
      tireSet: { select: { id: true, label: true, setNumber: true } },
      event: { select: { id: true, name: true, trackId: true, startDate: true, endDate: true } },
      setupSnapshot: { select: { id: true, data: true } }
    }
  });

  return NextResponse.json({ lastRun });
}

