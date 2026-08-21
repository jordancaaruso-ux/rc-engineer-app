import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import {
  ensureEventParticipation,
  EVENT_LIST_INCLUDE,
  mapEventForUser,
  userMayJoinEvent,
} from "@/lib/events/eventParticipation";
import { revalidateAfterEventMutation } from "@/lib/revalidateUser";

export const dynamic = "force-dynamic";

/**
 * Join an event the caller can reach but is not yet on, and return it in the shape the run wizard
 * already uses for its own events.
 *
 * `GET /api/events` only ever lists events you are already on, so a freshly matched teammate event
 * is invisible to the wizard — before this route the LiveRC prompt resolved the match against that
 * list and failed with "Could not find the matching event". This is the one place a driver crosses
 * from "matched" to "on it", so `userMayJoinEvent` is enforced here rather than at the call site.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ eventId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { eventId } = await context.params;
  if (!eventId?.trim()) {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 });
  }

  const exists = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true },
  });
  if (!exists) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  if (!(await userMayJoinEvent(userId, eventId))) {
    return NextResponse.json(
      { error: "This event belongs to someone outside your team." },
      { status: 403 }
    );
  }

  await ensureEventParticipation({ userId, eventId });

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: EVENT_LIST_INCLUDE,
  });
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  revalidateAfterEventMutation(userId);

  return NextResponse.json({ event: mapEventForUser(event, userId) });
}
