import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { listJoinableTeamEventsAtTrack } from "@/lib/events/findJoinableTeamEvent";
import { eventIdsInScopeForUser } from "@/lib/events/eventParticipation";
import { loadTeamMemberDisplays } from "@/lib/teams/teamMemberDisplay";

export const dynamic = "force-dynamic";

/**
 * My team's events at this track that I am not on yet.
 *
 * The pop-up prompt only fires for an event running *now*, and only if you happen to have the run
 * wizard open with the right track selected. This is the same question asked somewhere you can go
 * looking: it fills a "Your team" group in the event picker, so a meeting a teammate booked for
 * Saturday is selectable on Wednesday instead of invisible until race morning.
 *
 * Selecting one is not enough to make it yours — the client posts to `/api/events/[eventId]/join`,
 * which is where the access rule is enforced. Nothing here is a permission decision beyond the team
 * scoping `listJoinableTeamEventsAtTrack` already applies.
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const trackId = searchParams.get("trackId")?.trim();
  if (!trackId) {
    return NextResponse.json({ error: "trackId is required" }, { status: 400 });
  }

  const [matches, alreadyOn] = await Promise.all([
    listJoinableTeamEventsAtTrack({
      viewerId: userId,
      trackId,
      referenceDate: new Date(),
    }),
    eventIdsInScopeForUser(userId),
  ]);

  // Anything already in scope is in the picker's own Upcoming/Past groups; listing it twice would
  // offer to "join" an event the driver has already logged runs on.
  const onSet = new Set(alreadyOn);
  const fresh = matches.filter((m) => !onSet.has(m.id) && m.userId !== userId);
  if (fresh.length === 0) {
    return NextResponse.json({ joinable: [] });
  }

  const displays = await loadTeamMemberDisplays(
    [...new Set(fresh.map((m) => m.userId).filter((id): id is string => Boolean(id)))],
    userId
  );

  return NextResponse.json({
    joinable: fresh.map((m) => ({
      id: m.id,
      name: m.name,
      startDate: m.startDate.toISOString(),
      endDate: m.endDate.toISOString(),
      isOnToday: m.isOnToday,
      ownerName: m.userId ? displays.get(m.userId)?.name ?? null : null,
    })),
  });
}
