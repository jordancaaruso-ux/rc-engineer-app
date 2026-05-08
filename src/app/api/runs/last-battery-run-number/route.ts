import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const batteryId = searchParams.get("batteryId");
  const excludeRunId = searchParams.get("excludeRunId");

  if (!batteryId) {
    return NextResponse.json({ error: "batteryId is required" }, { status: 400 });
  }

  // Drafts do not claim a battery-run slot — only completed runs do. See
  // the last-tire-run-number route for rationale — max index, not latest createdAt.
  const agg = await prisma.run.aggregate({
    where: {
      userId: user.id,
      batteryId,
      loggingComplete: true,
      ...(excludeRunId ? { id: { not: excludeRunId } } : {}),
    },
    _max: { batteryRunNumber: true },
  });

  if (agg._max.batteryRunNumber != null) {
    return NextResponse.json({ lastBatteryRunNumber: agg._max.batteryRunNumber });
  }

  const battery = await prisma.battery.findFirst({
    where: { id: batteryId, userId: user.id },
    select: { initialRunCount: true },
  });

  return NextResponse.json({ lastBatteryRunNumber: battery?.initialRunCount ?? 0 });
}
