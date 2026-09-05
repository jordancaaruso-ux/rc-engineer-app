"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Wrench } from "lucide-react";
import type { ComparisonSeries, LapRow, SummaryMetricDeltas } from "@/lib/lapAnalysis";
import { mergeImportedLapSetsByDriver } from "@/lib/lapImport/mergeImportedLapSets";
import {
  alignLapsByNumber,
  analyzeLapRows,
  areLapSeriesEquivalent,
  buildComparisonSeries,
  computeSummaryDeltas,
  filterDuplicateImportedSeries,
  formatFadePerLap,
  formatLapDelta,
  getDeltaStyle,
  getDisplayFiveMinuteStint,
  importedSetToLapRows,
  primaryLapRowsFromRun,
  readFiveMinStartLap,
  resolveDeltaTintRange,
} from "@/lib/lapAnalysis";
import {
  LapCompareCharts,
  type LapChartSeries,
  type LapChartTab,
} from "@/components/runs/LapCompareCharts";
import { LapCompareDriverChips, type LapDriverChip } from "@/components/runs/LapCompareDriverChips";
import {
  LapCompareStatTiles,
  type LapStatTile,
} from "@/components/runs/LapCompareStatTiles";
import {
  lapCompareFieldSeriesId,
  lapCompareFieldSeriesRunId,
  lapCompareTrackKey,
  lapSeriesMatchesCompareScope,
  sameLocalCalendarDay,
} from "@/lib/lapCompareScope";
import { formatFiveMinuteStint, formatLap, normalizeLapTimes } from "@/lib/runLaps";
import { formatRunDateTime } from "@/lib/formatDate";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { buildDayRunNameMap } from "@/lib/runs/buildRunHistoryGroups";
import { cn } from "@/lib/utils";
import {
  LapCompareSegmentBar,
  LapCompareSessionList,
  LapCompareTargetRow,
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
  /** Nullable to match `CompareRunImportedLapSet`, which a run loaded for the full-page sheet arrives as. */
  createdAt?: Date | string | null;
  sessionCompletedAt?: Date | string | null;
  /** Timing-source URL; when present, LiveRC/MyRCM session times render frozen (wall clock). */
  sourceUrl?: string | null;
  isPrimaryUser?: boolean | null;
  driverName: string;
  displayName?: string | null;
  /** Cross-import identity for the driver merge; the name is the fallback key. */
  normalizedName?: string | null;
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
  /**
   * For a `field:` series, the run whose timing sheet the rival came off; null
   * for everything else, including the anchor run's own `imported:` field.
   */
  fieldRunId: string | null;
  /**
   * The race a rival's column came from — "Round 1 · A-main" — printed after
   * the date, so two "T. Volk" columns from different heats can be told apart.
   */
  context: string | null;
  /** False while that race's laps are still on their way from the server. */
  loaded: boolean;
};

/**
 * Who the comparison belongs to. Replaces the old Driver dropdown, whose
 * per-driver keys ("compare against Dayne") were a filter over a list you then
 * had to tick anyway — two steps to say one thing. Segments carve the same set
 * by *whose* sessions they are, and every row inside stays individually tickable.
 */
type CompareSegmentKey = "driver" | "teammates" | "field" | "library";

/**
 * The default for the run-list props. One shared instance, NOT `= []` in the signature: a
 * fresh array per render is a new dependency per render, and the memos hanging off it
 * (`dayRunNames` → the series list → the scope rows → the tick-pruning effect's setState)
 * re-ran until React threw "Maximum update depth exceeded" (found driving the preview,
 * 2026-09-05).
 */
const NO_RUNS: readonly CompareRunShape[] = [];

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
type DayTrackBucket = "today" | "later" | "here" | "elsewhere";

/** Every bucket, in the order the picker lists them: newest first, like the rows inside. */
const DAY_TRACK_BUCKETS: readonly DayTrackBucket[] = ["today", "later", "here", "elsewhere"];

function emptyDayTrackBuckets<T>(): Record<DayTrackBucket, T[]> {
  return { today: [], later: [], here: [], elsewhere: [] };
}

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
  // Another day at this track — before or after. "Earlier at …" used to take both, so a
  // 22 Aug sheet filed its 23 Aug runs under "Earlier" (reported 2026-09-05).
  const t = new Date(input.sortIso).getTime();
  const anchorT = new Date(input.anchorInstantIso).getTime();
  if (Number.isFinite(t) && Number.isFinite(anchorT) && t > anchorT) return "later";
  return "here";
}

