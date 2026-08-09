"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Wrench } from "lucide-react";
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
  resolveDeltaTintRange,
} from "@/lib/lapAnalysis";
import { lapCompareTrackKey, lapSeriesMatchesCompareScope } from "@/lib/lapCompareScope";
import { formatLap, normalizeLapTimes } from "@/lib/runLaps";
import { cn } from "@/lib/utils";
import type { CompareRunShape } from "@/components/runs/RunComparePanel";
import { SetupSheetModal, type SetupSheetModalRun } from "@/components/setup-sheet/SetupSheetModal";
import type { RunCompareListSource } from "@/lib/runCompareCatalog";
import { formatCompareRunMetaLine } from "@/lib/runCompareMeta";
import {
  formatDriverSessionLabel,
  formatDriverSessionLabelWithContext,
  resolveImportedSessionDisplayTimeIso,
  timingSourceFromSourceUrl,
} from "@/lib/lapImport/labels";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";

type ImportedSet = {
  id: string;
  createdAt?: Date | string;
  sessionCompletedAt?: Date | string | null;
  /** Timing-source URL; when present, LiveRC/MyRCM session times render frozen (wall clock). */
  sourceUrl?: string | null;
  isPrimaryUser?: boolean;
  driverName: string;
  displayName?: string | null;
  /** Omitted until loaded for list views that defer nested laps to an API call. */
  laps?: Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded?: boolean }>;
};

type SeriesMeta = {
  metaLine: string | null;
  setupRun: CompareRunShape | null;
  /** Target dropdown + compare list label */
  selectLabel: string;
  /** Ordering: true session / run instant as ISO (for sorting compare options). */
  sortIso: string;
};

const MS_PER_DAY = 86400000;

function startOfLocalDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/** Calendar-day distance from local today: 0 = today, 1 = yesterday, … */
function dayBucketFromSortIso(sortIso: string): number {
  const t = new Date(sortIso);
  if (Number.isNaN(t.getTime())) return 9999;
  const today = startOfLocalDay(new Date());
  const day = startOfLocalDay(t);
  return Math.round((today - day) / MS_PER_DAY);
}

/** Today first, then newer calendar days before older; within a day, newest instant first. */
function compareOptionSort(a: { sortIso: string }, b: { sortIso: string }): number {
  const ba = dayBucketFromSortIso(a.sortIso);
  const bb = dayBucketFromSortIso(b.sortIso);
  if (ba !== bb) return ba - bb;
  return new Date(b.sortIso).getTime() - new Date(a.sortIso).getTime();
}

function lapAt(series: ComparisonSeries, lapNumber: number): LapRow | undefined {
  return series.laps.find((l) => l.lapNumber === lapNumber);
}

/**
 * Is this the column's own quickest lap? Marked with a dot so the one lap everyone
 * scans for is findable without reading every row. Compared on the stored value —
 * `bestLap` comes off these same rows, so an epsilon would only mask a real mismatch.
 */
function isBestLapOf(series: ComparisonSeries, lap: LapRow): boolean {
  return series.bestLap != null && lap.lapTimeSeconds === series.bestLap;
}

/** Gain green / loss red for delta text where there is no background tint (header metrics). */
function deltaTextClass(delta: number): string {
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-9) return "text-foreground/80";
  return delta > 0 ? "text-destructive" : "text-[#4FD089]";
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
  const hasDelta = showDelta && delta != null && Number.isFinite(delta);
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-mono text-[11px] tabular-nums text-foreground">{value}</div>
      {/* Delta slot always reserves its line height (even on the target column and
          when no delta exists) so Best / Avg top 5 / Avg top 10 stay aligned across
          every column. */}
      <div
        className={cn(
          "text-[10px] font-mono tabular-nums leading-tight",
          hasDelta ? deltaTextClass(delta!) : "opacity-0"
        )}
        aria-hidden={hasDelta ? undefined : true}
      >
        {hasDelta ? formatLapDelta(delta!) : "0.000"}
      </div>
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
      <div className="mt-1 space-y-1">
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
      aria-label="View setup"
      title="View setup sheet for this run"
      className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background text-foreground transition hover:bg-muted/80"
      onClick={() => onView(run)}
    >
      <Wrench className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

