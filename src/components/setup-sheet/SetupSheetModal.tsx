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
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import { Eyebrow } from "@/components/ui/panel";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import type { SetupSheetTemplate } from "@/lib/setupSheetTemplate";
import { getGenericSetupSheetTemplate } from "@/lib/setupSheetModels/genericSetupSheetTemplate";
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
  tireType?: { id: string; displayName: string } | null;
  tireStintId?: string | null;
  tireAgeKnown?: boolean | null;
  event?: { name: string; track?: { name: string } | null } | null;
  setupSnapshot?: { id: string; data?: unknown } | null;
  lapTimes?: unknown;
  /** Per-lap inclusion flags (rows from history/analysis loaders). */
  lapSession?: unknown;
  /** Exclusion-aware best lap (rows from the picker APIs). */
  bestLapSeconds?: number | null;
};

/** A standalone library setup sheet (upload or PetitRC download) pickable as a compare baseline. */
export type SetupCompareDoc = {
  id: string;
  originalFilename: string;
  sourceType?: string | null;
  sourceSite?: string | null;
  sourceUrl?: string | null;
  createdAt: string | Date;
  setupSheetTemplate?: string | null;
  parsedDataJson: unknown;
};

/** Which pool the compare baseline is drawn from. */
type CompareSource = "mine" | "teammates" | "setups";

const COMPARE_SOURCE_META: Record<CompareSource, SegmentedOption<CompareSource>> = {
  mine: { value: "mine", label: "Mine" },
  teammates: { value: "teammates", label: "Teammates" },
  setups: { value: "setups", label: "Setups" },
};

