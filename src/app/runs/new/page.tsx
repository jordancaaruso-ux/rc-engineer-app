import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { getFavouriteTrackIdsForUser } from "@/lib/track-favourites";
import { trackCatalogScopeWhere } from "@/lib/tracks/communityTrackAccess";
import { NewRunForm } from "@/components/runs/NewRunFormDynamic";
import { hasDatabaseUrl } from "@/lib/env";
import {
  getDashboardNewRunPrefill,
  loadIncompleteRunsForImportChooser,
  loadTodaysIncompleteRuns,
} from "@/lib/dashboardServer";
import { NewRunImportLinkChooser } from "@/components/runs/NewRunImportLinkChooser";
import { ResumeDraftChooser } from "@/components/runs/ResumeDraftChooser";
import { CardPanel } from "@/components/ui/CardPanel";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { getLastRunForCopyPreview } from "@/lib/runs/getLastRunForCopyPreview";
import { CopyLastRunFormProvider } from "@/components/runs/CopyLastRunFormProvider";
import { NewRunCopyLastRunSlot } from "@/components/runs/NewRunCopyLastRunSlot";
import { decodeLabFields } from "@/lib/rollCenter/labState";
import { LogRunWizardHost } from "@/components/runs/LogRunWizardHost";
import { toEntryCandidate } from "@/lib/runs/entryCandidate";
import { platformForChassisSlug } from "@/lib/cars/chassisPlatform";
import { lastRunAtMsByCarId, orderCarsByRecentUse } from "@/lib/cars/orderCarsByRecentUse";

