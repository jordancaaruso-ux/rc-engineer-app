import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { loadTeamFeedModel } from "@/lib/teams/loadTeamFeed";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ teamId: string }> };

/** One page of the team delta feed. `?cursor=` pages older; membership is enforced in the loader. */
export async function GET(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { teamId } = await ctx.params;
  const url = new URL(request.url);
  const timeZone = await getExplicitTimeZoneForRunFormatting();

  const model = await loadTeamFeedModel({
    viewerId: userId,
    teamId,
    timeZone,
    cursor: url.searchParams.get("cursor"),
    pinnedRunId: url.searchParams.get("run"),
  });
  // `loadTeamFeedModel` returns null for a non-member — a 404 rather than a 403 so team
  // existence isn't confirmed to outsiders.
  if (!model) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    entries: model.entries,
    nextCursor: model.nextCursor,
    pinnedEntry: model.pinnedEntry,
  });
}
