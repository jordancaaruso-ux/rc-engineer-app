import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { carIdsSharingSetupTemplate } from "@/lib/carSetupScope";

/** Past runs for Load setup + Compare pickers (newest first). */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const carId = searchParams.get("carId")?.trim() || null;
  const scopeCarIds = carId ? await carIdsSharingSetupTemplate(user.id, carId) : null;

  const runs = await prisma.run.findMany({
    where:
      carId && scopeCarIds?.length
        ? { userId: user.id, carId: { in: scopeCarIds } }
        : { userId: user.id },
    orderBy: { sortAt: "desc" },
    take: 200,
    select: {
      id: true,
      createdAt: true,
      sessionCompletedAt: true,
      sortAt: true,
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
