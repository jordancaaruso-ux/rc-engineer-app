import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getFavouriteTrackIdsForUser } from "@/lib/track-favourites";
import { NewRunForm } from "@/components/runs/NewRunForm";
import { getDashboardNewRunPrefill } from "@/lib/dashboardServer";

export const dynamic = "force-dynamic";

export default async function EditRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Edit run</h1>
            <p className="page-subtitle">Database not configured yet.</p>
          </div>
        </header>
      </>
    );
  }

  const user = await getOrCreateLocalUser();
  const { id } = await params;
  const sp = await searchParams;
  const dashboardPrefill = await getDashboardNewRunPrefill(user.id, sp);

  const run = await prisma.run.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      createdAt: true,
      sessionLabel: true,
      sessionType: true,
      meetingSessionType: true,
      meetingSessionCode: true,
      carId: true,
      car: { select: { id: true, name: true, setupSheetTemplate: true } },
      carNameSnapshot: true,
      trackId: true,
      track: { select: { id: true, name: true } },
      trackNameSnapshot: true,
      eventId: true,
      event: {
        select: {
          id: true,
          name: true,
          trackId: true,
          startDate: true,
          endDate: true,
          notes: true,
          track: { select: { id: true, name: true, location: true } },
        },
      },
      raceClass: true,
      tireSetId: true,
      tireSet: { select: { id: true, label: true, setNumber: true, initialRunCount: true } },
      tireRunNumber: true,
      batteryId: true,
      battery: { select: { id: true, label: true, packNumber: true, initialRunCount: true } },
      batteryRunNumber: true,
      setupSnapshot: { select: { id: true, data: true } },
      notes: true,
      driverNotes: true,
      handlingProblems: true,
      suggestedChanges: true,
      handlingAssessmentJson: true,
      lapTimes: true,
      lapSession: true,
      importedLapSets: {
        select: {
          driverName: true,
          displayName: true,
          isPrimaryUser: true,
          laps: { orderBy: { lapNumber: "asc" } },
        },
      },
      loggingComplete: true,
    },
  });

  if (!run) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Edit run</h1>
            <p className="page-subtitle">Run not found.</p>
          </div>
        </header>
      </>
    );
  }

  const [cars, allTracks, favouriteTrackIds] = await Promise.all([
    prisma.car.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, setupSheetTemplate: true },
    }),
    prisma.track.findMany({
      where: { userId: user.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, location: true, gripTags: true, layoutTags: true },
    }),
    getFavouriteTrackIdsForUser(user.id),
  ]);

  const favSet = new Set(favouriteTrackIds);
  const favouriteTracks = allTracks.filter((t) => favSet.has(t.id));

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Edit run</h1>
          <p className="page-subtitle">Update notes, laps, tire/battery context, or setup details.</p>
        </div>
      </header>
      <section className="page-body">
        <NewRunForm
          cars={cars}
          tracks={allTracks}
          favouriteTrackIds={favouriteTrackIds}
          favouriteTracks={favouriteTracks}
          dashboardPrefill={dashboardPrefill}
          editRun={{
            id: run.id,
            createdAt: run.createdAt.toISOString(),
            sessionLabel: run.sessionLabel ?? null,
            sessionType: run.sessionType,
            meetingSessionType: run.meetingSessionType,
            meetingSessionCode: run.meetingSessionCode,
            carId: run.carId ?? undefined,
            car: run.car ? { id: run.car.id, name: run.car.name } : null,
            carNameSnapshot: run.carNameSnapshot ?? null,
            trackId: run.trackId,
            trackNameSnapshot: run.trackNameSnapshot ?? null,
            raceClass: run.raceClass ?? null,
            eventId: run.eventId,
            tireSetId: run.tireSetId,
            tireRunNumber: run.tireRunNumber,
            setupSnapshot: run.setupSnapshot,
            event: run.event
              ? {
                  id: run.event.id,
                  name: run.event.name,
                  trackId: run.event.trackId,
                  startDate: run.event.startDate.toISOString(),
                  endDate: run.event.endDate.toISOString(),
                  notes: run.event.notes,
                  track: run.event.track
                    ? { id: run.event.track.id, name: run.event.track.name, location: run.event.track.location }
                    : null,
                }
              : null,
            track: run.track ? { id: run.track.id, name: run.track.name } : null,
            tireSet: run.tireSet
              ? { id: run.tireSet.id, label: run.tireSet.label, setNumber: run.tireSet.setNumber }
              : null,
            batteryId: run.batteryId,
            batteryRunNumber: run.batteryRunNumber,
            battery: run.battery ? { id: run.battery.id, label: run.battery.label, packNumber: run.battery.packNumber } : null,
            notes: run.notes,
            driverNotes: run.driverNotes,
            handlingProblems: run.handlingProblems,
            suggestedChanges: run.suggestedChanges,
            handlingAssessmentJson: run.handlingAssessmentJson,
            lapTimes: run.lapTimes,
            lapSession: run.lapSession,
            importedLapSets: run.importedLapSets.map((s) => ({
              driverName: s.driverName,
              displayName: s.displayName,
              isPrimaryUser: s.isPrimaryUser,
              laps: s.laps.map((l) => ({
                lapNumber: l.lapNumber,
                lapTimeSeconds: l.lapTimeSeconds,
                isIncluded: l.isIncluded,
              })),
            })),
            loggingComplete: run.loggingComplete,
          }}
        />
      </section>
    </>
  );
}

