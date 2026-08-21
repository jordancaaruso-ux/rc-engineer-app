import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { trackCatalogScopeWhere } from "@/lib/tracks/communityTrackAccess";
import { getFavouriteTrackIdsForUser } from "@/lib/track-favourites";
import { EventsView } from "@/components/events/EventsView";
import type { EventListStats } from "@/components/events/EventList";
import { CardPanel } from "@/components/ui/CardPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { loadUserScopedEvents } from "@/lib/events/eventParticipation";
import { loadEventsSeasonModel } from "@/lib/events/seasonModel";

/** Match /tracks + /runs/new: always load user events/tracks fresh (avoids stale static RSC for selectors). */
export const dynamic = "force-dynamic";

/**
 * The season scope lives in the URL rather than in client state, so a year is
 * server-rendered and linkable. `?year=all` is the only non-numeric value; anything
 * unparseable falls through to the model's default (the newest year with events).
 */
function parseYear(raw: string | string[] | undefined): number | null | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  if (value === "all") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 1900 && n < 3000 ? n : undefined;
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header is-echo">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/paddock" />
            <div>
              <h1 className="page-title">Events</h1>
              <p className="page-subtitle">Database not configured.</p>
            </div>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            Set DATABASE_URL in .env to manage events.
          </CardPanel>
        </section>
      </>
    );
  }

  const [user, params] = await Promise.all([requireCurrentUser(), searchParams]);
  const [events, tracks, favouriteTrackIds, model] = await Promise.all([
    loadUserScopedEvents({ userId: user.id, take: 120 }),
    // Same catalog scope as /runs/new and /tracks. Scoping this to `userId` predated the
    // community catalog and meant you could log a run at a track you could not hold an
    // event at — including any track you had just verified but did not create yourself.
    prisma.track.findMany({
      where: trackCatalogScopeWhere(user),
      orderBy: { name: "asc" },
      // liveRcUrl/speedhiveUrl are read by EventAddForm: a track that already carries a timing
      // link makes the per-event practice/race URL boxes redundant, so they are not shown.
      // gripTags/layoutTags are never drawn — they let the picker's search match "carpet" or
      // "high grip", which is how the same sheet already behaves on Log your run.
      select: {
        id: true,
        name: true,
        location: true,
        liveRcUrl: true,
        speedhiveUrl: true,
        gripTags: true,
        layoutTags: true,
      },
    }),
    // Favourites lead the picker. Server-side here because the desktop panel is server-rendered
    // and never refetches; the phone list refreshes both together on navigation.
    getFavouriteTrackIdsForUser(user.id),
    loadEventsSeasonModel({ userId: user.id, year: parseYear(params.year) }),
  ]);

  // The phone list keeps its own row shape; it only borrows the season model's per-event
  // evidence, which is what replaced the `Planned` badge on both breakpoints.
  const stats: EventListStats = {};
  for (const row of model.events) {
    stats[row.id] = {
      runCount: row.runCount,
      bestLapSeconds: row.bestLapSeconds,
      vsVenueSeconds: row.vsVenueSeconds,
    };
  }

  return (
    <EventsView
      model={model}
      tracks={tracks}
      favouriteTrackIds={favouriteTrackIds}
      initialEvents={events}
      stats={stats}
    />
  );
}
