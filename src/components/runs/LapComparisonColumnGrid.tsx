"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Wrench } from "lucide-react";
import type { ComparisonSeries, LapRow, SummaryMetricDeltas } from "@/lib/lapAnalysis";
import {
  alignLapsByNumber,
  analyzeLapRows,
  areLapSeriesEquivalent,
  buildComparisonSeries,
  computeSummaryDeltas,
  filterDuplicateImportedSeries,
  formatLapDelta,
  getDeltaStyle,
  getIncludedLaps,
  importedSetToLapRows,
  primaryLapRowsFromRun,
  resolveDeltaTintRange,
} from "@/lib/lapAnalysis";
import { LapTimeGraph } from "@/components/runs/LapTimeGraph";
import {
  LapCompareStatTiles,
  type LapStatTile,
} from "@/components/runs/LapCompareStatTiles";
import {
  lapCompareTrackKey,
  lapSeriesMatchesCompareScope,
  sameLocalCalendarDay,
} from "@/lib/lapCompareScope";
import { formatLap, normalizeLapTimes } from "@/lib/runLaps";
import { formatRunDateTime } from "@/lib/formatDate";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { cn } from "@/lib/utils";
import {
  LapCompareSegmentBar,
  LapCompareSessionList,
  LapCompareSheet,
  type LapPickerGroup,
  type LapPickerRow,
} from "@/components/runs/LapCompareSessionPicker";
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
  /**
   * Session name on its own, with no timestamp glued to it. The picker prints
   * name and time on separate lines, and splitting `selectLabel` back apart on
   * " · " would break the moment a car or track name contained one.
   */
  name: string;
  /** Which tab of the picker this series lives under. */
  segment: CompareSegmentKey;
  /** Track it was run at, for grouping rows under "Earlier at …". */
  trackKey: string | null;
};

/**
 * Who the comparison belongs to. Replaces the old Driver dropdown, whose
 * per-driver keys ("compare against Dayne") were a filter over a list you then
 * had to tick anyway — two steps to say one thing. Segments carve the same set
 * by *whose* sessions they are, and every row inside stays individually tickable.
 */
type CompareSegmentKey = "driver" | "teammates" | "field" | "library";

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
 * The three buckets a driver actually thinks in: what happened today, what
 * happened at this track before, and everything else.
 *
 * Shared by the target dropdown and the tick-list under it so the two can never
 * name the same session differently. Day membership uses `sameLocalCalendarDay`
 * — the same test the `same_day` scope uses — so grouping and filtering can't
 * disagree. It resolves the day in the READER's zone, not the driver's:
 * `resolveRunLocalTimeZone` is the zone-correct answer and is already used by
 * the Sessions groups, but it needs `Run.localTimeZone` plumbed onto
 * `CompareRunShape` first. Until then a session that crosses your midnight can
 * still land in "Earlier at …" rather than "This test day".
 */
type DayTrackBucket = "today" | "here" | "elsewhere";

function dayTrackBucketFor(input: {
  sortIso: string;
  trackKey: string | null;
  anchorTrackKey: string | null;
  anchorInstantIso: string;
}): DayTrackBucket {
  // "This test day" is a day AND a place. A session run the same afternoon at a
  // different venue filed under a heading naming this one would be a lie about
  // where you were — so a track mismatch beats the calendar.
  const here = !input.anchorTrackKey || input.trackKey === input.anchorTrackKey;
  if (!here) return "elsewhere";
  if (input.sortIso && sameLocalCalendarDay(input.sortIso, input.anchorInstantIso)) return "today";
  return "here";
}

function dayTrackBucketLabels(anchorTrackName: string | null): Record<DayTrackBucket, string> {
  return {
    today: anchorTrackName ? `This test day · ${anchorTrackName}` : "This test day",
    here: anchorTrackName ? `Earlier at ${anchorTrackName}` : "Earlier sessions",
    elsewhere: "Other tracks and events",
  };
}

/**
 * Is this the column's own quickest lap? Marked with a dot so the one lap everyone
 * scans for is findable without reading every row. Compared on the stored value —
 * `bestLap` comes off these same rows, so an epsilon would only mask a real mismatch.
 */
function isBestLapOf(series: ComparisonSeries, lap: LapRow): boolean {
  return series.bestLap != null && lap.lapTimeSeconds === series.bestLap;
}

