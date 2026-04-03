import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const { searchParams } = new URL(request.url);
  const batteryId = searchParams.get("batteryId");

  if (!batteryId) {
    return NextResponse.json({ error: "batteryId is required" }, { status: 400 });
  }

  const last = await prisma.run.findFirst({
    where: { userId: user.id, batteryId },
    orderBy: { createdAt: "desc" },
    select: { batteryRunNumber: true },
  });

  if (last?.batteryRunNumber != null) {
    return NextResponse.json({ lastBatteryRunNumber: last.batteryRunNumber });
  }

  const battery = await prisma.battery.findFirst({
    where: { id: batteryId, userId: user.id },
    select: { initialRunCount: true },
  });

  return NextResponse.json({ lastBatteryRunNumber: battery?.initialRunCount ?? 0 });
}
