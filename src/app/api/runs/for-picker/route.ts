import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { carIdsSharingSetupTemplate } from "@/lib/carSetupScope";
import { withIncludedBestLapForPicker } from "@/lib/lapAnalysis";

/**
 * Past runs for Load setup + Compare pickers (newest first).
 *
 *   ?carId=   — only cars sharing that car's setup template (the setup pickers).
 *   ?track=   — only runs at the venue of that NAME, any car (the lap-times picker's
 *               "This track only": the venue is matched on its name because imported
 *               and legacy rows carry only a `trackNameSnapshot`, exactly as
 *               `lapCompareTrackKey` matches it on the client).
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const carId = searchParams.get("carId")?.trim() || null;
  const trackName = searchParams.get("track")?.trim() || null;
  const scopeCarIds = carId ? await carIdsSharingSetupTemplate(userId, carId) : null;

  const runs = await prisma.run.findMany({
    where: {
      userId,
      ...(carId && scopeCarIds?.length ? { carId: { in: scopeCarIds } } : {}),
      ...(trackName
        ? {
            OR: [
              { track: { name: { equals: trackName, mode: "insensitive" } } },
              { trackNameSnapshot: { equals: trackName, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { sortAt: "desc" },
    take: 200,
    select: {
      id: true,
      userId: true,
      createdAt: true,
      sessionCompletedAt: true,
      loggingCompletedAt: true,
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
      lapSession: true,
      bestLapSeconds: true,
      tireRunNumber: true,
      setupSnapshot: { select: { id: true, data: true } },
      car: { select: { id: true, name: true, setupSheetTemplate: true, setupSheetModelId: true } },
      track: { select: { id: true, name: true } },
      event: { select: { name: true } },
    },
  });

  return NextResponse.json({ runs: runs.map(withIncludedBestLapForPicker) });
}
