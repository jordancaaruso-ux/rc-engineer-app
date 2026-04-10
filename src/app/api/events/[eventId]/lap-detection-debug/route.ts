import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { buildEventLapDetectionDebug } from "@/lib/eventLapDetection/lapDetectionDebug";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ eventId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const user = await getOrCreateLocalUser();
  const { eventId } = await context.params;

  const payload = await buildEventLapDetectionDebug(user.id, eventId);
  if (!payload) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  return NextResponse.json(payload);
}
