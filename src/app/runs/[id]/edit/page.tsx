import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getFavouriteTrackIdsForUser } from "@/lib/track-favourites";
import { trackCatalogScopeWhere } from "@/lib/tracks/communityTrackAccess";
import { NewRunForm } from "@/components/runs/NewRunFormDynamic";
import { CardPanel } from "@/components/ui/CardPanel";
import { getDashboardNewRunPrefill } from "@/lib/dashboardServer";
import { runConditionsFromRecord } from "@/lib/weather/runConditionsRecord";
import { deriveEditEntry } from "@/lib/runs/wizardEntry";
import { WIZARD_STEPS } from "@/lib/runs/wizardWalk";
import { safeAppPath } from "@/lib/navigation/safeAppPath";
import { confirmRunReturnHref } from "@/lib/runs/confirmRunHref";
import { disciplineForCar } from "@/lib/cars/chassisPlatform";

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
      // The front end of a front/rear car, and what each end is glued to.
      frontTireTypeId: true,
      frontTireStintId: true,
      frontTireAgeKnown: true,
      frontTireRunNumber: true,
      frontTireType: { select: { id: true, displayName: true } },
      tireFitment: true,
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
      unconfirmedAt: true,
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

  const [carRows, allTracks, favouriteTrackIds] = await Promise.all([
    prisma.car.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        setupSheetTemplate: true,
        setupSheetModelId: true,
        carClass: true,
        setupSheetModel: { select: { slug: true, discipline: true } },
      },
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

  // The discipline decides which tires the form offers and how it asks for them, same as a new
  // run — the edit form was handed no platform at all before 2026-09-19.
  const cars = carRows.map(({ setupSheetModel, carClass, ...c }) => ({
    ...c,
    platform: disciplineForCar({
      carClass,
      setupSheetTemplate: c.setupSheetTemplate,
      setupSheetModel,
    }),
  }));

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
  /**
   * `?step=laps` — the Sessions row "no lap times" warning drops the driver
   * straight on the importer. Validated against the step model so a junk value
   * falls back to the normal first-unfinished walk rather than wedging the form.
   */
  const wizardInitialStep =
    wizardEnabled && typeof sp.step === "string"
      ? WIZARD_STEPS.find((s) => s.id === sp.step)?.id ?? null
      : null;

  /*
   * `?back=` — where a save lands when someone sent the driver here for one thing.
   *
   * The session view's "Replace link" has put this on its href since the day it was built,
   * and until 2026-08-21 NOTHING READ IT: every save ran `navigateAway("/")` and the driver
   * who came to swap one timing link was handed the dashboard. The comment beside that link
   * claimed it "comes back here", which made it a doc claim rather than behaviour.
   *
   * Null when nobody said, which keeps the wizard's own landings exactly as they were — a
   * run logged from the dock still finishes on the dashboard with its `?suggestRun` nudge.
   */
  /*
   * A run the app filed from the timing sheet is here to be CONFIRMED, and a confirmation
   * lands back on that day's Sessions list, where the rest of the day's unconfirmed runs are —
   * not on the dashboard with a `?suggestRun` nudge meant for a run just logged. Anyone who
   * said where they came from (`?back=`) still wins.
   */
  const confirming = wizardEnabled && run.loggingComplete && run.unconfirmedAt != null;
  const returnHref = safeAppPath(sp.back) ?? (confirming ? confirmRunReturnHref(run.id) : null);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">
            {finishingDraft ? "Finish your run" : confirming ? "Confirm run" : "Edit run"}
          </h1>
          <p className="page-subtitle">
            {finishingDraft
              ? "Pick up where you left off — laps, feedback, done."
              : confirming
                ? "Check what was carried over, rate it, confirm."
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
          wizardInitialStep={wizardInitialStep}
          returnHref={returnHref}
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
            frontTireTypeId: run.frontTireTypeId,
            frontTireStintId: run.frontTireStintId,
            frontTireAgeKnown: run.frontTireAgeKnown,
            frontTireRunNumber: run.frontTireRunNumber,
            frontTireType: run.frontTireType,
            tireFitment: run.tireFitment,
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
            unconfirmedAt: run.unconfirmedAt?.toISOString() ?? null,
            shareWithTeam: run.shareWithTeam,
            conditions: runConditionsFromRecord(run),
          }}
        />
        {/* The "Video lap sync" card (`RunVideoAnalysisSection`) came off 2026-09-15 by founder
            call: video is on no surface for now. The component is still in the tree. */}
      </section>
    </>
  );
}

