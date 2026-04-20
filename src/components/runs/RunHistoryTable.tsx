"use client";

import React, { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { formatLap, formatStintTime, normalizeLapTimes } from "@/lib/runLaps";
import { DEFAULT_SETUP_FIELDS, normalizeSetupData } from "@/lib/runSetup";
import { compareSetupField } from "@/lib/setupCompare/compare";
import { displayRunNotes } from "@/lib/runNotes";
import { formatLapSourceSummary, tryReadLapSourceUrl } from "@/lib/lapSession/display";
import type { RunCompareListSource } from "@/lib/runCompareCatalog";
import type { CompareRunShape } from "@/components/runs/RunComparePanel";
import { SetupSheetModal, type SetupSheetModalRun } from "@/components/setup-sheet/SetupSheetModal";
import {
  getAverageTopN,
  getBestLap,
  getIncludedLapDashboardMetrics,
  primaryLapRowsFromRun,
} from "@/lib/lapAnalysis";
import { LapComparisonColumnGrid } from "@/components/runs/LapComparisonColumnGrid";
import { toCompareRunShape } from "@/lib/runCompareShape";
import { AnalysisActiveThingsToTry } from "@/components/runs/AnalysisActiveThingsToTry";
import { primaryLapRowsFromImportedPayload } from "@/lib/lapImport/fromPayload";
import { formatDriverSessionLabel, resolveImportedSessionDisplayTimeIso } from "@/lib/lapImport/labels";
import type { LapRow } from "@/lib/lapAnalysis";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EngineerRunSummaryPanel } from "@/components/engineer/EngineerRunSummaryPanel";
import { RunComparePairCell } from "@/components/runs/AnalysisCompareContext";
import { RelativeTime } from "@/components/ui/RelativeTime";

type Run = {
  id: string;
  createdAt: Date | string;
  sessionCompletedAt?: Date | string | null;
  /**
   * Stable ordering axis. Stamped once on create; only changes when the user
   * explicitly drags a run to a new position in this table. Reading it here
   * lets the component compute drop-target neighbours without a round-trip.
   */
  sortAt?: Date | string | null;
  /** False until user marks "Run completed" when saving. */
  loggingComplete?: boolean;
  carId: string | null;
  eventId: string | null;
  sessionType: string;
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  sessionLabel?: string | null;
  carNameSnapshot?: string | null;
  trackNameSnapshot?: string | null;
  tireRunNumber: number;
  lapTimes: unknown;
  /**
   * Materialized lap summary columns (written at save time). List rows prefer
   * these; when null (legacy rows written before the columns existed) the
   * table falls back to computing from `lapTimes` / `lapSession`.
   */
  bestLapSeconds?: number | null;
  avgTop5LapSeconds?: number | null;
  notes?: string | null;
  driverNotes?: string | null;
  handlingProblems?: string | null;
  suggestedChanges?: string | null;
  car?: { id: string; name: string; setupSheetTemplate?: string | null } | null;
  track?: { id: string; name: string } | null;
  tireSet?: { id: string; label: string; setNumber: number | null } | null;
  event?: { name: string; track?: { name: string } | null } | null;
  setupSnapshot?: { id: string; data: unknown } | null;
  lapSession?: unknown;
  importedLapSets?: Array<{
    id: string;
    createdAt: Date | string;
    sessionCompletedAt?: Date | string | null;
    driverId?: string | null;
    driverName: string;
    displayName?: string | null;
    normalizedName: string;
    isPrimaryUser: boolean;
    /** Omitted on Sessions list SSR; loaded on demand for lap column compare. */
    laps?: Array<{
      lapNumber: number;
      lapTimeSeconds: number;
      isIncluded?: boolean;
    }>;
  }>;
};

function formatLapSourceLinkText(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    const pathShort = path.length > 26 ? `${path.slice(0, 24)}…` : path;
    return `${u.hostname}${pathShort || "/"}`;
  } catch {
    return url.length > 42 ? `${url.slice(0, 39)}…` : url;
  }
}

function CompactField({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-[5.5rem] max-w-[220px] shrink-0">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xs text-foreground break-words">{children ?? value ?? "—"}</div>
    </div>
  );
}