/** Whole-session summary rows under the laps — see the `<tfoot>` that renders them. */
const SUMMARY_FOOTER_ROWS: Array<{
  label: string;
  pick: (s: ComparisonSeries) => number | null;
  delta: (d: SummaryMetricDeltas) => number | null;
}> = [
  { label: "Avg 5", pick: (s) => s.avgTop5, delta: (d) => d.avgTop5Delta },
  { label: "Avg 10", pick: (s) => s.avgTop10, delta: (d) => d.avgTop10Delta },
];

/** Gain green / loss red for delta text where there is no background tint (header metrics). */
function deltaTextClass(delta: number): string {
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-9) return "text-foreground/80";
  return delta > 0 ? "text-destructive" : "text-gain";
}

/**
 * A column's identity and its one headline number — three lines, not fifteen.
 *
 * This block used to stack name, meta line, a setup note, and Best / Avg top 5 /
 * Avg top 10 each with its own delta: about 400px of header on a 390px phone, so
 * the sheet opened on a screen of column headings with no lap times on it at all.
 * Best lap is the number that decides whether a column is worth reading; the two
 * averages moved to the table footer, where they compare just as well and cost
 * nothing until you have scrolled the laps you came for.
 */
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
  const bestDelta = isTarget ? null : summaryDelta?.bestDelta ?? null;
  return (
    <>
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          {/* The session, not the driver. Three of the driver's own runs side by
              side all read "Dayne Warren" — a heading that cannot tell you which
              column you are looking at. */}
          <div className="truncate font-medium text-foreground">{meta.name}</div>
          <div className="truncate text-[9px] leading-tight text-muted-foreground">
            {meta.sortIso ? formatRunDateTime(meta.sortIso) : ""}
            {isTarget ? " · target" : ""}
          </div>
        </div>
        <SetupHint series={series} run={meta.setupRun} onView={onViewSetup} />
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-1 text-[10px] tabular-nums">
        <span className="text-muted-foreground">best</span>
        <span className={cn("font-medium", isTarget ? "text-primary-ink" : "text-foreground")}>
          {formatLap(series.bestLap)}
        </span>
        {bestDelta != null && Number.isFinite(bestDelta) ? (
          <span className={cn("text-[9px]", deltaTextClass(bestDelta))}>
            {formatLapDelta(bestDelta)}
          </span>
        ) : null}
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
  // "No saved setup snapshot" was printed in every column that lacked one — the
  // same sentence three times across a header that had no room for it. Absence of
  // the wrench says the same thing and takes no space.
  if (!run?.setupSnapshot?.id) return null;
  if (!onView) return null;
  return (
    <button
      type="button"
      aria-label="View setup"
      title="View setup sheet for this run"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground transition hover:bg-muted/80"
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
    /** Driver on the timing sheet, without the time appended — the picker row's title. */
    name?: string | null;
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
  const [activeSegment, setActiveSegment] = useState<CompareSegmentKey>("driver");
  const [pickerOpen, setPickerOpen] = useState(false);

  const { seriesList, metaById } = useMemo(() => {
    const metaById = new Map<string, SeriesMeta>();

    const primarySeries = buildComparisonSeries(
      "run:primary",
      primaryRunLabel,
      "run",
      primaryLaps
    );
    /*
     * The target is the run you opened, so it wears that run's clock — the same
     * instant the sheet's own header prints and the same one every other row in
     * the picker resolves. It used to read the primary IMPORT's time instead,
     * which with no `sessionCompletedAt` on the timing sheet degraded to the
     * import row's `createdAt`: the moment the laps were pasted in, not the
     * moment the car was on track. A run driven at 4:40 PM and imported after
     * midnight showed as the next day at 2:26 AM, against a list of siblings all
     * dated correctly — the one row you cannot untick looked like someone
     * else's session. Any real on-track wall time already lives on the Run
     * itself, which `resolveRunDisplayInstant` prefers.
     */
    const anchorSessionIso = resolveRunDisplayInstant(compareAnchorRun).toISOString();
    const primaryImport =
      run.importedLapSets?.find((x) => x.isPrimaryUser) ?? run.importedLapSets?.[0];
    const meSortIso = anchorSessionIso;

    const anchorTrack = lapCompareTrackKey(
      compareAnchorRun.track?.name ?? compareAnchorRun.trackNameSnapshot ?? null
    );

    metaById.set(primarySeries.id, {
      metaLine: formatCompareRunMetaLine(compareAnchorRun),
      setupRun: compareAnchorRun,
      selectLabel: formatDriverSessionLabel(primaryRunLabel, meSortIso, {
        timingSource: timingSourceFromSourceUrl(primaryImport?.sourceUrl),
        isWallClockTime: primaryImport?.sessionCompletedAt != null,
      }),
      sortIso: meSortIso,
      // Falls back to the car, not the driver — the same fallback the history
      // rows below it use. An unlabelled run put "Jordan Caruso" on the target
      // and "A800RR" on every row under it, so the pinned row read as a
      // different kind of thing from the sessions it is measured against.
      name: formatRunSessionDisplay(compareAnchorRun, {
        fallback:
          compareAnchorRun.car?.name?.trim() ||
          compareAnchorRun.carNameSnapshot?.trim() ||
          primaryRunLabel,
      }),
      segment: "driver",
      trackKey: anchorTrack,
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
        name: label,
        segment: "field",
        // The field came in on THIS run's timing sheet, so it was at this track
        // by construction — it has no track of its own to read.
        trackKey: anchorTrack,
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
        name: formatRunSessionDisplay(r, { fallback: carName }),
        // Team Sessions mixes every member's runs into this list; a run that
        // isn't the anchor driver's belongs under Teammates, not under their name.
        segment:
          compareAnchorRun.userId && r.userId && r.userId !== compareAnchorRun.userId
            ? "teammates"
            : "driver",
        trackKey: lapCompareTrackKey(trackCtx),
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
        name: lib.name?.trim() || lib.selectLabel,
        segment: "library",
        trackKey: lapCompareTrackKey(lib.trackName),
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

  /**
   * "How far to look", as one predicate. Both lists you can pick a session from
   * run through it: the tick-list below and the target dropdown above. The
   * dropdown used to read the unfiltered `seriesList`, so a sheet scoped to this
   * track still offered every session ever run, anywhere — the two controls
   * disagreed about what was comparable.
   */
  const seriesMatchesScope = useCallback(
    (seriesId: string, sortIso: string) =>
      lapSeriesMatchesCompareScope({
        seriesId,
        sortIso,
        scope: compareScope,
        anchorInstantIso,
        anchorEventId: compareAnchorRun.eventId,
        primaryRunEventId: run.eventId ?? null,
        eventIdForHistoryRun: (rid) => otherRuns.find((o) => o.id === rid)?.eventId,
        anchorTrackKey,
        trackKeyForSeries,
      }),
    [
      compareScope,
      anchorInstantIso,
      compareAnchorRun.eventId,
      run.eventId,
      otherRuns,
      anchorTrackKey,
      trackKeyForSeries,
    ]
  );

  const scopeFilteredRows = useMemo(() => {
    return seriesList
      .filter((s) => s.id !== targetId)
      .map((s) => {
        const m = metaById.get(s.id);
        const sortIso = m?.sortIso ?? "";
        return { series: s, sortIso, label: m?.selectLabel ?? s.label };
      })
      .filter(({ series, sortIso }) => seriesMatchesScope(series.id, sortIso));
  }, [seriesList, targetId, metaById, seriesMatchesScope]);

  const segmentFor = useCallback(
    (seriesId: string): CompareSegmentKey => metaById.get(seriesId)?.segment ?? "driver",
    [metaById]
  );

  /**
   * Only segments that actually hold something are offered. A solo testing run
   * has one (its driver); a club race with an imported timing sheet has two;
   * a team session can have all four. An empty tab is a dead end you can press.
   */
  const segments = useMemo(() => {
    const counts = new Map<CompareSegmentKey, number>();
    for (const r of scopeFilteredRows) {
      const k = segmentFor(r.series.id);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const labels: Record<CompareSegmentKey, string> = {
      driver: primaryIsViewer ? "My runs" : primaryRunLabel,
      teammates: "Teammates",
      field: "Field",
      library: "My imports",
    };
    const order: CompareSegmentKey[] = ["driver", "teammates", "field", "library"];
    return order
      .filter((k) => (counts.get(k) ?? 0) > 0)
      .map((k) => ({ key: k, label: labels[k], count: counts.get(k)! }));
  }, [scopeFilteredRows, segmentFor, primaryIsViewer, primaryRunLabel]);

  useEffect(() => {
    if (segments.length === 0) return;
    if (segments.some((s) => s.key === activeSegment)) return;
    setActiveSegment(segments[0]!.key);
  }, [segments, activeSegment]);

  const compareOptionRows = useMemo(() => {
    return (
      scopeFilteredRows
        .filter(({ series }) => segmentFor(series.id) === activeSegment)
        .map(({ series, sortIso, label }) => ({ id: series.id, sortIso, label }))
        // Newest first, like every other run list in the app — and like the Target
        // dropdown directly above it, which has always used this comparator. The
        // ascending sort here put your oldest session at the top of the one list you
        // pick from, which is the opposite of what you reach for after a run.
        .sort(compareOptionSort)
    );
  }, [scopeFilteredRows, activeSegment, segmentFor]);

  const seriesById = useMemo(() => {
    const m = new Map<string, ComparisonSeries>();
    for (const s of seriesList) m.set(s.id, s);
    return m;
  }, [seriesList]);

  const anchorTrackName =
    compareAnchorRun.track?.name?.trim() || compareAnchorRun.trackNameSnapshot?.trim() || null;

  /** The rows, cut into {@link dayTrackBucketFor}'s three groups. */
  const pickerGroups = useMemo((): LapPickerGroup[] => {
    const toRow = (r: { id: string; sortIso: string; label: string }): LapPickerRow => ({
      id: r.id,
      name: metaById.get(r.id)?.name ?? r.label,
      when: r.sortIso ? formatRunDateTime(r.sortIso) : "—",
      bestLap: seriesById.get(r.id)?.bestLap ?? null,
    });

    // The field came in on this run's own timing sheet — every entrant shares its
    // day and its track, so splitting them by either says nothing.
    if (activeSegment === "field") {
      if (compareOptionRows.length === 0) return [];
      return [
        { key: "field", label: "Rest of the race field", rows: compareOptionRows.map(toRow) },
      ];
    }

    const buckets: Record<DayTrackBucket, LapPickerRow[]> = {
      today: [],
      here: [],
      elsewhere: [],
    };
    for (const r of compareOptionRows) {
      const bucket = dayTrackBucketFor({
        sortIso: r.sortIso,
        trackKey: metaById.get(r.id)?.trackKey ?? null,
        anchorTrackKey,
        anchorInstantIso,
      });
      buckets[bucket].push(toRow(r));
    }

    const labels = dayTrackBucketLabels(anchorTrackName);
    return (["today", "here", "elsewhere"] as const)
      .map((key) => ({ key, label: labels[key], rows: buckets[key] }))
      .filter((g) => g.rows.length > 0);
  }, [
    compareOptionRows,
    metaById,
    seriesById,
    activeSegment,
    anchorInstantIso,
    anchorTrackKey,
    anchorTrackName,
  ]);

  useEffect(() => {
    setSelectedComparisonIds([]);
  }, [currentRunId]);

  useEffect(() => {
    const valid = new Set(compareOptionRows.map((r) => r.id));
    setSelectedComparisonIds((prev) => prev.filter((id) => valid.has(id) && id !== targetId));
  }, [compareOptionRows, targetId]);

  /**
   * What the target dropdown may offer: whatever "How far to look" allows, plus
   * the run you opened — which stays selectable under every scope, because a
   * sheet whose own laps have dropped out of its target list has nothing left to
   * measure against.
   */
  const targetOptionSeries = useMemo(
    () =>
      seriesList.filter(
        (s) => s.id === "run:primary" || seriesMatchesScope(s.id, metaById.get(s.id)?.sortIso ?? "")
      ),
    [seriesList, metaById, seriesMatchesScope]
  );

  /*
   * Narrowing the scope can pull the current target out from under the sheet —
   * pick a session at another track under "Everything", then switch to "This
   * track only". Fall back to the run you opened rather than leaving a `<select>`
   * whose value matches none of its options, which browsers draw as the first
   * option while the grid still measures against the vanished one.
   */
  useEffect(() => {
    if (targetOptionSeries.some((s) => s.id === targetId)) return;
    setTargetId(targetOptionSeries[0]?.id ?? "run:primary");
  }, [targetOptionSeries, targetId]);

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
   * The target list wears one label shape ("NAME · date, time") over sessions
   * from different days, different venues and different people, so flat it reads
   * as a pile of unexplained runs — the complaint that produced this grouping.
   *
   * Headings are the SAME ones the tick-list below uses, from
   * {@link dayTrackBucketLabels}, so one vocabulary covers both halves of the
   * picker. The race field keeps a group of its own rather than being filed by
   * day and track: it came in on this run's own timing sheet, so it shares both
   * by construction and splitting it says nothing — while "who these strangers
   * are" is exactly what needs saying. Native `<optgroup>`s cost nothing; they
   * are skipped when only one group survives, so a plain solo run keeps a plain
   * list.
   */
  const targetOptionGroups = useMemo(() => {
    const sortIsoOf = (s: ComparisonSeries) => metaById.get(s.id)?.sortIso ?? "";
    const bySortIso = (a: ComparisonSeries, b: ComparisonSeries) =>
      compareOptionSort({ sortIso: sortIsoOf(a) }, { sortIso: sortIsoOf(b) });

    const buckets: Record<DayTrackBucket, ComparisonSeries[]> = {
      today: [],
      here: [],
      elsewhere: [],
    };
    const field: ComparisonSeries[] = [];
    const thisRun: ComparisonSeries[] = [];
    for (const s of targetOptionSeries) {
      if (s.id === "run:primary") {
        thisRun.push(s);
      } else if (s.id.startsWith("imported:")) {
        field.push(s);
      } else {
        buckets[
          dayTrackBucketFor({
            sortIso: sortIsoOf(s),
            trackKey: metaById.get(s.id)?.trackKey ?? null,
            anchorTrackKey,
            anchorInstantIso,
          })
        ].push(s);
      }
    }

    const labels = dayTrackBucketLabels(anchorTrackName);
    const groups: { key: string; label: string; series: ComparisonSeries[] }[] = [
      { key: "this_run", label: "This run", series: thisRun },
      { key: "field", label: "Rest of the race field", series: field.sort(bySortIso) },
      { key: "today", label: labels.today, series: buckets.today.sort(bySortIso) },
      { key: "here", label: labels.here, series: buckets.here.sort(bySortIso) },
      { key: "elsewhere", label: labels.elsewhere, series: buckets.elsewhere.sort(bySortIso) },
    ];
    return groups.filter((g) => g.series.length > 0);
  }, [targetOptionSeries, metaById, anchorTrackKey, anchorTrackName, anchorInstantIso]);

  function metaFor(s: ComparisonSeries): SeriesMeta {
    const fallbackIso = resolveRunDisplayInstant(compareAnchorRun).toISOString();
    return (
      metaById.get(s.id) ?? {
        metaLine: null,
        setupRun: null,
        selectLabel: s.label,
        sortIso: fallbackIso,
        name: s.label,
        segment: "driver",
        trackKey: anchorTrackKey,
      }
    );
  }

  /** The pinned, untickable row at the top of the picker: what everything is measured against. */
  const targetPickerRow = useMemo((): LapPickerRow | null => {
    if (!targetSeries) return null;
    const m = metaById.get(targetSeries.id);
    return {
      id: targetSeries.id,
      name: m?.name ?? targetSeries.label,
      when: m?.sortIso ? formatRunDateTime(m.sortIso) : "—",
      bestLap: targetSeries.bestLap,
    };
  }, [targetSeries, metaById]);

  /** What the "Compared with" bar reads out, so the grid never has to be scrolled to find out. */
  const comparedWithLabel = useMemo(() => {
    if (comparisonSeries.length === 0) return "Nothing yet — pick a session";
    return comparisonSeries.map((s) => metaById.get(s.id)?.name ?? s.label).join(", ");
  }, [comparisonSeries, metaById]);

  /**
   * The desktop tile row. Comparisons are read against the FIRST ticked column —
   * the same one the lap trace draws — so the tiles, the trace and the grid are
   * all answering "versus what?" with the same session rather than three.
   */
  const statTiles = useMemo((): LapStatTile[] => {
    if (!targetSeries) return [];
    const vs = comparisonSeries[0] ?? null;
    const vsName = vs ? metaById.get(vs.id)?.name ?? vs.label : null;
    const d = vs ? computeSummaryDeltas(targetSeries, vs) : null;

    /** `comparison − target`, so negative means the target was quicker. */
    const noteFor = (delta: number | null | undefined) => {
      if (delta == null || !Number.isFinite(delta) || !vsName) return { note: null };
      return {
        // Flipped to read from the target's side: "−0.091 on Run 6" means this
        // session was 0.091 quicker than that one.
        note: `${formatLapDelta(-delta)} on ${vsName}`,
        noteTone: (-delta < 0 ? "good" : "bad") as "good" | "bad",
      };
    };

    const targetAnalysis = analyzeLapRows(targetSeries.laps);
    const vsAnalysis = vs ? analyzeLapRows(vs.laps) : null;
    const included = getIncludedLaps(targetSeries.laps).length;
    const total = targetSeries.laps.filter((l) => l.lapNumber !== 0).length;

    const consistencyDelta =
      targetAnalysis.consistencyStdDev != null && vsAnalysis?.consistencyStdDev != null
        ? vsAnalysis.consistencyStdDev - targetAnalysis.consistencyStdDev
        : null;

    /*
     * Where this session's best lap sat among the field that came in on the same
     * timing sheet. Only the `imported:` series are the field — another of the
     * driver's own runs is not someone they finished ahead of — so the tile is
     * omitted entirely on a session with no timing import rather than reporting
     * "P1 of 1", which is not information.
     */
    const fieldBests = seriesList
      .filter((s) => s.id.startsWith("imported:"))
      .map((s) => s.bestLap)
      .filter((b): b is number => b != null);
    let fieldTile: LapStatTile | null = null;
    if (fieldBests.length > 0 && targetSeries.bestLap != null) {
      const all = [targetSeries.bestLap, ...fieldBests].sort((a, b) => a - b);
      const rank = all.filter((b) => b < targetSeries.bestLap! - 1e-9).length + 1;
      const mid = all.length / 2;
      const median =
        all.length % 2 === 1 ? all[Math.floor(mid)]! : (all[mid - 1]! + all[mid]!) / 2;
      fieldTile = {
        label: "Vs field",
        value: `P${rank}`,
        valueSuffix: `/${all.length}`,
        note: `median ${median.toFixed(3)}`,
        noteTone: "muted",
      };
    }

    const tiles: LapStatTile[] = [
      {
        label: "Best lap",
        value: formatLap(targetSeries.bestLap),
        accent: true,
        ...noteFor(d?.bestDelta),
      },
      { label: "Avg top 5", value: formatLap(targetSeries.avgTop5), ...noteFor(d?.avgTop5Delta) },
      {
        label: "Consistency",
        value:
          targetAnalysis.consistencyStdDev != null
            ? `±${targetAnalysis.consistencyStdDev.toFixed(2)}`
            : "—",
        ...(consistencyDelta != null && vsName
          ? {
              note: `${formatLapDelta(-consistencyDelta)} on ${vsName}`,
              noteTone: (-consistencyDelta < 0 ? "good" : "bad") as "good" | "bad",
            }
          : { note: null }),
      },
      {
        label: "Laps counted",
        value: String(included),
        valueSuffix: `/${total}`,
        note: total > included ? `${total - included} excluded` : null,
        noteTone: "muted",
      },
    ];
    if (fieldTile) tiles.push(fieldTile);
    return tiles;
  }, [targetSeries, comparisonSeries, metaById, seriesList]);

  /**
   * Trace rows for the target and, when one is ticked, the first comparison as a
   * baseline. `LapTimeGraph` carries the app's established trace conventions
   * (clean-pace clamp, excluded laps bridged, mono ticks) and takes exactly one
   * baseline — so this shows two sessions, not the artifact's three. A true
   * N-series trace needs a categorical chart palette, which the app does not yet
   * have and which is a design-system call rather than one to make here.
   */
  const traceBaseline = comparisonSeries[0] ?? null;
  const traceBaselineName = traceBaseline
    ? metaById.get(traceBaseline.id)?.name ?? traceBaseline.label
    : null;

  const toggleComparison = useCallback((id: string) => {
    setSelectedComparisonIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const modalRuns = useMemo(
    () => (pickerRunsForModal.length > 0 ? pickerRunsForModal : [compareAnchorRun]) as SetupSheetModalRun[],
    [pickerRunsForModal, compareAnchorRun]
  );

  if (seriesList.length < 1) {
    return <p className="text-xs text-muted-foreground">No lap data for comparison.</p>;
  }

  /**
   * One picker, two homes: the phone opens it in a sheet, the desktop leaves it
   * standing in the rail. Rendered from a function rather than a shared variable
   * because both are mounted at once (hidden by breakpoint, not unmounted), and
   * two live copies of the same `id` would break every label's `htmlFor`.
   */
  /**
   * One clock across the whole sheet. `selectLabel` formats its time through
   * `formatImportedSessionTime` ("09/08/2026, 01:20 pm") while every row, column
   * header and tile below it reads `formatRunDateTime` ("9 Aug, 1:20 PM") — two
   * notations for the same instant, on one screen, and the long one overflowed
   * the rail's select anyway.
   */
  function targetOptionLabel(s: ComparisonSeries): string {
    const m = metaFor(s);
    return m.sortIso ? `${m.name} · ${formatRunDateTime(m.sortIso)}` : m.name;
  }

  function renderPicker(idPrefix: string) {
    const targetId_ = `${idPrefix}-lap-compare-target`;
    const scopeId = `${idPrefix}-lap-compare-scope`;
    return (
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="ui-label-caps text-[9px] uppercase tracking-wider" htmlFor={targetId_}>
            Measure everything against
          </label>
          <select
            id={targetId_}
            className="w-full rounded-md border border-border bg-card px-2 py-2 text-xs outline-none"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            aria-label="Target series"
          >
            {targetOptionGroups.length === 1
              ? targetOptionGroups[0].series.map((s) => (
                  <option key={s.id} value={s.id}>
                    {targetOptionLabel(s)}
                  </option>
                ))
              : targetOptionGroups.map((g) => (
                  <optgroup key={g.key} label={g.label}>
                    {g.series.map((s) => (
                      <option key={s.id} value={s.id}>
                        {targetOptionLabel(s)}
                      </option>
                    ))}
                  </optgroup>
                ))}
          </select>
        </div>

        <LapCompareSegmentBar
          segments={segments}
          active={activeSegment}
          onSelect={(k) => setActiveSegment(k as CompareSegmentKey)}
        />

        <LapCompareSessionList
          groups={pickerGroups}
          selectedIds={selectedComparisonIds}
          onToggle={toggleComparison}
          target={targetPickerRow}
        />

        {/*
         * Scope sits at the bottom on purpose. The grouping above already says
         * "this test day" and "earlier at MR33 Arena", so widening the net is a
         * thing you reach for when the list ran out — not a decision to make
         * before you have seen it.
         */}
        <div className="space-y-1 border-t border-border pt-3">
          <label className="ui-label-caps text-[9px] uppercase tracking-wider" htmlFor={scopeId}>
            How far to look
          </label>
          <select
            id={scopeId}
            className="w-full rounded-md border border-border bg-card px-2 py-2 text-xs outline-none"
            value={compareScope}
            onChange={(e) => setCompareScope(e.target.value as typeof compareScope)}
          >
            <option value="same_track">This track only</option>
            {compareAnchorRun.eventId ? <option value="same_event">This event only</option> : null}
            <option value="same_day">This calendar day only</option>
            <option value="all">Everything</option>
          </select>
        </div>
      </div>
    );
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

      {/*
       * The "Compared with" bar: one line that answers what the grid is showing,
       * and one button that changes it. It replaces three stacked dropdowns
       * (Target / Scope / Driver) plus a checkbox list — four controls the reader
       * had to work through before the first lap time was on screen, on a sheet
       * opened to look at lap times.
       */}
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-runna px-3 py-2 lg:hidden">
        <div className="min-w-0">
          <p className="ui-label-caps text-[9px] uppercase tracking-wider">Compared with</p>
          <p
            className={cn(
              "truncate text-[12px]",
              comparisonSeries.length === 0 ? "text-muted-foreground" : "text-foreground"
            )}
          >
            {comparedWithLabel}
          </p>
        </div>
        <button
          type="button"
          className="tap-active shrink-0 rounded-full border border-primary-ink/50 bg-primary/10 px-3 py-1.5 text-[11px] font-medium text-primary-ink transition hover:bg-primary/20"
          onClick={() => setPickerOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
        >
          Change
        </button>
      </div>

      <LapCompareSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        selectedCount={selectedComparisonIds.length}
      >
        {renderPicker("sheet")}
      </LapCompareSheet>

      {/* Desktop: the tiles, then the rail beside the grid. The rail renders the
          same picker the phone opens in a sheet — at this width there is room to
          leave it standing, so choosing what to compare stops being a mode. */}
      <LapCompareStatTiles tiles={statTiles} className="hidden lg:grid" />

      <div className="lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-4">
        <aside className="hidden lg:block">
          <div className="max-h-[52vh] overflow-y-auto overscroll-contain rounded-md border border-border bg-surface-runna p-2.5">
            {renderPicker("rail")}
          </div>
        </aside>

        <div className="min-w-0 space-y-3">
          {/* The trace answers "what shape was the run?" before the grid answers
              "by how much, lap by lap?". Hidden until a comparison is ticked —
              on its own it repeats what the single-run views already show. */}
          {targetSeries && traceBaseline ? (
            <div className="hidden rounded-md border border-border bg-surface-runna p-2.5 lg:block">
              <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="ui-label-caps text-[9px] uppercase tracking-wider">Lap trace</p>
                {/* Two series means a legend, always: the trace separates them by
                    line style alone, and a <title> tooltip is not an answer for
                    anyone reading rather than hovering. */}
                <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <svg width="16" height="6" aria-hidden className="shrink-0">
                    <line x1="0" y1="3" x2="16" y2="3" stroke="rgb(var(--color-muted-foreground))" strokeWidth="2" />
                  </svg>
                  {metaById.get(targetSeries.id)?.name ?? targetSeries.label}
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <svg width="16" height="6" aria-hidden className="shrink-0">
                    <line
                      x1="0"
                      y1="3"
                      x2="16"
                      y2="3"
                      stroke="rgb(var(--color-muted-foreground))"
                      strokeWidth="1.5"
                      strokeOpacity="0.35"
                      strokeDasharray="4 3"
                    />
                  </svg>
                  {traceBaselineName}
                </span>
              </div>
              <LapTimeGraph
                rows={targetSeries.laps}
                bestLapNumbers={
                  new Set(
                    targetSeries.bestLap != null
                      ? targetSeries.laps
                          .filter((l) => isBestLapOf(targetSeries, l) && l.isIncluded)
                          .map((l) => l.lapNumber)
                      : []
                  )
                }
                mistakeLapNumbers={new Set()}
                mistakeDetailByLapNumber={new Map()}
                medianSeconds={null}
                baseline={traceBaseline.laps}
                baselineLabel={traceBaselineName}
              />
            </div>
          ) : null}

      <div className="overflow-x-auto rounded-md border border-border">
        {/* No forced min-width: Lap + target + one comparison fit a 390px phone;
            additional comparison columns overflow into sideways scroll. */}
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/80">
              {/* w-12, not w-9: the footer's "Avg 10" label lives in this column and
                  wrapped to two lines at the old width. */}
              <th className="w-12 text-left text-xs sm:text-sm font-medium text-muted-foreground px-1.5 sm:px-2 py-2 align-bottom sticky left-0 bg-muted/80 z-10">
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
                        "px-1.5 sm:px-2 py-1 tabular-nums border-l border-border",
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
                          <span className="text-[10px] text-foreground/80 tabular-nums">
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
                          "px-1.5 sm:px-2 py-1 tabular-nums border-l border-border align-top",
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
                          <span className="text-[10px] text-foreground/80 tabular-nums">
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
          {/*
           * Where Avg top 5 / Avg top 10 went when the column headers were cut down.
           * A footer is the right home for a whole-session summary anyway: it reads
           * after the laps it summarises, and it stays out of the way of the first
           * screen. Same comparison, same deltas, none of the opening cost.
           */}
          <tfoot>
            {SUMMARY_FOOTER_ROWS.map((row) => (
              <tr key={row.label} className="border-t border-border bg-muted/70">
                <td className="sticky left-0 z-10 whitespace-nowrap bg-muted/70 px-1.5 py-1 text-[10px] font-medium text-muted-foreground sm:px-2">
                  {row.label}
                </td>
                {targetSeries ? (
                  <td className="border-l border-border px-1.5 py-1 text-[11px] tabular-nums text-foreground sm:px-2">
                    {formatLap(row.pick(targetSeries))}
                  </td>
                ) : null}
                {comparisonSeries.map((s) => {
                  const d = targetSeries ? computeSummaryDeltas(targetSeries, s) : null;
                  const dv = d ? row.delta(d) : null;
                  return (
                    <td
                      key={s.id}
                      className="border-l border-border px-1.5 py-1 text-[11px] tabular-nums text-foreground sm:px-2"
                    >
                      <div className="flex flex-col leading-tight">
                        <span>{formatLap(row.pick(s))}</span>
                        {dv != null && Number.isFinite(dv) ? (
                          <span className={cn("text-[9px]", deltaTextClass(dv))}>
                            {formatLapDelta(dv)}
                          </span>
                        ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tfoot>
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
      </div>
    </div>
  );
}
