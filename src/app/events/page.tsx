import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { EventList } from "@/components/events/EventList";

/** Match /tracks + /runs/new: always load user events/tracks fresh (avoids stale static RSC for selectors). */
export const dynamic = "force-dynamic";

export default async function EventsPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Events</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <div className="max-w-2xl rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Set DATABASE_URL in .env to manage events.
          </div>
        </section>
      </>
    );
  }

  const user = await requireCurrentUser();
  const [events, tracks] = await Promise.all([
    prisma.event.findMany({
      where: { userId: user.id },
      orderBy: { startDate: "desc" },
      take: 120,
      include: {
        track: { select: { id: true, name: true, location: true } },
      },
    }),
    prisma.track.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, location: true },
    }),
  ]);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Events</h1>
          <p className="page-subtitle">
            Create and manage race meetings and events. Link events to tracks and use them when logging runs.
          </p>
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
