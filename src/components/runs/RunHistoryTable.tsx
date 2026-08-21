"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { formatRunDateShort, formatRunDateTime } from "@/lib/formatDate";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { formatLap } from "@/lib/runLaps";
import type { RunCompareListSource } from "@/lib/runCompareCatalog";
import type { MatchReason } from "@/lib/runs/runHistoryFilters";
import {
  BACK_PARAM,
  OPEN_GROUP_PARAM,
  SESSIONS_RETURN_KEY,
} from "@/lib/runs/sessionsReturn";
import type { CompareRunShape } from "@/components/runs/RunComparePanel";
import { TirePrepStepsList, resolveTirePrepSteps } from "@/components/runs/TirePrepStepsList";
import {
  computeTireIndicatorsByRunId,
  formatTireIdentityLine,
  type RunTireIndicator,
} from "@/lib/runs/tireSetChange";
import { TireIndicatorIcon } from "@/components/runs/TireIndicatorIcon";
import { SetupSheetModal, type SetupSheetModalRun } from "@/components/runs/RunHistoryModalsLazy";
import {
  getAverageTopN,
  getBestLap,
  getIncludedLapDashboardMetrics,
  primaryLapRowsFromRun,
} from "@/lib/lapAnalysis";
import { RunLapAnalysisModal } from "@/components/runs/RunHistoryModalsLazy";
import { Timer, TriangleAlert, Wrench, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { RunComparePairCell } from "@/components/runs/AnalysisCompareContext";
import { type Run } from "@/components/runs/RunDetailPanel";
import { runNeedsLapImport } from "@/lib/runs/lapImportPrompt";
import { lapImportHref } from "@/lib/runs/lapImportHref";
import {
  computeRunHistoryColSpan,
  RUN_HISTORY_ACTION_CELL_CLASS,
  RUN_HISTORY_DATA_CLASS,
  RUN_HISTORY_MOBILE_ACTIONS_CLASS,
  RunHistoryMobileColumns,
  RunHistoryMobileRowShell,
} from "@/components/runs/runHistoryTableColumns";

/**
 * "This run has no lap times" — the amber warning that sits beside the Draft badge.
 *
 * Founder report 2026-08-08: a driver logged a run before LiveRC had posted the
 * times and marked it complete. The row then showed three em-dashes and nothing
 * else — no signal, no way back to the importer. Tapping this lands straight on
 * the wizard's Laps step (`?step=laps` — needed because `firstUnfinishedStep`
 * would otherwise stop at the first empty step, typically Prep).
 *
 * Amber, matching the Draft badge. That does not break the house rule below
 * ("yellow is actions only") — the rule reserves *yellow*; amber is already the
 * established badge tone on this row, and green stays good/complete.
 */
function LapImportWarning({
  onImport,
  onDismiss,
  compact,
  className,
}: {
  onImport: () => void;
  onDismiss: () => void;
  /** Mobile: icon only — the date column is already carrying date + session + Draft. */
  compact: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-0.5", className)}
      // The whole <tr> is role="button" → openRun. Everything in here is its own
      // target, so stop the row from swallowing the tap.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onImport}
        aria-label="Lap times missing — import them"
        title="No lap times on this run — tap to import"
        className={cn(
          "inline-flex items-center gap-0.5 rounded border border-amber-500/40 bg-amber-500/10 ui-title text-amber-900 transition hover:bg-amber-500/20 dark:text-amber-100",
          compact ? "px-0.5 py-px text-[8px]" : "px-1 py-0.5 text-[8px] md:text-[9px]"
        )}
      >
        <TriangleAlert className={compact ? "h-2.5 w-2.5" : "h-3 w-3"} aria-hidden />
        {compact ? null : "Import laps"}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Hide the missing lap times warning for this run"
        title="This run will never have lap times — hide this"
        className="inline-flex items-center justify-center rounded p-0.5 text-muted-foreground transition hover:bg-muted/80 hover:text-foreground"
      >
        <X className="h-2.5 w-2.5" aria-hidden />
      </button>
    </span>
  );
}

function RunHistoryActionButtons({
  onSetup,
  onLaps,
  onTirePrep,
  tirePrepOpen = false,
  tireIndicator,
  hasTirePrep = false,
  layout,
  className,
}: {
  onSetup: () => void;
  onLaps: () => void;
  /** Tap the tire indicator → toggle the inline tire-prep panel under the row. */
  onTirePrep?: () => void;
  tirePrepOpen?: boolean;
  tireIndicator: RunTireIndicator | null;
  /** Prep steps exist even though no compound was logged — still worth a way in. */
  hasTirePrep?: boolean;
  layout: "mobile" | "desktop";
  className?: string;
}) {
  const mobile = layout === "mobile";
  // A run with neither compound nor prep gets no button: it would open an empty box.
  const showTireMark = tireIndicator != null || hasTirePrep;
  return (
    <div
      className={cn(
        mobile
          ? RUN_HISTORY_MOBILE_ACTIONS_CLASS
          // `flex-nowrap`, deliberately: wrapping here is what made every desktop
          // run row 98px tall. The column is sized to fit these three side by side.
          : "inline-flex w-fit flex-row flex-nowrap items-center justify-end gap-0.5",
        className
      )}
    >
      {showTireMark ? (
        onTirePrep ? (
          <button
            type="button"
            onClick={onTirePrep}
            aria-expanded={tirePrepOpen}
            aria-label="Show tires and prep"
            title="Tires and prep for this run"
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-md transition",
              tirePrepOpen && "bg-accent/10 ring-1 ring-primary-ink/50",
              !tirePrepOpen && "hover:bg-muted/80"
            )}
          >
            <TireIndicatorIcon indicator={tireIndicator} size={mobile ? "md" : "sm"} well={mobile} />
          </button>
        ) : (
          <TireIndicatorIcon indicator={tireIndicator} size={mobile ? "md" : "sm"} well={mobile} />
        )
      ) : mobile ? (
        // Fixed-width slot so stat columns stay aligned across rows.
        <span className="h-8 w-8 shrink-0" aria-hidden />
      ) : null}
      <button
        type="button"
        onClick={onSetup}
        aria-label="View setup"
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-muted/80 transition",
          mobile ? "h-8 w-8" : "h-6 w-6"
        )}
        title="View setup sheet for this run; compare to another run from the modal"
      >
        <Wrench className={mobile ? "h-4 w-4" : "h-3.5 w-3.5"} aria-hidden />
      </button>
      <button
        type="button"
        onClick={onLaps}
        aria-label="View laps"
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-muted/80 transition",
          mobile ? "h-8 w-8" : "h-6 w-6"
        )}
        title="Open lap column compare for this run"
      >
        <Timer className={mobile ? "h-4 w-4" : "h-3.5 w-3.5"} aria-hidden />
      </button>
    </div>
  );
}

