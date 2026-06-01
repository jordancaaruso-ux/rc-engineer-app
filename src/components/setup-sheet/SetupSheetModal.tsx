"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import {
  formatRunPickerLine,
  formatRunPickerLineWithDriver,
  type RunPickerRun,
} from "@/lib/runPickerFormat";
import { filterRunsForTeamSetupComparePicker } from "@/lib/setupCompare/teamSetupComparePicker";
import { RunPickerSelect } from "@/components/runs/RunPickerSelect";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import { getDefaultSetupSheetTemplate } from "@/lib/setupSheetTemplate";
import { isA800RRCar } from "@/lib/setupSheetTemplateId";
import {
  getActiveSetupData,
  ACTIVE_SETUP_CHANGED_EVENT,
} from "@/lib/activeSetupContext";
import type { RunCompareListSource } from "@/lib/runCompareCatalog";
import type { NumericAggregationCompareSlice } from "@/lib/setupCompare/numericAggregationCompare";
import {
  buildNumericAggregationMapForCar,
  type SetupAggApiRow,
} from "@/lib/setupCompare/buildNumericAggregationMap";

export type SetupSheetModalRun = {
  id: string;
  userId?: string | null;
  carId?: string | null;
  createdAt: Date | string;
  sessionLabel?: string | null;
  sessionType: string;
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  eventId?: string | null;
  carNameSnapshot?: string | null;
  trackNameSnapshot?: string | null;
  tireRunNumber: number;
  car?: {
    id: string;
    name: string;
    setupSheetTemplate?: string | null;
    setupSheetModelId?: string | null;
  } | null;
  track?: { id: string; name: string } | null;
  tireSet?: { id: string; label: string; setNumber: number | null } | null;
  event?: { name: string; track?: { name: string } | null } | null;
  setupSnapshot?: { id: string; data?: unknown } | null;
  lapTimes?: unknown;
};

type CompareMode = "this_run_only" | "current_setup" | "choose_run";

