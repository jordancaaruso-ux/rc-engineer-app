"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { chipToggleClass } from "@/components/ui/chipToggle";
import { formatLap, formatStintTime } from "@/lib/runLaps";
import {
  computeFieldSheet,
  computeMistakeLaps,
  formatConsistencyScorePercent,
  formatMistakeLapDetail,
  getIncludedLapDashboardMetrics,
  getIncludedLaps,
  lapRowsFromTimesAndFlags,
} from "@/lib/lapAnalysis";
import { applyMedianBandAutoExclude } from "@/lib/lapImport/autoExcludeOutlierLaps";
import { LapTimeGraph, type LapGraphRow } from "@/components/runs/LapTimeGraph";
import { LapGapGraph } from "@/components/runs/LapGapGraph";
import { FieldAverageWells, RunFieldSheet, driverSurname } from "@/components/runs/RunFieldSheet";
import { StatWellGrid, StatWellCell } from "@/components/runs/LapStatStrip";
import { RUN_HISTORY_DATA_CLASS } from "@/components/runs/runHistoryTableColumns";

/**
 * Driver-compare pager for a run imported from a multi-driver timing session
 * (e.g. a LiveRC race result): mono name tabs in race-classification order
 * above the lap area; swiping (or tapping a tab) switches which driver's laps,
 * stats, and lap trace are shown. Your own run stays the untouched `userView`;
 * other drivers render a recomputed panel with your trace as a faint dashed
 * baseline on the graph. Runs without a multi-driver session render `userView`
 * with no extra chrome.
 */

type RaceFieldDriver = {
  id: string;
  name: string;
  position: number;
  isUser: boolean;
  laps: number[];
};

/** Movement (px) before a drag is claimed as a horizontal driver swipe. */
const CLAIM_DISTANCE = 8;
/** Drag distance (px) that commits a driver change on release. */
const COMMIT_DISTANCE = 56;

/**
 * Sentinel tab id for the whole-field sheet, which sits at the head of the strip
 * ahead of every driver. Not a driver id, so it can never collide with one.
 *
 * It deliberately carries no identity-coloured top edge: that edge exists to tie a
 * tab to its trace colour on the graph below, and the sheet has no trace. Its
 * selected state is the plain neutral chip treatment, keeping yellow for actions.
 */
const FIELD_TAB_ID = "__field__";

/**
 * Identity hues for the driver-compare view: your run vs the selected competitor.
 * Applied to both the notebook tab and the matching lap-graph trace so the eye
 * ties tab → laps → line together. Yellow = you (the hero line); white = the
 * field, echoing the monochrome ink ramp on the analysis trend graph. (Yellow is
 * normally action-only; here it reads as "you" in an explicit comparison.)
 */
export const RACE_IDENTITY = {
  you: "#FFD60A",
  competitor: "#ECE9E4",
} as const;

/**
 * Compact tab code for a driver: your own tab reads `YOU`; everyone else is the
 * first three letters of their last name, uppercased (e.g. Jordan Caruso → CAR).
 * Collisions across the field are acceptable — the tooltip carries the full
 * `P{position} {name}` label.
 *
 * The surname rule (a trailing single letter is a member flag, not a name) lives
 * in `driverSurname` so the field sheet's fuller labels derive it identically.
 */
function driverTabCode(driver: RaceFieldDriver): string {
  if (driver.isUser) return "YOU";
  return driverSurname(driver.name).slice(0, 3).toUpperCase() || "—";
}

