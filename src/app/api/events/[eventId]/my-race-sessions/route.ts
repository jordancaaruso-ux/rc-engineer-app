import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { listMyPendingRaceSessionsForEvent } from "@/lib/eventLapDiscovery/myRaceSessionsForEvent";

/**
 * Race sessions on the event's LiveRC results hub where the user appears in the result table,
 * excluding sessions already linked to a saved run. Uses per-session HTTP checks (concurrency-limited).
 */
export async function GET(_request: Request, context: { params: Promise<{ eventId: string }> }) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { eventId } = await context.params;
  if (!eventId?.trim()) {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 });
  }

  const data = await listMyPendingRaceSessionsForEvent(userId, eventId.trim());
  return NextResponse.json(data);
}
