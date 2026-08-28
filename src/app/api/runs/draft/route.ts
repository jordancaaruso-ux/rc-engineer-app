import { NextResponse } from "next/server";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { getResumableDraft } from "@/lib/runs/loadResumableDrafts";

/**
 * The one unfinished run the resume bars should offer.
 *
 * Was `/api/runs/today-draft`, and the rename is the change: the window is three days rather than
 * today, so last night's unfinished run is still offered. `resumableDraftLogic` carries the rule.
 */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const timeZone = await getExplicitTimeZoneForRunFormatting();
  const draft = await getResumableDraft(userId, timeZone);
  return NextResponse.json({
    draftRunId: draft?.id ?? null,
    draftSavedAt: draft?.savedAt ?? null,
    draftEventName: draft?.eventName ?? null,
    draftIsForToday: draft?.isForToday ?? false,
  });
}
