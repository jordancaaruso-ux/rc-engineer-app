import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import Link from "next/link";
import { EventLapSourcesPanel } from "@/components/events/EventLapSourcesPanel";
import { EventMetaEditor } from "@/components/events/EventMetaEditor";
import {
  EVENT_LIST_INCLUDE,
  mapEventForUser,
  userCanAccessEvent,
} from "@/lib/events/eventParticipation";

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
  const user = await requireCurrentUser();

  const raw = await prisma.event.findUnique({
    where: { id: eventId },
    include: EVENT_LIST_INCLUDE,
  });

  if (!raw || !(await userCanAccessEvent(user.id, eventId))) {
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

  const event = mapEventForUser(raw, user.id);

  const runCount = await prisma.run.count({
    where: { eventId: event.id, userId: user.id },
  });

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">{event.name}</h1>
          <p className="page-subtitle">
            {event.hasLiveRcLink ? "LiveRC linked meeting" : "Planned meeting"}
          </p>
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
          <EventMetaEditor
            eventId={event.id}
            initialName={event.name}
            initialTrackId={event.trackId}
            initialStartDate={event.startDate}
            initialEndDate={event.endDate}
            initialNotes={event.notes}
            initialControlledTireTypeId={event.controlledTireTypeId}
            runCount={runCount}
          />

          <EventLapSourcesPanel
            eventId={event.id}
            practiceSourceUrl={event.practiceSourceUrl}
            resultsSourceUrl={event.resultsSourceUrl}
            raceClass={event.raceClass}
          />
        </div>
      </section>
    </>
  );
}
