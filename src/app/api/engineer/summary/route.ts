import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { getOrComputeEngineerSummaryForLatestRun } from "@/lib/engineerPhase5/loadLatestEngineerSummary";

export const dynamic = "force-dynamic";

/**
 * Latest run's deterministic Engineer Summary (no OpenAI).
 * Prefer `/api/runs/[id]/engineer-summary` when the run id is known.
 */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const result = await getOrComputeEngineerSummaryForLatestRun(user.id);
  if (!result) {
    return NextResponse.json({ summary: null, cached: false, runId: null });
  }
  return NextResponse.json({
    summary: result.summary,
    cached: result.cached,
    runId: result.summary.currentRunId,
  });
}
