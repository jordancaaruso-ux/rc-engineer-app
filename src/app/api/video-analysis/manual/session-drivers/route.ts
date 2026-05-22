import { NextResponse } from "next/server";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { loadDriversFromRun } from "@/lib/manualVideoAnalysis/loadTiming";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });

  const drivers = await loadDriversFromRun(runId, user.id);
  if (!drivers?.length) {
    return NextResponse.json(
      { error: "No imported lap sets on this run" },
      { status: 404 }
    );
  }

  return NextResponse.json({ drivers });
}
