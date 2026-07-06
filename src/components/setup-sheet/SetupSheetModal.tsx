"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { GitCompare } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { setupChangedRowsSincePrevious } from "@/lib/setupCompare/changedSincePrevious";
import { SetupChangedSincePreviousList } from "@/components/runs/SetupChangedSincePreviousList";
import {
  formatRunPickerLine,
  formatRunPickerLineWithDriver,
  type RunPickerRun,
} from "@/lib/runPickerFormat";
import { filterRunsForTeamSetupComparePicker } from "@/lib/setupCompare/teamSetupComparePicker";
import { RunPickerSelect } from "@/components/runs/RunPickerSelect";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import { Eyebrow } from "@/components/ui/panel";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import { getDefaultSetupSheetTemplate, type SetupSheetTemplate } from "@/lib/setupSheetTemplate";
import { canonicalSetupSheetTemplateId, isA800RRCar } from "@/lib/setupSheetTemplateId";
import { GRIP_BUCKET_ANY } from "@/lib/setupAggregations/gripBuckets";
import type { RunCompareListSource } from "@/lib/runCompareCatalog";
import type { NumericAggregationCompareSlice } from "@/lib/setupCompare/numericAggregationCompare";
import {
  buildNumericAggregationMapFromCommunity,
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
  const [compareOpen, setCompareOpen] = useState(false);
  const [otherRunId, setOtherRunId] = useState("");
  const [comparePickerRuns, setComparePickerRuns] = useState<SetupSheetModalRun[]>([]);
  const [comparePickerLoading, setComparePickerLoading] = useState(false);
  const [numericAggregationByKey, setNumericAggregationByKey] = useState<Map<
    string,
    NumericAggregationCompareSlice
  > | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [loadedSetupData, setLoadedSetupData] = useState<unknown>(null);
  const [baselineSetupData, setBaselineSetupData] = useState<unknown | null>(null);
  const [baselineSetupLoading, setBaselineSetupLoading] = useState(false);
  const [modelTemplate, setModelTemplate] = useState<SetupSheetTemplate | null>(null);

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
    setCompareOpen(false);
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

  const carId = run?.car?.id ?? run?.carId ?? null;

  useEffect(() => {
    if (!open || !carId) {
      setModelTemplate(null);
      return;
    }
    let alive = true;
    void fetch(`/api/cars/${encodeURIComponent(carId)}/setup-sheet-template?view=setup`, {
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data: { template?: SetupSheetTemplate }) => {
        if (!alive) return;
        setModelTemplate(data.template ?? null);
      })
      .catch(() => {
        if (alive) setModelTemplate(null);
      });
    return () => {
      alive = false;
    };
  }, [open, carId]);

  // Community stats bucket by the car's template key (model slug). No fallback: showing another
  // chassis' spread would color compare deltas with wrong data.
  const communityTemplateKey = useMemo(() => {
    return canonicalSetupSheetTemplateId(run?.car?.setupSheetTemplate ?? null);
  }, [run?.car?.setupSheetTemplate]);

  useEffect(() => {
    if (!open || !communityTemplateKey) {
      setNumericAggregationByKey(null);
      return;
    }
    let alive = true;
    const q = new URLSearchParams({
      setupSheetTemplate: communityTemplateKey,
      trackSurface: "asphalt",
      gripLevel: GRIP_BUCKET_ANY,
    }).toString();
    void fetch(`/api/setup-aggregations/community?${q}`)
      .then((res) => res.json())
      .then((data: { aggregations?: SetupAggApiRow[] }) => {
        if (!alive) return;
        const rows = Array.isArray(data.aggregations) ? data.aggregations : [];
        setNumericAggregationByKey(buildNumericAggregationMapFromCommunity(rows));
      })
      .catch(() => {
        if (alive) setNumericAggregationByKey(null);
      });
    return () => {
      alive = false;
    };
  }, [open, communityTemplateKey]);

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
    if (!compareOpen || !otherRunId) return null;
    return runs.find((r) => r.id === otherRunId) ?? null;
  }, [compareOpen, otherRunId, runs]);

  useEffect(() => {
    if (!open || !compareOpen || !otherRunId || !baselineRun) {
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
  }, [open, compareOpen, otherRunId, baselineRun]);

  const runSetup = useMemo<SetupSnapshotData>(
    () => normalizeSetupData(loadedSetupData ?? run?.setupSnapshot?.data ?? {}),
    [loadedSetupData, run?.setupSnapshot?.data]
  );

  const baselineValue = useMemo<SetupSnapshotData | null>(() => {
    if (!compareOpen || !otherRunId || baselineSetupLoading || baselineSetupData === null) {
      return null;
    }
    return normalizeSetupData(baselineSetupData);
  }, [compareOpen, otherRunId, baselineSetupLoading, baselineSetupData]);

  const compareActive = baselineValue != null;

  // "What changed this session" — diff vs the previous run on the same car,
  // mirroring the Sessions expanded-row preview. Same-car neighbours come from
  // the compare picker list (sorted newest → oldest, anchor run included).
  const previousRunOnCar = useMemo(() => {
    if (!run || !carId) return null;
    const sameCar = runs.filter((r) => (r.car?.id ?? r.carId) === carId);
    const idx = sameCar.findIndex((r) => r.id === run.id);
    if (idx < 0) return null;
    return sameCar[idx + 1] ?? null;
  }, [runs, run, carId]);

  const [previousSetupData, setPreviousSetupData] = useState<unknown | null>(null);
  useEffect(() => {
    if (!open || !previousRunOnCar?.setupSnapshot?.id) {
      setPreviousSetupData(null);
      return;
    }
    if (previousRunOnCar.setupSnapshot.data !== undefined) {
      setPreviousSetupData(previousRunOnCar.setupSnapshot.data);
      return;
    }
    let alive = true;
    void fetch(`/api/runs/${encodeURIComponent(previousRunOnCar.id)}/setup-snapshot`)
      .then((res) => res.json())
      .then((payload: { setupSnapshot?: { data?: unknown } }) => {
        if (alive) setPreviousSetupData(payload.setupSnapshot?.data ?? {});
      })
      .catch(() => {
        if (alive) setPreviousSetupData(null);
      });
    return () => {
      alive = false;
    };
  }, [open, previousRunOnCar?.id, previousRunOnCar?.setupSnapshot?.id, previousRunOnCar?.setupSnapshot?.data]);

  const changedSincePrevious = useMemo(() => {
    if (!previousRunOnCar?.setupSnapshot?.id || previousSetupData == null) return null;
    return setupChangedRowsSincePrevious(runSetup, previousSetupData);
  }, [previousRunOnCar, previousSetupData, runSetup]);

  const template = useMemo(() => {
    if (modelTemplate) return modelTemplate;
    if (isA800RRCar(run?.car?.setupSheetTemplate)) return A800RR_SETUP_SHEET_V1;
    return getDefaultSetupSheetTemplate();
  }, [modelTemplate, run?.car?.setupSheetTemplate]);

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
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Eyebrow>Setup vs previous run</Eyebrow>
                  <button
                    type="button"
                    onClick={() => {
                      setCompareOpen((wasOpen) => {
                        if (wasOpen) setOtherRunId("");
                        return !wasOpen;
                      });
                    }}
                    aria-pressed={compareOpen}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition",
                      compareOpen
                        ? "border-accent bg-accent/15 text-foreground"
                        : "border-border bg-card hover:bg-muted/90"
                    )}
                    title="Compare this run's setup to another run"
                  >
                    <GitCompare className="h-3.5 w-3.5" aria-hidden />
                    Compare to another run
                  </button>
                </div>
                {comparePickerLoading ||
                (run.setupSnapshot?.id != null && loadedSetupData == null) ||
                (previousRunOnCar?.setupSnapshot?.id != null && previousSetupData == null) ? (
                  <p className="text-muted-foreground text-xs">Loading changes…</p>
                ) : (
                  <SetupChangedSincePreviousList rows={changedSincePrevious} />
                )}
                {compareOpen ? (
                  <div className="space-y-2 pt-1">
                    {comparePickerLoading ? (
                      <span className="text-[11px] text-muted-foreground">Loading runs…</span>
                    ) : otherRuns.length > 0 ? (
                      <div className="min-w-0 w-full max-w-md">
                        <RunPickerSelect
                          label=""
                          runs={otherRuns as RunPickerRun[]}
                          value={otherRunId}
                          onChange={setOtherRunId}
                          placeholder="Select run…"
                          formatLine={formatPickerLine as (run: RunPickerRun) => string}
                        />
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No other runs on this setup sheet yet. Log a run on your car with the same sheet model, or
                        ask your teammate to share more sessions.
                      </p>
                    )}
                    {otherRunId && baselineSetupLoading ? (
                      <p className="text-xs text-muted-foreground">Loading comparison setup…</p>
                    ) : null}
                    {compareActive && baselineRun ? (
                      <p className="text-[11px] text-muted-foreground">
                        Showing this run&apos;s setup vs {formatPickerLine(baselineRun)}. Changed fields show{" "}
                        <span className="font-medium text-foreground/80">vs …</span> with the other value.{" "}
                        <span className="text-destructive/90">Darker red</span> = larger difference vs
                        community spread for that parameter; parameters without enough community samples use a
                        fixed lighter red.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <SetupSheetView
                key={template.id}
                value={runSetup}
                onChange={() => {}}
                readOnly
                template={template}
                baselineValue={baselineValue}
                compareHighlightOnly={compareActive}
                numericAggregationByKey={compareActive ? numericAggregationByKey : null}
              />
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