export function RunRaceFieldSwitcher({
  runId,
  userView,
  userStats,
  userLapCard,
  userGraph,
  userLapRows,
  enabled = true,
}: {
  runId: string;
  /** Single-run layout (stats beside laps), rendered untouched when there's no field. */
  userView: ReactNode;
  /** Your stats chips — rendered above the notebook tabs in compare mode. */
  userStats: ReactNode;
  /** Your lap-time grid card — the notebook page the tabs attach to. */
  userLapCard: ReactNode;
  /** Your lap graph (yellow trace) — rendered below the notebook in compare mode. */
  userGraph: ReactNode;
  /** Your run's laps — the dashed baseline under other drivers' traces. */
  userLapRows: LapGraphRow[];
  /** Skip the field fetch entirely (e.g. manually-typed runs with no import). */
  enabled?: boolean;
}) {
  const [drivers, setDrivers] = useState<RaceFieldDriver[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    claimed: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setDrivers([]);
      return;
    }
    let alive = true;
    setDrivers(null);
    setSelectedId(null);
    fetch(`/api/runs/${encodeURIComponent(runId)}/race-field`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { drivers?: RaceFieldDriver[] } | null) => {
        if (!alive) return;
        const field = Array.isArray(data?.drivers) ? data.drivers : [];
        setDrivers(field);
        setSelectedId(field.find((d) => d.isUser)?.id ?? field[0]?.id ?? null);
      })
      .catch(() => {
        if (alive) setDrivers([]);
      });
    return () => {
      alive = false;
    };
  }, [runId, enabled]);

  const selectedIndex = useMemo(
    () => (drivers && selectedId ? drivers.findIndex((d) => d.id === selectedId) : -1),
    [drivers, selectedId]
  );
  const isFieldTab = selectedId === FIELD_TAB_ID;

  /**
   * Whole-field metrics for the FIELD tab. Your row is built from your own run's
   * lap rows — which carry your manual exclusions and no auto-exclude — while
   * competitors get the median-band heuristic, exactly as their own tabs do. Doing
   * it any other way makes your row in the sheet disagree with the stat wells
   * rendered directly above it.
   */
  const fieldSheet = useMemo(() => {
    if (!drivers || drivers.length < 2) return null;
    return computeFieldSheet(
      drivers.map((d) => ({
        id: d.id,
        name: d.name,
        position: d.position,
        isUser: d.isUser,
        rows:
          d.isUser && userLapRows.length > 0
            ? userLapRows
            : applyMedianBandAutoExclude(lapRowsFromTimesAndFlags(d.laps)),
      }))
    );
  }, [drivers, userLapRows]);

  const goTo = useCallback(
    (index: number) => {
      if (!drivers) return;
      const next = drivers[Math.max(0, Math.min(drivers.length - 1, index))];
      if (next) setSelectedId(next.id);
    },
    [drivers]
  );

  // Keep the active tab visible as swipes walk the field.
  useEffect(() => {
    if (!selectedId) return;
    const el = tabsRef.current?.querySelector<HTMLElement>(`[data-driver-id="${selectedId}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [selectedId]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    gestureRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      claimed: false,
    };
    suppressClickRef.current = false;
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g || e.pointerId !== g.pointerId) return;
    if (g.claimed) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (Math.abs(dx) < CLAIM_DISTANCE) return;
    // Vertical intent → page scroll owns it (touch-action: pan-y).
    if (Math.abs(dy) > Math.abs(dx)) {
      gestureRef.current = null;
      return;
    }
    g.claimed = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const g = gestureRef.current;
      gestureRef.current = null;
      if (!g || e.pointerId !== g.pointerId || !g.claimed) return;
      suppressClickRef.current = true;
      const dx = e.clientX - g.startX;
      if (Math.abs(dx) < COMMIT_DISTANCE) return;
      // The field sheet sits one slot ahead of the first driver, so the pager runs
      // FIELD → P1 → P2 … continuously in both directions.
      if (isFieldTab) {
        if (dx < 0) goTo(0);
        return;
      }
      if (selectedIndex < 0) return;
      if (selectedIndex === 0 && dx > 0) {
        setSelectedId(FIELD_TAB_ID);
        return;
      }
      // Dragging left reveals the next (worse-placed) driver, matching PagedCard.
      goTo(selectedIndex + (dx < 0 ? 1 : -1));
    },
    [goTo, isFieldTab, selectedIndex]
  );

  const onClickCapture = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // No multi-driver session (or still loading) — the run detail is unchanged.
  if (!drivers || drivers.length < 2 || !selectedId) return <>{userView}</>;

  const selected = drivers[selectedIndex] ?? drivers[0];

  // The race-field tab strip — flat chips matching every other toggle group
  // (shared chipToggleClass). Rendered once and dropped in above whichever
  // driver's lap card is showing (yours or a competitor's). It stops pointer events
  // from reaching the swipe handler so the strip can scroll horizontally on its own.
  const tabsNode = (
    <div
      ref={tabsRef}
      className="flex gap-1 overflow-x-auto px-px pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label="Race field"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {fieldSheet ? (
        <button
          type="button"
          role="tab"
          aria-selected={isFieldTab}
          aria-label="Whole field"
          title="Whole field — every driver on best lap, pace, consistency and mistakes"
          data-driver-id={FIELD_TAB_ID}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedId(FIELD_TAB_ID);
          }}
          className={cn(
            chipToggleClass(isFieldTab),
            "shrink-0 whitespace-nowrap px-2.5 py-1 text-[11px] font-semibold"
          )}
        >
          FIELD
        </button>
      ) : null}
      {drivers.map((driver) => {
        const active = driver.id === selectedId;
        const hue = driver.isUser ? RACE_IDENTITY.you : RACE_IDENTITY.competitor;
        const fullLabel = `P${driver.position} ${driver.name}${driver.isUser ? " · you" : ""}`;
        return (
          <button
            key={driver.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={fullLabel}
            title={fullLabel}
            data-driver-id={driver.id}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedId(driver.id);
            }}
            style={{
              // Your tab stays yellow even when unselected — your yellow trace is
              // still on every graph, so the tab keeps reading as "you". Identity
              // colour overrides the chip's default text colour.
              color: active ? hue : driver.isUser ? RACE_IDENTITY.you : undefined,
            }}
            className={cn(
              chipToggleClass(active),
              "relative shrink-0 overflow-hidden whitespace-nowrap px-2.5 py-1 text-[11px] font-semibold"
            )}
          >
            {active ? (
              // Identity-coloured top edge — ties the tab to its graph line.
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-[2px]"
                style={{ backgroundColor: hue }}
              />
            ) : null}
            {driverTabCode(driver)}
          </button>
        );
      })}
    </div>
  );

  return (
    <div
      className="space-y-3"
      style={{ touchAction: "pan-y" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        gestureRef.current = null;
      }}
      onClickCapture={onClickCapture}
    >
      {isFieldTab && fieldSheet ? (
        <>
          {/*
            The wells stay put on the FIELD tab carrying the field's averages, the
            same way they carry a competitor's figures on their tab — so the labels
            always describe whatever the tab is showing, and switching tabs never
            pulls the strip and sheet up the page.
          */}
          <FieldAverageWells sheet={fieldSheet} />
          <div className="min-w-0">
            {tabsNode}
            <RunFieldSheet sheet={fieldSheet} onSelectDriver={setSelectedId} />
          </div>
        </>
      ) : selected.isUser ? (
        <>
          {userStats}
          <div className="min-w-0">
            {tabsNode}
            {userLapCard}
          </div>
          {userGraph}
        </>
      ) : (
        <RaceFieldDriverPanel
          key={selected.id}
          driver={selected}
          userLapRows={userLapRows}
          tabs={tabsNode}
        />
      )}
    </div>
  );
}

/** Recomputed stats + laps + trace for a non-user driver from the same session. */
function RaceFieldDriverPanel({
  driver,
  userLapRows,
  tabs,
}: {
  driver: RaceFieldDriver;
  userLapRows: LapGraphRow[];
  /** The shared notebook-tab strip, dropped in above this driver's lap card. */
  tabs: ReactNode;
}) {
  // Graph mode: overlaid lap traces vs the running gap chart (design locked
  // 2026-07-19 — bars + sign-coloured cumulative line, raw gap math).
  const [graphMode, setGraphMode] = useState<"laps" | "gap">("laps");
  // Clean the raw timing-provider laps with the SAME median-band rule the app
  // applies to the user's own imported runs, so a competitor's grid/stats/graph
  // aren't polluted by start-line / transponder artifacts (e.g. an impossible
  // sub-median "best" lap). Excluded laps still render, struck through.
  const rows = useMemo(
    () => applyMedianBandAutoExclude(lapRowsFromTimesAndFlags(driver.laps)),
    [driver.laps]
  );
  const dash = useMemo(() => getIncludedLapDashboardMetrics(rows), [rows]);
  const mistakes = useMemo(() => computeMistakeLaps(rows), [rows]);
  const mistakeLapNumbers = useMemo(
    () => new Set(mistakes.mistakes.map((m) => m.lapNumber)),
    [mistakes.mistakes]
  );
  const mistakeDetailByLapNumber = useMemo(
    () => new Map(mistakes.mistakes.map((m) => [m.lapNumber, formatMistakeLapDetail(m)])),
    [mistakes.mistakes]
  );
  const bestLapNumbers = useMemo(() => {
    if (dash.bestLap == null) return new Set<number>();
    const eps = 0.0005;
    return new Set(
      getIncludedLaps(rows)
        .filter((l) => Math.abs(l.lapTimeSeconds - dash.bestLap!) <= eps)
        .map((l) => l.lapNumber)
    );
  }, [rows, dash.bestLap]);

  const chips: Array<{ label: string; value: string }> = [
    { label: "Laps", value: String(dash.lapCount) },
    { label: "Stint", value: dash.stintSeconds != null ? formatStintTime(dash.stintSeconds) : "—" },
    { label: "Best lap", value: formatLap(dash.bestLap) },
    { label: "Avg top 5", value: formatLap(dash.avgTop5) },
    { label: "Avg top 10", value: formatLap(dash.avgTop10) },
    { label: "Median", value: formatLap(dash.median) },
    {
      label: "Consist.",
      value:
        dash.consistencyScore != null ? formatConsistencyScorePercent(dash.consistencyScore) : "—",
    },
    { label: "Mistakes", value: mistakes.eligible ? String(mistakes.mistakeCount) : "—" },
  ];

  return (
    <div className="space-y-3">
      <StatWellGrid>
        {chips.map((chip) => (
          <StatWellCell key={chip.label} label={chip.label} value={chip.value} alignValue />
        ))}
      </StatWellGrid>

      <div className="min-w-0">
        {tabs}
        {rows.length > 0 ? (
          <div
            className={cn(
              "flex flex-wrap gap-x-3 gap-y-1.5 rounded-lg border border-border bg-background/40 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
              RUN_HISTORY_DATA_CLASS
            )}
          >
            {rows.map((r) => {
              const isMistake = mistakeLapNumbers.has(r.lapNumber);
              const isBest = bestLapNumbers.has(r.lapNumber);
              return (
                <span
                  key={r.lapNumber}
                  className={cn(
                    "inline-grid grid-cols-[2rem_auto] items-baseline gap-x-0.5 rounded px-0.5 tabular-nums",
                    !r.isIncluded && "opacity-50 line-through",
                    isMistake && "bg-red-600/55 text-white ring-1 ring-red-500/45",
                    isBest && !isMistake && "bg-purple-600/55 text-white ring-1 ring-purple-500/45"
                  )}
                  title={
                    !r.isIncluded
                      ? "Excluded (outlier)"
                      : isMistake
                        ? `${mistakeDetailByLapNumber.get(r.lapNumber)} vs median`
                        : isBest
                          ? "Best lap"
                          : undefined
                  }
                >
                  <span
                    className={cn(
                      "text-right",
                      isMistake || isBest ? "text-white/80" : "text-muted-foreground"
                    )}
                  >
                    {r.lapNumber}.
                  </span>
                  <span>{r.lapTimeSeconds.toFixed(3)}s</span>
                </span>
              );
            })}
          </div>
        ) : (
          <div className={cn(RUN_HISTORY_DATA_CLASS, "text-muted-foreground")}>—</div>
        )}
      </div>

      {rows.length >= 3 ? (
        <div className="space-y-1">
          {userLapRows.length >= 2 ? (
            <div
              className="flex gap-1"
              role="tablist"
              aria-label="Graph mode"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {(
                [
                  { mode: "laps", label: "Laps" },
                  { mode: "gap", label: "Gap" },
                ] as const
              ).map(({ mode, label }) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={graphMode === mode}
                  onClick={(e) => {
                    e.stopPropagation();
                    setGraphMode(mode);
                  }}
                  className={cn(chipToggleClass(graphMode === mode), "px-2.5 py-1 text-[11px]")}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          {graphMode === "gap" && userLapRows.length >= 2 ? (
            <>
              <LapGapGraph userRows={userLapRows} competitorRows={rows} />
              <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] leading-snug text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-0.5 w-3 rounded bg-[#4FD089]" />
                  you ahead
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-0.5 w-3 rounded bg-[#E5644E]" />
                  behind {driver.name}
                </span>
                <span>bars = each lap&apos;s gain/loss</span>
              </p>
            </>
          ) : (
            <>
              <LapTimeGraph
                rows={rows}
                bestLapNumbers={bestLapNumbers}
                mistakeLapNumbers={mistakeLapNumbers}
                mistakeDetailByLapNumber={mistakeDetailByLapNumber}
                medianSeconds={null}
                lineColor={RACE_IDENTITY.competitor}
                baseline={userLapRows.length >= 2 ? userLapRows : null}
                baselineColor={RACE_IDENTITY.you}
                baselineLabel="Your run"
              />
              {userLapRows.length >= 2 ? (
                <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] leading-snug text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="inline-block h-0.5 w-3 rounded"
                      style={{ backgroundColor: RACE_IDENTITY.competitor }}
                    />
                    {driver.name}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="inline-block h-0.5 w-3 rounded"
                      style={{ backgroundColor: RACE_IDENTITY.you }}
                    />
                    your run
                  </span>
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
