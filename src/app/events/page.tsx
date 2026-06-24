import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { EventList } from "@/components/events/EventList";
import { CardPanel } from "@/components/ui/CardPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { loadUserScopedEvents } from "@/lib/events/eventParticipation";

/** Match /tracks + /runs/new: always load user events/tracks fresh (avoids stale static RSC for selectors). */
export const dynamic = "force-dynamic";

export default async function EventsPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/assets" />
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

  const user = await requireCurrentUser();
  const [events, tracks] = await Promise.all([
    loadUserScopedEvents({ userId: user.id, take: 120 }),
    prisma.track.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, location: true },
    }),
  ]);

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/assets" />
          <div>
            <h1 className="page-title">Events</h1>
            <p className="page-subtitle">
              Create and manage race meetings and events. Link events to tracks and use them when logging runs.
            </p>
          </div>
        </div>
      </header>
      <section className="page-body">
        <div className="max-w-2xl">
          <EventList
            initialEvents={events}
            tracks={tracks}
          />
        </div>
      </section>
    </>
  );
}
