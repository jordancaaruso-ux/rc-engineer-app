"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { LapComparisonColumnGrid } from "@/components/runs/LapComparisonColumnGrid";
import type { CompareRunShape } from "@/components/runs/RunComparePanel";
import type { RunCompareListSource } from "@/lib/runCompareCatalog";
import { toCompareRunShape } from "@/lib/runCompareShape";
import type { LapRow } from "@/lib/lapAnalysis";
import {
  formatDriverSessionLabel,
  resolveImportedSessionDisplayTimeIso,
  resolveImportedSessionHasWallClockTime,
  timingSourceFromParserId,
  timingSourceFromSourceUrl,
} from "@/lib/lapImport/labels";
import { primaryLapRowsFromImportedPayload } from "@/lib/lapImport/fromPayload";

type CompareRunInput = Parameters<typeof toCompareRunShape>[0];

type RunWithImports = CompareRunInput & {
  importedLapSets?: Array<{
    id: string;
    createdAt?: Date | string;
    sessionCompletedAt?: Date | string | null;
    driverName: string;
    displayName?: string | null;
    isPrimaryUser?: boolean;
    laps?: Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded?: boolean }>;
  }>;
};

type Props = {
  open: boolean;
  onClose: () => void;
  run: RunWithImports;
  pickerRunsSameCar: CompareRunShape[];
  runListSource: RunCompareListSource;
  /** Driver of THIS run — a teammate's name on a shared session, not the viewer's. */
  userDisplayName?: string | null;
  /** False when the run belongs to a teammate. */
  runOwnedByViewer?: boolean;
  viewerUserId?: string | null;
  memberDisplayByUserId?: Record<string, string>;
};