function LapStatChip({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded border border-border bg-muted/80 px-2 py-1 min-w-[4.5rem]" title={title}>
      <div className="text-[9px] font-medium text-muted-foreground leading-none mb-0.5">{label}</div>
      <div className="text-[11px] font-mono tabular-nums text-foreground leading-tight">{value}</div>
    </div>
  );
}

/** Primary action buttons (analyse setup / lap times) — identical styling */
const analyseActionButtonClass =
  "rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-glow-sm hover:brightness-105 transition";

function setupFieldLabel(key: string): string {
  const f = DEFAULT_SETUP_FIELDS.find((d) => d.key === key);
  return f ? f.label + (f.unit ? ` (${f.unit})` : "") : key.replace(/_/g, " ");
}

function setupRows(data: unknown): { label: string; value: string }[] {
  const obj = normalizeSetupData(data);
  const seen = new Set<string>();
  const rows: { label: string; value: string }[] = [];
  for (const f of DEFAULT_SETUP_FIELDS) {
    if (f.key in obj && obj[f.key] != null && String(obj[f.key]).trim() !== "") {
      rows.push({ label: f.label + (f.unit ? ` (${f.unit})` : ""), value: String(obj[f.key]) });
      seen.add(f.key);
    }
  }
  for (const key of Object.keys(obj).sort()) {
    if (seen.has(key)) continue;
    const v = obj[key];
    if (v == null || String(v).trim() === "") continue;
    rows.push({ label: key.replace(/_/g, " "), value: String(v) });
  }
  return rows;
}

/** Inline analysis preview: only fields that differ from the previous run on the same car (compare semantics). */
function setupChangedRowsSincePrevious(current: unknown, previous: unknown): {
  label: string;
  value: string;
  previousValue: string;
}[] {
  const cur = normalizeSetupData(current);
  const prev = normalizeSetupData(previous);
  const keys = new Set([...Object.keys(cur), ...Object.keys(prev)]);
  const rows: { label: string; value: string; previousValue: string }[] = [];
  for (const key of [...keys].sort()) {
    const cmp = compareSetupField({
      key,
      a: cur[key],
      b: prev[key],
      numericAggregationByKey: null,
    });
    if (cmp.areEqual) continue;
    rows.push({
      label: setupFieldLabel(key),
      value: cmp.normalizedA,
      previousValue: cmp.normalizedB,
    });
  }
  return rows;
}