export default async function NewRunPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Log your run</h1>
            <p className="page-subtitle">Database not configured yet.</p>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-3xl" contentClassName="text-sm text-muted-foreground">
            Set <span className="type-machine">DATABASE_URL</span> in a{" "}
            <span className="type-machine">.env</span> file (Postgres) to enable
            saving runs.
          </CardPanel>
        </section>
      </>
    );
  }

  const [user, displayTimeZone, sp] = await Promise.all([
    requireCurrentUser(),
    getExplicitTimeZoneForRunFormatting(),
    searchParams,
  ]);
  const initialEventId =
    typeof sp.eventId === "string" && sp.eventId.trim().length > 0 ? sp.eventId.trim() : null;
  const focusSection: "setup" | null =
    typeof sp.focus === "string" && sp.focus.trim().toLowerCase() === "setup"
      ? "setup"
      : null;
  const importedLapTimeSessionIdRaw =
    typeof sp.importedLapTimeSessionId === "string" ? sp.importedLapTimeSessionId.trim() : "";
  const importFailed = typeof sp.importError === "string" && sp.importError.trim() === "1";
  // `?resume=1` is the "new run — tap to log it" notification landing: offer to continue
  // today's in-progress draft (preserving pre-run setup) before falling through to a blank form.
  const resumeDraft = typeof sp.resume === "string" && sp.resume.trim() === "1";
  // Geometry Lab export: geometry field values to merge into the setup sheet
  // (docs/ROLL_CENTER_NORTH_STAR.md Phase 3 "Lab state → draft setup").
  const labSetupPrefill =
    typeof sp.labSetup === "string" && sp.labSetup.length > 0 ? decodeLabFields(sp.labSetup) : null;

  // Log-run wizard is the primary flow for a manual "new run" (founder 2026-07-16).
  // Deep-link flows that only the classic single-page form renders — imported-lap
  // attach, resume-draft, Geometry Lab export, focus=setup, import error — fall
  // back to classic. `?wizard=0` (or NEXT_PUBLIC_LOGRUN_WIZARD=0) forces classic
  // anywhere; `?wizard=1` forces the wizard even in those deep-link contexts.
  //
  // Decided here, above the fetch wave, because it is pure `searchParams` + env: doing
  // it later meant the wizard path paid an extra serial round trip for today's drafts
  // after every other query had already landed.
  const wizardForced =
    process.env.NEXT_PUBLIC_LOGRUN_WIZARD === "1" ||
    (typeof sp.wizard === "string" && sp.wizard === "1");
  const wizardDisabled =
    process.env.NEXT_PUBLIC_LOGRUN_WIZARD === "0" ||
    (typeof sp.wizard === "string" && sp.wizard === "0");
  const classicOnlyContext =
    importedLapTimeSessionIdRaw.length > 0 ||
    resumeDraft ||
    focusSection === "setup" ||
    labSetupPrefill != null ||
    importFailed;
  const wizardEnabled = !wizardDisabled && (wizardForced || !classicOnlyContext);

  const [
    dashboardPrefill,
    incompleteRunsForImport,
    todaysDrafts,
    carsByCreated,
    carLastRuns,
    allTracks,
    favouriteTrackIds,
    copyPreviewRun,
  ] = await Promise.all([
    getDashboardNewRunPrefill(user.id, sp),
    importedLapTimeSessionIdRaw.length > 0
      ? loadIncompleteRunsForImportChooser(user.id, initialEventId)
      : Promise.resolve([]),
    // One fetch for both consumers: the resume-draft banner and the wizard host.
    resumeDraft || wizardEnabled
      ? loadTodaysIncompleteRuns(user.id, displayTimeZone)
      : Promise.resolve([]),
    prisma.car.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        setupSheetTemplate: true,
        setupSheetModelId: true,
        // Chassis slug → platform for the car-swap tire rule (replaces the dropped
        // `Car.carClass` picker; drivers never see it).
        setupSheetModel: { select: { slug: true } },
      },
    }),
    prisma.run.groupBy({
      by: ["carId"],
      where: { userId: user.id, carId: { not: null } },
      _max: { createdAt: true },
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
      },
    }),
    getFavouriteTrackIdsForUser(user.id),
    getLastRunForCopyPreview(user.id),
  ]);

  // Car picker order: most recently used first — see `orderCarsByRecentUse`, which the Garage
  // list shares. Top car doubles as the pre-selected default.
  const cars = orderCarsByRecentUse(carsByCreated, lastRunAtMsByCarId(carLastRuns), (c) =>
    c.createdAt.getTime(),
  )
    .map(({ setupSheetModel, ...c }) => ({
      ...c,
      // Unknown chassis → null → treated as the same platform, so tires still carry.
      platform: platformForChassisSlug(setupSheetModel?.slug),
    }));

  const favSet = new Set(favouriteTrackIds);
  const favouriteTracks = allTracks.filter((t) => favSet.has(t.id));
  const tracks = allTracks;

  if (wizardEnabled) {
    const wizardDrafts = todaysDrafts;
    return (
      <>
        <header className="page-header">
          <div className="min-w-0">
            <h1 className="page-title">Log your run</h1>
            <p className="page-subtitle">Pick the car, continue or start fresh, and go.</p>
          </div>
        </header>
        <section className="page-body max-w-3xl">
          <LogRunWizardHost
            entryCars={cars.map((c) => ({ id: c.id, name: c.name }))}
            initialCandidate={toEntryCandidate(copyPreviewRun)}
            currentEventId={initialEventId}
            drafts={wizardDrafts.map((d) => ({
              id: d.id,
              carName: d.carName,
              trackName: d.trackName,
              eventName: d.eventName,
              sessionLabel: d.sessionLabel,
              createdAt: d.createdAt,
            }))}
            cars={cars}
            tracks={tracks}
            favouriteTrackIds={favouriteTrackIds}
            favouriteTracks={favouriteTracks}
            dashboardPrefill={dashboardPrefill}
            initialCopyPreviewRun={copyPreviewRun}
            // Runs always carry a car, so an empty groupBy means no runs at all
            // — a free first-run signal, no extra query.
            isFirstRun={carLastRuns.length === 0}
            homeTrackId={favouriteTrackIds[0] ?? null}
          />
        </section>
      </>
    );
  }

  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Log your run</h1>
          <p className="page-subtitle">Capture session details, laps, and setup.</p>
        </div>
      </header>
      <section className="page-body max-w-3xl">
        {importFailed ? (
          <CardPanel className="mb-4" contentClassName="text-[11px] leading-snug text-muted-foreground">
            We couldn&apos;t fetch that result yet — it may still be posting. Log this run manually
            now, or tap the notification again shortly and the laps should attach.
          </CardPanel>
        ) : null}
        <ResumeDraftChooser drafts={todaysDrafts} displayTimeZone={displayTimeZone}>
          <CopyLastRunFormProvider previewRun={copyPreviewRun}>
            <NewRunImportLinkChooser
              incompleteRuns={incompleteRunsForImport}
              importedLapTimeSessionId={importedLapTimeSessionIdRaw || null}
              eventId={initialEventId}
              displayTimeZone={displayTimeZone}
            >
              {copyPreviewRun ? (
                <div className="mb-4">
                  <NewRunCopyLastRunSlot displayTimeZone={displayTimeZone} />
                </div>
              ) : null}
              <NewRunForm
                cars={cars}
                tracks={tracks}
                favouriteTrackIds={favouriteTrackIds}
                favouriteTracks={favouriteTracks}
                dashboardPrefill={dashboardPrefill}
                initialEventId={initialEventId}
                focusSection={focusSection}
                initialCopyPreviewRun={copyPreviewRun}
                labSetupPrefill={labSetupPrefill}
              />
            </NewRunImportLinkChooser>
          </CopyLastRunFormProvider>
        </ResumeDraftChooser>
      </section>
    </>
  );
}

