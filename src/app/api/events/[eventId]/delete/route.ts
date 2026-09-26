import { NextResponse } from "next/server";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { deleteOwnEvent } from "@/lib/events/deleteOwnEvent";
import { revalidateAfterEventMutation, revalidateAfterRunMutation } from "@/lib/revalidateUser";

export const dynamic = "force-dynamic";

/**
 * Delete a meeting you made, while nobody else is on it (founder ruling 2026-09-26). Your runs on
 * it stay, as days at its track. A LiveRC meeting is never deleted here: it has no racer maker.
 * Rules and the transaction: src/lib/events/deleteOwnEvent.ts.
 *
 * A POST beside `join/`, not a DELETE on the event, so it can't be mistaken for an admin removal.
 */
export async function POST(_request: Request, context: { params: Promise<{ eventId: string }> }) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { eventId } = await context.params;
  if (!eventId?.trim()) {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 });
  }

  const result = await deleteOwnEvent(eventId, userId);
  if (!result.ok) {
    if (result.reason === "not-found") {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    if (result.reason === "liverc-meeting") {
      return NextResponse.json({ error: "A LiveRC meeting can't be deleted." }, { status: 403 });
    }
    if (result.reason === "not-maker") {
      return NextResponse.json(
        { error: "Only the driver who made this meeting can delete it." },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: "Someone else is on this meeting." }, { status: 409 });
  }

  revalidateAfterEventMutation(userId);
  // The runs regroup in Sessions and Analysis as days at the track.
  revalidateAfterRunMutation(userId);
  return NextResponse.json({ ok: true, runsKept: result.runsKept });
}