export function SetupSheetModal({
  open,
  onClose,
  run,
  pickerRuns,
  runListSource = "my_runs",
  viewerUserId = null,
  memberDisplayByUserId,
}: {
  open: boolean;
  onClose: () => void;
  run: SetupSheetModalRun | null;
  /** Fallback list (e.g. team page SSR) before API load; my_runs uses same-car filter. */
  pickerRuns?: SetupSheetModalRun[];
  runListSource?: RunCompareListSource;
  viewerUserId?: string | null;
  memberDisplayByUserId?: Record<string, string>;
}) {
  const [mode, setMode] = useState<CompareMode>("this_run_only");
  const [otherRunId, setOtherRunId] = useState("");
  const [comparePickerRuns, setComparePickerRuns] = useState<SetupSheetModalRun[]>([]);
  const [comparePickerLoading, setComparePickerLoading] = useState(false);
  const [activeTick, setActiveTick] = useState(0);
  const [numericAggregationByKey, setNumericAggregationByKey] = useState<Map<
    string,
    NumericAggregationCompareSlice
  > | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [loadedSetupData, setLoadedSetupData] = useState<unknown>(null);
  const [baselineSetupData, setBaselineSetupData] = useState<unknown | null>(null);
  const [baselineSetupLoading, setBaselineSetupLoading] = useState(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    setMode("this_run_only");
    setOtherRunId("");
    setBaselineSetupData(null);
    setBaselineSetupLoading(false);
  }, [open, run?.id]);

  useEffect(() => {
    if (!open || !run?.setupSnapshot?.id) {
      setLoadedSetupData(null);
      return;
    }
    if (run.setupSnapshot.data !== undefined) {
      setLoadedSetupData(run.setupSnapshot.data);
      return;
    }
    let alive = true;
    void fetch(`/api/runs/${encodeURIComponent(run.id)}/setup-snapshot`)
      .then((res) => res.json())
      .then((payload: { setupSnapshot?: { data?: unknown } }) => {
        if (!alive) return;
        setLoadedSetupData(payload.setupSnapshot?.data ?? {});
      })
      .catch(() => {
        if (alive) setLoadedSetupData({});
      });
    return () => {
      alive = false;
    };
  }, [open, run?.id, run?.setupSnapshot?.id, run?.setupSnapshot?.data]);

  useEffect(() => {
    const bump = () => setActiveTick((t) => t + 1);
    window.addEventListener(ACTIVE_SETUP_CHANGED_EVENT, bump);
    return () => window.removeEventListener(ACTIVE_SETUP_CHANGED_EVENT, bump);
  }, []);

  const aggregationCarId = run?.car?.id?.trim() || null;

  useEffect(() => {
    if (!open || !aggregationCarId) {
      setNumericAggregationByKey(null);
      return;
    }
    let alive = true;
    const q = `?carId=${encodeURIComponent(aggregationCarId)}`;
    fetch(`/api/setup-aggregations${q}`)
      .then((res) => res.json())
      .then((data: { aggregations?: SetupAggApiRow[] }) => {
        if (!alive) return;
        const rows = Array.isArray(data.aggregations) ? data.aggregations : [];
        setNumericAggregationByKey(buildNumericAggregationMapForCar(rows, aggregationCarId));
      })
      .catch(() => {
        if (alive) setNumericAggregationByKey(null);
      });
    return () => {
      alive = false;
    };
  }, [open, aggregationCarId]);

  // PDF viewer intentionally removed from Analyse run (Setup is app-native / parsed-first).

  const activeSetup = useMemo(() => {
    void activeTick;
    return getActiveSetupData();
  }, [activeTick]);

  const fallbackPickerRuns = pickerRuns ?? [];

  useEffect(() => {
    if (!open || !run?.id) {
      setComparePickerRuns([]);
      setComparePickerLoading(false);
      return;
    }

    if (runListSource === "team_runs") {
      let alive = true;
      setComparePickerLoading(true);
      void fetch(`/api/runs/for-setup-compare?runId=${encodeURIComponent(run.id)}`, {
        cache: "no-store",
      })
        .then(async (res) => {
          const data = (await res.json().catch(() => ({}))) as {
            runs?: SetupSheetModalRun[];
            error?: string;
          };
          if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
          return Array.isArray(data.runs) ? data.runs : [];
        })
        .then((runs) => {
          if (!alive) return;
          setComparePickerRuns(runs);
        })
        .catch(() => {
          if (!alive) return;
          if (viewerUserId) {
            setComparePickerRuns(
              filterRunsForTeamSetupComparePicker(run, fallbackPickerRuns, viewerUserId)
            );
          } else {
            setComparePickerRuns(fallbackPickerRuns);
          }
        })
        .finally(() => {
          if (alive) setComparePickerLoading(false);
        });
      return () => {
        alive = false;
      };
    }

    const anchorCarId = run.car?.id ?? run.carId ?? null;
    const sameCar = anchorCarId
      ? fallbackPickerRuns.filter((r) => (r.car?.id ?? r.carId) === anchorCarId)
      : fallbackPickerRuns;
    setComparePickerRuns(sameCar);
    setComparePickerLoading(false);
  }, [open, run?.id, runListSource, viewerUserId, pickerRuns]);

  const formatPickerLine = useMemo((): ((run: SetupSheetModalRun) => string) => {
    if (runListSource !== "team_runs" || !memberDisplayByUserId) {
      return (r) => formatRunPickerLine(r);
    }
    return (r) => formatRunPickerLineWithDriver(r, memberDisplayByUserId);
  }, [runListSource, memberDisplayByUserId]);

  const runs = comparePickerRuns;
  const otherRuns = useMemo(
    () => runs.filter((r) => r.id !== run?.id),
    [runs, run?.id]
  );
  const baselineRun = useMemo(() => {
    if (mode !== "choose_run" || !otherRunId) return null;
    return runs.find((r) => r.id === otherRunId) ?? null;
  }, [mode, otherRunId, runs]);

  useEffect(() => {
    if (!open || mode !== "choose_run" || !otherRunId || !baselineRun) {
      setBaselineSetupData(null);
      setBaselineSetupLoading(false);
      return;
    }
    setBaselineSetupData(null);
    if (baselineRun.setupSnapshot?.data !== undefined) {
      setBaselineSetupData(baselineRun.setupSnapshot.data);
      setBaselineSetupLoading(false);
      return;
    }
    let alive = true;
    setBaselineSetupLoading(true);
    void fetch(`/api/runs/${encodeURIComponent(baselineRun.id)}/setup-snapshot`)
      .then((res) => res.json())
      .then((payload: { setupSnapshot?: { data?: unknown } }) => {
        if (!alive) return;
        setBaselineSetupData(payload.setupSnapshot?.data ?? {});
      })
      .catch(() => {
        if (alive) setBaselineSetupData({});
      })
      .finally(() => {
        if (alive) setBaselineSetupLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, mode, otherRunId, baselineRun]);

  const runSetup = useMemo<SetupSnapshotData>(
    () => normalizeSetupData(loadedSetupData ?? run?.setupSnapshot?.data ?? {}),
    [loadedSetupData, run?.setupSnapshot?.data]
  );

  const baselineValue = useMemo<SetupSnapshotData | null>(() => {
    if (mode === "this_run_only") return null;
    if (mode === "choose_run") {
      if (!otherRunId || baselineSetupLoading || baselineSetupData === null) return null;
      return normalizeSetupData(baselineSetupData);
    }
    if (mode === "current_setup" && activeSetup) {
      return normalizeSetupData(activeSetup);
    }
    return null;
  }, [mode, otherRunId, baselineSetupLoading, baselineSetupData, activeSetup]);

  const compareActive = mode !== "this_run_only" && baselineValue != null;

  const template = useMemo(() => {
    if (isA800RRCar(run?.car?.setupSheetTemplate)) return A800RR_SETUP_SHEET_V1;
    return getDefaultSetupSheetTemplate();
  }, [run?.car?.setupSheetTemplate]);

  const hasActiveSetup = useMemo(() => {
    if (!activeSetup) return false;
    return Object.keys(activeSetup).some((k) => {
      const v = activeSetup[k];
      return v != null && String(v).trim() !== "";
    });
  }, [activeSetup]);

  if (!open || !portalReady) return null;

  return createPortal(
    <div
      data-setup-sheet-modal
      className="setup-sheet-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Setup"
    >
      <div
        className="setup-sheet-modal-panel bg-background border border-border rounded-lg shadow-xl max-h-[90vh] overflow-auto w-full max-w-4xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="setup-sheet-modal-close sticky top-0 z-10 flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-background/95">
          <div className="ui-title text-sm text-muted-foreground truncate min-w-0 normal-case">
            {run ? formatPickerLine(run) : "Setup"}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/90 transition shrink-0"
          >
            Close
          </button>
        </div>

        <div className="p-4 space-y-4 print:p-0">
          {!run ? (
            <p className="text-sm text-muted-foreground">No run data.</p>
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1 space-y-2">
                  <span className="ui-title text-xs text-muted-foreground">
                    Compare to
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setMode("this_run_only");
                        setOtherRunId("");
                      }}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-xs font-medium transition",
                        mode === "this_run_only"
                          ? "border-accent bg-accent/15 text-foreground"
                          : "border-border bg-card hover:bg-muted/90"
                      )}
                    >
                      This run
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("current_setup")}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-xs font-medium transition",
                        mode === "current_setup"
                          ? "border-accent bg-accent/15 text-foreground"
                          : "border-border bg-card hover:bg-muted/90"
                      )}
                    >
                      Current setup
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("choose_run")}
                      disabled={otherRuns.length === 0}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-xs font-medium transition",
                        otherRuns.length === 0
                          ? "border-border/80 text-muted-foreground/50 cursor-not-allowed"
                          : mode === "choose_run"
                            ? "border-accent bg-accent/15 text-foreground"
                            : "border-border bg-card hover:bg-muted/90"
                      )}
                    >
                      Choose run
                    </button>
                    {mode === "choose_run" && comparePickerLoading && (
                      <span className="text-[11px] text-muted-foreground">Loading runs…</span>
                    )}
                    {mode === "choose_run" && !comparePickerLoading && otherRuns.length > 0 && (
                      <div className="min-w-0 w-full max-w-md sm:w-auto sm:min-w-[12rem]">
                        <RunPickerSelect
                          label=""
                          runs={otherRuns as RunPickerRun[]}
                          value={otherRunId}
                          onChange={setOtherRunId}
                          placeholder="Select run…"
                          formatLine={formatPickerLine as (run: RunPickerRun) => string}
                        />
                      </div>
                    )}
                  </div>
                  {mode === "choose_run" && !comparePickerLoading && otherRuns.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No other runs on this setup sheet yet. Log a run on your car with the same sheet model, or ask
                      your teammate to share more sessions.
                    </p>
                  )}
                  {mode === "choose_run" && otherRunId && baselineSetupLoading ? (
                    <p className="text-xs text-muted-foreground">Loading comparison setup…</p>
                  ) : null}
                  {mode === "current_setup" && !hasActiveSetup && (
                    <p className="text-xs text-amber-600/90 dark:text-amber-400/90">
                      No current setup. Use the Setup page or Log your run to set one.
                    </p>
                  )}
                  {compareActive && baselineRun ? (
                    <p className="text-[11px] text-muted-foreground">
                      Showing this run&apos;s setup.{" "}
                      <span className="text-red-600/90 dark:text-red-400/90">Red</span> = different from{" "}
                      {formatPickerLine(baselineRun)}. Changed fields show{" "}
                      <span className="font-medium text-foreground/80">vs …</span> with the other value
                      {mode === "current_setup" ? " (current setup)" : ""}; numbers include{" "}
                      <span className="font-medium text-foreground/80">(+/−Δ)</span> when applicable.
                    </p>
                  ) : compareActive && mode === "current_setup" ? (
                    <p className="text-[11px] text-muted-foreground">
                      Compared to your current setup. Changed fields show{" "}
                      <span className="font-medium text-foreground/80">vs …</span>
                      {hasActiveSetup ? " and (+/−Δ) for numbers." : "."}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col gap-1.5 sm:items-end sm:pl-2">
                  {run.userId && (!viewerUserId || run.userId === viewerUserId) ? (
                    <Link
                      href={`/setup?runId=${encodeURIComponent(run.id)}&pdfReview=1`}
                      onClick={onClose}
                      className="rounded-md border border-border bg-card px-3 py-1.5 text-center text-xs font-medium hover:bg-muted/90 transition"
                    >
                      Turn into a PDF
                    </Link>
                  ) : null}
                </div>
              </div>

              <SetupSheetView
                value={runSetup}
                onChange={() => {}}
                readOnly
                template={template}
                baselineValue={baselineValue}
                compareHighlightOnly={compareActive}
                numericAggregationByKey={null}
              />
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
