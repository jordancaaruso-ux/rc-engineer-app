import { NextResponse } from "next/server";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { loadTimingSessionsFromRun } from "@/lib/manualVideoAnalysis/loadTiming";
import { defaultDriverKeys } from "@/lib/manualVideoAnalysis/timing";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });

  const sessions = await loadTimingSessionsFromRun(runId, userId);
  if (!sessions?.length) {
    return NextResponse.json(
      { error: "No imported lap sets on this run" },
      { status: 404 }
    );
  }

  const drivers = sessions.flatMap((s) => s.drivers);

  return NextResponse.json({
    sessions,
    drivers,
    defaults: defaultDriverKeys(drivers),
  });
}
