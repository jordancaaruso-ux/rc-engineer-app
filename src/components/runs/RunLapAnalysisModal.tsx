"use client";

import React, { useEffect, useMemo, useState } from "react";
import { LapComparisonColumnGrid } from "@/components/runs/LapComparisonColumnGrid";
import type { CompareRunShape } from "@/components/runs/RunComparePanel";
import type { RunCompareListSource } from "@/lib/runCompareCatalog";
import { toCompareRunShape } from "@/lib/runCompareShape";
import type { LapRow } from "@/lib/lapAnalysis";
import {
  formatDriverSessionLabel,
  resolveImportedSessionDisplayTimeIso,
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
  userDisplayName?: string | null;
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
  viewerUserId = null,
  memberDisplayByUserId,
}: Props) {
  const [importedLapSetsFull, setImportedLapSetsFull] = useState<RunWithImports["importedLapSets"] | null>(null);
  const [importedLapsLoading, setImportedLapsLoading] = useState(false);
  const [importedLapsError, setImportedLapsError] = useState<string | null>(null);
  const [libraryLapSessions, setLibraryLapSessions] = useState<
    Array<{ id: string; selectLabel: string; laps: LapRow[]; sortTimeIso: string }>
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
            parsedPayload: unknown;
          }>;
        } | null) => {
          if (!alive || !data?.sessions) return;
          const mapped: Array<{ id: string; selectLabel: string; laps: LapRow[]; sortTimeIso: string }> = [];
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
              selectLabel: formatDriverSessionLabel(parsed.driverName, whenIso),
              laps: parsed.rows,
              sortTimeIso: whenIso,
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4 bg-black/50"
      role="dialog"
      aria-modal
      aria-labelledby="lap-analysis-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-h-[min(92vh,720px)] sm:max-w-4xl rounded-t-lg sm:rounded-lg border border-border bg-card shadow-lg flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 shrink-0">
          <h2 id="lap-analysis-modal-title" className="text-sm font-semibold text-foreground truncate pr-2">
            Lap times — column compare
          </h2>
          <button
            type="button"
            className="rounded-md border border-border bg-muted/60 px-2 py-1 text-[11px] font-medium hover:bg-muted transition shrink-0"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="overflow-y-auto p-3 min-h-0 flex-1">
          {importedLapsError ? (
            <p className="text-xs text-red-600 dark:text-red-400 mb-2">{importedLapsError}</p>
          ) : null}
          {missingImportedLapRows && importedLapsLoading && !importedLapSetsFull ? (
            <p className="text-xs text-muted-foreground py-2">Loading imported lap sets…</p>
          ) : (
            <LapComparisonColumnGrid
              myDisplayName={userDisplayName}
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
    </div>
  );
}
