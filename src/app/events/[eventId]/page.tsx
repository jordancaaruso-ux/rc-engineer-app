import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { formatEventDate } from "@/lib/formatDate";
import Link from "next/link";
import { EventLapSourcesPanel } from "@/components/events/EventLapSourcesPanel";

export default async function EventDetailPage(props: {
  params: Promise<{ eventId: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Event</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <div className="max-w-2xl rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Set DATABASE_URL in .env to view events.
          </div>
        </section>
      </>
    );
  }

  const { eventId } = await props.params;
  const user = await getOrCreateLocalUser();

  const event = await prisma.event.findFirst({
    where: { id: eventId, userId: user.id },
    include: {
      track: { select: { id: true, name: true, location: true } },
    },
  });

  if (!event) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Event</h1>
            <p className="page-subtitle">Not found.</p>
          </div>
          <Link
            href="/events"
            className="rounded-md border border-border bg-card px-4 py-2 text-xs hover:bg-muted transition"
          >
            Back to Events
          </Link>
        </header>
      </>
    );
  }

  const runCount = await prisma.run.count({
    where: { eventId: event.id, userId: user.id },
  });

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">{event.name}</h1>
          <p className="page-subtitle">Event details.</p>
        </div>
        <Link
          href="/events"
          className="rounded-md border border-border bg-card px-4 py-2 text-xs hover:bg-muted transition"
        >
          Back to Events
        </Link>
      </header>
      <section className="page-body">
        <div className="max-w-2xl space-y-4">
          <EventLapSourcesPanel
            eventId={event.id}
            practiceSourceUrl={event.practiceSourceUrl}
            resultsSourceUrl={event.resultsSourceUrl}
            raceClass={event.raceClass}
          />

          <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm">
            <div className="grid gap-2">
              <div>
                <span className="text-sm font-medium text-muted-foreground">Start date</span>
                <span className="ml-2">{formatEventDate(event.startDate)}</span>
              </div>
              <div>
                <span className="text-sm font-medium text-muted-foreground">End date</span>
                <span className="ml-2">{formatEventDate(event.endDate)}</span>
              </div>
              {event.track && (
                <div>
                  <span className="text-sm font-medium text-muted-foreground">Track</span>
                  <span className="ml-2">
                    <Link href={`/tracks/${event.track.id}`} className="hover:underline">
                      {event.track.name}
                      {event.track.location ? ` (${event.track.location})` : ""}
                    </Link>
                  </span>
                </div>
              )}
              <div>
                <span className="text-sm font-medium text-muted-foreground">Runs</span>
                <span className="ml-2">{runCount}</span>
              </div>
              {event.notes && (
                <div className="pt-2 border-t border-border mt-2">
                  <span className="text-sm font-medium text-muted-foreground block mb-1">Notes</span>
                  <p className="text-foreground whitespace-pre-wrap">{event.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
