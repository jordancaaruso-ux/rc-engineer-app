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
import { formatLap, formatStintTime } from "@/lib/runLaps";
import {
  computeMistakeLaps,
  formatConsistencyScorePercent,
  formatMistakeLapDetail,
  getIncludedLapDashboardMetrics,
  getIncludedLaps,
  lapRowsFromTimesAndFlags,
} from "@/lib/lapAnalysis";
import { applyMedianBandAutoExclude } from "@/lib/lapImport/autoExcludeOutlierLaps";
import { LapTimeGraph, type LapGraphRow } from "@/components/runs/LapTimeGraph";
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

export function RunRaceFieldSwitcher({
  runId,
  userView,
  userLapRows,
  enabled = true,
}: {
  runId: string;
  /** The existing single-run stats + laps + graph block, rendered untouched for your tab. */
  userView: ReactNode;
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
      if (Math.abs(dx) < COMMIT_DISTANCE || selectedIndex < 0) return;
      // Dragging left reveals the next (worse-placed) driver, matching PagedCard.
      goTo(selectedIndex + (dx < 0 ? 1 : -1));
    },
    [goTo, selectedIndex]
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

  return (
    <div className="space-y-2">
      <div
        ref={tabsRef}
        className="flex gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label="Race field"
      >
        {drivers.map((driver) => {
          const active = driver.id === selectedId;
          return (
            <button
              key={driver.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-driver-id={driver.id}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedId(driver.id);
              }}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors",
                active
                  ? "border-ring/45 bg-muted text-foreground"
                  : "border-border bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              P{driver.position} {driver.name}
              {driver.isUser ? " · you" : ""}
            </button>
          );
        })}
      </div>

      <div
        style={{ touchAction: "pan-y" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          gestureRef.current = null;
        }}
        onClickCapture={onClickCapture}
      >
        {selected.isUser ? (
          userView
        ) : (
          <RaceFieldDriverPanel key={selected.id} driver={selected} userLapRows={userLapRows} />
        )}
      </div>
    </div>
  );
}

/** Recomputed stats + laps + trace for a non-user driver from the same session. */
function RaceFieldDriverPanel({
  driver,
  userLapRows,
}: {
  driver: RaceFieldDriver;
  userLapRows: LapGraphRow[];
}) {
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
      label: "Consistency",
      value:
        dash.consistencyScore != null ? formatConsistencyScorePercent(dash.consistencyScore) : "—",
    },
    { label: "Mistakes", value: mistakes.eligible ? String(mistakes.mistakeCount) : "—" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 md:gap-1.5">
        {chips.map((chip) => (
          <div
            key={chip.label}
            className="min-w-0 rounded border border-border bg-muted/80 px-1.5 py-0.5 text-left md:min-w-[4.5rem] md:px-2 md:py-1"
          >
            <div className="ui-label-caps mb-0.5 text-[9px] leading-none">{chip.label}</div>
            <div className={RUN_HISTORY_DATA_CLASS}>{chip.value}</div>
          </div>
        ))}
      </div>

      <div className="min-w-0 space-y-1">
        <div className="ui-label-caps">All laps ({rows.length})</div>
        {rows.length > 0 ? (
          <div
            className={cn(
              "flex flex-wrap gap-x-2 gap-y-1 rounded border border-border bg-muted/60 px-2 py-1.5",
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
          <div className="ui-label-caps">Lap graph</div>
          <LapTimeGraph
            rows={rows}
            bestLapNumbers={bestLapNumbers}
            mistakeLapNumbers={mistakeLapNumbers}
            mistakeDetailByLapNumber={mistakeDetailByLapNumber}
            medianSeconds={dash.median ?? null}
            baseline={userLapRows.length >= 2 ? userLapRows : null}
            baselineLabel="Your run"
          />
          {userLapRows.length >= 2 ? (
            <p className="text-[10px] leading-snug text-muted-foreground">
              Solid = {driver.name} · dashed = your run
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
