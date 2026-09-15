import { NextResponse } from "next/server";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { userCanAccessEvent } from "@/lib/events/eventParticipation";
import { revalidateAfterDebriefMutation } from "@/lib/revalidateUser";
import {
  DEBRIEF_TEXT_MAX_LENGTH,
  eventIdFromMeetingKey,
  isValidLocalDayKey,
  isValidMeetingKey,
  isValidTrackKey,
  normalizeDebriefText,
  type DebriefIdentity,
} from "@/lib/debrief/debriefKey";
import { saveDebrief } from "@/lib/debrief/loadDebrief";

/**
 * Save the driver's debrief for one meeting. Idempotent: the box commits on blur, so the same
 * text can arrive twice. No GET — the Sessions page loads debriefs server-side with the day.
 *
 * The identity comes from the client because only the client knows which group the box sat
 * under, but nothing in it is trusted as authority: the event id is re-derived from the key,
 * and an event key the caller has no runs or participation on is a 404, exactly as the event
 * routes answer. A day key is the caller's own (user, day, track) triple and needs no check —
 * the row is theirs whatever they type into it.
 */
export async function PUT(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    meetingKey?: unknown;
    localDayKey?: unknown;
    trackKey?: unknown;
    text?: unknown;
  } | null;
  if (
    !body ||
    !isValidMeetingKey(body.meetingKey) ||
    !isValidLocalDayKey(body.localDayKey) ||
    !isValidTrackKey(body.trackKey)
  ) {
    return NextResponse.json({ error: "Invalid meeting" }, { status: 400 });
  }
  if (typeof body.text === "string" && body.text.length > DEBRIEF_TEXT_MAX_LENGTH) {
    return NextResponse.json({ error: "Too long" }, { status: 400 });
  }

  const identity: DebriefIdentity = {
    meetingKey: body.meetingKey,
    eventId: eventIdFromMeetingKey(body.meetingKey),
    localDayKey: body.localDayKey,
    trackKey: body.trackKey,
  };
  if (identity.eventId && !(await userCanAccessEvent(userId, identity.eventId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const saved = await saveDebrief(userId, identity, normalizeDebriefText(body.text));
  revalidateAfterDebriefMutation();
  return NextResponse.json({ debrief: saved });
}