export function RunHistoryTable({
  runs,
  allRunsDescending,
  runListSource = "my_runs",
  userDisplayName,
  showComparePairColumn = false,
  enableReorder = false,
}: {
  runs: Run[];
  allRunsDescending: CompareRunShape[];
  runListSource?: RunCompareListSource;
  /** User / driver name for primary lap column ("Me" if unset). */
  userDisplayName?: string | null;
  /** Analysis page: target / comparison selection column (requires AnalysisCompareProvider). */
  showComparePairColumn?: boolean;
  /**
   * Analysis page: allow the driver to drag rows up/down to fix chronology
   * when the auto-stamped `sortAt` isn't quite right (e.g. ran out of order,
   * logged a run a day late). Within-group only — crossing day / event
   * boundaries by drag is intentionally not supported for now; easier to
   * reason about and avoids accidental reshuffles.
   */
  enableReorder?: boolean;
}) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [setupModalRunId, setSetupModalRunId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<
    { runId: string; edge: "above" | "below" } | null
  >(null);
  const [reorderErr, setReorderErr] = useState<string | null>(null);
  const [reorderBusy, setReorderBusy] = useState(false);

  function toggleRow(runId: string) {
    setExpandedId((prev) => (prev === runId ? null : runId));
  }

  const totalCols =
    (enableReorder ? 1 : 0) /* drag handle */ +
    1 /* date */ + 1 + 1 + 1 + 1 + 1 + 1 /* session */ + 1 /* setup */ + (showComparePairColumn ? 1 : 0);

  async function commitReorder(draggedId: string, targetId: string, edge: "above" | "below") {
    if (draggedId === targetId) return;
    // Build the would-be neighbour pair from the rendered list with the
    // dragged row removed. Newer-first, so "above" = lower index.
    const withoutDragged = runs.filter((r) => r.id !== draggedId);
    const tIdx = withoutDragged.findIndex((r) => r.id === targetId);
    if (tIdx < 0) return;
    let beforeId: string | null;
    let afterId: string | null;
    if (edge === "above") {
      beforeId = withoutDragged[tIdx - 1]?.id ?? null;
      afterId = withoutDragged[tIdx]?.id ?? null;
    } else {
      beforeId = withoutDragged[tIdx]?.id ?? null;
      afterId = withoutDragged[tIdx + 1]?.id ?? null;
    }
    if (!beforeId && !afterId) return;
    setReorderBusy(true);
    setReorderErr(null);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(draggedId)}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beforeId, afterId }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Reorder failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setReorderErr(err instanceof Error ? err.message : "Reorder failed");
    } finally {
      setReorderBusy(false);
    }
  }

  const setupModalRun = useMemo(
    () => runs.find((r) => r.id === setupModalRunId) ?? null,
    [runs, setupModalRunId]
  );

  return (
    <>
      {enableReorder && reorderErr ? (
        <tr>
          <td colSpan={totalCols} className="px-4 py-2 text-xs text-red-600 dark:text-red-300">
            {reorderErr}
          </td>
        </tr>
      ) : null}
      {runs.map((run) => {
        const isExpanded = expandedId === run.id;
        const carDisplay = run.car?.name ?? run.carNameSnapshot ?? "Deleted car";
        const trackDisplay = run.track?.name ?? run.trackNameSnapshot ?? "—";
        const tiresDisplay = run.tireSet
          ? `${run.tireSet.label} · Set ${run.tireSet.setNumber ?? "—"} · Run ${run.tireRunNumber}`
          : "—";
        const isDragging = draggingId === run.id;
        const showDropAbove = dropTarget?.runId === run.id && dropTarget.edge === "above";
        const showDropBelow = dropTarget?.runId === run.id && dropTarget.edge === "below";

        return (
          <React.Fragment key={run.id}>
            <tr
              role="button"
              tabIndex={0}
              draggable={enableReorder && !reorderBusy}
              onDragStart={
                enableReorder
                  ? (e) => {
                      setDraggingId(run.id);
                      e.dataTransfer.effectAllowed = "move";
                      try {
                        e.dataTransfer.setData("text/plain", run.id);
                      } catch {
                        // Some browsers/environments reject setData — non-fatal.
                      }
                    }
                  : undefined
              }
              onDragEnd={
                enableReorder
                  ? () => {
                      setDraggingId(null);
                      setDropTarget(null);
                    }
                  : undefined
              }
              onDragOver={
                enableReorder
                  ? (e) => {
                      if (!draggingId || draggingId === run.id) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      const rect = e.currentTarget.getBoundingClientRect();
                      const midpoint = rect.top + rect.height / 2;
                      const edge: "above" | "below" = e.clientY < midpoint ? "above" : "below";
                      setDropTarget((prev) =>
                        prev?.runId === run.id && prev.edge === edge ? prev : { runId: run.id, edge }
                      );
                    }
                  : undefined
              }
              onDragLeave={
                enableReorder
                  ? () => {
                      setDropTarget((prev) => (prev?.runId === run.id ? null : prev));
                    }
                  : undefined
              }
              onDrop={
                enableReorder
                  ? (e) => {
                      e.preventDefault();
                      const dragged = draggingId;
                      const edge = dropTarget?.edge ?? "below";
                      setDraggingId(null);
                      setDropTarget(null);
                      if (dragged && dragged !== run.id) {
                        void commitReorder(dragged, run.id, edge);
                      }
                    }
                  : undefined
              }
              onClick={() => toggleRow(run.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleRow(run.id);
                }
              }}
              className={cn(
                "border-b border-border/80 hover:bg-muted/50 cursor-pointer select-none",
                isDragging && "opacity-50",
                showDropAbove && "shadow-[inset_0_2px_0_0_var(--color-primary,#2563eb)]",
                showDropBelow && "shadow-[inset_0_-2px_0_0_var(--color-primary,#2563eb)]"
              )}
              aria-expanded={isExpanded}
            >
              {enableReorder ? (
                <td
                  className="w-6 px-1 py-2 text-center text-muted-foreground"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  title="Drag to reorder"
                  aria-label="Drag to reorder"
                >
                  <span className="inline-block cursor-grab select-none text-sm leading-none">⋮⋮</span>
                </td>
              ) : null}
              <td className="px-4 py-2">
                <RelativeTime
                  iso={resolveRunDisplayInstant(run)}
                  fallback={formatRunCreatedAtDateTime(resolveRunDisplayInstant(run))}
                  display="combo"
                />
              </td>
              <td className="px-4 py-2">{carDisplay}</td>
              <td className="px-4 py-2">{trackDisplay}</td>
              <td className="px-4 py-2">{tiresDisplay}</td>
              <td className="px-4 py-2">
                {formatLap(
                  run.bestLapSeconds ?? getBestLap(primaryLapRowsFromRun(run))
                )}
              </td>
              <td className="px-4 py-2">
                {formatLap(
                  run.avgTop5LapSeconds ?? getAverageTopN(primaryLapRowsFromRun(run), 5)
                )}
              </td>
              <td className="px-4 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>{formatRunSessionDisplay(run)}</span>
                  {run.loggingComplete === false ? (
                    <span
                      className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-900 dark:text-amber-100"
                      title="Logging not marked complete"
                    >
                      Not completed
                    </span>
                  ) : null}
                </div>
              </td>
              <td
                className="px-2 py-2 align-middle"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => setSetupModalRunId(run.id)}
                  className="rounded-md border border-border bg-background px-2 py-1 text-[10px] font-medium text-foreground hover:bg-muted/80 transition whitespace-nowrap"
                  title="View setup sheet for this run; compare to another run from the modal"
                >
                  View setup
                </button>
              </td>
              {showComparePairColumn ? <RunComparePairCell runId={run.id} /> : null}
            </tr>
            {isExpanded && (
              <tr className="border-b border-border/80 bg-muted/40">
                <td colSpan={totalCols} className="px-4 py-4">
                  <RunDetail
                    run={run}
                    pickerRuns={allRunsDescending}
                    runListSource={runListSource}
                    userDisplayName={userDisplayName}
                  />
                </td>
              </tr>
            )}
          </React.Fragment>
        );
      })}
      <SetupSheetModal
        open={setupModalRunId !== null}
        onClose={() => setSetupModalRunId(null)}
        run={setupModalRun as SetupSheetModalRun | null}
        pickerRuns={
          (setupModalRun?.carId
            ? allRunsDescending.filter((r) => r.car?.id === setupModalRun.carId)
            : allRunsDescending) as SetupSheetModalRun[]
        }
        runListSource={runListSource}
      />
    </>
  );
}

