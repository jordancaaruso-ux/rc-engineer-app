import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { getFavouriteTrackIdsForUser } from "@/lib/track-favourites";
import { NewRunForm } from "@/components/runs/NewRunFormDynamic";
import { hasDatabaseUrl } from "@/lib/env";
import { getDashboardNewRunPrefill, loadIncompleteRunsForImportChooser } from "@/lib/dashboardServer";
import { NewRunImportLinkChooser } from "@/components/runs/NewRunImportLinkChooser";
import { CardPanel } from "@/components/ui/CardPanel";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { getLastRunForCopyPreview } from "@/lib/runs/getLastRunForCopyPreview";
import { CopyLastRunFormProvider } from "@/components/runs/CopyLastRunFormContext";
import { NewRunCopyLastRunSlot } from "@/components/runs/NewRunCopyLastRunSlot";

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
            <h1 className="page-title text-base text-base">Log your run</h1>
            <p className="page-subtitle">Database not configured yet.</p>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-3xl" contentClassName="text-sm text-muted-foreground">
            Set <span className="font-mono">DATABASE_URL</span> in a{" "}
            <span className="font-mono">.env</span> file (Postgres) to enable
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

  const [dashboardPrefill, incompleteRunsForImport, cars, allTracks, favouriteTrackIds, copyPreviewRun] =
    await Promise.all([
    getDashboardNewRunPrefill(user.id, sp),
    importedLapTimeSessionIdRaw.length > 0
      ? loadIncompleteRunsForImportChooser(user.id, initialEventId)
      : Promise.resolve([]),
    prisma.car.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, setupSheetTemplate: true, setupSheetModelId: true },
    }),
    prisma.track.findMany({
      where: {},
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

  const favSet = new Set(favouriteTrackIds);
  const favouriteTracks = allTracks.filter((t) => favSet.has(t.id));
  const tracks = allTracks;

  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title text-base">Log your run</h1>
          <p className="page-subtitle mt-0.5">Capture session details, laps, and setup.</p>
        </div>
      </header>
      <section className="page-body max-w-3xl">
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
            />
          </NewRunImportLinkChooser>
        </CopyLastRunFormProvider>
      </section>
    </>
  );
}

