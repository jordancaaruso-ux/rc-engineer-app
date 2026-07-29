import { NextResponse } from "next/server";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { getTodayDraftRun } from "@/lib/todayDraftRun";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const timeZone = await getExplicitTimeZoneForRunFormatting();
  const draft = await getTodayDraftRun(userId, timeZone);
  return NextResponse.json({
    draftRunId: draft?.id ?? null,
    draftSavedAt: draft?.savedAt ?? null,
  });
}