export function LapComparisonColumnGrid({
  primaryDriverName,
  primaryIsViewer = true,
  run,
  currentRunId,
  otherRuns = [],
  compareAnchorRun,
  pickerRunsForModal = [],
  runListSource = "my_runs",
  librarySessions = [],
  viewerUserId = null,
  memberDisplayByUserId,
}: {
  /**
   * Who drove the run these laps came from — NOT who is looking at it. On a
   * teammate's shared session the viewer's own name here put "Jordan Caruso"
   * on the target column above someone else's lap times.
   */
  primaryDriverName?: string | null;
  /** False when the run belongs to a teammate; drops the "(my runs)" wording. */
  primaryIsViewer?: boolean;
  run: {
    lapTimes: unknown;
    lapSession?: unknown;
    importedLapSets?: ImportedSet[];
    eventId?: string | null;
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
  librarySessions?: Array<{
    id: string;
    selectLabel: string;
    laps: LapRow[];
    sortTimeIso: string;
    /** Track this import was run at, via its linked run; null when never linked. */
    trackName?: string | null;
  }>;
  viewerUserId?: string | null;
  memberDisplayByUserId?: Record<string, string>;
}) {
  const primaryRunLabel =
    primaryDriverName?.trim() || (primaryIsViewer ? "Me" : "Driver");

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
  /** Columns to show vs target: imports, library, and previous runs (ids from seriesList). */
  const [selectedComparisonIds, setSelectedComparisonIds] = useState<string[]>([]);
  const [setupModalRun, setSetupModalRun] = useState<CompareRunShape | null>(null);
  /*
   * Defaults to the track, not the day. "Same calendar day" was the old default and it
   * quietly hid half a test day: the day was resolved from raw instants in the reader's
   * zone, so a session that ran across the reader's midnight lost everything on the far
   * side of it (reported 2026-08-09 — a continuous MR33 Arena test day). The track is
   * the question a lap sheet is opened to answer anyway, and no clock can break it.
   */
  const [compareScope, setCompareScope] = useState<"all" | "same_day" | "same_event" | "same_track">(
    // …unless this run has no track, where "same track" has nothing to match on and
    // would open the sheet on an empty list. Scoping to a venue you never recorded is
    // a dead end, so those runs start at "All" instead.
    () =>
      lapCompareTrackKey(compareAnchorRun.track?.name ?? compareAnchorRun.trackNameSnapshot ?? null)
        ? "same_track"
        : "all"
  );
  const [compareDriverKey, setCompareDriverKey] = useState<string>("__me__");

  const { seriesList, metaById } = useMemo(() => {
    const metaById = new Map<string, SeriesMeta>();

    const primarySeries = buildComparisonSeries(
      "run:primary",
      primaryRunLabel,
      "run",
      primaryLaps
    );
    const anchorSessionIso = resolveRunDisplayInstant(compareAnchorRun).toISOString();
    const primaryImport =
      run.importedLapSets?.find((x) => x.isPrimaryUser) ?? run.importedLapSets?.[0];
    const primaryFallback =
      primaryImport && primaryImport.createdAt != null
        ? typeof primaryImport.createdAt === "string"
          ? primaryImport.createdAt
          : primaryImport.createdAt.toISOString()
        : anchorSessionIso;
    const meSortIso = primaryImport
      ? resolveImportedSessionDisplayTimeIso({
          sessionCompletedAt: primaryImport.sessionCompletedAt ?? null,
          parsedPayload: undefined,
          createdAt: primaryFallback,
        })
      : anchorSessionIso;

    metaById.set(primarySeries.id, {
      metaLine: formatCompareRunMetaLine(compareAnchorRun),
      setupRun: compareAnchorRun,
      selectLabel: formatDriverSessionLabel(primaryRunLabel, meSortIso, {
        timingSource: timingSourceFromSourceUrl(primaryImport?.sourceUrl),
        isWallClockTime: primaryImport?.sessionCompletedAt != null,
      }),
      sortIso: meSortIso,
    });

    const rawImported: ComparisonSeries[] = [];
    for (const s of run.importedLapSets ?? []) {
      if (!s.laps?.length) continue;
      const label = (s.displayName?.trim() || s.driverName).trim() || "Imported";
      const ser = buildComparisonSeries(`imported:${s.id}`, label, "imported", importedSetToLapRows(s.laps));
      rawImported.push(ser);
      const fallbackWhen =
        typeof s.createdAt === "string"
          ? s.createdAt
          : s.createdAt != null
            ? s.createdAt.toISOString()
            : anchorSessionIso;
      const whenIso = resolveImportedSessionDisplayTimeIso({
        sessionCompletedAt: s.sessionCompletedAt ?? null,
        parsedPayload: undefined,
        createdAt: fallbackWhen,
      });
      metaById.set(ser.id, {
        metaLine: null,
        setupRun: null,
        selectLabel: formatDriverSessionLabel(label, whenIso, {
          timingSource: timingSourceFromSourceUrl(s.sourceUrl),
          isWallClockTime: s.sessionCompletedAt != null,
        }),
        sortIso: whenIso,
      });
    }

    const rawHistory: ComparisonSeries[] = [];
    for (const r of historyPickOptions) {
      // Team Sessions feeds every member's runs in here, so the anchor run's
      // driver is the wrong name to print above a column that isn't theirs. The
      // roster is only passed in team mode; solo lists fall through unchanged.
      const runDriverLabel =
        (r.userId ? memberDisplayByUserId?.[r.userId]?.trim() : "") || primaryRunLabel;
      const ser = buildComparisonSeries(
        `history:${r.id}`,
        runDriverLabel,
        "run",
        primaryLapRowsFromRun({ lapTimes: r.lapTimes, lapSession: r.lapSession })
      );
      rawHistory.push(ser);
      const metaLine = formatCompareRunMetaLine(r);
      const carName = r.car?.name?.trim() || r.carNameSnapshot?.trim() || primaryRunLabel;
      const whenIso = resolveRunDisplayInstant(r).toISOString();
      const trackCtx = r.track?.name?.trim() || r.trackNameSnapshot?.trim() || null;
      metaById.set(ser.id, {
        metaLine,
        setupRun: r,
        selectLabel: formatDriverSessionLabelWithContext(carName, whenIso, trackCtx ?? undefined),
        sortIso: whenIso,
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
        sortIso: lib.sortTimeIso,
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
    historyPickOptions,
    compareAnchorRun,
    primaryLaps,
    librarySessions,
    memberDisplayByUserId,
  ]);

  const anchorInstantIso = useMemo(
    () => resolveRunDisplayInstant(compareAnchorRun).toISOString(),
    [compareAnchorRun]
  );

  const anchorTrackKey = useMemo(
    () =>
      lapCompareTrackKey(
        compareAnchorRun.track?.name ?? compareAnchorRun.trackNameSnapshot ?? null
      ),
    [compareAnchorRun]
  );

  /** Track behind a series id: the run it came from, or the import's linked run. */
  const trackKeyForSeries = useCallback(
    (seriesId: string): string | null => {
      if (seriesId === "run:primary") return anchorTrackKey;
      if (seriesId.startsWith("history:")) {
        const r = otherRuns.find((o) => o.id === seriesId.slice("history:".length));
        return lapCompareTrackKey(r?.track?.name ?? r?.trackNameSnapshot ?? null);
      }
      if (seriesId.startsWith("library:")) {
        const lib = librarySessions.find((l) => l.id === seriesId.slice("library:".length));
        return lapCompareTrackKey(lib?.trackName ?? null);
      }
      return null;
    },
    [anchorTrackKey, otherRuns, librarySessions]
  );

  const scopeFilteredRows = useMemo(() => {
    const ev = compareAnchorRun.eventId;
    return seriesList
      .filter((s) => s.id !== targetId)
      .map((s) => {
        const m = metaById.get(s.id);
        const sortIso = m?.sortIso ?? "";
        return { series: s, sortIso, label: m?.selectLabel ?? s.label };
      })
      .filter(({ series, sortIso }) =>
        lapSeriesMatchesCompareScope({
          seriesId: series.id,
          sortIso,
          scope: compareScope,
          anchorInstantIso,
          anchorEventId: ev,
          primaryRunEventId: run.eventId ?? null,
          eventIdForHistoryRun: (rid) => otherRuns.find((o) => o.id === rid)?.eventId,
          anchorTrackKey,
          trackKeyForSeries,
        })
      );
  }, [
    seriesList,
    targetId,
    metaById,
    compareScope,
    anchorInstantIso,
    compareAnchorRun.eventId,
    run.eventId,
    otherRuns,
    anchorTrackKey,
    trackKeyForSeries,
  ]);

  /*
   * "This driver" means the driver of the run being viewed — not every run in the list.
   * Team Sessions feeds every member's runs in as `history:` series, so the old test
   * (any history series) quietly mixed teammates into what reads as your own sessions.
   * With no userId on the anchor (solo lists don't always carry one) it falls back to
   * the previous behaviour rather than filtering everything away.
   */
  const isAnchorDriverSeries = useCallback(
    (seriesId: string): boolean => {
      if (seriesId === "run:primary") return true;
      if (!seriesId.startsWith("history:")) return false;
      const anchorUserId = compareAnchorRun.userId ?? null;
      if (!anchorUserId) return true;
      const r = otherRuns.find((o) => o.id === seriesId.slice("history:".length));
      return (r?.userId ?? anchorUserId) === anchorUserId;
    },
    [compareAnchorRun.userId, otherRuns]
  );

  const compareDriverChoices = useMemo(() => {
    const opts: { key: string; label: string }[] = [{ key: "__all__", label: "All drivers" }];
    const hasMe = scopeFilteredRows.some((r) => isAnchorDriverSeries(r.series.id));
    if (hasMe) {
      opts.push({
        key: "__me__",
        label: primaryIsViewer ? `${primaryRunLabel} (my runs)` : primaryRunLabel,
      });
    }
    const seenImported = new Set<string>();
    const seenLib = new Set<string>();
    for (const r of scopeFilteredRows) {
      if (r.series.id.startsWith("imported:")) {
        const setId = r.series.id.slice(9);
        const set = run.importedLapSets?.find((x) => x.id === setId);
        const label = (set?.displayName?.trim() || set?.driverName || "").trim();
        if (!label) continue;
        const k = `drv:${label}`;
        if (seenImported.has(k)) continue;
        seenImported.add(k);
        opts.push({ key: k, label });
      } else if (r.series.id.startsWith("library:")) {
        const libId = r.series.id.slice(8);
        const lib = librarySessions.find((l) => l.id === libId);
        const lead = lib?.selectLabel.split(" · ")[0]?.trim() || lib?.selectLabel || "";
        if (!lead) continue;
        const k = `lib:${lead}`;
        if (seenLib.has(k)) continue;
        seenLib.add(k);
        opts.push({ key: k, label: `${lead} (library)` });
      }
    }
    return opts;
  }, [
    scopeFilteredRows,
    primaryRunLabel,
    primaryIsViewer,
    run.importedLapSets,
    librarySessions,
    isAnchorDriverSeries,
  ]);

  useEffect(() => {
    const keys = new Set(compareDriverChoices.map((c) => c.key));
    if (keys.has(compareDriverKey)) return;
    const next =
      compareDriverChoices.find((c) => c.key === "__me__") ?? compareDriverChoices[0];
    if (next) setCompareDriverKey(next.key);
  }, [compareDriverChoices, compareDriverKey]);

  const compareOptionRows = useMemo(() => {
    return scopeFilteredRows
      .filter(({ series }) => {
        if (compareDriverKey === "__all__") return true;
        if (compareDriverKey === "__me__") return isAnchorDriverSeries(series.id);
        if (compareDriverKey.startsWith("drv:")) {
          const name = compareDriverKey.slice(4);
          if (!series.id.startsWith("imported:")) return false;
          const setId = series.id.slice(9);
          const set = run.importedLapSets?.find((x) => x.id === setId);
          const label = (set?.displayName?.trim() || set?.driverName || "").trim();
          return label === name;
        }
        if (compareDriverKey.startsWith("lib:")) {
          const lead = compareDriverKey.slice(4);
          if (!series.id.startsWith("library:")) return false;
          const libId = series.id.slice(8);
          const lib = librarySessions.find((l) => l.id === libId);
          return lib?.selectLabel.startsWith(lead) ?? false;
        }
        return true;
      })
      .map(({ series, sortIso, label }) => ({ id: series.id, sortIso, label }))
      // Newest first, like every other run list in the app — and like the Target
      // dropdown directly above it, which has always used this comparator. The
      // ascending sort here put your oldest session at the top of the one list you
      // pick from, which is the opposite of what you reach for after a run.
      .sort(compareOptionSort);
  }, [
    scopeFilteredRows,
    compareDriverKey,
    run.importedLapSets,
    librarySessions,
    isAnchorDriverSeries,
  ]);

  useEffect(() => {
    setSelectedComparisonIds([]);
  }, [currentRunId]);

  useEffect(() => {
    const valid = new Set(compareOptionRows.map((r) => r.id));
    setSelectedComparisonIds((prev) => prev.filter((id) => valid.has(id) && id !== targetId));
  }, [compareOptionRows, targetId]);

  useEffect(() => {
    const ids = seriesList.map((s) => s.id);
    if (!ids.includes(targetId)) {
      setTargetId(ids[0] ?? "run:primary");
    }
  }, [seriesList, targetId]);

  const targetSeries = seriesList.find((s) => s.id === targetId) ?? seriesList[0];
  const comparisonSeries = useMemo(() => {
    return selectedComparisonIds
      .map((id) => seriesList.find((s) => s.id === id))
      .filter((s): s is ComparisonSeries => Boolean(s));
  }, [selectedComparisonIds, seriesList]);

  const lapNumbers = useMemo(() => {
    const cols = targetSeries ? [targetSeries, ...comparisonSeries] : comparisonSeries;
    return alignLapsByNumber(cols);
  }, [targetSeries, comparisonSeries]);

  /*
   * Colour range for THIS grid, from the deltas actually drawn in it.
   *
   * The fixed 1.0s range assumed a spread lap data never has: in a 14.8s class a 0.1s
   * delta tinted at 10% opacity, so every meaningful lap sat in the bottom sixth of the
   * ramp and the grid read as one flat wash. Recomputed per grid (and so per comparison
   * you tick on), which is also why excluded laps are skipped — an 18s crash lap is not
   * part of the comparison and must not set the scale for the laps that are.
   */
  const deltaTintRange = useMemo(() => {
    if (!targetSeries || comparisonSeries.length === 0) return undefined;
    const deltas: number[] = [];
    for (const lapNum of lapNumbers) {
      const t = lapAt(targetSeries, lapNum);
      if (!t || !t.isIncluded || t.lapNumber === 0) continue;
      for (const s of comparisonSeries) {
        const c = lapAt(s, lapNum);
        if (!c || !c.isIncluded || c.lapNumber === 0) continue;
        deltas.push(c.lapTimeSeconds - t.lapTimeSeconds);
      }
    }
    return resolveDeltaTintRange(deltas);
  }, [targetSeries, comparisonSeries, lapNumbers]);

  /*
   * The target list is four different kinds of thing wearing one label shape
   * ("NAME · date, time"): this run, the rest of the race field that came in on
   * its timing import, the driver's earlier runs, and their own imported lap
   * library. Flat, it reads as a pile of unexplained runs — worse on a
   * teammate's session, where every name in it is a stranger. Native
   * `<optgroup>` headings cost nothing and say which is which; skipped entirely
   * when only one kind is present, so a plain solo run keeps a plain list.
   */
  const targetOptionGroups = useMemo(() => {
    const bySortIso = (a: ComparisonSeries, b: ComparisonSeries) =>
      compareOptionSort(
        { sortIso: metaById.get(a.id)?.sortIso ?? "" },
        { sortIso: metaById.get(b.id)?.sortIso ?? "" }
      );
    const pick = (prefix: string) =>
      seriesList.filter((s) => s.id.startsWith(prefix)).sort(bySortIso);
    const groups: { key: string; label: string; series: ComparisonSeries[] }[] = [
      {
        key: "this_run",
        label: "This run",
        series: seriesList.filter((s) => s.id === "run:primary"),
      },
      { key: "field", label: "Rest of the race field", series: pick("imported:") },
      {
        key: "history",
        label: primaryIsViewer ? "My other runs" : "Other runs",
        series: pick("history:"),
      },
      { key: "library", label: "My imported sessions", series: pick("library:") },
    ];
    return groups.filter((g) => g.series.length > 0);
  }, [seriesList, metaById, primaryIsViewer]);

  const compareOptionCount = compareOptionRows.length;

  function metaFor(s: ComparisonSeries): SeriesMeta {
    const fallbackIso = resolveRunDisplayInstant(compareAnchorRun).toISOString();
    return (
      metaById.get(s.id) ?? {
        metaLine: null,
        setupRun: null,
        selectLabel: s.label,
        sortIso: fallbackIso,
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
        viewerUserId={viewerUserId}
        memberDisplayByUserId={memberDisplayByUserId}
      />

      <div className="space-y-3 sm:max-w-[520px]">
        <div className="space-y-1">
          <label className="ui-label-caps" htmlFor="lap-compare-target">
            Target
          </label>
          <select
            id="lap-compare-target"
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            aria-label="Target series"
          >
            {targetOptionGroups.length === 1
              ? targetOptionGroups[0].series.map((s) => (
                  <option key={s.id} value={s.id}>
                    {metaFor(s).selectLabel}
                  </option>
                ))
              : targetOptionGroups.map((g) => (
                  <optgroup key={g.key} label={g.label}>
                    {g.series.map((s) => (
                      <option key={s.id} value={s.id}>
                        {metaFor(s).selectLabel}
                      </option>
                    ))}
                  </optgroup>
                ))}
          </select>
        </div>
        <div className="space-y-2">
          <div className="ui-label-caps">Compare against</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0 space-y-0.5">
              <label className="text-[10px] text-muted-foreground" htmlFor="lap-compare-scope">
                Scope
              </label>
              <select
                id="lap-compare-scope"
                className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none"
                value={compareScope}
                onChange={(e) => setCompareScope(e.target.value as typeof compareScope)}
              >
                <option value="same_track">Same track</option>
                <option value="same_event">Same event</option>
                <option value="same_day">Same calendar day</option>
                <option value="all">All</option>
              </select>
            </div>
            <div className="min-w-0 space-y-0.5">
              <label className="text-[10px] text-muted-foreground" htmlFor="lap-compare-driver">
                Driver
              </label>
              <select
                id="lap-compare-driver"
                className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none"
                value={compareDriverKey}
                onChange={(e) => setCompareDriverKey(e.target.value)}
              >
                {compareDriverChoices.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {compareOptionCount === 0 ? (
            <p className="text-[11px] text-muted-foreground">No lap series match this scope and driver.</p>
          ) : (
            <div
              className="max-h-[min(220px,40vh)] overflow-y-auto rounded-md border border-border bg-card px-2 py-1.5"
              role="group"
              aria-label="Series to compare against the target"
            >
              <ul className="space-y-1.5">
                {compareOptionRows.map((row) => (
                  <li key={row.id}>
                    <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-snug">
                      <input
                        type="checkbox"
                        className="mt-0.5 shrink-0"
                        checked={selectedComparisonIds.includes(row.id)}
                        onChange={(e) => {
                          setSelectedComparisonIds((prev) => {
                            if (e.target.checked) return [...prev, row.id];
                            return prev.filter((id) => id !== row.id);
                          });
                        }}
                      />
                      <span className="min-w-0 text-foreground">{row.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            Choose scope and driver, then tick runs to compare. Newest first.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        {/* No forced min-width: Lap + target + one comparison fit a 390px phone;
            additional comparison columns overflow into sideways scroll. */}
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/80">
              <th className="w-9 text-left text-xs sm:text-sm font-medium text-muted-foreground px-1.5 sm:px-2 py-2 align-bottom sticky left-0 bg-muted/80 z-10">
                Lap
              </th>
              {targetSeries ? (
                <th
                  key={targetSeries.id}
                  className="text-left px-1.5 sm:px-2 py-1.5 sm:py-2 align-bottom border-l border-border min-w-[108px] bg-muted/70"
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
                    className="text-left px-1.5 sm:px-2 py-1.5 sm:py-2 align-bottom border-l border-border min-w-[108px]"
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
              const targetOk = tLap != null && tLap.isIncluded && tLap.lapNumber !== 0;
              // Mirror tint: target colors the opposite way vs the fastest
              // included comparison lap in this row (green when the target
              // was quicker, red when it was slower).
              let fastestComparisonSeconds: number | null = null;
              for (const s of comparisonSeries) {
                const lap = lapAt(s, lapNum);
                if (!lap || !lap.isIncluded || lap.lapNumber === 0) continue;
                if (
                  fastestComparisonSeconds == null ||
                  lap.lapTimeSeconds < fastestComparisonSeconds
                ) {
                  fastestComparisonSeconds = lap.lapTimeSeconds;
                }
              }
              const targetMirrorDelta =
                targetOk && fastestComparisonSeconds != null
                  ? tLap.lapTimeSeconds - fastestComparisonSeconds
                  : null;
              const targetMirrorStyle =
                targetMirrorDelta != null
                  ? getDeltaStyle(targetMirrorDelta, deltaTintRange)
                  : undefined;
              return (
                <tr key={lapNum} className="border-b border-border/80 hover:bg-muted/50">
                  <td className="px-1.5 sm:px-2 py-1 text-xs sm:text-sm font-medium text-muted-foreground sticky left-0 bg-background/95 z-10">
                    {lapNum}
                  </td>
                  {targetSeries ? (
                    <td
                      className={cn(
                        "px-1.5 sm:px-2 py-1 font-mono border-l border-border",
                        !targetMirrorStyle && "bg-muted/60",
                        tLap && (!tLap.isIncluded || tLap.lapNumber === 0) && "opacity-50 line-through"
                      )}
                      style={targetMirrorStyle}
                    >
                      {/* The target cell states its delta too. It was the only column
                          that showed a tint without the number behind it — the one
                          column everything else is measured against, silent about by
                          how much. It mirrors the tint: measured against the fastest
                          comparison in this row. */}
                      <div className="flex flex-col gap-0.5 leading-tight">
                        <span className="tabular-nums">
                          {tLap ? tLap.lapTimeSeconds.toFixed(3) : "—"}
                          {tLap && targetOk && isBestLapOf(targetSeries, tLap) ? (
                            <span
                              className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle"
                              title="Best lap of this session"
                              aria-label="Best lap of this session"
                            />
                          ) : null}
                          {tLap && !tLap.isIncluded ? (
                            <span className="ml-1 ui-title text-[9px] text-muted-foreground">Excluded</span>
                          ) : null}
                        </span>
                        {targetMirrorDelta != null ? (
                          <span className="text-[10px] font-mono text-foreground/80 tabular-nums">
                            {formatLapDelta(targetMirrorDelta)}
                          </span>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                  {comparisonSeries.map((s) => {
                    const lap = lapAt(s, lapNum);
                    if (!lap) {
                      return (
                        <td
                          key={s.id}
                          className="px-1.5 sm:px-2 py-1 text-xs sm:text-sm font-medium text-muted-foreground border-l border-border"
                        >
                          —
                        </td>
                      );
                    }
                    const excluded = !lap.isIncluded || lap.lapNumber === 0;
                    const delta =
                      !excluded && targetOk ? lap.lapTimeSeconds - tLap.lapTimeSeconds : null;
                    const showDelta = !excluded && delta != null && Number.isFinite(delta);
                    const cellStyle =
                      showDelta && delta != null ? getDeltaStyle(delta, deltaTintRange) : undefined;
                    return (
                      <td
                        key={s.id}
                        className={cn(
                          "px-1.5 sm:px-2 py-1 font-mono border-l border-border align-top",
                          excluded && "opacity-50 line-through text-muted-foreground"
                        )}
                        style={cellStyle}
                      >
                        <div className="flex flex-col gap-0.5 leading-tight">
                          <span className="tabular-nums">
                            {lap.lapTimeSeconds.toFixed(3)}
                            {!excluded && isBestLapOf(s, lap) ? (
                              <span
                                className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle"
                                title="Best lap of this session"
                                aria-label="Best lap of this session"
                              />
                            ) : null}
                            {excluded ? (
                              <span className="ml-1 ui-title text-[9px] text-muted-foreground not-italic">
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

      {/* Nothing in the grid said what the colours meant. The ramp shows both the
          direction and that strength tracks size — and it only appears once there is
          a comparison actually tinting cells. */}
      {targetSeries && comparisonSeries.length > 0 ? (
        <div className="flex items-center gap-2">
          <span className="ui-label-caps text-[9px] text-muted-foreground">Quicker</span>
          <span
            aria-hidden
            className="h-1.5 flex-1 rounded-full"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgba(79,208,137,0.5), rgba(79,208,137,0.08), rgba(128,128,128,0.06), rgba(229,100,78,0.08), rgba(229,100,78,0.5))",
            }}
          />
          <span className="ui-label-caps text-[9px] text-muted-foreground">Slower</span>
        </div>
      ) : null}
    </div>
  );
}