function formatSetupDocLine(doc: SetupCompareDoc): string {
  const source = doc.sourceSite?.toLowerCase() === "petitrc" ? "PetitRC" : "Upload";
  const name = doc.originalFilename?.replace(/\.(pdf|jpe?g|png|webp)$/i, "").trim() || "Setup sheet";
  let when = "";
  try {
    when = new Date(doc.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    when = "";
  }
  return when ? `${source} · ${name} · ${when}` : `${source} · ${name}`;
}

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
  const [compareSource, setCompareSource] = useState<CompareSource>("mine");
  const [otherRunId, setOtherRunId] = useState("");
  const [selectedDocId, setSelectedDocId] = useState("");
  const [comparePickerRuns, setComparePickerRuns] = useState<SetupSheetModalRun[]>([]);
  const [comparePickerLoading, setComparePickerLoading] = useState(false);
  const [setupDocs, setSetupDocs] = useState<SetupCompareDoc[]>([]);
  const [teammateRuns, setTeammateRuns] = useState<SetupSheetModalRun[]>([]);
  const [teammateDisplay, setTeammateDisplay] = useState<Record<string, string>>({});
  const [hasTeammates, setHasTeammates] = useState(false);
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
    setCompareSource("mine");
    setOtherRunId("");
    setSelectedDocId("");
    setSetupDocs([]);
    setTeammateRuns([]);
    setTeammateDisplay({});
    setHasTeammates(false);
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

  // Standalone library setups (uploads + PetitRC downloads) on this car's setup
  // sheet — a third compare source alongside my runs / teammate runs. Fetched
  // once the compare panel opens so the picker doesn't pay for it on every view.
  useEffect(() => {
    if (!open || !compareOpen || !run?.id) return;
    let alive = true;
    void fetch(`/api/setup-documents/for-compare?runId=${encodeURIComponent(run.id)}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { documents?: SetupCompareDoc[] };
        return Array.isArray(data.documents) ? data.documents : [];
      })
      .then((docs) => {
        if (alive) setSetupDocs(docs);
      })
      .catch(() => {
        if (alive) setSetupDocs([]);
      });
    return () => {
      alive = false;
    };
  }, [open, compareOpen, run?.id]);

  // Teammate-visible runs on this setup sheet — a compare source in EITHER
  // context (open my own setup, compare to a teammate). `hasTeammates` keeps the
  // segment discoverable even before a teammate has logged this car.
  useEffect(() => {
    if (!open || !compareOpen || !run?.id) return;
    let alive = true;
    void fetch(`/api/runs/teammate-for-setup-compare?runId=${encodeURIComponent(run.id)}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          runs?: SetupSheetModalRun[];
          memberDisplayByUserId?: Record<string, string>;
          hasTeammates?: boolean;
        };
        return {
          runs: Array.isArray(data.runs) ? data.runs : [],
          display: data.memberDisplayByUserId ?? {},
          hasTeammates: Boolean(data.hasTeammates),
        };
      })
      .then(({ runs, display, hasTeammates: ht }) => {
        if (!alive) return;
        setTeammateRuns(runs);
        setTeammateDisplay(display);
        setHasTeammates(ht);
      })
      .catch(() => {
        if (!alive) return;
        setTeammateRuns([]);
        setTeammateDisplay({});
        setHasTeammates(false);
      });
    return () => {
      alive = false;
    };
  }, [open, compareOpen, run?.id]);

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

  // My runs come from the local pool (in team context the merged list also
  // holds teammate rows, so filter to the viewer when we know who they are).
  // Teammate runs are fetched separately so they're available in EITHER context.
  const myRuns = useMemo(
    () => (viewerUserId ? otherRuns.filter((r) => r.userId === viewerUserId) : otherRuns),
    [otherRuns, viewerUserId]
  );

  // Only offer a source with something to pick — except Teammates, which stays
  // visible whenever the viewer has any teammate (empty state explains the gap).
  const availableSources = useMemo<CompareSource[]>(() => {
    const out: CompareSource[] = [];
    if (myRuns.length > 0) out.push("mine");
    if (hasTeammates) out.push("teammates");
    if (setupDocs.length > 0) out.push("setups");
    return out;
  }, [myRuns.length, hasTeammates, setupDocs.length]);

  // Driver names for teammate rows (fetched map wins; falls back to any passed in).
  const teammateFormatLine = useMemo(
    () =>
      (r: SetupSheetModalRun) =>
        formatRunPickerLineWithDriver(r, { ...(memberDisplayByUserId ?? {}), ...teammateDisplay }),
    [memberDisplayByUserId, teammateDisplay]
  );

  // Keep the active source valid as pools load in / change.
  useEffect(() => {
    if (availableSources.length === 0) return;
    if (!availableSources.includes(compareSource)) {
      setCompareSource(availableSources[0]!);
      setOtherRunId("");
      setSelectedDocId("");
    }
  }, [availableSources, compareSource]);

  const sourceRuns = compareSource === "teammates" ? teammateRuns : myRuns;

  const baselineRun = useMemo(() => {
    if (!compareOpen || compareSource === "setups" || !otherRunId) return null;
    // Teammate rows live in their own fetched pool, not the local run list.
    return sourceRuns.find((r) => r.id === otherRunId) ?? null;
  }, [compareOpen, compareSource, otherRunId, sourceRuns]);

  const selectedDoc = useMemo(() => {
    if (!compareOpen || compareSource !== "setups" || !selectedDocId) return null;
    return setupDocs.find((d) => d.id === selectedDocId) ?? null;
  }, [compareOpen, compareSource, selectedDocId, setupDocs]);

  useEffect(() => {
    // Library setups carry parsed values inline — no snapshot fetch needed.
    if (compareSource === "setups") {
      if (!open || !compareOpen || !selectedDoc) {
        setBaselineSetupData(null);
      } else {
        setBaselineSetupData(selectedDoc.parsedDataJson ?? {});
      }
      setBaselineSetupLoading(false);
      return;
    }
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
  }, [open, compareOpen, compareSource, otherRunId, baselineRun, selectedDoc]);

  const runSetup = useMemo<SetupSnapshotData>(
    () => normalizeSetupData(loadedSetupData ?? run?.setupSnapshot?.data ?? {}),
    [loadedSetupData, run?.setupSnapshot?.data]
  );

  const hasBaselineSelection = compareSource === "setups" ? Boolean(selectedDocId) : Boolean(otherRunId);

  const baselineValue = useMemo<SetupSnapshotData | null>(() => {
    if (!compareOpen || !hasBaselineSelection || baselineSetupLoading || baselineSetupData === null) {
      return null;
    }
    return normalizeSetupData(baselineSetupData);
  }, [compareOpen, hasBaselineSelection, baselineSetupLoading, baselineSetupData]);

  const compareActive = baselineValue != null;

  // Label for the "showing vs …" line, whichever source is active.
  const baselineLabel = useMemo(() => {
    if (compareSource === "setups") return selectedDoc ? formatSetupDocLine(selectedDoc) : null;
    return baselineRun ? formatPickerLine(baselineRun) : null;
  }, [compareSource, selectedDoc, baselineRun, formatPickerLine]);

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
    return getGenericSetupSheetTemplate();
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
                        if (wasOpen) {
                          setOtherRunId("");
                          setSelectedDocId("");
                        }
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
                  <SetupChangedSincePreviousList rows={changedSincePrevious} carId={carId} />
                )}
                {compareOpen ? (
                  <div className="space-y-2 pt-1">
                    {comparePickerLoading ? (
                      <span className="text-[11px] text-muted-foreground">Loading runs…</span>
                    ) : availableSources.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No runs or saved setups on this setup sheet yet. Log a run on your car with the same
                        sheet model, upload a setup sheet, or ask a teammate to share more sessions.
                      </p>
                    ) : (
                      <>
                        {availableSources.length > 1 ? (
                          <SegmentedControl<CompareSource>
                            size="sm"
                            ariaLabel="Compare against"
                            className="max-w-md"
                            value={compareSource}
                            onChange={(next) => {
                              setCompareSource(next);
                              setOtherRunId("");
                              setSelectedDocId("");
                            }}
                            options={availableSources.map((s) => COMPARE_SOURCE_META[s])}
                          />
                        ) : null}
                        <div className="min-w-0 w-full max-w-md">
                          {compareSource === "setups" ? (
                            <SearchableSelect
                              aria-label="Select a saved setup"
                              placeholder="Select saved setup…"
                              triggerMono
                              clearable
                              clearLabel="Select saved setup…"
                              value={selectedDocId}
                              onChange={setSelectedDocId}
                              options={setupDocs.map((d) => ({
                                value: d.id,
                                label: formatSetupDocLine(d),
                              }))}
                            />
                          ) : compareSource === "teammates" && sourceRuns.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              No teammate runs on this setup sheet yet. Ask a teammate to log or share a run
                              on this car.
                            </p>
                          ) : (
                            <RunPickerSelect
                              label=""
                              runs={sourceRuns as RunPickerRun[]}
                              value={otherRunId}
                              onChange={setOtherRunId}
                              placeholder={compareSource === "teammates" ? "Select teammate run…" : "Select run…"}
                              formatLine={
                                (compareSource === "teammates"
                                  ? teammateFormatLine
                                  : formatPickerLine) as (run: RunPickerRun) => string
                              }
                            />
                          )}
                        </div>
                      </>
                    )}
                    {hasBaselineSelection && baselineSetupLoading ? (
                      <p className="text-xs text-muted-foreground">Loading comparison setup…</p>
                    ) : null}
                    {compareActive && baselineLabel ? (
                      <p className="text-[11px] text-muted-foreground">
                        Showing this run&apos;s setup vs {baselineLabel}. Changed fields show{" "}
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
