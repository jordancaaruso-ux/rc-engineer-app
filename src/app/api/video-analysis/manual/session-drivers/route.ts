import { NextResponse } from "next/server";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { loadTimingSessionsFromRun } from "@/lib/manualVideoAnalysis/loadTiming";
import { defaultDriverKeys } from "@/lib/manualVideoAnalysis/timing";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });

  const sessions = await loadTimingSessionsFromRun(runId, user.id);
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