export function RunLapAnalysisModal({
  open,
  onClose,
  run,
  pickerRunsSameCar,
  runListSource,
  userDisplayName,
  runOwnedByViewer = true,
  viewerUserId = null,
  memberDisplayByUserId,
}: Props) {
  const [importedLapSetsFull, setImportedLapSetsFull] = useState<RunWithImports["importedLapSets"] | null>(null);
  const [importedLapsLoading, setImportedLapsLoading] = useState(false);
  const [importedLapsError, setImportedLapsError] = useState<string | null>(null);
  const [libraryLapSessions, setLibraryLapSessions] = useState<
    Array<{
      id: string;
      selectLabel: string;
      laps: LapRow[];
      sortTimeIso: string;
      trackName: string | null;
    }>
  >([]);

  const missingImportedLapRows =
    (run.importedLapSets?.length ?? 0) > 0 && run.importedLapSets!.some((s) => !("laps" in s));

  const runForLapCompare = useMemo((): RunWithImports => {
    if (importedLapSetsFull?.length) {
      return { ...run, importedLapSets: importedLapSetsFull };
    }
    return run;
  }, [run, importedLapSetsFull]);

  useEffect(() => {
    if (!open) {
      setImportedLapSetsFull(null);
      setImportedLapsError(null);
      setImportedLapsLoading(false);
    }
  }, [open, run.id]);

  // Escape closes, and the page underneath is frozen — without the lock a flick
  // that lands outside the grid scrolls the run page behind the sheet, which is
  // half of why it read as "somewhere down the page" rather than as a modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    if ((run.importedLapSets?.length ?? 0) === 0) return;
    if (importedLapSetsFull) return;
    if (!missingImportedLapRows) {
      setImportedLapSetsFull(run.importedLapSets);
      return;
    }
    let alive = true;
    setImportedLapsLoading(true);
    setImportedLapsError(null);
    fetch(`/api/runs/${encodeURIComponent(run.id)}/imported-lap-sets`)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          sets?: RunWithImports["importedLapSets"];
        };
        if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
        return data.sets ?? [];
      })
      .then((sets) => {
        if (alive) setImportedLapSetsFull(sets);
      })
      .catch((err) => {
        if (alive) {
          setImportedLapsError(err instanceof Error ? err.message : "Failed to load imported laps");
        }
      })
      .finally(() => {
        if (alive) setImportedLapsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, run.id, run.importedLapSets, importedLapSetsFull, missingImportedLapRows]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/lap-time-sessions", { cache: "no-store" })
      .then((r) => r.json().catch(() => null))
      .then(
        (data: {
          sessions?: Array<{
            id: string;
            createdAt: string;
            sessionCompletedAt?: string | null;
            sourceUrl?: string | null;
            parserId?: string | null;
            trackName?: string | null;
            parsedPayload: unknown;
          }>;
        } | null) => {
          if (!alive || !data?.sessions) return;
          const mapped: Array<{
            id: string;
            selectLabel: string;
            laps: LapRow[];
            sortTimeIso: string;
            trackName: string | null;
          }> = [];
          for (const s of data.sessions) {
            const parsed = primaryLapRowsFromImportedPayload(s.parsedPayload);
            if (!parsed) continue;
            const whenIso = resolveImportedSessionDisplayTimeIso({
              sessionCompletedAt: s.sessionCompletedAt ?? null,
              parsedPayload: s.parsedPayload,
              createdAt: s.createdAt,
            });
            mapped.push({
              id: s.id,
              selectLabel: formatDriverSessionLabel(parsed.driverName, whenIso, {
                timingSource:
                  timingSourceFromParserId(s.parserId) ?? timingSourceFromSourceUrl(s.sourceUrl),
                isWallClockTime: resolveImportedSessionHasWallClockTime({
                  sessionCompletedAt: s.sessionCompletedAt ?? null,
                  parsedPayload: s.parsedPayload,
                }),
              }),
              laps: parsed.rows,
              sortTimeIso: whenIso,
              trackName: s.trackName ?? null,
            });
          }
          setLibraryLapSessions(mapped);
        }
      )
      .catch(() => {
        if (alive) setLibraryLapSessions([]);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  /*
   * Portalled to <body>, above the dock, and a real height — three separate
   * reasons this sheet used to open as a strip stranded at the bottom of the
   * page:
   *
   *  - Rendered in place, it sat inside `.page-body` among the run's cards. Any
   *    transformed or backdrop-blurred ancestor turns `fixed` into `absolute`
   *    and pins the overlay to that ancestor instead of the viewport — the same
   *    trap the Ideas, Upload and exit-prompt sheets already portal around.
   *  - z-50 tied the floating dock, which is drawn later, so the nav pill won
   *    the stack and covered the sheet's bottom rows. z-[60] clears it while
   *    staying under `PickerSheet` (z-[70]), which opens *from* this sheet's
   *    own run/driver selects and has to land on top of it.
   *  - `max-h` alone let a short or failed body collapse to a few rows hugging
   *    the bottom edge — the "super low on the page" part. It now opens at a
   *    fixed sheet height, in `dvh` so iOS browser chrome can't push the bottom
   *    off-screen.
   */
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center p-0 sm:p-4 bg-black/50"
      role="dialog"
      aria-modal
      aria-labelledby="lap-analysis-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex h-[min(92dvh,720px)] max-h-full w-full flex-col rounded-t-lg border border-border bg-surface-runna pb-[env(safe-area-inset-bottom)] shadow-lg sm:max-w-4xl sm:rounded-lg sm:pb-0"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 shrink-0">
          <h2 id="lap-analysis-modal-title" className="text-sm font-semibold text-foreground truncate pr-2">
            Lap times — column compare
          </h2>
          <button
            type="button"
            className="btn-surface px-2 py-1 text-[11px] font-medium shrink-0"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="overflow-y-auto p-2 sm:p-3 min-h-0 flex-1">
          {importedLapsError ? (
            <p className="text-xs text-destructive mb-2">{importedLapsError}</p>
          ) : null}
          {missingImportedLapRows && importedLapsLoading && !importedLapSetsFull ? (
            <p className="text-xs text-muted-foreground py-2">Loading imported lap sets…</p>
          ) : (
            <LapComparisonColumnGrid
              primaryDriverName={userDisplayName}
              primaryIsViewer={runOwnedByViewer}
              run={runForLapCompare}
              currentRunId={run.id}
              otherRuns={pickerRunsSameCar.filter((r) => r.id !== run.id)}
              compareAnchorRun={toCompareRunShape(run)}
              pickerRunsForModal={pickerRunsSameCar}
              runListSource={runListSource}
              librarySessions={libraryLapSessions}
              viewerUserId={viewerUserId}
              memberDisplayByUserId={memberDisplayByUserId}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