export function RunHistoryTable({
  runs,
  allRunsDescending,
  runListSource = "my_runs",
  userDisplayName,
  showComparePairColumn = false,
  enableReorder = false,
  displayTimeZone,
  viewerUserId = null,
  memberDisplayByUserId,
  showMemberColumn = false,
  showSessionColumn = true,
  dayRunNumberByRunId,
  matchReasonsById,
  focusRunId = null,
}: {
  runs: Run[];
  allRunsDescending: CompareRunShape[];
  runListSource?: RunCompareListSource;
  /** User / driver name for primary lap column ("Me" if unset). */
  userDisplayName?: string | null;
  /** IANA zone for SSR run timestamps (from rc_tz cookie); matches device after cookie is set. */
  displayTimeZone?: string | null;
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
  /** Current user; with `memberDisplayByUserId`, attributes rows and hides peer edit/delete. */
  viewerUserId?: string | null;
  /** `userId` → display label for team Sessions (`?teamId=`). */
  memberDisplayByUserId?: Record<string, string>;
  showMemberColumn?: boolean;
  showSessionColumn?: boolean;
  /** runId → position within its day (1-based); names unlabeled testing runs "Run N". */
  dayRunNumberByRunId?: Record<string, number>;
  /** runId → why the run matched the active search/setup filters (search only). */
  matchReasonsById?: Record<string, MatchReason[]>;
  /**
   * Run being returned to from the run view (`?openGroup=`). Marks the row so the
   * driver's eye lands back on it, and anchors the scroll (`SessionsFocusScroll`).
   */
  focusRunId?: string | null;
}) {
  const router = useRouter();
  const [setupModalRunId, setSetupModalRunId] = useState<string | null>(null);
  const [lapModalRunId, setLapModalRunId] = useState<string | null>(null);
  /** Run whose inline tire-prep panel is open (toggled from the tire indicator). */
  const [prepOpenRunId, setPrepOpenRunId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<
    { runId: string; edge: "above" | "below" } | null
  >(null);
  const [reorderErr, setReorderErr] = useState<string | null>(null);
  const [reorderBusy, setReorderBusy] = useState(false);
  const [modalsPortalReady, setModalsPortalReady] = useState(false);
  /**
   * Runs whose "no lap times" warning the driver just dismissed. Held locally and
   * applied optimistically: Sessions is a 30s-revalidate server component, so a
   * `router.refresh()` would read as a stall trackside. The column is the source
   * of truth on the next load.
   */
  const [dismissedLapPromptIds, setDismissedLapPromptIds] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    setModalsPortalReady(true);
  }, []);

  async function dismissLapImportPrompt(runId: string) {
    setDismissedLapPromptIds((prev) => new Set(prev).add(runId));
    try {
      const res = await fetch(`/api/runs/${runId}/dismiss-lap-import-prompt`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      // Put the warning back rather than leave the driver believing it stuck.
      setDismissedLapPromptIds((prev) => {
        const next = new Set(prev);
        next.delete(runId);
        return next;
      });
    }
  }

  /**
   * Rows navigate to the run view — the one place a run is looked at (Option A, 2026-07-29).
   *
   * Before leaving we stamp the *current* Sessions URL with `openGroup=<runId>` via
   * `history.replaceState` — a shallow rewrite, so no re-render and no second history
   * entry. Browser back then returns to a URL that fully describes where the driver was
   * (group expanded, filters and team scope intact) instead of a cold, collapsed list:
   * the `<details open>` state they set by hand does *not* survive the remount. The same
   * URL rides along as `?back=` so the run page still has a destination when history
   * doesn't (shared link, cold launch, arrived from the dashboard).
   */
  function openRun(runId: string) {
    let backHref: string | null = null;
    if (typeof window !== "undefined" && window.location.pathname === "/runs/history") {
      const params = new URLSearchParams(window.location.search);
      params.set(OPEN_GROUP_PARAM, runId);
      backHref = `/runs/history?${params.toString()}`;
      try {
        // `null` state, per Next's shallow-routing contract: it patches
        // replaceState to sync its own router tree, so back() restores *this* URL
        // (openGroup and all) rather than the pre-rewrite one.
        window.history.replaceState(null, "", backHref);
        sessionStorage.setItem(SESSIONS_RETURN_KEY, runId);
      } catch {
        // Private mode / blocked storage — the `?back=` link below still works.
      }
    }
    const target = `/runs/${encodeURIComponent(runId)}`;
    router.push(
      backHref ? `${target}?${BACK_PARAM}=${encodeURIComponent(backHref)}` : target
    );
  }

  /** Newest-first across all loaded runs (crosses day/event group boundaries). */
  const tireIndicatorsByRunId = useMemo(
    () =>
      computeTireIndicatorsByRunId(
        allRunsDescending.map((r) => ({
          id: r.id,
          carId: r.carId ?? r.car?.id ?? null,
          tireRunNumber: r.tireRunNumber,
          tireType: r.tireType ?? null,
          tireStintId: r.tireStintId ?? null,
          tireAgeKnown: r.tireAgeKnown ?? true,
        }))
      ),
    [allRunsDescending]
  );

  const totalCols = computeRunHistoryColSpan({
    showReorderColumn: enableReorder,
    showMemberColumn,
    showSessionColumn,
    showComparePairColumn,
  });

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
  const lapModalRun = useMemo(
    () => (lapModalRunId ? runs.find((r) => r.id === lapModalRunId) ?? null : null),
    [runs, lapModalRunId]
  );
  const lapModalPickerRuns = useMemo(() => {
    if (!lapModalRun) return allRunsDescending;
    if (runListSource === "team_runs" && viewerUserId) {
      return allRunsDescending;
    }
    if (!lapModalRun.carId) return allRunsDescending;
    return allRunsDescending.filter((r) => r.car?.id === lapModalRun.carId);
  }, [allRunsDescending, lapModalRun, runListSource, viewerUserId]);
  const lapModalUserDisplayName = useMemo(() => {
    if (!lapModalRun) return userDisplayName;
    if (!viewerUserId || !lapModalRun.userId || !memberDisplayByUserId) return userDisplayName;
    return lapModalRun.userId === viewerUserId
      ? userDisplayName
      : memberDisplayByUserId[lapModalRun.userId] ?? null;
  }, [lapModalRun, viewerUserId, memberDisplayByUserId, userDisplayName]);
  const lapModalRunOwnedByViewer =
    !lapModalRun?.userId || !viewerUserId || lapModalRun.userId === viewerUserId;

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
        const runMatchReasons = matchReasonsById?.[run.id];
        const memberLabel =
          showMemberColumn && run.userId
            ? memberDisplayByUserId?.[run.userId] ?? "—"
            : null;
        const carDisplay = run.car?.name ?? run.carNameSnapshot ?? "Deleted car";
        const primaryLapRows = primaryLapRowsFromRun(run);
        const listLapDash = getIncludedLapDashboardMetrics(primaryLapRows);
        const bestLapDisplay = formatLap(run.bestLapSeconds ?? getBestLap(primaryLapRows));
        const avg5Display = formatLap(run.avgTop5LapSeconds ?? getAverageTopN(primaryLapRows, 5));
        const avg10Display = formatLap(getAverageTopN(primaryLapRows, 10));
        const medianLapDisplay = formatLap(listLapDash.median);
        const sessionDisplay = formatRunSessionDisplay(run, {
          dayRunNumber: dayRunNumberByRunId?.[run.id],
        });
        const runInstant = resolveRunDisplayInstant(run);
        // Team Sessions lists other members' runs. Their missing laps are not
        // yours to chase — the deep link would open an edit page you can't save
        // and the dismiss POST would 404 on the ownership check.
        const runOwnedByViewer = !run.userId || !viewerUserId || run.userId === viewerUserId;
        const showLapImportWarning =
          runOwnedByViewer && runNeedsLapImport(run) && !dismissedLapPromptIds.has(run.id);
        const tireIndicator = tireIndicatorsByRunId.get(run.id) ?? null;
        const tirePrepSteps = resolveTirePrepSteps(run);
        const isDragging = draggingId === run.id;
        const showDropAbove = dropTarget?.runId === run.id && dropTarget.edge === "above";
        const showDropBelow = dropTarget?.runId === run.id && dropTarget.edge === "below";

        return (
          <React.Fragment key={run.id}>
            <tr
              role="button"
              tabIndex={0}
              // The row navigates through `openRun`, not an href, so the demo walkthrough has
              // nothing to read when it needs to open a run. This is that handle. Inert markup.
              data-run-id={run.id}
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
              onClick={() => openRun(run.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openRun(run.id);
                }
              }}
              data-run-row={run.id}
              className={cn(
                "border-b border-border/80 hover:bg-muted/50 cursor-pointer select-none",
                // When the match-reason chips row follows, it carries the divider.
                runMatchReasons && runMatchReasons.length > 0 && "border-b-0",
                isDragging && "opacity-50",
                // Returned-to row: a quiet inset rail, not yellow — yellow is actions only.
                focusRunId === run.id &&
                  "bg-muted/40 shadow-[inset_2px_0_0_0_rgb(var(--color-muted-foreground)/0.55)]",
                showDropAbove && "shadow-[inset_0_2px_0_0_var(--color-primary,#2563eb)]",
                showDropBelow && "shadow-[inset_0_-2px_0_0_var(--color-primary,#2563eb)]"
              )}
            >
              <td colSpan={totalCols} className="md:hidden align-middle p-0">
                <RunHistoryMobileRowShell>
                  <RunHistoryMobileColumns
                    date={
                      <>
                        <span
                          className={cn(RUN_HISTORY_DATA_CLASS, "block leading-snug text-foreground")}
                          title={formatRunDateTime(runInstant, displayTimeZone)}
                        >
                          {formatRunDateShort(runInstant, displayTimeZone)}
                        </span>
                        {showMemberColumn && memberLabel ? (
                          <span
                            className="mt-0.5 block truncate text-[9px] text-muted-foreground"
                            title={memberLabel}
                          >
                            {memberLabel}
                          </span>
                        ) : null}
                        {showSessionColumn ? (
                          <span className="mt-0.5 block min-w-0 truncate text-[9px] text-muted-foreground leading-tight">
                            {sessionDisplay === "—" ? "" : sessionDisplay}
                          </span>
                        ) : null}
                        {run.loggingComplete === false ? (
                          <span
                            className="mt-0.5 inline-block rounded border border-amber-500/40 bg-amber-500/10 px-0.5 py-px text-[8px] ui-title text-amber-900 dark:text-amber-100"
                            title="Logging not marked complete"
                          >
                            Draft
                          </span>
                        ) : null}
                        {showLapImportWarning ? (
                          <LapImportWarning
                            compact
                            className="mt-0.5"
                            onImport={() => router.push(lapImportHref(run.id))}
                            onDismiss={() => void dismissLapImportPrompt(run.id)}
                          />
                        ) : null}
                      </>
                    }
                    best={
                      <span className={cn(RUN_HISTORY_DATA_CLASS, "text-foreground")}>
                        {bestLapDisplay}
                      </span>
                    }
                    top5={
                      <span className={cn(RUN_HISTORY_DATA_CLASS, "text-foreground")}>
                        {avg5Display}
                      </span>
                    }
                    median={
                      <span className={cn(RUN_HISTORY_DATA_CLASS, "text-foreground")}>
                        {medianLapDisplay}
                      </span>
                    }
                    actions={
                      <div
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <RunHistoryActionButtons
                          layout="mobile"
                          onSetup={() => setSetupModalRunId(run.id)}
                          onLaps={() => setLapModalRunId(run.id)}
                          onTirePrep={() =>
                            setPrepOpenRunId((cur) => (cur === run.id ? null : run.id))
                          }
                          tirePrepOpen={prepOpenRunId === run.id}
                          tireIndicator={tireIndicator}
                          hasTirePrep={tirePrepSteps.length > 0}
                        />
                      </div>
                    }
                  />
                </RunHistoryMobileRowShell>
              </td>
              {enableReorder ? (
                <td
                  className="hidden md:table-cell w-6 px-1 py-1.5 md:py-1 align-middle text-center text-muted-foreground"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  title="Drag to reorder"
                  aria-label="Drag to reorder"
                >
                  <span className="inline-block cursor-grab select-none text-sm leading-none">⋮⋮</span>
                </td>
              ) : null}
              {showMemberColumn ? (
                <td
                  className="hidden md:table-cell px-2 py-1.5 md:px-2 md:py-1 align-middle text-xs text-muted-foreground max-w-[4.5rem] md:max-w-[10rem] truncate"
                  title={memberLabel ?? ""}
                >
                  {memberLabel}
                </td>
              ) : null}
              <td className={cn("hidden md:table-cell px-1.5 py-1.5 md:px-2 md:py-1 align-middle text-foreground leading-snug md:whitespace-nowrap", RUN_HISTORY_DATA_CLASS)}>
                <span title={formatRunDateTime(runInstant, displayTimeZone)}>
                  {formatRunDateShort(runInstant, displayTimeZone)}
                </span>
                {/* The Session cell is where this normally lives, but it only exists
                    when some run in the group is labelled. Unlabelled testing days
                    would otherwise lose the warning entirely on desktop. */}
                {showLapImportWarning && !showSessionColumn ? (
                  <LapImportWarning
                    compact={false}
                    className="ml-1.5"
                    onImport={() => router.push(lapImportHref(run.id))}
                    onDismiss={() => void dismissLapImportPrompt(run.id)}
                  />
                ) : null}
              </td>
              {showSessionColumn ? (
                <td className="hidden md:table-cell px-2 py-1.5 md:px-2 md:py-1 min-w-0 align-middle">
                  <div className="flex flex-row flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
                    <span className="text-xs text-foreground leading-snug line-clamp-1 break-words min-w-0">
                      {sessionDisplay === "—" ? "" : sessionDisplay}
                    </span>
                    {run.loggingComplete === false ? (
                      <span
                        className="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 text-[8px] md:text-[9px] ui-title text-amber-900 dark:text-amber-100"
                        title="Logging not marked complete"
                      >
                        Draft
                      </span>
                    ) : null}
                    {showLapImportWarning ? (
                      <LapImportWarning
                        compact={false}
                        onImport={() => router.push(lapImportHref(run.id))}
                        onDismiss={() => void dismissLapImportPrompt(run.id)}
                      />
                    ) : null}
                  </div>
                </td>
              ) : null}
              <td className="hidden md:table-cell px-2 py-1 align-middle text-xs text-foreground">
                {carDisplay}
              </td>
              <td className={cn("hidden md:table-cell px-1.5 py-1.5 md:px-2 md:py-1 align-middle text-foreground whitespace-nowrap", RUN_HISTORY_DATA_CLASS)}>
                {bestLapDisplay}
              </td>
              <td className={cn("hidden md:table-cell px-1.5 py-1.5 md:px-2 md:py-1 align-middle text-foreground whitespace-nowrap", RUN_HISTORY_DATA_CLASS)}>
                {avg5Display}
              </td>
              <td className={cn("hidden md:table-cell px-1.5 py-1.5 md:px-2 md:py-1 align-middle text-foreground whitespace-nowrap", RUN_HISTORY_DATA_CLASS)}>
                {avg10Display}
              </td>
              <td className={cn("hidden md:table-cell px-1.5 py-1.5 md:px-2 md:py-1 align-middle text-foreground whitespace-nowrap", RUN_HISTORY_DATA_CLASS)}>
                {medianLapDisplay}
              </td>
              <td
                className={cn(RUN_HISTORY_ACTION_CELL_CLASS, "align-middle")}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <RunHistoryActionButtons
                  layout="desktop"
                  onSetup={() => setSetupModalRunId(run.id)}
                  onLaps={() => setLapModalRunId(run.id)}
                  onTirePrep={() =>
                    setPrepOpenRunId((cur) => (cur === run.id ? null : run.id))
                  }
                  tirePrepOpen={prepOpenRunId === run.id}
                  tireIndicator={tireIndicator}
                  hasTirePrep={tirePrepSteps.length > 0}
                />
              </td>
              {showComparePairColumn ? <RunComparePairCell runId={run.id} /> : null}
            </tr>
            {prepOpenRunId === run.id ? (
              <tr className="border-b border-border/80">
                <td colSpan={totalCols} className="px-3 pb-2.5 pt-0 md:px-4">
                  <div className="rounded-lg border border-border bg-secondary/60 px-3 py-2.5">
                    {/* What's on the car first, then what went on it. The additive
                        brand used to be the only heading here, which read as the
                        tire's name — the compound was in a hover title the phone
                        can never show. */}
                    <div className="text-xs font-semibold text-foreground">
                      {tireIndicator ? formatTireIdentityLine(tireIndicator) : "Tires not logged"}
                    </div>
                    {run.additiveType?.displayName ? (
                      <div className="text-[11px] text-muted-foreground">
                        {run.additiveType.displayName}
                      </div>
                    ) : null}
                    <div className="mt-1.5">
                      <TirePrepStepsList steps={tirePrepSteps} />
                    </div>
                  </div>
                </td>
              </tr>
            ) : null}
            {runMatchReasons && runMatchReasons.length > 0 ? (
              <tr className="border-b border-border/80">
                <td colSpan={totalCols} className="px-2 pb-1.5 pt-0 md:px-3">
                  <MatchReasonChips reasons={runMatchReasons} />
                </td>
              </tr>
            ) : null}
          </React.Fragment>
        );
      })}
      {modalsPortalReady
        ? createPortal(
            <>
              <SetupSheetModal
                open={setupModalRunId !== null}
                onClose={() => setSetupModalRunId(null)}
                run={setupModalRun as SetupSheetModalRun | null}
                pickerRuns={allRunsDescending as SetupSheetModalRun[]}
                runListSource={runListSource}
                viewerUserId={viewerUserId}
                memberDisplayByUserId={memberDisplayByUserId}
              />
              {lapModalRun ? (
                <RunLapAnalysisModal
                  open={lapModalRunId !== null}
                  onClose={() => setLapModalRunId(null)}
                  run={lapModalRun}
                  pickerRunsSameCar={lapModalPickerRuns}
                  runListSource={runListSource}
                  userDisplayName={lapModalUserDisplayName}
                  runOwnedByViewer={lapModalRunOwnedByViewer}
                  viewerUserId={viewerUserId}
                  memberDisplayByUserId={memberDisplayByUserId}
                />
              ) : null}
            </>,
            document.body
          )
        : null}
    </>
  );
}

const MATCH_REASON_LABEL: Record<MatchReason["kind"], string> = {
  car: "Car",
  track: "Track",
  event: "Event",
  session: "Session",
  class: "Class",
  tires: "Tires",
  additive: "Additive",
  driver: "Driver",
  note: "Note",
  setup: "Setup",
  changed: "Changed",
};

/** "Why it matched" pills shown under a run row during an active search. */
function MatchReasonChips({ reasons }: { reasons: MatchReason[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {reasons.map((reason, i) => (
        <span
          key={`${reason.kind}-${i}`}
          className={cn(
            "inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/60 px-1.5 py-0.5",
            reason.kind === "changed" && "border-foreground/30 bg-muted"
          )}
        >
          <span className="type-data-label shrink-0 text-[8px] text-muted-foreground">
            {MATCH_REASON_LABEL[reason.kind]}
          </span>
          <span className="min-w-0 truncate text-[11px] text-foreground/90">{reason.text}</span>
        </span>
      ))}
    </div>
  );
}

