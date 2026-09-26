import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { CardPanel } from "@/components/ui/CardPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { EventMetaEditor } from "@/components/events/EventMetaEditor";
import { EventDeleteClient } from "@/components/events/EventDeleteClient";
import { loadEventDeleteView } from "@/lib/events/deleteOwnEvent";
import { canEditSharedEventFields } from "@/lib/events/eventAccess";
import { findMergedEventFor } from "@/lib/events/mergeEvents";
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
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/events" />
            <div>
              <h1 className="page-title">Event</h1>
              <p className="page-subtitle">Database not configured.</p>
            </div>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            Set DATABASE_URL in .env to view events.
          </CardPanel>
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
    // A meeting that joined another one (LiveRC's, usually) sends its drivers on to it.
    const mergedInto = raw ? null : await findMergedEventFor(user.id, eventId);
    if (mergedInto && (await userCanAccessEvent(user.id, mergedInto))) {
      redirect(`/events/${encodeURIComponent(mergedInto)}`);
    }
    // Said in the page body: the header's subtitle is hidden at every width, so this page used to
    // read as a blank "Event" (test drive 2026-09-26, W1-11). A stranger's meeting names nothing.
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/events" />
            <div>
              <h1 className="page-title">Event</h1>
            </div>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="space-y-3 text-sm">
            <p className="text-foreground">
              {raw ? "You’re not on this meeting." : "This meeting isn’t here any more."}
            </p>
            <ButtonLink href="/events" variant="outline">
              Your events
            </ButtonLink>
          </CardPanel>
        </section>
      </>
    );
  }

  const event = mapEventForUser(raw, user.id);

  const [runCount, deleteView] = await Promise.all([
    prisma.run.count({ where: { eventId: event.id, userId: user.id } }),
    loadEventDeleteView(event.id, user.id),
  ]);

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/events" />
          <div>
            <h1 className="page-title">{event.name}</h1>
            <p className="page-subtitle">
              {event.hasLiveRcLink ? "LiveRC linked meeting" : "Planned meeting"}
            </p>
          </div>
        </div>
      </header>
      <section className="page-body">
        <div className="space-y-4">
          {runCount > 0 ? (
            <ButtonLink href={`/engineer?pin=event:${event.id}`} variant="outline">
              Ask the Engineer about this meeting
            </ButtonLink>
          ) : null}

          <EventMetaEditor
            eventId={event.id}
            initialName={event.name}
            initialTrackId={event.trackId}
            initialLegacyTrackLabel={event.trackLabel}
            initialIsLegacyTrack={event.isLegacyTrack}
            initialStartDate={event.startDate}
            initialEndDate={event.endDate}
            initialNotes={event.notes}
            initialPracticeSourceUrl={event.practiceSourceUrl}
            initialResultsSourceUrl={event.resultsSourceUrl}
            initialMyRcmUrl={event.myRcmUrl}
            initialRaceClass={event.raceClass}
            runCount={runCount}
            canEditShared={canEditSharedEventFields(user, raw)}
          />

          {deleteView && deleteView.block === null ? (
            <EventDeleteClient eventId={event.id} myRunCount={deleteView.myRunCount} />
          ) : null}
        </div>
      </section>
    </>
  );
}
