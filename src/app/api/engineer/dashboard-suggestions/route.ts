import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import {
  getOrComputeDashboardSuggestion,
  peekDashboardSuggestion,
} from "@/lib/engineerPhase5/dashboardSuggestions/getOrComputeDashboardSuggestion";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const runId = url.searchParams.get("runId")?.trim() || null;
  const sync =
    url.searchParams.get("sync") === "1" || url.searchParams.get("sync")?.toLowerCase() === "true";

  if (!runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }

  try {
    if (sync) {
      const { suggestions } = await getOrComputeDashboardSuggestion(user.id, runId);
      return NextResponse.json({ suggestions });
    }

    const peeked = await peekDashboardSuggestion(user.id, runId);
    if (!peeked) {
      void getOrComputeDashboardSuggestion(user.id, runId).catch(() => {});
    }
    return NextResponse.json({ suggestions: peeked });
  } catch {
    return NextResponse.json({ error: "Failed to load suggestions" }, { status: 500 });
  }
}
