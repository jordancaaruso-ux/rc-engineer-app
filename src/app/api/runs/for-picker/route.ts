import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

/** Past runs for Load setup + Compare pickers (newest first). */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const { searchParams } = new URL(request.url);
  const carId = searchParams.get("carId")?.trim() || null;

  const runs = await prisma.run.findMany({
    where: carId ? { userId: user.id, carId } : { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      createdAt: true,
      sessionLabel: true,
      sessionType: true,
      meetingSessionType: true,
      meetingSessionCode: true,
      eventId: true,
      carId: true,
      carNameSnapshot: true,
      trackNameSnapshot: true,
      lapTimes: true,
      setupSnapshot: { select: { id: true, data: true } },
      car: { select: { name: true } },
      track: { select: { name: true } },
      event: { select: { name: true } },
    },
  });
  return NextResponse.json({ runs });
}
