"use client";

import { useEffect, useState } from "react";
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
  initialTargetId,
  initialComparisonIds,
  viewerUserId = null,
  trackName = null,
  whenIso = null,
  driverCount = null,
  sourceLabel = null,
}: {
  run: CompareRunShape;
  otherRuns: CompareRunShape[];
  runListSource: RunCompareListSource;
  primaryDriverName?: string | null;
  /** False on an imported session the viewer didn't drive — drops the "(my runs)" wording. */
  primaryIsViewer: boolean;
  initialTargetId?: string;
  initialComparisonIds?: string[];
  viewerUserId?: string | null;
  /** The context line's parts — formatted here so its clock matches the grid's. */
  trackName?: string | null;
  whenIso?: string | null;
  driverCount?: number | null;
  sourceLabel?: string | null;
}) {
  const librarySessions = useImportedLapLibrary();

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
  const context = [
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
        run={run}
        currentRunId={run.id}
        otherRuns={otherRuns.filter((r) => r.id !== run.id)}
        compareAnchorRun={run}
        pickerRunsForModal={otherRuns}
        runListSource={runListSource}
        librarySessions={librarySessions}
        viewerUserId={viewerUserId}
        initialTargetId={initialTargetId}
        initialComparisonIds={initialComparisonIds}
        /* No `onOpenFullAnalysis`: this IS the full analysis. */
      />
    </div>
  );
}
