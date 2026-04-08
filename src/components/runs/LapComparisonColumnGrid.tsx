"use client";

import { useEffect, useMemo, useState } from "react";
import type { ComparisonSeries, LapRow } from "@/lib/lapAnalysis";
import {
  alignLapsByNumber,
  areLapSeriesEquivalent,
  buildComparisonSeries,
  computeSummaryDeltas,
  filterDuplicateImportedSeries,
  formatLapDelta,
  getDeltaStyle,
  importedSetToLapRows,
  primaryLapRowsFromRun,
} from "@/lib/lapAnalysis";
import { formatLap, normalizeLapTimes } from "@/lib/runLaps";
import { cn } from "@/lib/utils";
import type { CompareRunShape } from "@/components/runs/RunComparePanel";
import { SetupSheetModal, type SetupSheetModalRun } from "@/components/setup-sheet/SetupSheetModal";
import type { RunCompareListSource } from "@/lib/runCompareCatalog";
import { formatCompareRunMetaLine } from "@/lib/runCompareMeta";
import { formatDriverSessionLabel } from "@/lib/lapImport/labels";

type ImportedSet = {
  id: string;
  driverName: string;
  displayName?: string | null;
  laps: Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded?: boolean }>;
};

type SeriesMeta = {
  metaLine: string | null;
  setupRun: CompareRunShape | null;
  /** Target dropdown + checkbox label */
  selectLabel: string;
};

function lapAt(series: ComparisonSeries, lapNumber: number): LapRow | undefined {
  return series.laps.find((l) => l.lapNumber === lapNumber);
}

function MetricBlock({
  label,
  value,
  delta,
  showDelta,
}: {
  label: string;
  value: string;
  delta: number | null;
  showDelta: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-mono text-[11px] text-foreground">{value}</div>
      {showDelta && delta != null && Number.isFinite(delta) ? (
        <div className="text-[10px] font-mono text-foreground/80 tabular-nums">{formatLapDelta(delta)}</div>
      ) : null}
    </div>
  );
}

function ColumnHeaderBlock({
  series,
  meta,
  isTarget,
  summaryDelta,
  onViewSetup,
}: {
  series: ComparisonSeries;
  meta: SeriesMeta;
  isTarget: boolean;
  summaryDelta: ReturnType<typeof computeSummaryDeltas> | null;
  onViewSetup?: (r: CompareRunShape) => void;
}) {
  const d = isTarget ? null : summaryDelta;
  return (
    <>
      <div className="font-medium text-foreground truncate">{series.label}</div>
      {meta.metaLine ? (
        <div className="text-[9px] text-muted-foreground leading-tight line-clamp-2">{meta.metaLine}</div>
      ) : null}
      <SetupHint series={series} run={meta.setupRun} onView={onViewSetup} />
      <div className="mt-1.5 space-y-1.5">
        <MetricBlock
          label="Best"
          value={formatLap(series.bestLap)}
          delta={d?.bestDelta ?? null}
          showDelta={!isTarget}
        />
        <MetricBlock
          label="Avg top 5"
          value={formatLap(series.avgTop5)}
          delta={d?.avgTop5Delta ?? null}
          showDelta={!isTarget}
        />
        <MetricBlock
          label="Avg top 10"
          value={formatLap(series.avgTop10)}
          delta={d?.avgTop10Delta ?? null}
          showDelta={!isTarget}
        />
      </div>
    </>
  );
}

function SetupHint({
  series,
  run,
  onView,
}: {
  series: ComparisonSeries;
  run: CompareRunShape | null;
  onView?: (r: CompareRunShape) => void;
}) {
  if (series.sourceType === "imported") return null;
  if (!run?.setupSnapshot?.id) {
    return <div className="text-[9px] text-muted-foreground mt-0.5">No saved setup snapshot</div>;
  }
  if (!onView) return null;
  return (
    <button
      type="button"
      className="text-[10px] text-accent underline underline-offset-2 mt-0.5 hover:brightness-110"
      onClick={() => onView(run)}
    >
      View setup
    </button>
  );
}