function RunDetail({
  run,
  pickerRuns,
  runListSource,
  userDisplayName,
}: {
  run: Run;
  pickerRuns: CompareRunShape[];
  runListSource: RunCompareListSource;
  userDisplayName?: string | null;
}) {
  const router = useRouter();
  const [showLapAnalysis, setShowLapAnalysis] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [importedLapSetsFull, setImportedLapSetsFull] = useState<Run["importedLapSets"] | null>(
    null
  );
  const [importedLapsLoading, setImportedLapsLoading] = useState(false);
  const [importedLapsError, setImportedLapsError] = useState<string | null>(null);
  const [libraryLapSessions, setLibraryLapSessions] = useState<
    Array<{ id: string; selectLabel: string; laps: LapRow[]; sortTimeIso: string }>
  >([]);

  const missingImportedLapRows =
    (run.importedLapSets?.length ?? 0) > 0 &&
    run.importedLapSets!.some((s) => !("laps" in s));

  const runForLapCompare = useMemo((): Run => {
    if (importedLapSetsFull?.length) {
      return { ...run, importedLapSets: importedLapSetsFull };
    }
    return run;
  }, [run, importedLapSetsFull]);

  useEffect(() => {
    if (!showLapAnalysis) return;
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
          sets?: Run["importedLapSets"];
        };
        if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
        return data.sets ?? [];
      })
      .then((sets) => {
        if (alive) setImportedLapSetsFull(sets);
      })
      .catch((err) => {
        if (alive) {
          setImportedLapsError(
            err instanceof Error ? err.message : "Failed to load imported laps"
          );
        }
      })
      .finally(() => {
        if (alive) setImportedLapsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [
    showLapAnalysis,
    run.id,
    run.importedLapSets,
    importedLapSetsFull,
    missingImportedLapRows,
  ]);

  async function handleDeleteRun() {
    if (deleting) return;
    const when = formatRunCreatedAtDateTime(resolveRunDisplayInstant(run));
    const carLabel = run.car?.name ?? run.carNameSnapshot ?? "this run";
    const ok = window.confirm(
      `Delete ${carLabel} run from ${when}?\n\nThis removes the run and its lap data. Setup snapshots are kept.`
    );
    if (!ok) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(run.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Delete failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete run");
      setDeleting(false);
    }
  }

  useEffect(() => {
    let alive = true;
    fetch("/api/lap-time-sessions", { cache: "no-store" })
      .then((r) => r.json().catch(() => null))
      .then(
        (data: {
          sessions?: Array<{ id: string; createdAt: string; sessionCompletedAt?: string | null; parsedPayload: unknown }>;
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
  }, []);

  /** Compare / load-setup pickers only offer runs for this vehicle. */
  const pickerRunsSameCar = useMemo(() => {
    if (!run.carId) return pickerRuns;
    return pickerRuns.filter((r) => r.car?.id === run.carId);
  }, [pickerRuns, run.carId]);
  const carDisplay = run.car?.name ?? run.carNameSnapshot ?? "Deleted car";
  const trackDisplay = run.track?.name ?? run.trackNameSnapshot ?? "—";
  const laps = normalizeLapTimes(run.lapTimes);
  const meetingType =
    run.sessionType === "RACE_MEETING" || run.sessionType === "PRACTICE"
      ? run.meetingSessionType === "OTHER" && run.meetingSessionCode?.trim()
        ? run.meetingSessionCode.trim()
        : run.meetingSessionType
          ? {
              PRACTICE: "Practice",
              SEEDING: "Seeding",
              QUALIFYING: "Qualifying",
              RACE: "Race",
              OTHER: "Other",
            }[run.meetingSessionType] ?? run.meetingSessionType
          : "—"
      : "—";
  const previousRunOnCar = useMemo(() => {
    if (!run.carId) return null;
    const idx = pickerRunsSameCar.findIndex((r) => r.id === run.id);
    if (idx < 0 || idx >= pickerRunsSameCar.length - 1) return null;
    return pickerRunsSameCar[idx + 1] ?? null;
  }, [pickerRunsSameCar, run.id, run.carId]);

  const setupPreview = useMemo(() => {
    const prevData = previousRunOnCar?.setupSnapshot?.data;
    if (!run.carId || !prevData) {
      return { mode: "no_baseline" as const, rows: [] as ReturnType<typeof setupRows> };
    }
    const changed = setupChangedRowsSincePrevious(run.setupSnapshot?.data, prevData);
    return { mode: "diff" as const, rows: changed };
  }, [run.setupSnapshot?.data, previousRunOnCar]);
  const ownRows = primaryLapRowsFromRun(run);
  const lapDash = getIncludedLapDashboardMetrics(ownRows);
  const sourceUrl = tryReadLapSourceUrl(run.lapSession);
  const sourceSummary = formatLapSourceSummary(run.lapSession);
  const uploadedLapSetCount = run.importedLapSets?.length ?? 0;
  const uploadedLapSetsLine =
    uploadedLapSetCount === 0
      ? "No additional driver lap sets uploaded"
      : uploadedLapSetCount === 1
        ? "1 driver lap set uploaded"
        : `${uploadedLapSetCount} driver lap sets uploaded`;

  const engineerThisRunHref = `/engineer?runId=${encodeURIComponent(run.id)}`;
  const engineerVsPreviousHref =
    previousRunOnCar &&
    `/engineer?runId=${encodeURIComponent(run.id)}&compareRunId=${encodeURIComponent(previousRunOnCar.id)}`;

  return (
    <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-5 text-sm">
      <EngineerRunSummaryPanel runId={run.id} defaultExpanded={false} />

      <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
        <Link
          href={engineerVsPreviousHref ?? engineerThisRunHref}
          className="inline-flex items-center rounded-lg border border-border bg-card/60 px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted/60 transition"
        >
          {engineerVsPreviousHref ? "Open in Engineer (vs previous same car)" : "Open in Engineer"}
        </Link>
      </div>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:gap-6">
        <div className="min-w-0 space-y-3 xl:max-w-[min(100%,28rem)]">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Run details</h3>
          <div className="flex flex-wrap gap-x-5 gap-y-3">
            <CompactField label="Date / time">
              <RelativeTime
                iso={resolveRunDisplayInstant(run)}
                fallback={formatRunCreatedAtDateTime(resolveRunDisplayInstant(run))}
                display="combo"
              />
            </CompactField>
            <CompactField
              label="Session type"
              value={run.sessionType === "RACE_MEETING" || run.sessionType === "PRACTICE" ? "Race Meeting" : "Testing"}
            />
            <CompactField label="Meeting session" value={meetingType} />
            <CompactField label="Label" value={run.sessionLabel?.trim() || "—"} />
            <CompactField label="Car" value={carDisplay} />
            <CompactField label="Track" value={trackDisplay} />
            <CompactField
              label="Tire set"
              value={
                run.tireSet
                  ? `${run.tireSet.label} · Set ${run.tireSet.setNumber ?? "—"} · Run ${run.tireRunNumber}`
                  : "—"
              }
            />
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-2 border-t border-border pt-4 xl:border-t-0 xl:border-l xl:border-border xl:pt-0 xl:pl-6">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Lap times</h3>

          <div className="space-y-1">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Included-lap metrics
            </div>
            <div className="flex flex-wrap gap-1.5">
              <LapStatChip label="Laps" value={String(lapDash.lapCount)} />
              <LapStatChip
                label="Stint"
                title="Sum of included lap times"
                value={
                  lapDash.stintSeconds != null ? formatStintTime(lapDash.stintSeconds) : "—"
                }
              />
              <LapStatChip label="Best lap" value={formatLap(lapDash.bestLap)} />
              <LapStatChip label="Avg top 5" value={formatLap(lapDash.avgTop5)} />
              <LapStatChip label="Avg top 10" value={formatLap(lapDash.avgTop10)} />
              <LapStatChip label="Median" value={formatLap(lapDash.median)} />
              <LapStatChip
                label="Consistency"
                title="100 − CV; higher = more consistent laps"
                value={
                  lapDash.consistencyScore != null ? `${lapDash.consistencyScore.toFixed(1)}%` : "—"
                }
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              All laps ({laps.length})
            </div>
            {laps.length > 0 ? (
              <ul className="font-mono text-[11px] grid grid-cols-[auto_1fr_auto] gap-x-2 gap-y-0.5 max-h-32 overflow-y-auto rounded border border-border bg-muted/60 px-2 py-1.5">
                {(ownRows.length === laps.length ? ownRows : laps.map((t, i) => ({
                  lapNumber: i + 1,
                  lapTimeSeconds: t,
                  isIncluded: true,
                }))).map((r, i) => (
                  <React.Fragment key={i}>
                    <span
                      className={cn(
                        "text-muted-foreground",
                        !r.isIncluded && "opacity-50 line-through"
                      )}
                    >
                      {r.lapNumber}.
                    </span>
                    <span className={cn(!r.isIncluded && "opacity-50 line-through")}>
                      {r.lapTimeSeconds.toFixed(3)}s
                    </span>
                    {!r.isIncluded ? (
                      <span className="text-[9px] uppercase text-muted-foreground">Excluded</span>
                    ) : (
                      <span />
                    )}
                  </React.Fragment>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-muted-foreground">—</div>
            )}
          </div>

          <div className="space-y-1 pt-1 border-t border-border/60 border-dashed">
            <div className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/80">Lap source</div>
            <div className="text-[11px] space-y-1 text-muted-foreground">
              <div className="text-muted-foreground/90">{sourceSummary ?? "—"}</div>
              {sourceUrl ? (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block max-w-full text-accent/90 underline underline-offset-2 break-all text-[11px]"
                  title={sourceUrl}
                >
                  {formatLapSourceLinkText(sourceUrl)}
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="space-y-0.5 min-w-0">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Lap analysis</h3>
            <p className="text-[11px] text-muted-foreground">{uploadedLapSetsLine}</p>
          </div>
          <Link
            href={`/runs/${encodeURIComponent(run.id)}/edit`}
            className={cn(analyseActionButtonClass, "no-underline")}
            onClick={(e) => e.stopPropagation()}
          >
            Edit run
          </Link>
          <button
            type="button"
            onClick={() => setShowLapAnalysis((v) => !v)}
            className={cn("shrink-0", analyseActionButtonClass)}
          >
            Analyse lap times
          </button>
        </div>
        {showLapAnalysis ? (
          <div className="rounded-md border border-border bg-muted/60 p-3">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Column comparison
            </div>
            {importedLapsError ? (
              <p className="text-xs text-red-600 dark:text-red-400 mb-2">{importedLapsError}</p>
            ) : null}
            {missingImportedLapRows && importedLapsLoading && !importedLapSetsFull ? (
              <p className="text-xs text-muted-foreground py-3">Loading imported lap sets…</p>
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
              />
            )}
          </div>
        ) : null}
      </div>

      <AnalysisActiveThingsToTry />

      <div className="space-y-2">
        <DetailRow
          label="Notes"
          value={displayRunNotes(run) || "—"}
          multiline
          emptyAsDash
        />
        <DetailRow
          label="Things to try"
          value={run.suggestedChanges?.trim() || "—"}
          multiline
          emptyAsDash
        />
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <Link
            href={engineerVsPreviousHref ?? engineerThisRunHref}
            className={cn(analyseActionButtonClass, "no-underline")}
            title="Open this run in the Engineer tab for full setup + lap analysis"
          >
            Analyse setup
          </Link>
          <button
            type="button"
            onClick={handleDeleteRun}
            disabled={deleting}
            className="ml-auto rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] font-medium text-destructive hover:bg-destructive/20 disabled:opacity-60 transition"
            title="Permanently delete this run"
          >
            {deleting ? "Deleting…" : "Delete run"}
          </button>
        </div>
        {deleteError ? (
          <p className="text-[11px] text-destructive">{deleteError}</p>
        ) : null}
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Setup vs previous run</div>
        {setupPreview.mode === "no_baseline" ? (
          <p className="text-muted-foreground text-xs">
            No earlier run on this car to diff against. Open <span className="font-medium text-foreground">Analyse setup</span> for the
            full sheet.
          </p>
        ) : setupPreview.rows.length === 0 ? (
          <p className="text-muted-foreground text-xs">No setup changes since your previous run on this car.</p>
        ) : (
          <div className="rounded-md border border-border bg-muted/70 divide-y divide-border max-h-48 overflow-y-auto">
            {setupPreview.rows.map((row) => (
              <div
                key={`${row.label}:${row.value}:${row.previousValue}`}
                className="px-3 py-2 flex flex-col gap-0.5 text-xs sm:flex-row sm:flex-wrap sm:justify-between sm:gap-2"
              >
                <span className="text-muted-foreground shrink-0">{row.label}</span>
                <div className="min-w-0 text-right sm:text-left">
                  <span className="font-mono text-foreground">{row.value}</span>
                  <span className="block text-[10px] text-muted-foreground sm:inline sm:ml-2">
                    was {row.previousValue}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

function DetailRow({
  label,
  value,
  multiline,
  emptyAsDash,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  emptyAsDash?: boolean;
}) {
  const show = emptyAsDash && !value.trim() ? "—" : value;
  return (
    <div>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <div className={multiline ? "mt-0.5 whitespace-pre-wrap text-foreground" : "mt-0.5 text-foreground"}>{show}</div>
    </div>
  );
}
