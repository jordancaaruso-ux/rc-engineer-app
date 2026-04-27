"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { formatRunPickerLine } from "@/lib/runPickerFormat";
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
  createdAt: Date | string;
  sessionLabel?: string | null;
  sessionType: string;
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  eventId?: string | null;
  carNameSnapshot?: string | null;
  trackNameSnapshot?: string | null;
  tireRunNumber: number;
  car?: { id: string; name: string; setupSheetTemplate?: string | null } | null;
  track?: { id: string; name: string } | null;
  tireSet?: { id: string; label: string; setNumber: number | null } | null;
  event?: { name: string; track?: { name: string } | null } | null;
  setupSnapshot?: { id: string; data: unknown } | null;
  lapTimes?: unknown;
};

type CompareMode = "current_setup" | "choose_run";

export function SetupSheetModal({
  open,
  onClose,
  run,
  pickerRuns,
  runListSource = "my_runs",
}: {
  open: boolean;
  onClose: () => void;
  run: SetupSheetModalRun | null;
  /** All runs for "choose run" comparison (newest first). */
  pickerRuns?: SetupSheetModalRun[];
  runListSource?: RunCompareListSource;
}) {
  const [mode, setMode] = useState<CompareMode>("current_setup");
  const [otherRunId, setOtherRunId] = useState("");
  const [activeTick, setActiveTick] = useState(0);
  const [numericAggregationByKey, setNumericAggregationByKey] = useState<Map<
    string,
    NumericAggregationCompareSlice
  > | null>(null);
  const [portalReady, setPortalReady] = useState(false);

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

  const runs = pickerRuns ?? [];
  const otherRuns = useMemo(
    () => runs.filter((r) => r.id !== run?.id),
    [runs, run?.id]
  );
  const baselineRun = useMemo(() => {
    if (mode !== "choose_run" || !otherRunId) return null;
    return runs.find((r) => r.id === otherRunId) ?? null;
  }, [mode, otherRunId, runs]);

  const runSetup = useMemo<SetupSnapshotData>(
    () => normalizeSetupData(run?.setupSnapshot?.data ?? {}),
    [run?.setupSnapshot?.data]
  );

  const baselineValue = useMemo<SetupSnapshotData | null>(() => {
    if (mode === "choose_run" && baselineRun)
      return normalizeSetupData(baselineRun.setupSnapshot?.data ?? {});
    if (mode === "current_setup" && activeSetup)
      return normalizeSetupData(activeSetup);
    return null;
  }, [mode, baselineRun, activeSetup]);

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
          <div className="ui-title text-sm text-muted-foreground truncate min-w-0">
            {run ? formatRunPickerLine(run) : "Setup"}
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
              <div className="space-y-2">
                <span className="ui-title text-xs text-muted-foreground uppercase tracking-wide">
                  Compare to
                </span>
                <div className="flex flex-wrap gap-2 items-center">
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
                  {mode === "choose_run" && otherRuns.length > 0 && (
                    <div className="min-w-0 max-w-md">
                      <RunPickerSelect
                        label=""
                        runs={otherRuns}
                        value={otherRunId}
                        onChange={setOtherRunId}
                        placeholder="Select run…"
                        formatLine={formatRunPickerLine}
                      />
                    </div>
                  )}
                </div>
                {mode === "current_setup" && !hasActiveSetup && (
                  <p className="text-xs text-amber-600/90 dark:text-amber-400/90">
                    No current setup. Use the Setup page or Log your run to set one.
                  </p>
                )}
              </div>

              <SetupSheetView
                value={runSetup}
                onChange={() => {}}
                readOnly
                template={template}
                baselineValue={baselineValue}
                numericAggregationByKey={numericAggregationByKey}
              />
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