export function LapComparisonColumnGrid({
  myDisplayName,
  run,
  currentRunId,
  otherRuns = [],
  compareAnchorRun,
  pickerRunsForModal = [],
  runListSource = "my_runs",
  librarySessions = [],
}: {
  myDisplayName?: string | null;
  run: {
    lapTimes: unknown;
    lapSession?: unknown;
    importedLapSets?: ImportedSet[];
  };
  /** Current expanded run id — excluded from “other” prior runs. */
  currentRunId: string;
  /** Same user’s other runs (newest-first); used as extra lap columns. */
  otherRuns?: CompareRunShape[];
  /** Full shape for this run (setup + meta); must match `run` laps. */
  compareAnchorRun: CompareRunShape;
  /** All runs for setup modal picker (e.g. full history list). */
  pickerRunsForModal?: CompareRunShape[];
  runListSource?: RunCompareListSource;
  /** User-owned imported lap-time library (any session from /laps/import or Log your run). */
  librarySessions?: Array<{ id: string; selectLabel: string; laps: LapRow[] }>;
}) {
  const primaryRunLabel = myDisplayName?.trim() || "Me";

  const primaryLaps = useMemo(() => primaryLapRowsFromRun(run), [run]);

  const historyPickOptions = useMemo(() => {
    return otherRuns.filter((r) => {
      if (r.id === currentRunId) return false;
      if (normalizeLapTimes(r.lapTimes).length === 0) return false;
      const rows = primaryLapRowsFromRun({ lapTimes: r.lapTimes, lapSession: r.lapSession });
      if (areLapSeriesEquivalent(primaryLaps, rows)) return false;
      return true;
    });
  }, [otherRuns, currentRunId, primaryLaps]);

  const [targetId, setTargetId] = useState("run:primary");
  /** Import / driver columns only; history is controlled via multiselect. */
  const [importComparisonIds, setImportComparisonIds] = useState<string[]>([]);
  const [selectedHistoryRunIds, setSelectedHistoryRunIds] = useState<string[]>([]);
  const [setupModalRun, setSetupModalRun] = useState<CompareRunShape | null>(null);

  const { seriesList, metaById } = useMemo(() => {
    const metaById = new Map<string, SeriesMeta>();

    const primarySeries = buildComparisonSeries(
      "run:primary",
      primaryRunLabel,
      "run",
      primaryLaps
    );
    const meWhen =
      typeof compareAnchorRun.createdAt === "string"
        ? compareAnchorRun.createdAt
        : compareAnchorRun.createdAt.toISOString();
    metaById.set(primarySeries.id, {
      metaLine: formatCompareRunMetaLine(compareAnchorRun),
      setupRun: compareAnchorRun,
      selectLabel: formatDriverSessionLabel(primaryRunLabel, meWhen),
    });

    const rawImported: ComparisonSeries[] = [];
    for (const s of run.importedLapSets ?? []) {
      if (!s.laps?.length) continue;
      const label = (s.displayName?.trim() || s.driverName).trim() || "Imported";
      const ser = buildComparisonSeries(`imported:${s.id}`, label, "imported", importedSetToLapRows(s.laps));
      rawImported.push(ser);
      metaById.set(ser.id, {
        metaLine: null,
        setupRun: null,
        selectLabel: formatDriverSessionLabel(label, meWhen),
      });
    }

    const rawHistory: ComparisonSeries[] = [];
    for (const r of otherRuns) {
      if (!selectedHistoryRunIds.includes(r.id)) continue;
      if (r.id === currentRunId) continue;
      if (normalizeLapTimes(r.lapTimes).length === 0) continue;
      const ser = buildComparisonSeries(
        `history:${r.id}`,
        primaryRunLabel,
        "run",
        primaryLapRowsFromRun({ lapTimes: r.lapTimes, lapSession: r.lapSession })
      );
      rawHistory.push(ser);
      const metaLine = formatCompareRunMetaLine(r);
      const carName = r.car?.name?.trim() || r.carNameSnapshot?.trim() || primaryRunLabel;
      const when =
        typeof r.createdAt === "string" ? r.createdAt : r.createdAt.toISOString();
      metaById.set(ser.id, {
        metaLine,
        setupRun: r,
        selectLabel: formatDriverSessionLabel(carName, when),
      });
    }

    const rawLibrary: ComparisonSeries[] = [];
    for (const lib of librarySessions) {
      if (!lib.laps?.length) continue;
      const ser = buildComparisonSeries(
        `library:${lib.id}`,
        lib.selectLabel,
        "imported",
        lib.laps
      );
      rawLibrary.push(ser);
      metaById.set(ser.id, {
        metaLine: "Imported lap-time library",
        setupRun: null,
        selectLabel: lib.selectLabel,
      });
    }

    const dedupedOthers = filterDuplicateImportedSeries(primarySeries, [
      ...rawImported,
      ...rawLibrary,
      ...rawHistory,
    ]);
    const list = [primarySeries, ...dedupedOthers];
    return { seriesList: list, metaById };
  }, [
    run,
    primaryRunLabel,
    otherRuns,
    currentRunId,
    compareAnchorRun,
    primaryLaps,
    selectedHistoryRunIds,
    librarySessions,
  ]);

  useEffect(() => {
    setSelectedHistoryRunIds([]);
  }, [currentRunId]);

  useEffect(() => {
    const allowed = new Set(historyPickOptions.map((r) => r.id));
    setSelectedHistoryRunIds((prev) => prev.filter((id) => allowed.has(id)));
  }, [historyPickOptions]);

  const importedSeriesIds = useMemo(
    () => seriesList.filter((s) => s.sourceType === "imported").map((s) => s.id),
    [seriesList]
  );

  useEffect(() => {
    const valid = new Set(seriesList.map((s) => s.id));
    setImportComparisonIds((prev) => {
      const filtered = prev.filter(
        (id) => valid.has(id) && id !== targetId && importedSeriesIds.includes(id)
      );
      if (filtered.length > 0) return filtered;
      return importedSeriesIds.filter((id) => id !== targetId);
    });
  }, [seriesList, targetId, importedSeriesIds]);

  const comparisonIds = useMemo(() => {
    const valid = new Set(seriesList.map((s) => s.id));
    const hist = selectedHistoryRunIds
      .map((id) => `history:${id}`)
      .filter((id) => valid.has(id) && id !== targetId);
    return [...importComparisonIds, ...hist];
  }, [importComparisonIds, selectedHistoryRunIds, seriesList, targetId]);

  useEffect(() => {
    const ids = seriesList.map((s) => s.id);
    if (!ids.includes(targetId)) {
      setTargetId(ids[0] ?? "run:primary");
    }
  }, [seriesList, targetId]);

  const targetSeries = seriesList.find((s) => s.id === targetId) ?? seriesList[0];
  const comparisonSeries = seriesList.filter((s) => comparisonIds.includes(s.id));

  const lapNumbers = useMemo(() => {
    const cols = targetSeries ? [targetSeries, ...comparisonSeries] : comparisonSeries;
    return alignLapsByNumber(cols);
  }, [targetSeries, comparisonSeries]);

  function metaFor(s: ComparisonSeries): SeriesMeta {
    return (
      metaById.get(s.id) ?? {
        metaLine: null,
        setupRun: null,
        selectLabel: s.label,
      }
    );
  }

  const modalRuns = useMemo(
    () => (pickerRunsForModal.length > 0 ? pickerRunsForModal : [compareAnchorRun]) as SetupSheetModalRun[],
    [pickerRunsForModal, compareAnchorRun]
  );

  if (seriesList.length < 1) {
    return <p className="text-xs text-muted-foreground">No lap data for comparison.</p>;
  }

  return (
    <div className="space-y-3">
      <SetupSheetModal
        open={setupModalRun != null}
        onClose={() => setSetupModalRun(null)}
        run={(setupModalRun ?? compareAnchorRun) as SetupSheetModalRun}
        pickerRuns={modalRuns}
        runListSource={runListSource}
      />

      <div className="flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <label className="text-sm font-medium text-muted-foreground">Target</label>
          <select
            className="rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none max-w-[min(100%,280px)]"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            aria-label="Target series"
          >
            {seriesList.map((s) => (
              <option key={s.id} value={s.id}>
                {metaFor(s).selectLabel}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1 min-w-[200px]">
          <span className="text-sm font-medium text-muted-foreground block">Compare (this run + library)</span>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {seriesList
              .filter((s) => s.id !== targetId && s.sourceType === "imported")
              .map((s) => {
                const m = metaFor(s);
                return (
                  <label key={s.id} className="flex items-center gap-1.5 text-xs cursor-pointer max-w-[200px]">
                    <input
                      type="checkbox"
                      checked={importComparisonIds.includes(s.id)}
                      onChange={(e) => {
                        setImportComparisonIds((prev) =>
                          e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id)
                        );
                      }}
                    />
                    <span className="truncate" title={m.selectLabel}>
                      {m.selectLabel}
                    </span>
                  </label>
                );
              })}
            {importedSeriesIds.filter((id) => id !== targetId).length === 0 ? (
              <span className="text-[11px] text-muted-foreground">No extra imported/lap-library columns.</span>
            ) : null}
          </div>
        </div>
        <div className="space-y-1 min-w-[200px] max-w-[min(100%,320px)]">
          <label className="text-sm font-medium text-muted-foreground block" htmlFor="lap-compare-history">
            Compare to your previous runs?
          </label>
          {historyPickOptions.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No other runs with different lap data.</p>
          ) : (
            <select
              id="lap-compare-history"
              multiple
              size={Math.min(6, Math.max(3, historyPickOptions.length))}
              className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none"
              value={selectedHistoryRunIds}
              onChange={(e) => {
                setSelectedHistoryRunIds(Array.from(e.target.selectedOptions, (o) => o.value));
              }}
              aria-label="Select previous runs to compare"
            >
              {historyPickOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {formatCompareRunMetaLine(r)}
                </option>
              ))}
            </select>
          )}
          <p className="text-[10px] text-muted-foreground">Hold Ctrl (Windows) or ⌘ (Mac) to select several.</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs border-collapse min-w-[480px]">
          <thead>
            <tr className="border-b border-border bg-muted/80">
              <th className="text-left text-sm font-medium text-muted-foreground px-2 py-2 align-bottom sticky left-0 bg-muted/80 z-10">
                Lap
              </th>
              {targetSeries ? (
                <th
                  key={targetSeries.id}
                  className="text-left px-2 py-2 align-bottom border-l border-border min-w-[108px] bg-muted/70"
                >
                  <ColumnHeaderBlock
                    series={targetSeries}
                    meta={metaFor(targetSeries)}
                    isTarget
                    summaryDelta={null}
                    onViewSetup={setSetupModalRun}
                  />
                </th>
              ) : null}
              {comparisonSeries.map((s) => {
                const d = targetSeries ? computeSummaryDeltas(targetSeries, s) : null;
                return (
                  <th
                    key={s.id}
                    className="text-left px-2 py-2 align-bottom border-l border-border min-w-[108px]"
                  >
                    <ColumnHeaderBlock
                      series={s}
                      meta={metaFor(s)}
                      isTarget={false}
                      summaryDelta={d}
                      onViewSetup={setSetupModalRun}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {lapNumbers.map((lapNum) => {
              const tLap = targetSeries ? lapAt(targetSeries, lapNum) : undefined;
              return (
                <tr key={lapNum} className="border-b border-border/80 hover:bg-muted/50">
                  <td className="px-2 py-1 text-sm font-medium text-muted-foreground sticky left-0 bg-background/95 z-10">
                    {lapNum}
                  </td>
                  {targetSeries ? (
                    <td
                      className={cn(
                        "px-2 py-1 font-mono border-l border-border bg-muted/60",
                        tLap && (!tLap.isIncluded || tLap.lapNumber === 0) && "opacity-50 line-through"
                      )}
                    >
                      {tLap ? `${tLap.lapTimeSeconds.toFixed(3)}` : "—"}
                      {tLap && !tLap.isIncluded ? (
                        <span className="ml-1 text-[9px] uppercase text-muted-foreground">Excluded</span>
                      ) : null}
                    </td>
                  ) : null}
                  {comparisonSeries.map((s) => {
                    const lap = lapAt(s, lapNum);
                    if (!lap) {
                      return (
                        <td
                          key={s.id}
                          className="px-2 py-1 text-sm font-medium text-muted-foreground border-l border-border"
                        >
                          —
                        </td>
                      );
                    }
                    const excluded = !lap.isIncluded || lap.lapNumber === 0;
                    const targetOk = tLap && tLap.isIncluded && tLap.lapNumber !== 0;
                    const delta =
                      !excluded && targetOk ? lap.lapTimeSeconds - tLap.lapTimeSeconds : null;
                    const showDelta = !excluded && delta != null && Number.isFinite(delta);
                    const cellStyle =
                      showDelta && delta != null ? getDeltaStyle(delta) : undefined;
                    return (
                      <td
                        key={s.id}
                        className={cn(
                          "px-2 py-1 font-mono border-l border-border align-top",
                          excluded && "opacity-50 line-through text-muted-foreground"
                        )}
                        style={cellStyle}
                      >
                        <div className="flex flex-col gap-0.5 leading-tight">
                          <span>
                            {lap.lapTimeSeconds.toFixed(3)}
                            {excluded ? (
                              <span className="ml-1 text-[9px] uppercase text-muted-foreground not-italic">
                                Excluded
                              </span>
                            ) : null}
                          </span>
                          {showDelta ? (
                            <span className="text-[10px] font-mono text-foreground/80 tabular-nums">
                              {formatLapDelta(delta)}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
