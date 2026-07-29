import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import {
  getOrComputeDashboardSuggestion,
  peekDashboardSuggestion,
  findLatestPrimaryRunIdForDashboardSuggestion,
} from "@/lib/engineerPhase5/dashboardSuggestions/getOrComputeDashboardSuggestion";
import { withPerfRoute } from "@/lib/perf/withPerfRoute";

export const dynamic = "force-dynamic";

/**
 * Wrapped for `Server-Timing`: the dashboard and the Engineer strip both hit this on
 * mount, and the peek-vs-sync split is exactly the kind of thing worth seeing in
 * DevTools rather than inferring from a rollup.
 */
export const GET = withPerfRoute("/api/engineer/dashboard-suggestions", async (request: Request) => {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const runIdParam = url.searchParams.get("runId")?.trim() || null;
  const latest =
    url.searchParams.get("latest") === "1" || url.searchParams.get("latest")?.toLowerCase() === "true";
  const sync =
    url.searchParams.get("sync") === "1" || url.searchParams.get("sync")?.toLowerCase() === "true";

  let runId = runIdParam;
  if (!runId && latest) {
    runId = await findLatestPrimaryRunIdForDashboardSuggestion(userId);
  }
  if (!runId) {
    if (latest) {
      return NextResponse.json({ suggestions: null });
    }
    return NextResponse.json({ error: "runId required (or pass latest=1)" }, { status: 400 });
  }

  try {
    if (sync) {
      const { suggestions, cached } = await getOrComputeDashboardSuggestion(userId, runId);
      return NextResponse.json({ suggestions, runId, cached });
    }

    const peeked = await peekDashboardSuggestion(userId, runId);
    return NextResponse.json({ suggestions: peeked, runId, cached: peeked != null });
  } catch {
    return NextResponse.json({ error: "Failed to load suggestions" }, { status: 500 });
  }
});
