"use client";

import { useEffect, useMemo, useState } from "react";
import { wallClockAsUtcToInstant } from "@/lib/eventActive";
import { LapComparisonColumnGrid } from "@/components/runs/LapComparisonColumnGrid";
import { formatRunDateTime } from "@/lib/formatDate";
import type { CompareRunShape } from "@/components/runs/RunComparePanel";
import type { RunCompareListSource } from "@/lib/runCompareCatalog";
import { useImportedLapLibrary } from "@/components/laps/useImportedLapLibrary";

/**
 * The lap sheet as a page rather than a pop-up.
 *
 * Deliberately thin: it is the SAME grid the run pop-up draws, and every difference
 * between the two is a prop. The point of the full-page door is room — no 720px ceiling,
 * no run page holding its scroll underneath — not a second implementation that drifts.
 *
 * What it does add is an anchor that need not be a Run. `compareAnchorRun` here can be an
 * imported session dressed up by `loadImportedSessionAnchor`, which is how a race on the
 * other side of the world gets read by someone who wasn't in it.
 */
export function LapAnalysisBoard({
  run,
  otherRuns,
  runListSource,
  primaryDriverName,
  primaryIsViewer,
  viewerName = null,
  initialTargetId,
  initialComparisonIds,
  viewerUserId = null,
  trackName = null,
  whenIso = null,
  driverCount = null,
  sourceLabel = null,
  context: contextOverride = null,
  trackClockIso = null,
}: {
  run: CompareRunShape;
  otherRuns: CompareRunShape[];
  runListSource: RunCompareListSource;
  primaryDriverName?: string | null;
  /** False on an imported session the viewer didn't drive — drops the "(my runs)" wording. */
  primaryIsViewer: boolean;
  /** The viewer's own name — what their runs are called beside someone else's session. */
  viewerName?: string | null;
  initialTargetId?: string;
  initialComparisonIds?: string[];
  viewerUserId?: string | null;
  /** The context line's parts — formatted here so its clock matches the grid's. */
  trackName?: string | null;
  whenIso?: string | null;
  driverCount?: number | null;
  sourceLabel?: string | null;
  /**
   * The whole context line, already formatted — an imported session's page sends one written on
   * the track's clock. Wins over the parts above.
   */
  context?: string | null;
  /**
   * An imported session's time on the TRACK's clock, written as UTC (`SessionName.trackClockIso`).
   * The grid prints times in the phone's zone, so a LiveRC time stored as the track's clock read
   * hours out ("20 Jul, 1:30 AM" under a 3:30 PM session). Turned back into the real instant here,
   * the same way the grid already does for sessions brought in from the library.
   */
  trackClockIso?: string | null;
}) {
  // The sheet's own track — the only place its pickers look.
  const { sessions: librarySessions, reload: reloadLibrary, loaded: libraryLoaded } = useImportedLapLibrary(
    true,
    run.track?.name?.trim() || run.trackNameSnapshot?.trim() || null
  );

  /*
   * Drawn only after hydration, and this is not a preference.
   *
   * The grid formats every session time with `formatRunDateTime(iso)` and no explicit zone,
   * so it renders in whatever zone the runtime is in. That has always been safe because the
   * grid only ever existed inside a pop-up, which mounts on a tap and therefore only ever
   * renders in the browser. Server-rendering it from a page puts the SAME component through
   * a UTC render on Vercel and a local-zone render on the phone, and every run time in the
   * header disagrees — a hydration mismatch React reports and does not repair.
   *
   * Threading a timezone through a 1,600-line component with a dozen formatting call sites
   * is the deeper fix; this is the honest one. A lap sheet is a tool you open, not a document
   * anything needs in the first byte of HTML.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const sheetRun = useMemo(() => {
    if (!mounted || !trackClockIso || !run.id.startsWith("import:")) return run;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const at = new Date(trackClockIso);
    if (Number.isNaN(at.getTime())) return run;
    const instantIso = wallClockAsUtcToInstant(at, zone).toISOString();
    return {
      ...run,
      sessionCompletedAt: instantIso,
      sortAt: instantIso,
      // Everyone on the sheet ran in the same session.
      importedLapSets: run.importedLapSets?.map((set) => ({ ...set, sessionCompletedAt: instantIso })),
    };
  }, [mounted, run, trackClockIso]);
  if (!mounted) {
    return (
      <p className="px-1 py-6 text-[13px] text-muted-foreground" aria-live="polite">
        Loading lap times…
      </p>
    );
  }

  /*
   * The context line renders HERE, beside the grid, not on the server above it.
   *
   * Server-rendered it read "10 Apr, 2:45 AM" while the target column of the same sheet,
   * eighty pixels below, read "10 Apr, 12:45 PM" — the page had a timezone and the grid
   * had the browser's. One session, one screen, two clocks. Whatever the sheet says about
   * when a session ran, this has to say the same thing, and the only way to guarantee that
   * is to read the same clock.
   */
  const context = contextOverride ?? [
    trackName,
    whenIso ? formatRunDateTime(whenIso) : null,
    driverCount != null && driverCount > 1 ? `${driverCount} drivers` : null,
    sourceLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-3">
      {context ? <p className="ui-caption text-muted-foreground">{context}</p> : null}
      <LapComparisonColumnGrid
        primaryDriverName={primaryDriverName}
        primaryIsViewer={primaryIsViewer}
        viewerName={viewerName}
        run={sheetRun}
        currentRunId={run.id}
        otherRuns={otherRuns.filter((r) => r.id !== run.id)}
        compareAnchorRun={sheetRun}
        pickerRunsForModal={otherRuns}
        runListSource={runListSource}
        librarySessions={librarySessions}
        onLibraryChanged={reloadLibrary}
        libraryLoaded={libraryLoaded}
        viewerUserId={viewerUserId}
        initialTargetId={initialTargetId}
        initialComparisonIds={initialComparisonIds}
        /* No `onOpenFullAnalysis`: this IS the full analysis. */
      />
    </div>
  );
}
