import { NextResponse } from "next/server";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { getTodayDraftRun } from "@/lib/todayDraftRun";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const timeZone = await getExplicitTimeZoneForRunFormatting();
  const draft = await getTodayDraftRun(user.id, timeZone);
  return NextResponse.json({
    draftRunId: draft?.id ?? null,
    draftSavedAt: draft?.savedAt ?? null,
  });
}
