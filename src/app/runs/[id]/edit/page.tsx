import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getFavouriteTrackIdsForUser } from "@/lib/track-favourites";
import { trackCatalogScopeWhere } from "@/lib/tracks/communityTrackAccess";
import { NewRunForm } from "@/components/runs/NewRunFormDynamic";
import { RunVideoAnalysisSection } from "@/components/videoAnalysis/RunVideoAnalysisSection";
import { CardPanel } from "@/components/ui/CardPanel";
import { getDashboardNewRunPrefill } from "@/lib/dashboardServer";
import { runConditionsFromRecord } from "@/lib/weather/runConditionsRecord";
import { deriveEditEntry } from "@/lib/runs/wizardEntry";

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

  const user = await requireCurrentUser();
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
      trackLayoutId: true,
      trackLayout: { select: { id: true, name: true } },
      trackDirection: true,
      eventId: true,
      event: {
        select: {
          id: true,
          name: true,
          trackId: true,
          trackLayoutId: true,
          trackDirection: true,
          startDate: true,
          endDate: true,
          track: { select: { id: true, name: true, location: true } },
          participations: {
            where: { userId: user.id },
            select: { notes: true },
            take: 1,
          },
        },
      },
      raceClass: true,
      tireTypeId: true,
      tireStintId: true,
      tireAgeKnown: true,
      tireType: { select: { id: true, displayName: true } },
      tireRunNumber: true,
      additiveTypeId: true,
      warmerTimingMinutes: true,
      tirePrep: true,
      additiveType: { select: { id: true, displayName: true, modelCode: true } },
      setupSnapshot: { select: { id: true, data: true } },
      notes: true,
      driverNotes: true,
      handlingProblems: true,
      suggestedChanges: true,
      suggestedPreRun: true,
      handlingAssessmentJson: true,
      carRating: true,
      lapTimes: true,
      lapSession: true,
      importedLapSets: {
        select: {
          driverName: true,
          displayName: true,
          isPrimaryUser: true,
          sourceUrl: true,
          driverId: true,
          sessionCompletedAt: true,
          laps: { orderBy: { lapNumber: "asc" } },
        },
      },
      linkedImportedLapSessions: {
        select: {
          id: true,
          sourceUrl: true,
          parserId: true,
          createdAt: true,
          sessionCompletedAt: true,
          parsedPayload: true,
        },
        orderBy: { createdAt: "desc" },
      },
      loggingComplete: true,
      shareWithTeam: true,
      conditionsAirTempC: true,
      conditionsTrackTempC: true,
      conditionsCloudCoverPct: true,
      conditionsWeatherCode: true,
      conditionsHumidityPct: true,
      conditionsWindKph: true,
      conditionsWindDirDeg: true,
      conditionsSource: true,
      conditionsLatitude: true,
      conditionsLongitude: true,
      conditionsObservedAt: true,
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
      select: { id: true, name: true, setupSheetTemplate: true, setupSheetModelId: true },
    }),
    prisma.track.findMany({
      where: trackCatalogScopeWhere(user),
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        location: true,
        latitude: true,
        longitude: true,
        gripTags: true,
        layoutTags: true,
        liveRcUrl: true,
        speedhiveUrl: true,
      },
    }),
    getFavouriteTrackIdsForUser(user.id),
  ]);

  const favSet = new Set(favouriteTrackIds);
  const favouriteTracks = allTracks.filter((t) => favSet.has(t.id));

  // All edits open in the wizard (founder 2026-07-17): finishing a draft
  // resumes at the first unfinished step; editing a completed run reviews from
  // Session. `?wizard=0` (or NEXT_PUBLIC_LOGRUN_WIZARD=0) forces the classic
  // single-page editor; the imported-lap attach deep link stays classic (its
  // prefill lands mid-form on lap ingest).
  const wizardForced =
    process.env.NEXT_PUBLIC_LOGRUN_WIZARD === "1" ||
    (typeof sp.wizard === "string" && sp.wizard === "1");
  const wizardDisabled =
    process.env.NEXT_PUBLIC_LOGRUN_WIZARD === "0" ||
    (typeof sp.wizard === "string" && sp.wizard === "0");
  const classicOnlyContext =
    typeof sp.importedLapTimeSessionId === "string" &&
    sp.importedLapTimeSessionId.trim().length > 0;
  const wizardEnabled = !wizardDisabled && (wizardForced || !classicOnlyContext);
  const wizardEntry = wizardEnabled
    ? deriveEditEntry({
        carId: run.carId ?? run.car?.id ?? null,
        sessionType: run.sessionType,
        meetingSessionType: run.meetingSessionType,
        sessionLabel: run.sessionLabel,
        eventId: run.eventId,
        trackId: run.trackId,
        trackLayoutId: run.trackLayoutId ?? run.trackLayout?.id ?? null,
        trackDirection: run.trackDirection ?? null,
      })
    : null;
  const finishingDraft = wizardEnabled && run.loggingComplete === false;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">{finishingDraft ? "Finish your run" : "Edit run"}</h1>
          <p className="page-subtitle">
            {finishingDraft
              ? "Pick up where you left off — laps, feedback, done."
              : "Update notes, laps, tire context, or setup details."}
          </p>
        </div>
      </header>
      <section className="page-body">
        <NewRunForm
          cars={cars}
          tracks={allTracks}
          favouriteTrackIds={favouriteTrackIds}
          favouriteTracks={favouriteTracks}
          dashboardPrefill={dashboardPrefill}
          wizard={wizardEntry}
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
            trackLayoutId: run.trackLayoutId ?? null,
            trackLayout: run.trackLayout ? { id: run.trackLayout.id, name: run.trackLayout.name } : null,
            trackDirection: run.trackDirection ?? null,
            raceClass: run.raceClass ?? null,
            eventId: run.eventId,
            tireTypeId: run.tireTypeId,
            tireStintId: run.tireStintId,
            tireAgeKnown: run.tireAgeKnown,
            tireRunNumber: run.tireRunNumber,
            additiveTypeId: run.additiveTypeId,
            warmerTimingMinutes: run.warmerTimingMinutes,
            tirePrep: run.tirePrep,
            additiveType: run.additiveType,
            setupSnapshot: run.setupSnapshot,
            event: run.event
              ? {
                  id: run.event.id,
                  name: run.event.name,
                  trackId: run.event.trackId,
                  trackLayoutId: run.event.trackLayoutId,
                  trackDirection: run.event.trackDirection,
                  startDate: run.event.startDate.toISOString(),
                  endDate: run.event.endDate.toISOString(),
                  notes: run.event.participations[0]?.notes ?? null,
                  track: run.event.track
                    ? { id: run.event.track.id, name: run.event.track.name, location: run.event.track.location }
                    : null,
                }
              : null,
            track: run.track ? { id: run.track.id, name: run.track.name } : null,
            tireType: run.tireType,
            notes: run.notes,
            driverNotes: run.driverNotes,
            handlingProblems: run.handlingProblems,
            suggestedChanges: run.suggestedChanges,
            suggestedPreRun: run.suggestedPreRun,
            handlingAssessmentJson: run.handlingAssessmentJson,
            carRating: run.carRating,
            lapTimes: run.lapTimes,
            lapSession: run.lapSession,
            importedLapSets: run.importedLapSets.map((s) => ({
              driverName: s.driverName,
              displayName: s.displayName,
              isPrimaryUser: s.isPrimaryUser,
              sourceUrl: s.sourceUrl,
              driverId: s.driverId,
              sessionCompletedAt: s.sessionCompletedAt?.toISOString() ?? null,
              laps: s.laps.map((l) => ({
                lapNumber: l.lapNumber,
                lapTimeSeconds: l.lapTimeSeconds,
                isIncluded: l.isIncluded,
              })),
            })),
            linkedImportedSessions: run.linkedImportedLapSessions.map((s) => ({
              id: s.id,
              sourceUrl: s.sourceUrl,
              parserId: s.parserId,
              createdAt: s.createdAt.toISOString(),
              sessionCompletedAt: s.sessionCompletedAt?.toISOString() ?? null,
              parsedPayload: s.parsedPayload,
            })),
            loggingComplete: run.loggingComplete,
            shareWithTeam: run.shareWithTeam,
            conditions: runConditionsFromRecord(run),
          }}
        />
        <CardPanel className="mt-8 max-w-2xl">
          <h2 className="text-sm font-medium mb-2">Video lap sync</h2>
          <RunVideoAnalysisSection runId={run.id} trackId={run.trackId} />
        </CardPanel>
      </section>
    </>
  );
}