function dayTrackBucketLabels(anchorTrackName: string | null): Record<DayTrackBucket, string> {
  return {
    today: anchorTrackName ? `This test day · ${anchorTrackName}` : "This test day",
    later: anchorTrackName ? `Later at ${anchorTrackName}` : "Later sessions",
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

/**
 * The whole-session numbers every column carries, in the order the header stacks them.
 *
 * Best lap says what the car had in it; the two averages say what it did with that for
 * a run — and a column can win one and lose the other, which is the comparison you
 * opened the sheet to make. Consistency and fade answer the next question down: not how
 * fast, but whether they kept it there. A rival half a tenth up on avg10 who fades three
 * tenths over the run is a rival you beat on lap 20, and none of the first three rows
 * can tell you that.
 *
 * Five rows cost ~18px more than three, once, however many columns are ticked — headers
 * sit side by side, so this is the cheapest real estate on the sheet.
 */
const HEADER_METRIC_ROWS: Array<{
  label: string;
  pick: (s: ComparisonSeries) => number | null;
  delta: (d: SummaryMetricDeltas) => number | null;
  /** Best lap is the headline: it wears the target's accent, the averages don't. */
  accent?: boolean;
  /** Defaults to `formatLap` — seconds. */
  format?: (v: number | null) => string;
  /** Defaults to `formatLapDelta` — signed seconds. */
  formatDelta?: (d: number) => string;
}> = [
  { label: "best", pick: (s) => s.bestLap, delta: (d) => d.bestDelta, accent: true },
  { label: "avg5", pick: (s) => s.avgTop5, delta: (d) => d.avgTop5Delta },
  { label: "avg10", pick: (s) => s.avgTop10, delta: (d) => d.avgTop10Delta },
  {
    /*
     * "±0.23", the same spread in the same words as the Consistency stat tile that sits
     * directly above this grid on desktop. It was briefly the app's OTHER consistency
     * figure — the 100−CV score the FIELD tab uses — which put "98.44%" and "±0.23" on
     * screen together, describing one run, agreeing about nothing a reader could see.
     */
    label: "cons",
    pick: (s) => s.consistencyStdDev,
    delta: (d) => d.consistencyDelta,
    format: (v) => (v == null ? "—" : `±${v.toFixed(2)}`),
  },
  {
    /*
     * Signed in its own cell, not just in the delta: "fade 0.04" reads as a quantity of
     * fade, when the sign is the entire finding. A run that came to the driver has to say
     * −0.04 in the column itself. A rate (s/lap, 2026-08-27), so a rival's 30-lap main and
     * your 12-lap heat sit on one scale; the delta wears the same unit for the same reason.
     */
    label: "fade",
    pick: (s) => s.fadePerLap,
    delta: (d) => d.fadePerLapDelta,
    format: formatFadePerLap,
    formatDelta: (d) => `${formatLapDelta(d).slice(0, -1)}/lap`,
  },
];

/**
 * Column sizing on the sheet: equal widths, shared out of the room the grid actually has.
 *
 * Auto layout made every column as wide as its widest cell, so the target — whose subline
 * names the race — came out half again wider than its neighbours, and ten drivers never fit
 * a monitor without a sideways scroll (founder, 2026-08-27: "all ten should fit"). The grid
 * measures its own width, gives the lap-number gutter its fixed slice and splits the rest
 * evenly. The floor is what a `16.825` and its delta need; the cap is what stops a sheet with
 * one column drawing a lane a thousand pixels wide, which is the complaint that came before.
 */
const LAP_COL_PX = 36;
const MIN_COL_PX = 76;
const MAX_COL_PX = 160;

/**
 * A driver's name in two lines — first name light, SURNAME bold — so an 80px column can still
 * be told from its neighbour at a glance. Timing sites disagree about case ("SANDY IAVAZZO",
 * "Bruno Coelho", "Frank FUCHS"); the split is at the first space and the case is ours, so a
 * field from two sources reads as one. A single-word name gets the bold line alone.
 */
function DriverNameStack({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) {
    return <div className="truncate text-[11px] font-bold uppercase text-foreground">{name}</div>;
  }
  const first = parts[0]!.toLowerCase();
  const rest = parts.slice(1).join(" ");
  return (
    <div className="leading-tight">
      <div className="truncate text-[10px] font-normal capitalize text-foreground/80">{first}</div>
      <div className="truncate text-[11px] font-bold uppercase text-foreground">{rest}</div>
    </div>
  );
}

/** Gain green / loss red for delta text where there is no background tint (header metrics). */
function deltaTextClass(delta: number): string {
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-9) return "text-foreground/80";
  return delta > 0 ? "text-destructive" : "text-gain";
}

/**
 * A column's identity and the three numbers that decide whether it is worth
 * reading: best, avg5, avg10, each against the target.
 *
 * They lived in the table footer for a while, after a header that also carried a
 * meta line and a setup note ran to about 400px on a 390px phone and opened the
 * sheet on nothing but column headings. Those two lines are gone for good, so the
 * three metrics cost ~26px here — and they cost it ONCE, however many columns are
 * ticked, because headers sit side by side. A number you have to scroll past the
 * laps to reach is not one you compare with.
 */
function ColumnHeaderBlock({
  series,
  meta,
  isTarget,
  isPerson = false,
  compact = false,
  summaryDelta,
  onViewSetup,
}: {
  series: ComparisonSeries;
  meta: SeriesMeta;
  isTarget: boolean;
  /** The column is a driver off a timing sheet, so its name splits into first / SURNAME. */
  isPerson?: boolean;
  /** Under ~100px of column: one type size down on the metric rows so label + value fit a line. */
  compact?: boolean;
  summaryDelta: ReturnType<typeof computeSummaryDeltas> | null;
  onViewSetup?: (r: CompareRunShape) => void;
}) {
  return (
    <>
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          {/* The session, not the driver. Three of the driver's own runs side by
              side all read "Dayne Warren" — a heading that cannot tell you which
              column you are looking at. */}
          {isPerson ? (
            <DriverNameStack name={meta.name} />
          ) : (
            <div className="truncate font-medium text-foreground">{meta.name}</div>
          )}
          <div className="truncate text-[9px] leading-tight text-muted-foreground">
            {/*
             * It led with the date and ended " · target", which truncates away first on a
             * narrow column. "target" is the picker's own word for this column (founder,
             * 2026-08-27), and it leads the line so it can never truncate away.
             */}
            {isTarget ? "target · " : ""}
            {meta.sortIso ? formatRunDateTime(meta.sortIso) : ""}
            {meta.context ? ` · ${meta.context}` : ""}
          </div>
        </div>
        <SetupHint series={series} run={meta.setupRun} onView={onViewSetup} />
      </div>
      {/* Label, value and delta share a line and wrap together — at the 108px
          column floor "avg10 15.240 +0.012" has almost nothing spare, so a long
          one drops its delta to a second line rather than overflowing. */}
      <div className={cn("mt-1 space-y-0.5 tabular-nums", compact ? "text-[9px]" : "text-[10px]")}>
        {HEADER_METRIC_ROWS.map((row) => {
          // The target is what everything else is measured against, so it has
          // nothing of its own to show a delta for.
          const delta = isTarget || !summaryDelta ? null : row.delta(summaryDelta);
          return (
            <div key={row.label} className="flex flex-wrap items-baseline gap-x-1">
              {/*
               * Label and value are one unbreakable unit; only the delta may drop to a second
               * line. Left to wrap freely, an 87px column put "avg10" alone on a line and the
               * next row kept its label — five rows of different heights in every header.
               */}
              <span className="whitespace-nowrap">
                <span className="text-muted-foreground">{row.label}</span>{" "}
                <span
                  className={cn(
                    "font-medium",
                    isTarget && row.accent ? "text-primary-ink" : "text-foreground"
                  )}
                >
                  {(row.format ?? formatLap)(row.pick(series))}
                </span>
              </span>
              {delta != null && Number.isFinite(delta) ? (
                <span className={cn("text-[9px]", deltaTextClass(delta))}>
                  {(row.formatDelta ?? formatLapDelta)(delta)}
                </span>
              ) : null}
            </div>
          );
        })}
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
  otherRuns = NO_RUNS as CompareRunShape[],
  dayRuns = NO_RUNS as CompareRunShape[],
  compareAnchorRun,
  pickerRunsForModal = NO_RUNS as CompareRunShape[],
  runListSource = "my_runs",
  librarySessions = [],
  viewerUserId = null,
  memberDisplayByUserId,
  initialTargetId,
  initialComparisonIds,
  onOpenFullAnalysis,
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
  /**
   * Every run the driver logged on the days in play — all cars, laps or not. Only NAMES are
   * read off it: "Run 3" is a position in the whole day, and a host that hands `otherRuns`
   * a one-car slice would otherwise number the day short. Optional; hosts whose `otherRuns`
   * is already the whole list need not pass it.
   */
  dayRuns?: CompareRunShape[];
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
  /**
   * Where the sheet opens, when the caller was handed a state to restore. Both are
   * initial values only — once the reader touches the picker the sheet owns its own
   * selection, and a prop change must not yank the columns back out from under them.
   */
  initialTargetId?: string;
  initialComparisonIds?: string[];
  /**
   * Shown as "Detailed analysis" when provided, handed the columns currently on
   * screen. The door out of the pop-up and into the full-page sheet, which is the
   * same grid with room to breathe — so what you carry across is what you were
   * already looking at, not a fresh empty sheet you have to rebuild.
   */
  onOpenFullAnalysis?: (state: { targetId: string; comparisonIds: string[] }) => void;
}) {
  const primaryRunLabel =
    primaryDriverName?.trim() || (primaryIsViewer ? "Me" : "Driver");

  /** `loadImportedSessionAnchor` mints `import:<id>`; a real run's id never looks like that. */
  const anchorIsImportedSheet = compareAnchorRun.id.startsWith("import:");

  /**
   * The words the WHOLE picker uses — the tabs, and the headings in the target dropdown above
   * them. One list, because the two halves offering the same sessions under different names is
   * what made the panel unreadable (founder, 2026-08-27).
   *
   * An imported sheet is nobody here's run, so the sessions filed beside it are the viewer's
   * own — that tab held 132 of his A800RR runs under the heading "SANDY IAVAZZO", the leading
   * driver of a race he only read. A driver's name belongs there only when the anchor is that
   * driver's run, which is the shared-teammate case.
   */
  const segmentLabels: Record<CompareSegmentKey, string> = useMemo(
    () => ({
      driver: primaryIsViewer || anchorIsImportedSheet ? "My runs" : primaryRunLabel,
      teammates: "Teammates",
      field: "Field",
      library: "My imports",
    }),
    [primaryIsViewer, anchorIsImportedSheet, primaryRunLabel]
  );

  const primaryLaps = useMemo(() => primaryLapRowsFromRun(run), [run]);

  /**
   * Runs the sheet cannot put in a column, and the words for why: nothing to plot, or laps
   * that are a copy of the run you opened. They stay in the picker greyed with the reason
   * (`pickerGroups`) instead of vanishing — a run that duplicates another row is decided
   * later, once the rows exist (`heldBackDuplicates`).
   */
  const heldBackByAnchor = useMemo(() => {
    const out = new Map<string, string>();
    for (const r of otherRuns) {
      if (r.id === currentRunId) continue;
      if (normalizeLapTimes(r.lapTimes).length === 0) {
        out.set(r.id, "No lap times");
        continue;
      }
      const rows = primaryLapRowsFromRun({ lapTimes: r.lapTimes, lapSession: r.lapSession });
      if (areLapSeriesEquivalent(primaryLaps, rows)) out.set(r.id, "Same laps as this run");
    }
    return out;
  }, [otherRuns, currentRunId, primaryLaps]);

  const historyPickOptions = useMemo(
    () => otherRuns.filter((r) => r.id !== currentRunId && !heldBackByAnchor.has(r.id)),
    [otherRuns, currentRunId, heldBackByAnchor]
  );

  /**
   * What each of those runs is CALLED — "Run 3", "Qualifying Q2", "A Main".
   *
   * The rows were headed with the car ("A800RR", seven times over) because the label they
   * used leads with it, and an unlabelled test run has no session name of its own to fall
   * back to. The number is the run's position in its day, by the same function Run History
   * uses, and the car moves to the line underneath (founder, 2026-08-27: "the heading should
   * be the name of the run and the time").
   *
   * Counted over the WHOLE day — every run handed in, laps or not, plus `dayRuns` for the
   * cars a host filtered out. It used to count only the runs the picker offers, so a day
   * with one lapless run early on had "Run 4" on the Sessions list open as "Run 3" here
   * (reported 2026-09-05). A name is only a name if every screen agrees on it.
   */
  const dayRunNames = useMemo(() => {
    const seen = new Set<string>();
    const wholeDay = [compareAnchorRun, ...otherRuns, ...dayRuns].filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
    return buildDayRunNameMap(
      wholeDay.map((r) => ({
        id: r.id,
        createdAt: new Date(r.createdAt),
        sortAt: r.sortAt ? new Date(r.sortAt) : null,
        userId: r.userId ?? null,
        sessionType: r.sessionType,
        meetingSessionType: r.meetingSessionType ?? null,
        meetingSessionCode: r.meetingSessionCode ?? null,
        sessionLabel: r.sessionLabel ?? null,
      }))
    );
  }, [compareAnchorRun, otherRuns, dayRuns]);

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
  /*
   * Which segment the TARGET dropdown lists. A race you only read opens on its field — the
   * other drivers on that sheet are the whole reason it was opened; your own run opens on
   * your runs. Falls back to whatever is non-empty (effect below).
   */
  const [targetSegment, setTargetSegment] = useState<CompareSegmentKey>(() =>
    anchorIsImportedSheet ? "field" : "driver"
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  /*
   * Which chart is up. A race sheet opens on the gap to the leader — the picture of the
   * race; your own run opens on its trace. `LapCompareCharts` falls back to the trace
   * itself when the ticked columns cannot draw a race.
   */
  const [chartTab, setChartTab] = useState<LapChartTab>(anchorIsImportedSheet ? "gap" : "trace");
  /** The driver being pointed at — on a chip, a chart line or a pace row; all three light up together. */
  const [focusedSeriesId, setFocusedSeriesId] = useState<string | null>(null);

  /** Width of the area the grid sits in — see `LAP_COL_PX`. Zero until measured. */
  const gridAreaRef = useRef<HTMLDivElement | null>(null);
  const [gridAreaWidth, setGridAreaWidth] = useState(0);
  useEffect(() => {
    const el = gridAreaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setGridAreaWidth(Math.floor(el.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /*
   * Other races' fields. The picker's runs arrive knowing WHO was on each timing
   * sheet but not their laps — the list queries leave laps out to keep the page
   * light — so a race's laps are fetched the moment you open its group in the
   * Field tab, and cached here for the life of the sheet.
   */
  const [targetId, setTargetId] = useState(initialTargetId ?? "run:primary");
  /** Columns to show vs target: imports, library, and previous runs (ids from seriesList). */
  const [selectedComparisonIds, setSelectedComparisonIds] = useState<string[]>(
    initialComparisonIds ?? []
  );
  const [fieldSetsByRunId, setFieldSetsByRunId] = useState<Record<string, ImportedSet[]>>({});
  const [fieldFetchState, setFieldFetchState] = useState<Record<string, "loading" | "error">>({});
  const [expandedFieldRunIds, setExpandedFieldRunIds] = useState<string[]>([]);

  /**
   * Every other run in the picker with rivals on its timing sheet. Read off
   * `otherRuns`, not `historyPickOptions`: a run's own laps and its field are
   * different things, and a heat you were in but never logged laps for still
   * has a field worth measuring against. The driver's own row is skipped — it
   * is the same laps as that run's "My runs" entry.
   */
  const otherFieldRuns = useMemo(
    () =>
      otherRuns.filter(
        (r) => r.id !== currentRunId && (r.importedLapSets ?? []).some((s) => !s.isPrimaryUser)
      ),
    [otherRuns, currentRunId]
  );

  const toggleFieldRun = useCallback((runId: string) => {
    setExpandedFieldRunIds((prev) =>
      prev.includes(runId) ? prev.filter((x) => x !== runId) : [...prev, runId]
    );
  }, []);

  useEffect(() => {
    const wanted = new Set<string>(expandedFieldRunIds);
    // A ticked rival whose race was folded again still needs its laps — and so does a
    // rival chosen as the TARGET from a race that has never been unfolded.
    const targetRunId = lapCompareFieldSeriesRunId(targetId);
    if (targetRunId) wanted.add(targetRunId);
    for (const id of selectedComparisonIds) {
      const rid = lapCompareFieldSeriesRunId(id);
      if (rid) wanted.add(rid);
    }
    const toFetch = [...wanted].filter((rid) => {
      if (fieldSetsByRunId[rid] || fieldFetchState[rid]) return false;
      const r = otherFieldRuns.find((o) => o.id === rid);
      if (!r) return false;
      // Some lists (previews, or a run loaded in full) already carry the laps.
      return (r.importedLapSets ?? []).some((s) => !Array.isArray(s.laps));
    });
    if (toFetch.length === 0) return;
    setFieldFetchState((prev) => {
      const next = { ...prev };
      for (const rid of toFetch) next[rid] = "loading";
      return next;
    });
    for (const rid of toFetch) {
      fetch(`/api/runs/${encodeURIComponent(rid)}/imported-lap-sets`)
        .then(async (res) => {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            sets?: ImportedSet[];
          };
          if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
          return data.sets ?? [];
        })
        .then((sets) => {
          setFieldSetsByRunId((prev) => ({ ...prev, [rid]: sets }));
          setFieldFetchState((prev) => {
            const next = { ...prev };
            delete next[rid];
            return next;
          });
        })
        .catch(() => {
          setFieldFetchState((prev) => ({ ...prev, [rid]: "error" }));
        });
    }
    // No cancel token on purpose: marking a run "loading" re-runs this effect,
    // and a cleanup that dropped the in-flight response would lose every fetch.
  }, [expandedFieldRunIds, selectedComparisonIds, targetId, fieldSetsByRunId, fieldFetchState, otherFieldRuns]);

  const { seriesList, metaById, heldBackDuplicates } = useMemo(() => {
    const metaById = new Map<string, SeriesMeta>();

    const primarySeries = buildComparisonSeries(
      "run:primary",
      primaryRunLabel,
      "run",
      primaryLaps,
      // The driver's own 5-minute window choice rides along, so this sheet and
      // the run card can never quote two different stints for one run.
      { fiveMinStartLap: readFiveMinStartLap(run.lapSession) }
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
    const anchorSessionName = formatRunSessionDisplay(compareAnchorRun, {
      fallback:
        compareAnchorRun.car?.name?.trim() ||
        compareAnchorRun.carNameSnapshot?.trim() ||
        primaryRunLabel,
    });
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
      /*
       * On your own run the column is named after the SESSION ("Run 5", "Qualifying") and the
       * car rides the subline — three of your runs side by side all read "Jordan Caruso"
       * otherwise. On an imported race it is the other way round: every rival column is
       * already named after its driver, and the target was the one column wearing the
       * race's name — "measure everything against ISTC 13.5", as if a class could drive
       * (founder, 2026-08-27). So there the driver names the column and the race is the
       * context, the same shape as the columns beside it.
       */
      name: anchorIsImportedSheet
        ? primaryRunLabel
        : dayRunNames[compareAnchorRun.id] || anchorSessionName,
      segment: "driver",
      trackKey: anchorTrack,
      fieldRunId: null,
      // The car on your own run — the same subline every "My runs" row wears.
      context: anchorIsImportedSheet
        ? anchorSessionName
        : compareAnchorRun.car?.name?.trim() || compareAnchorRun.carNameSnapshot?.trim() || null,
      loaded: true,
    });

    // A run can hold two timing imports when a break split the session, and each
    // stores its own set per driver. Joined by driver so a rival is one column
    // over the whole run, not two columns of half a stint each.
    const mergedImportedSets = mergeImportedLapSetsByDriver(
      (run.importedLapSets ?? [])
        .filter((s) => s.laps?.length)
        .map((s) => ({
          ...s,
          isPrimaryUser: Boolean(s.isPrimaryUser),
          laps: (s.laps ?? []).map((l) => ({
            lapNumber: l.lapNumber,
            lapTimeSeconds: l.lapTimeSeconds,
            isIncluded: l.isIncluded !== false,
          })),
        }))
    );

    const rawImported: ComparisonSeries[] = [];
    for (const s of mergedImportedSets) {
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
        fieldRunId: null,
        context: null,
        loaded: true,
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
        primaryLapRowsFromRun({ lapTimes: r.lapTimes, lapSession: r.lapSession }),
        { fiveMinStartLap: readFiveMinStartLap(r.lapSession) }
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
        name: dayRunNames[r.id] || formatRunSessionDisplay(r, { fallback: carName }),
        // Team Sessions mixes every member's runs into this list; a run that
        // isn't the anchor driver's belongs under Teammates, not under their name.
        segment:
          compareAnchorRun.userId && r.userId && r.userId !== compareAnchorRun.userId
            ? "teammates"
            : "driver",
        trackKey: lapCompareTrackKey(trackCtx),
        fieldRunId: null,
        // Displaced from the heading, not dropped: it rides the line with the time.
        context: carName,
        loaded: true,
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
        fieldRunId: null,
        context: null,
        loaded: true,
      });
    }

    /*
     * Rivals off OTHER runs' timing sheets — "compare me with his first heat,
     * not the one I'm looking at". A race that hasn't been opened yet still gets
     * its rows (the names are known), just with no laps behind them; those stay
     * out of the duplicate filter, which would otherwise call every empty series
     * a copy of the first one.
     */
    const rawOtherField: ComparisonSeries[] = [];
    const rawOtherFieldPending: ComparisonSeries[] = [];
    for (const r of otherFieldRuns) {
      const metaSets = r.importedLapSets ?? [];
      const loadedSets = fieldSetsByRunId[r.id] ?? null;
      const loaded = loadedSets != null || metaSets.every((s) => Array.isArray(s.laps));
      const merged = mergeImportedLapSetsByDriver(
        (loadedSets ?? metaSets)
          .filter((s) => !s.isPrimaryUser)
          .map((s) => ({
            id: s.id,
            driverName: s.driverName,
            displayName: s.displayName ?? null,
            normalizedName: s.normalizedName ?? null,
            sourceUrl: s.sourceUrl ?? null,
            createdAt: s.createdAt ?? null,
            sessionCompletedAt: s.sessionCompletedAt ?? null,
            isPrimaryUser: false,
            laps: (s.laps ?? []).map((l) => ({
              lapNumber: l.lapNumber,
              lapTimeSeconds: l.lapTimeSeconds,
              isIncluded: l.isIncluded !== false,
            })),
          }))
      );
      const whenIso = resolveRunDisplayInstant(r).toISOString();
      const raceName = formatRunSessionDisplay(r, {
        fallback: r.car?.name?.trim() || r.carNameSnapshot?.trim() || primaryRunLabel,
      });
      const trackCtx = r.track?.name?.trim() || r.trackNameSnapshot?.trim() || null;
      for (const s of merged) {
        // A rival whose sheet came back with no laps has nothing to compare.
        if (loaded && s.laps.length === 0) continue;
        const label = (s.displayName?.trim() || s.driverName).trim() || "Imported";
        const ser = buildComparisonSeries(
          lapCompareFieldSeriesId(r.id, s.id),
          label,
          "imported",
          importedSetToLapRows(s.laps)
        );
        (loaded ? rawOtherField : rawOtherFieldPending).push(ser);
        metaById.set(ser.id, {
          metaLine: null,
          setupRun: null,
          selectLabel: formatDriverSessionLabelWithContext(label, whenIso, raceName),
          // The run's own instant, not the timing sheet's: it is the same clock
          // that run's "My runs" row reads, so the two are scoped identically.
          sortIso: whenIso,
          name: label,
          segment: "field",
          trackKey: lapCompareTrackKey(trackCtx),
          fieldRunId: r.id,
          context: raceName,
          loaded,
        });
      }
    }

    const dedupedOthers = filterDuplicateImportedSeries(primarySeries, [
      ...rawImported,
      ...rawLibrary,
      ...rawHistory,
      ...rawOtherField,
    ]);
    /*
     * One of the driver's own runs that the dedupe threw out is remembered with the row
     * it copies, so the picker can still list it — greyed, "Same laps as Run 1". Two runs
     * with identical laps is nearly always one timing block attached twice, and hiding
     * the second copy hid the mistake along with it.
     */
    const heldBackDuplicates = new Map<string, string>();
    const keptIds = new Set(dedupedOthers.map((s) => s.id));
    for (const s of rawHistory) {
      if (keptIds.has(s.id)) continue;
      const twin = [primarySeries, ...dedupedOthers].find((k) =>
        areLapSeriesEquivalent(s.laps, k.laps)
      );
      const twinName =
        twin == null
          ? null
          : twin.id === "run:primary"
            ? "this run"
            : metaById.get(twin.id)?.name ?? twin.label;
      heldBackDuplicates.set(
        s.id.slice("history:".length),
        twinName ? `Same laps as ${twinName}` : "Same laps as another row"
      );
    }
    const list = [primarySeries, ...dedupedOthers, ...rawOtherFieldPending];
    return { seriesList: list, metaById, heldBackDuplicates };
  }, [
    run,
    primaryRunLabel,
    historyPickOptions,
    dayRunNames,
    compareAnchorRun,
    primaryLaps,
    librarySessions,
    memberDisplayByUserId,
    otherFieldRuns,
    fieldSetsByRunId,
    anchorIsImportedSheet,
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
      // A rival off another run's sheet was wherever that run was.
      const fieldRunId = lapCompareFieldSeriesRunId(seriesId);
      if (fieldRunId) {
        const r = otherRuns.find((o) => o.id === fieldRunId);
        return lapCompareTrackKey(r?.track?.name ?? r?.trackNameSnapshot ?? null);
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
    const order: CompareSegmentKey[] = ["driver", "teammates", "field", "library"];
    return order
      .filter((k) => (counts.get(k) ?? 0) > 0)
      .map((k) => ({ key: k, label: segmentLabels[k], count: counts.get(k)! }));
  }, [scopeFilteredRows, segmentFor, segmentLabels]);

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
    const toRow = (r: { id: string; sortIso: string; label: string }): LapPickerRow => {
      const m = metaById.get(r.id);
      return {
        id: r.id,
        name: m?.name ?? r.label,
        /*
         * The car joins the time on the second line. It used to BE the heading, which read as
         * seven rows of "A800RR" over seven different sessions; on a field row the context is
         * the race name and the group heading already says it.
         */
        when: [
          r.sortIso ? formatRunDateTime(r.sortIso) : "—",
          m?.segment === "field" ? null : m?.context ?? null,
        ]
          .filter(Boolean)
          .join(" · "),
        bestLap: seriesById.get(r.id)?.bestLap ?? null,
      };
    };

    /*
     * The field is grouped by RACE, not by day and track: this run's own sheet
     * first and always open, then every other race in scope folded shut until
     * asked for. Inside a race every entrant shares a day and a venue, so the
     * day/track buckets below would say nothing; between races, the race name
     * is exactly what needs saying. The venue is only appended when it is not
     * this one, which can only happen once the scope has been widened.
     */
    if (activeSegment === "field") {
      if (compareOptionRows.length === 0) return [];
      const own: LapPickerRow[] = [];
      const byRun = new Map<string, LapPickerRow[]>();
      for (const r of compareOptionRows) {
        const rid = metaById.get(r.id)?.fieldRunId ?? null;
        if (!rid) {
          own.push(toRow(r));
          continue;
        }
        const rows = byRun.get(rid) ?? [];
        rows.push(toRow(r));
        byRun.set(rid, rows);
      }
      const groups: LapPickerGroup[] = [];
      if (own.length > 0) {
        // Named after the session, not "This session": beside "Race · 15 Jul" and
        // "Race · 8 Jul" the reader needs the same kind of name here.
        const pm = metaById.get("run:primary");
        // On an imported race the race's name is the anchor's CONTEXT (the driver names the
        // column); on your own run it is the anchor's NAME (the car is the context).
        const sessionName = anchorIsImportedSheet ? pm?.context : pm?.name;
        const label = [sessionName ?? null, pm?.sortIso ? formatRunDateTime(pm.sortIso) : null]
          .filter(Boolean)
          .join(" · ");
        groups.push({ key: "field", label: label || "This session", rows: own });
      }
      // `compareOptionRows` is already newest-first, and a Map keeps insertion
      // order, so the races come out in the same order as every other list.
      for (const [rid, rows] of byRun) {
        const m = metaById.get(rows[0]!.id);
        const r = otherRuns.find((o) => o.id === rid);
        const trackName = r?.track?.name?.trim() || r?.trackNameSnapshot?.trim() || null;
        const elsewhere = trackName != null && lapCompareTrackKey(trackName) !== anchorTrackKey;
        const expanded = expandedFieldRunIds.includes(rid);
        const fetchState = fieldFetchState[rid];
        groups.push({
          key: `field:${rid}`,
          label: [
            m?.context ?? null,
            m?.sortIso ? formatRunDateTime(m.sortIso) : null,
            elsewhere ? trackName : null,
          ]
            .filter(Boolean)
            .join(" · "),
          rows,
          collapsed: !expanded,
          onToggle: () => toggleFieldRun(rid),
          status:
            fetchState === "error"
              ? "Couldn't load this race's laps"
              : expanded && fetchState === "loading"
                ? "Loading laps…"
                : null,
        });
      }
      return groups;
    }

    const buckets = emptyDayTrackBuckets<{ row: LapPickerRow; sortIso: string }>();
    for (const r of compareOptionRows) {
      const bucket = dayTrackBucketFor({
        sortIso: r.sortIso,
        trackKey: metaById.get(r.id)?.trackKey ?? null,
        anchorTrackKey,
        anchorInstantIso,
      });
      buckets[bucket].push({ row: toRow(r), sortIso: r.sortIso });
    }

    /*
     * The runs held back (no laps, a copy of this run, a copy of another row) take their
     * place in the same groups, greyed, with the reason on the time line. Same tab, same
     * scope, same name as everywhere else — so the day's numbering has no holes, and a
     * missing "Run 2" is one line of explanation rather than a mystery.
     */
    if (activeSegment === "driver" || activeSegment === "teammates") {
      for (const r of otherRuns) {
        const note = heldBackByAnchor.get(r.id) ?? heldBackDuplicates.get(r.id) ?? null;
        if (!note) continue;
        const segment: CompareSegmentKey =
          compareAnchorRun.userId && r.userId && r.userId !== compareAnchorRun.userId
            ? "teammates"
            : "driver";
        if (segment !== activeSegment) continue;
        const sortIso = resolveRunDisplayInstant(r).toISOString();
        if (!seriesMatchesScope(`history:${r.id}`, sortIso)) continue;
        const trackCtx = r.track?.name?.trim() || r.trackNameSnapshot?.trim() || null;
        const carName = r.car?.name?.trim() || r.carNameSnapshot?.trim() || null;
        const included = primaryLapRowsFromRun({ lapTimes: r.lapTimes, lapSession: r.lapSession })
          .filter((l) => l.isIncluded)
          .map((l) => l.lapTimeSeconds);
        const bucket = dayTrackBucketFor({
          sortIso,
          trackKey: lapCompareTrackKey(trackCtx),
          anchorTrackKey,
          anchorInstantIso,
        });
        buckets[bucket].push({
          sortIso,
          row: {
            id: `held:${r.id}`,
            name: dayRunNames[r.id] || formatRunSessionDisplay(r, { fallback: carName ?? "Run" }),
            when: [formatRunDateTime(sortIso), carName].filter(Boolean).join(" · "),
            bestLap: included.length > 0 ? Math.min(...included) : null,
            disabled: true,
            note,
          },
        });
      }
    }

    const labels = dayTrackBucketLabels(anchorTrackName);
    return DAY_TRACK_BUCKETS.map((key) => ({
      key,
      label: labels[key],
      rows: buckets[key].sort(compareOptionSort).map((b) => b.row),
    })).filter((g) => g.rows.length > 0);
  }, [
    compareOptionRows,
    metaById,
    seriesById,
    activeSegment,
    anchorInstantIso,
    anchorTrackKey,
    anchorTrackName,
    otherRuns,
    expandedFieldRunIds,
    fieldFetchState,
    toggleFieldRun,
    anchorIsImportedSheet,
    heldBackByAnchor,
    heldBackDuplicates,
    compareAnchorRun.userId,
    seriesMatchesScope,
    dayRunNames,
  ]);

  /*
   * A CHANGE of run empties the columns. Not the first render: an effect on mount ran this
   * too, which wiped `initialComparisonIds` before anyone saw them — so the pop-up's
   * "Detailed analysis" door arrived with nothing ticked, and a race sheet could never open
   * on its field.
   */
  const lastRunIdRef = useRef(currentRunId);
  useEffect(() => {
    if (lastRunIdRef.current === currentRunId) return;
    lastRunIdRef.current = currentRunId;
    setSelectedComparisonIds([]);
    setExpandedFieldRunIds([]);
  }, [currentRunId]);

  /*
   * Pruned against everything in SCOPE, not against the open segment. It used
   * to read `compareOptionRows`, which is cut to the active tab — so ticking a
   * rival under Field and then opening My runs to tick an earlier session threw
   * the rival away. The tabs only carve the list up; they do not un-tick it.
   */
  useEffect(() => {
    const valid = new Set(scopeFilteredRows.map((r) => r.series.id));
    setSelectedComparisonIds((prev) => prev.filter((id) => valid.has(id) && id !== targetId));
  }, [scopeFilteredRows, targetId]);

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
    return (
      selectedComparisonIds
        // The prune effect below drops a newly-chosen target from the ticked list, but only
        // after the render that chose it — for that one frame the same column would be
        // drawn twice, as the target and as a comparison of itself.
        .filter((id) => id !== targetId)
        .map((id) => seriesList.find((s) => s.id === id))
        .filter((s): s is ComparisonSeries => Boolean(s))
    );
  }, [selectedComparisonIds, seriesList, targetId]);

  const lapNumbers = useMemo(() => {
    const cols = targetSeries ? [targetSeries, ...comparisonSeries] : comparisonSeries;
    return alignLapsByNumber(cols);
  }, [targetSeries, comparisonSeries]);

  /*
   * One width for every driver column — see `LAP_COL_PX`. Null until the area is measured,
   * during which the table keeps its auto layout for a frame. Below the floor the columns
   * stop shrinking and the wrapper scrolls sideways instead, which is the phone's case.
   */
  const columnCount = (targetSeries ? 1 : 0) + comparisonSeries.length;
  // A phone scrolls the sheet sideways whatever the floor is, so it keeps columns a name
  // still fits in; the desktop floor is what lets ten drivers share a 1440 monitor.
  const minColumnWidth = gridAreaWidth < 640 ? 100 : MIN_COL_PX;
  const fixedColumnWidth =
    gridAreaWidth > 0 && columnCount > 0
      ? Math.max(
          minColumnWidth,
          Math.min(MAX_COL_PX, Math.floor((gridAreaWidth - LAP_COL_PX) / columnCount))
        )
      : null;
  const compactColumns = fixedColumnWidth != null && fixedColumnWidth < 100;

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

  /**
   * A SESSION as the target picker sees it: the thing you choose first, whose drivers you
   * choose from second.
   *
   * "If I've uploaded a race, it should let me select the race and then select the driver"
   * (founder, 2026-08-27). The dropdown used to list SERIES — one row per driver per
   * session, every rival of every heat in scope flattened into one list. The target is
   * always a driver in a session; this is the session half, and `drivers` is the other.
   */
  type TargetSession = {
    key: string;
    name: string;
    sortIso: string;
    trackKey: string | null;
    /** Every tab this session belongs under. A heat you drove is both yours and a field. */
    segments: CompareSegmentKey[];
    /** `loaded` is false while a rival's laps are still on their way from the server. */
    drivers: Array<{ id: string; name: string; bestLap: number | null; loaded: boolean }>;
  };

  /** `run:primary` + this sheet's `imported:` field → "this_sheet"; `history:`/`field:` → their run; `library:` → itself. */
  const sessionKeyForSeries = useCallback((seriesId: string): string => {
    if (seriesId === "run:primary" || seriesId.startsWith("imported:")) return "this_sheet";
    if (seriesId.startsWith("history:")) return `run:${seriesId.slice("history:".length)}`;
    const rid = lapCompareFieldSeriesRunId(seriesId);
    if (rid) return `run:${rid}`;
    return seriesId;
  }, []);

  const targetSessions = useMemo((): TargetSession[] => {
    const byKey = new Map<string, TargetSession>();
    for (const s of seriesList) {
      const m = metaById.get(s.id);
      const key = sessionKeyForSeries(s.id);
      let session = byKey.get(key);
      if (!session) {
        session = {
          key,
          name: "",
          sortIso: m?.sortIso ?? "",
          trackKey: m?.trackKey ?? null,
          segments: [],
          drivers: [],
        };
        byKey.set(key, session);
      }
      const seg = m?.segment ?? "driver";
      if (!session.segments.includes(seg)) session.segments.push(seg);
      /*
       * The DRIVER's name, which is the series label — your own rows are named after their
       * session in `metaById` ("Run 1"), and "Run 1" is not who was driving. A library
       * import is the one series whose label is a session line, so it keeps its meta name.
       */
      session.drivers.push({
        id: s.id,
        name: s.id.startsWith("library:") ? (m?.name ?? s.label) : s.label,
        bestLap: s.bestLap,
        loaded: m?.loaded ?? true,
      });
    }

    /*
     * This sheet's drivers in CLASSIFICATION order. The series list puts the anchor first
     * and the field after it, but on an imported race the anchor may have finished third,
     * and "P3" is what the driver select needs to say. `importedLapSets` arrives in
     * finishing order, with the anchor's own row flagged primary.
     */
    const thisSheet = byKey.get("this_sheet");
    if (thisSheet) {
      const order = new Map<string, number>();
      (run.importedLapSets ?? []).forEach((set, i) => {
        order.set(set.isPrimaryUser ? "run:primary" : `imported:${set.id}`, i);
      });
      if (!order.has("run:primary")) order.set("run:primary", -1);
      thisSheet.drivers.sort(
        (a, b) =>
          (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER)
      );
      const pm = metaById.get("run:primary");
      // Race name on an imported sheet (the anchor's context); the run's name on your own.
      thisSheet.name = (anchorIsImportedSheet ? pm?.context : pm?.name) ?? "This sheet";
      thisSheet.sortIso = pm?.sortIso ?? thisSheet.sortIso;
    }

    for (const session of byKey.values()) {
      if (session.key === "this_sheet") continue;
      if (session.key.startsWith("run:")) {
        const rid = session.key.slice("run:".length);
        const r = otherRuns.find((o) => o.id === rid);
        session.name =
          dayRunNames[rid] ||
          (r
            ? formatRunSessionDisplay(r, {
                fallback: r.car?.name?.trim() || r.carNameSnapshot?.trim() || "Run",
              })
            : "Run");
        // You first, then the rest of that sheet in its own order.
        session.drivers.sort(
          (a, b) => Number(b.id.startsWith("history:")) - Number(a.id.startsWith("history:"))
        );
        continue;
      }
      session.name = session.drivers[0]?.name ?? session.key;
    }

    /*
     * "How far to look" applies here too: a session is offered when any of its drivers is
     * in scope. This sheet always is. Newest first after it, like every other list.
     */
    const inScope = [...byKey.values()].filter(
      (session) =>
        session.key === "this_sheet" ||
        session.drivers.some((d) => seriesMatchesScope(d.id, session.sortIso))
    );
    return inScope.sort((a, b) => {
      if (a.key === "this_sheet") return -1;
      if (b.key === "this_sheet") return 1;
      return compareOptionSort(a, b);
    });
  }, [
    seriesList,
    metaById,
    sessionKeyForSeries,
    run.importedLapSets,
    otherRuns,
    dayRunNames,
    seriesMatchesScope,
    anchorIsImportedSheet,
  ]);

  /** The session the current target sits in. Derived, so the two can never disagree. */
  const targetSessionKey = sessionKeyForSeries(targetId);
  const targetSession = targetSessions.find((s) => s.key === targetSessionKey) ?? null;

  /**
   * The same tabs as Compare with, over the SESSION dropdown. Headings inside a dropdown were
   * not enough: "if I have a lot of runs I'd never find those" (founder, 2026-08-27).
   */
  const targetSegments = useMemo(() => {
    const counts = new Map<CompareSegmentKey, number>();
    for (const session of targetSessions) {
      if (session.key === "this_sheet") continue;
      for (const k of session.segments) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const order: CompareSegmentKey[] = ["driver", "teammates", "field", "library"];
    return order
      .filter((k) => (counts.get(k) ?? 0) > 0)
      .map((k) => ({ key: k, label: segmentLabels[k], count: counts.get(k)! }));
  }, [targetSessions, segmentLabels]);

  useEffect(() => {
    if (targetSegments.length === 0) return;
    if (targetSegments.some((s) => s.key === targetSegment)) return;
    setTargetSegment(targetSegments[0]!.key);
  }, [targetSegments, targetSegment]);

  /**
   * The session dropdown's groups: this sheet on its own line, then the chosen tab's sessions
   * by day and track — and whatever session holds the current target, whichever tab it is
   * under, because a `<select>` whose value is not among its options draws the first one
   * while the grid measures against another.
   */
  const targetSessionGroups = useMemo(() => {
    const labels = dayTrackBucketLabels(anchorTrackName);
    const buckets = emptyDayTrackBuckets<TargetSession>();
    const pinned: TargetSession[] = [];
    for (const session of targetSessions) {
      if (session.key === "this_sheet") {
        pinned.push(session);
        continue;
      }
      const wanted = session.segments.includes(targetSegment) || session.key === targetSessionKey;
      if (!wanted) continue;
      buckets[
        dayTrackBucketFor({
          sortIso: session.sortIso,
          trackKey: session.trackKey,
          anchorTrackKey,
          anchorInstantIso,
        })
      ].push(session);
    }
    const groups: Array<{ key: string; label: string | null; sessions: TargetSession[] }> = [
      { key: "this_sheet", label: null, sessions: pinned },
    ];
    for (const bucket of DAY_TRACK_BUCKETS) {
      groups.push({ key: bucket, label: labels[bucket], sessions: buckets[bucket] });
    }
    return groups.filter((g) => g.sessions.length > 0);
  }, [targetSessions, targetSegment, targetSessionKey, anchorTrackName, anchorTrackKey, anchorInstantIso]);

  /**
   * Changing the target never loses a column. Making Michael the target used to drop Jordan
   * off the sheet — the old target was ticked nowhere, so it simply vanished — when
   * "measure him against me" is the reason for the switch. The previous target stays on as
   * a comparison; the scope pruning above still applies if it has left the scope.
   */
  const chooseTarget = useCallback(
    (nextId: string) => {
      if (nextId === targetId) return;
      const previous = targetId;
      setTargetId(nextId);
      setSelectedComparisonIds((prev) =>
        prev.includes(previous) ? prev.filter((id) => id !== nextId) : [previous, ...prev.filter((id) => id !== nextId)]
      );
    },
    [targetId]
  );

  /** Choosing a session lands on its own driver when there is one — you — else its leader. */
  const onTargetSessionChange = useCallback(
    (key: string) => {
      const session = targetSessions.find((s) => s.key === key);
      if (!session) return;
      const own = session.drivers.find((d) => d.id === "run:primary" || d.id.startsWith("history:"));
      chooseTarget((own ?? session.drivers[0])?.id ?? "run:primary");
    },
    [targetSessions, chooseTarget]
  );

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
        fieldRunId: null,
        context: null,
        loaded: true,
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
      // The driver above, the session and its time below — the same two lines every
      // other row in the picker reads, and the same two the column header prints.
      when: [m?.sortIso ? formatRunDateTime(m.sortIso) : "—", m?.context ?? null]
        .filter(Boolean)
        .join(" · "),
      bestLap: targetSeries.bestLap,
    };
  }, [targetSeries, metaById]);

  /** What the "Compared with" bar reads out, so the grid never has to be scrolled to find out. */
  const comparedWithLabel = useMemo(() => {
    if (comparisonSeries.length === 0) return "Nothing yet — pick a session";
    return comparisonSeries
      .map((s) => {
        const m = metaById.get(s.id);
        const name = m?.name ?? s.label;
        // A rival from another heat names the heat, or two "T. Volk"s read as one.
        return m?.context ? `${name} · ${m.context}` : name;
      })
      .join(", ");
  }, [comparisonSeries, metaById]);

  /**
   * The desktop tile row. Comparisons are read against the FIRST ticked column —
   * the same one the lap trace draws — so the tiles, the trace and the grid are
   * all answering "versus what?" with the same session rather than three.
   *
   * There is no "Laps counted" tile: Avg top 10 took its slot. The count it
   * carried is legible from the grid itself (a lap per row, excluded ones struck
   * through), while pace over ten laps is not derivable by eye from anything on
   * screen.
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
        shortLabel: "Field",
        value: `P${rank}`,
        valueSuffix: `/${all.length}`,
        note: `median ${median.toFixed(3)}`,
        noteTone: "muted",
      };
    }

    /*
     * The 5-minute stint — best consecutive five minutes, timing-loop scored, the
     * figure LiveRC posts as the result. Laps carry the value; the clock rides as
     * the suffix, the same emphasis a results sheet gives it. Its note compares the
     * RC way: laps first ("+1 lap on…"), and only on equal laps does the clock
     * decide. On the phone band it takes Avg top 10's place — the settled row is
     * five across, and a 13-lap stint already answers the over-a-run question.
     */
    // A driver's own hand-placed window (when stored and still valid) is the
    // figure their run shows everywhere; imported rivals are always auto-best.
    const targetStint = getDisplayFiveMinuteStint(targetSeries.laps, targetSeries.fiveMinStartLap);
    const vsStint = vs ? getDisplayFiveMinuteStint(vs.laps, vs.fiveMinStartLap) : null;
    /** "/5:12.345" — the time half of the stint figure, sized down beside the lap count. */
    const stintTimeSuffix = (stint: { lapCount: number; seconds: number }, decimals: 0 | 1 | 3) => {
      const full = formatFiveMinuteStint(stint, decimals);
      return full.slice(full.indexOf("/"));
    };
    let stintNote: { note: string | null; noteTone?: "good" | "bad" } = { note: null };
    if (targetStint != null && vsStint != null && vsName) {
      const lapDiff = targetStint.lapCount - vsStint.lapCount;
      if (lapDiff !== 0) {
        stintNote = {
          note: `${lapDiff > 0 ? "+" : "−"}${Math.abs(lapDiff)} lap${
            Math.abs(lapDiff) === 1 ? "" : "s"
          } on ${vsName}`,
          noteTone: lapDiff > 0 ? "good" : "bad",
        };
      } else {
        // Read from the target's side like every other note: negative = this session
        // covered the same laps in less time.
        const secDiff = targetStint.seconds - vsStint.seconds;
        stintNote = {
          note: `${formatLapDelta(secDiff)} on ${vsName}`,
          noteTone: secDiff < 0 ? "good" : "bad",
        };
      }
    }

    const tiles: LapStatTile[] = [
      {
        label: "Best lap",
        shortLabel: "Best",
        value: formatLap(targetSeries.bestLap),
        accent: true,
        ...noteFor(d?.bestDelta),
      },
      {
        label: "Avg top 5",
        shortLabel: "Avg5",
        value: formatLap(targetSeries.avgTop5),
        ...noteFor(d?.avgTop5Delta),
      },
      ...(targetStint != null
        ? [
            {
              label: "5-min stint",
              shortLabel: "5min",
              value: String(targetStint.lapCount),
              valueSuffix: stintTimeSuffix(targetStint, 3),
              // Whole seconds: a ~60px band cell clips "/5:04.0" one character short
              // (measured); the tenth lives on desktop, the run card, and hover.
              bandValueSuffix: stintTimeSuffix(targetStint, 0),
              ...stintNote,
            } satisfies LapStatTile,
          ]
        : []),
      {
        label: "Avg top 10",
        shortLabel: "Avg10",
        value: formatLap(targetSeries.avgTop10),
        hideOnBand: targetStint != null,
        ...noteFor(d?.avgTop10Delta),
      },
      {
        label: "Consistency",
        shortLabel: "Cons",
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
    ];
    if (fieldTile) tiles.push(fieldTile);
    return tiles;
  }, [targetSeries, comparisonSeries, metaById, seriesList]);

  const toggleComparison = useCallback((id: string) => {
    setSelectedComparisonIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  /**
   * The columns as the charts see them: target first, then every ticked column in grid
   * order. `sameSessionAsTarget` is what lets Gap and Position know which lines shared a
   * start — the session key is the same one the target picker groups by, so "same race"
   * means the same thing in both places.
   */
  const chartSeries = useMemo((): LapChartSeries[] => {
    if (!targetSeries) return [];
    return [targetSeries, ...comparisonSeries].map((s) => ({
      id: s.id,
      name: metaById.get(s.id)?.name ?? s.label,
      series: s,
      isTarget: s.id === targetSeries.id,
      sameSessionAsTarget: sessionKeyForSeries(s.id) === targetSessionKey,
    }));
  }, [targetSeries, comparisonSeries, metaById, sessionKeyForSeries, targetSessionKey]);

  /**
   * The chip row: everyone in the target's session, ticked or not, then anything ticked
   * from elsewhere. A race's field is the pool you choose from; a column added from another
   * heat still needs a chip, or there would be a column on the sheet nothing above it names.
   */
  const driverChips = useMemo((): LapDriverChip[] => {
    if (!targetSeries) return [];
    const selected = new Set(selectedComparisonIds);
    const chips: LapDriverChip[] = [];
    const seen = new Set<string>();
    const push = (id: string, label: string, loaded: boolean) => {
      if (seen.has(id)) return;
      seen.add(id);
      chips.push({ id, label, on: id === targetSeries.id || selected.has(id), isTarget: id === targetSeries.id, loaded });
    };
    push(targetSeries.id, metaById.get(targetSeries.id)?.name ?? targetSeries.label, true);
    for (const d of targetSession?.drivers ?? []) {
      // Named like its column: the driver on a race sheet, the session on your own runs.
      push(d.id, metaById.get(d.id)?.name ?? d.name, d.loaded);
    }
    for (const s of comparisonSeries) push(s.id, metaById.get(s.id)?.name ?? s.label, true);
    return chips;
  }, [targetSeries, targetSession, comparisonSeries, selectedComparisonIds, metaById]);

  const selectAllChips = useCallback(() => {
    setSelectedComparisonIds((prev) => {
      const next = new Set(prev);
      for (const c of driverChips) if (!c.isTarget && c.loaded) next.add(c.id);
      return [...next];
    });
  }, [driverChips]);
  const selectNoChips = useCallback(() => setSelectedComparisonIds([]), []);

  const traceBestLapNumbers = useMemo(
    () =>
      new Set(
        targetSeries?.bestLap != null
          ? targetSeries.laps.filter((l) => isBestLapOf(targetSeries, l) && l.isIncluded).map((l) => l.lapNumber)
          : []
      ),
    [targetSeries]
  );

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
  function targetSessionLabel(session: TargetSession): string {
    const when = session.sortIso ? formatRunDateTime(session.sortIso) : null;
    const n = session.drivers.length;
    return [session.name, when, n > 1 ? `${n} drivers` : null].filter(Boolean).join(" · ");
  }

  /**
   * The driver half of the target choice, drawn wherever the question "whose numbers are
   * these?" gets asked: in the picker under the session, and in the stat strip's heading.
   * One control, two homes, distinct ids. Null when the session has one driver — a select
   * that can only be set to what it already says reads as broken.
   */
  function renderTargetDriverSelect(
    idPrefix: string,
    opts?: { fullWidth?: boolean; variant?: "heading" }
  ) {
    const drivers = targetSession?.drivers ?? [];
    if (drivers.length < 2) return null;
    // Finishing positions are only known for THIS sheet's field, and only mean something
    // when the sheet is a race somebody imported in finishing order.
    const numbered = targetSession?.key === "this_sheet" && anchorIsImportedSheet;
    const options = drivers.map((d, i) => (
      <option key={d.id} value={d.id} disabled={!d.loaded}>
        {numbered ? `P${i + 1} · ` : ""}
        {d.name}
        {d.loaded ? ` · ${formatLap(d.bestLap)}` : " · loading…"}
      </option>
    ));
    if (opts?.variant === "heading") {
      /*
       * The phone band's heading: the same select, drawn as the name rather than beside
       * it. At 390px there is no room for a name AND a 16rem dropdown on one line, and the
       * two said the same thing anyway. The chevron is the only tell that it opens.
       */
      return (
        <span className="relative inline-flex max-w-full items-center">
          <select
            id={`${idPrefix}-lap-compare-target-driver`}
            className="tap-active max-w-full appearance-none truncate rounded-md bg-transparent py-0.5 pl-0 pr-5 text-[13px] font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            value={targetId}
            onChange={(e) => chooseTarget(e.target.value)}
            aria-label="Target driver"
          >
            {options}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-0 size-3.5 text-muted-foreground"
            aria-hidden
          />
        </span>
      );
    }
    return (
      <select
        id={`${idPrefix}-lap-compare-target-driver`}
        className={cn(
          "rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none",
          opts?.fullWidth ? "w-full py-2" : "max-w-[16rem]"
        )}
        value={targetId}
        onChange={(e) => chooseTarget(e.target.value)}
        aria-label="Target driver"
      >
        {options}
      </select>
    );
  }

  /**
   * The headline figures, in the layout the width calls for: tiles across the top of the
   * desktop, a band under the context line on the phone. Both are mounted and one is
   * hidden by breakpoint, so each gets its own id prefix for the target select inside it.
   */
  function renderStatTiles(layout: "tiles" | "band") {
    const heading = targetSeries
      ? {
          name: metaFor(targetSeries).name,
          context: [
            "target",
            metaFor(targetSeries).sortIso ? formatRunDateTime(metaFor(targetSeries).sortIso) : null,
            // A rival off this sheet carries no context of their own (the sheet IS
            // the context), so the session names them — unless it already did.
            metaFor(targetSeries).context ??
              (targetSession && targetSession.name !== metaFor(targetSeries).name
                ? targetSession.name
                : null),
          ]
            .filter(Boolean)
            .join(" · "),
          control:
            layout === "band"
              ? renderTargetDriverSelect("band", { variant: "heading" })
              : renderTargetDriverSelect("tiles"),
        }
      : null;
    return (
      <LapCompareStatTiles
        tiles={statTiles}
        heading={heading}
        layout={layout}
        className={layout === "band" ? "lg:hidden" : "hidden lg:block"}
      />
    );
  }

  function renderPicker(idPrefix: string) {
    const sessionSelectId = `${idPrefix}-lap-compare-target`;
    const scopeId = `${idPrefix}-lap-compare-scope`;
    return (
      <div className="space-y-3">
        {/*
         * Target, in two steps: the session, then a driver in it. The driver step only appears
         * when there is a choice — your own run has one driver, and a control that can only
         * be set to what it already says reads as broken.
         */}
        <div className="space-y-1">
          <label className="ui-label-caps text-[9px] uppercase tracking-wider" htmlFor={sessionSelectId}>
            Target
          </label>
          <LapCompareSegmentBar
            segments={targetSegments}
            active={targetSegment}
            onSelect={(k) => setTargetSegment(k as CompareSegmentKey)}
            ariaLabel="Where to pick the target from"
          />
          <select
            id={sessionSelectId}
            className="w-full rounded-md border border-border bg-card px-2 py-2 text-xs outline-none"
            value={targetSessionKey}
            onChange={(e) => onTargetSessionChange(e.target.value)}
            aria-label="Target session"
          >
            {targetSessionGroups.map((g) =>
              g.label == null ? (
                g.sessions.map((session) => (
                  <option key={session.key} value={session.key}>
                    {targetSessionLabel(session)}
                  </option>
                ))
              ) : (
                <optgroup key={g.key} label={g.label}>
                  {g.sessions.map((session) => (
                    <option key={session.key} value={session.key}>
                      {targetSessionLabel(session)}
                    </option>
                  ))}
                </optgroup>
              )
            )}
          </select>
          {renderTargetDriverSelect(idPrefix, { fullWidth: true })}
        </div>

        {/* The two dropdowns' answer, right under them — see `LapCompareTargetRow`. */}
        <LapCompareTargetRow target={targetPickerRow} />

        <div className="space-y-2 border-t border-border pt-3">
          <p className="ui-label-caps text-[9px] uppercase tracking-wider">Compare with</p>
          <LapCompareSegmentBar
            segments={segments}
            active={activeSegment}
            onSelect={(k) => setActiveSegment(k as CompareSegmentKey)}
          />
          <LapCompareSessionList
            groups={pickerGroups}
            selectedIds={selectedComparisonIds}
            onToggle={toggleComparison}
          />
        </div>
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
       * The way out to the full-page sheet, carrying the columns with it.
       *
       * Not a second copy of the grid: the same one, with the pop-up's height limit
       * and the run page behind it both gone. It only appears when a host hands over
       * a destination — the full-page sheet itself never offers a door to itself.
       */}
      {onOpenFullAnalysis ? (
        <div className="flex justify-end">
          <button
            type="button"
            className="btn-surface px-2.5 py-1 text-[11px] font-medium"
            onClick={() =>
              onOpenFullAnalysis({ targetId, comparisonIds: selectedComparisonIds })
            }
          >
            Detailed analysis
          </button>
        </div>
      ) : null}

      {/*
       * The "Compared with" bar: one line that answers what the grid is showing,
       * and one button that changes it. It replaces three stacked dropdowns
       * (Target / Scope / Driver) plus a checkbox list — four controls the reader
       * had to work through before the first lap time was on screen, on a sheet
       * opened to look at lap times.
       */}
      {/* Phone: whose sheet this is and their five figures, before what they are compared with.
          Until 2026-08-29 the phone had none of this — the tiles were desktop-only. */}
      {renderStatTiles("band")}

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
      {renderStatTiles("tiles")}

      {/*
       * The rail took 17rem while the grid took everything else, which on a full-page sheet
       * meant the thing you pick sessions WITH was a third the width of one lap column
       * (founder call, 2026-08-27). Session rows carry a name, a date and a lap time and
       * were truncating all three at 17rem. 22rem fits them; 26rem at xl, where there is
       * room and the grid still has more than it needs.
       */}
      <div className="lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-4 xl:grid-cols-[26rem_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="max-h-[52vh] overflow-y-auto overscroll-contain rounded-md border border-border bg-surface-runna p-2.5">
            {renderPicker("rail")}
          </div>
        </aside>

        <div ref={gridAreaRef} className="min-w-0 space-y-3">
          {/* Who is on the sheet. Every chip is a column below and a line in the chart. */}
          <LapCompareDriverChips
            chips={driverChips}
            onToggle={toggleComparison}
            onAll={selectAllChips}
            onNone={selectNoChips}
            focusedId={focusedSeriesId}
            onFocus={setFocusedSeriesId}
          />

          {/* The charts answer "what shape was the race?" before the grid answers
              "by how much, lap by lap?". Hidden until a comparison is ticked —
              on its own the trace repeats what the single-run views already show.
              Drawn at every width since 2026-08-29 (it was `hidden lg:block`): the
              card measures itself and draws the phone version under ~560px. */}
          {targetSeries && comparisonSeries.length > 0 ? (
            <LapCompareCharts
              series={chartSeries}
              tab={chartTab}
              onTabChange={setChartTab}
              focusedId={focusedSeriesId}
              onFocus={setFocusedSeriesId}
              traceBestLapNumbers={traceBestLapNumbers}
            />
          ) : null}

      {/*
       * `w-fit max-w-full` is what stops one column filling a monitor.
       *
       * The table is `w-full`, and a full-width table shares every spare pixel between its
       * columns — so a sheet with nothing ticked drew a single lane of lap times a thousand
       * pixels wide, one number every 900px (founder call, 2026-08-27). Shrink-to-fit on the
       * WRAPPER makes "100%" mean "as wide as the columns need", while `max-w-full` keeps the
       * cap at the container so a six-column sheet still scrolls sideways instead of pushing
       * the page out. Fixing it on the table itself is what doesn't work: `w-auto` would stop
       * it reaching the edges at 390px, where filling the phone is the whole point.
       *
       * `lg:` for the same reason — unqualified, it shrank the phone sheet to a 235px strip
       * with the rest of the screen blank beside it. There is no spare width to give away at
       * 390px, so there is nothing to fix there.
       */}
      <div className="max-w-full overflow-x-auto rounded-md border border-border lg:w-fit">
        {/*
         * Fixed layout with one `<col>` per column once the area is measured (see
         * `LAP_COL_PX`). Until then, auto layout with a floor per column — Lap + target + one
         * comparison fit a 390px phone; more overflow into sideways scroll.
         */}
        <table
          className={cn("text-xs border-collapse", fixedColumnWidth == null && "w-full")}
          style={
            fixedColumnWidth != null
              ? { tableLayout: "fixed", width: LAP_COL_PX + columnCount * fixedColumnWidth }
              : undefined
          }
        >
          {fixedColumnWidth != null ? (
            <colgroup>
              <col style={{ width: LAP_COL_PX }} />
              {Array.from({ length: columnCount }, (_, i) => (
                <col key={i} style={{ width: fixedColumnWidth }} />
              ))}
            </colgroup>
          ) : null}
          <thead>
            <tr className="border-b border-border bg-muted/80">
              {/* Back to w-9 now the footer's "Avg 10" label — the only thing that
                  needed w-12 — has gone up into the column headers. */}
              <th className="w-9 text-left text-xs sm:text-sm font-medium text-muted-foreground px-1.5 sm:px-2 py-2 align-bottom sticky left-0 bg-muted/80 z-10">
                Lap
              </th>
              {targetSeries ? (
                <th
                  key={targetSeries.id}
                  className={cn(
                    "text-left px-1.5 sm:px-2 py-1.5 sm:py-2 align-bottom border-l border-border bg-muted/70",
                    fixedColumnWidth == null && "min-w-[108px]"
                  )}
                >
                  <ColumnHeaderBlock
                    series={targetSeries}
                    meta={metaFor(targetSeries)}
                    isTarget
                    isPerson={anchorIsImportedSheet}
                    compact={compactColumns}
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
                    className={cn(
                      "text-left px-1.5 sm:px-2 py-1.5 sm:py-2 align-bottom border-l border-border",
                      fixedColumnWidth == null && "min-w-[108px]"
                    )}
                  >
                    <ColumnHeaderBlock
                      series={s}
                      meta={metaFor(s)}
                      isTarget={false}
                      isPerson={s.sourceType === "imported"}
                      compact={compactColumns}
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
              return (
                <tr key={lapNum} className="border-b border-border/80 hover:bg-muted/50">
                  <td className="px-1.5 sm:px-2 py-1 text-xs sm:text-sm font-medium text-muted-foreground sticky left-0 bg-background/95 z-10">
                    {lapNum}
                  </td>
                  {targetSeries ? (
                    /*
                     * The target is the baseline, so it wears one flat wash and
                     * no delta. It used to "mirror" the comparison — tinted green
                     * or red against the fastest ticked lap in the row, with that
                     * delta printed under the time — which made the one column
                     * everything is measured FROM look like it was being measured
                     * too (founder call, 2026-08-27). Every colour on the sheet is
                     * now a comparison column's, and reads one way: vs the target.
                     */
                    <td
                      className={cn(
                        "px-1.5 sm:px-2 py-1 tabular-nums border-l border-border bg-muted/60",
                        tLap && (!tLap.isIncluded || tLap.lapNumber === 0) && "opacity-50 line-through"
                      )}
                    >
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
          {/* No summary footer: best / avg5 / avg10 are in the column headers, where
              they are on screen when you decide which column to read rather than
              behind a scroll past the laps they summarise. */}
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
