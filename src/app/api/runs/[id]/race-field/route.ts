import { NextResponse } from "next/server";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { loadRaceFieldForRun } from "@/lib/lapImport/raceFieldForRun";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Full field of the run's imported timing session (every entrant's laps, race
 * order, user flagged) — powers the run-detail driver-compare pager. Empty
 * `drivers` when the run has no multi-driver session linked.
 */
export async function GET(_req: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const field = await loadRaceFieldForRun(userId, id);
  return NextResponse.json(field);
}
