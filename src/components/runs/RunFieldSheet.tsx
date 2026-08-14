"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { formatLap, formatStintTime } from "@/lib/runLaps";
import {
  MIN_LAPS_FOR_FIELD_RANK,
  formatConsistencyScorePercent,
  getDeltaStyle,
  type FieldSheet,
  type FieldSheetRow,
} from "@/lib/lapAnalysis";
import { StatWellGrid, StatWellCell } from "@/components/runs/LapStatStrip";
import { RUN_HISTORY_DATA_CLASS } from "@/components/runs/runHistoryTableColumns";

/**
 * The whole race field in one table (Sessions expanded view, FIELD tab). Replaces
 * the three separate ranked lists other timing sites show (Pace / Consistency /
 * Best times) with one sheet whose column headers re-sort it — same three views,
 * without re-reading the same twelve names three times.
 *
 * Anchored on your row: it stays highlighted and in place while the sort changes
 * around it, and the two time columns tint by how each driver compares to you.
 * Tapping any row selects that driver's tab, so the sheet is the index page for
 * the lap-overlay / gap-chart compare that already exists.
 *
 * Design locked 2026-07-26 via artifact interview. Two rules from that review:
 *   · Tint follows the app's pace semantics — GREEN = faster, red = slower (see
 *     `getDeltaStyle`), not "red = a gap to close". Matches the column-compare grid.
 *   · Only the two seconds-valued columns tint. Consistency is a percentage and
 *     mistakes are a count, so `DELTA_MAX_ABS_RANGE` is meaningless for them and a
 *     per-metric tint scale would just make the sheet a rainbow. Both stay sortable.
 */

/**
 * Display surname: the last word longer than one letter, so a trailing member
 * flag ("Jordan Caruso M") doesn't become the name. Shared with the tab strip's
 * 3-letter codes so both derive the surname the same way.
 */
export function driverSurname(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return [...words].reverse().find((w) => w.length > 1) ?? words[words.length - 1] ?? "—";
}

/**
 * The stat wells above the tab strip, filled with field averages while the FIELD
 * tab is up. Keeps the same labels and geometry as the YOU and competitor tabs —
 * which already reuse this grid for whichever driver is selected — so switching
 * tabs never shifts the page, and the wells always describe what the tab is showing.
 *
 * Averages cover ranked drivers only; the count is in every cell's tooltip so the
 * figures can't be mistaken for one driver's.
 */
export function FieldAverageWells({ sheet }: { sheet: FieldSheet }) {
  const avg = sheet.averages;
  const over = `Field average across ${avg.driverCount} ranked car${avg.driverCount === 1 ? "" : "s"}`;
  const cells: Array<{ label: string; value: string }> = [
    { label: "Laps", value: avg.lapCount != null ? avg.lapCount.toFixed(1) : "—" },
    {
      label: "Stint",
      value: avg.stintSeconds != null ? formatStintTime(avg.stintSeconds) : "—",
    },
    { label: "Best lap", value: formatLap(avg.bestLap) },
    { label: "Avg top 5", value: formatLap(avg.avgTop5) },
    { label: "Avg top 10", value: formatLap(avg.avgTop10) },
    { label: "Median", value: formatLap(avg.median) },
    {
      label: "Consist.",
      value:
        avg.consistencyScore != null ? formatConsistencyScorePercent(avg.consistencyScore) : "—",
    },
    { label: "Mistakes", value: avg.mistakeCount != null ? avg.mistakeCount.toFixed(1) : "—" },
  ];

  return (
    <StatWellGrid>
      {cells.map((cell) => (
        <StatWellCell
          key={cell.label}
          label={cell.label}
          value={cell.value}
          title={`${cell.label} — ${over}`}
          alignValue
        />
      ))}
    </StatWellGrid>
  );
}

type SortKey = "position" | "best" | "pace" | "consistency" | "mistakes";

const COLUMNS: Array<{
  key: SortKey;
  label: string;
  title: string;
}> = [
  { key: "best", label: "Best", title: "Best single clean lap" },
  { key: "pace", label: "Pace", title: "Average of the 10 fastest clean laps" },
  {
    key: "consistency",
    label: "Cons",
    title: "Consistency: 100 − CV; higher = more consistent laps",
  },
  { key: "mistakes", label: "Mist", title: "Laps slower than the median by more than max(0.5s, 2 × IQR)" },
];

/** Sort value for a row, always "best first" ascending. Unranked rows sink to the bottom. */
function sortValue(row: FieldSheetRow, key: SortKey): number {
  switch (key) {
    case "position":
      return row.position;
    case "best":
      return row.bestLap ?? Infinity;
    case "pace":
      return row.pace ?? Infinity;
    case "consistency":
      // Higher score is better, so negate to keep the sort ascending.
      return row.consistencyScore == null ? Infinity : -row.consistencyScore;
    case "mistakes":
      return row.mistakeCount ?? Infinity;
  }
}

export function RunFieldSheet({
  sheet,
  onSelectDriver,
}: {
  sheet: FieldSheet;
  /** Selects that driver's tab in the pager — the lap overlay + gap chart. */
  onSelectDriver: (driverId: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("position");

  const you = sheet.you;

  // Purple marks the fastest lap of the session, matching the best-lap chip in the
  // lap grid. Only ranked drivers can hold it.
  const sessionBest = useMemo(() => {
    const values = sheet.rows
      .filter((r) => r.eligible && r.bestLap != null)
      .map((r) => r.bestLap!);
    return values.length > 0 ? Math.min(...values) : null;
  }, [sheet.rows]);

  const sorted = useMemo(() => {
    const rows = [...sheet.rows];
    rows.sort((a, b) => {
      // Unranked runs always sit at the bottom, whatever the sort.
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      const delta = sortValue(a, sortKey) - sortValue(b, sortKey);
      if (delta !== 0 && Number.isFinite(delta)) return delta;
      // Pace breaks ties, then classification order.
      const paceDelta = (a.pace ?? Infinity) - (b.pace ?? Infinity);
      if (paceDelta !== 0 && Number.isFinite(paceDelta)) return paceDelta;
      return a.position - b.position;
    });
    return rows;
  }, [sheet.rows, sortKey]);

  /** Tint a seconds-valued cell by how it compares to your time. */
  function timeCellStyle(value: number | null, yourValue: number | null, isUser: boolean) {
    if (isUser || value == null || yourValue == null) return undefined;
    return getDeltaStyle(value - yourValue);
  }

  return (
    // Stop pointer events reaching the driver-swipe handler so taps and header
    // sorts inside the sheet never get read as a horizontal page swipe.
    <div
      className="space-y-2"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {you ? (
        <p className={cn(RUN_HISTORY_DATA_CLASS, "text-muted-foreground")}>
          <span className="text-foreground">You</span>
          {you.rankByBest != null ? <> · best P{you.rankByBest}</> : null}
          {you.rankByPace != null ? <> · pace P{you.rankByPace}</> : null}
          {you.rankByConsistency != null ? <> · consist P{you.rankByConsistency}</> : null}
          {sheet.rankedCount > 0 ? <span className="text-faint"> of {sheet.rankedCount}</span> : null}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-background/40 px-2 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <table className="w-full border-collapse">
          <caption className="sr-only">
            Race field, sortable by best lap, pace, consistency and mistakes
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                aria-sort={sortKey === "position" ? "ascending" : "none"}
                className="w-6 pb-1.5 pl-1 text-left"
              >
                <button
                  type="button"
                  onClick={() => setSortKey("position")}
                  title="Finishing position — most laps, then lowest total time"
                  className={cn(
                    "table-col-header transition-colors",
                    sortKey === "position" ? "text-primary-ink" : "hover:text-foreground"
                  )}
                >
                  P
                </button>
              </th>
              <th scope="col" className="pb-1.5 pl-1 text-left">
                <span className="table-col-header">Driver</span>
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={sortKey === col.key ? "ascending" : "none"}
                  className="pb-1.5 pl-2 text-right"
                >
                  <button
                    type="button"
                    onClick={() => setSortKey(col.key)}
                    title={col.title}
                    className={cn(
                      "table-col-header whitespace-nowrap transition-colors",
                      sortKey === col.key ? "text-primary-ink" : "hover:text-foreground"
                    )}
                  >
                    {col.label}
                    {sortKey === col.key ? <span aria-hidden> ↓</span> : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const isSessionBest =
                sessionBest != null && row.bestLap != null && row.bestLap <= sessionBest + 1e-9;
              return (
                <tr
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`P${row.position} ${row.name}${row.isUser ? ", you" : ""}`}
                  title={`P${row.position} ${row.name}${row.isUser ? " · you" : ""}`}
                  onClick={() => onSelectDriver(row.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectDriver(row.id);
                    }
                  }}
                  className={cn(
                    "cursor-pointer border-t border-border/70 transition-colors",
                    row.isUser ? "bg-primary/[0.07]" : "hover:bg-muted/40"
                  )}
                >
                  <td
                    className={cn(
                      "py-1 pl-1 text-[10px] tabular-nums",
                      row.isUser ? "text-primary-ink" : "text-faint"
                    )}
                  >
                    {row.eligible ? row.position : "—"}
                  </td>
                  <td
                    className={cn(
                      "max-w-[6.5rem] truncate py-1 pl-1 text-[12px] font-medium tracking-tight",
                      row.isUser
                        ? "text-primary-ink"
                        : row.eligible
                          ? "text-foreground"
                          : "text-faint"
                    )}
                  >
                    {row.isUser ? "You" : driverSurname(row.name)}
                  </td>

                  {/* Best lap */}
                  <td className={cn(RUN_HISTORY_DATA_CLASS, "py-1 pl-2 text-right")}>
                    <span
                      className={cn(
                        "inline-block rounded px-1 py-px",
                        // Purple = fastest lap of the session, matching the best-lap
                        // chip in the lap grid — including when it's yours.
                        isSessionBest && "text-[rgb(var(--color-best-lap))]",
                        !row.eligible && "text-faint"
                      )}
                      style={timeCellStyle(row.bestLap, you?.bestLap ?? null, row.isUser)}
                    >
                      {formatLap(row.bestLap)}
                    </span>
                  </td>

                  {/* Pace — or the lap count for a run too short to rank */}
                  <td className={cn(RUN_HISTORY_DATA_CLASS, "py-1 pl-2 text-right")}>
                    {row.eligible ? (
                      <span
                        className="inline-block rounded px-1 py-px"
                        style={timeCellStyle(row.pace, you?.pace ?? null, row.isUser)}
                      >
                        {formatLap(row.pace)}
                      </span>
                    ) : (
                      <span
                        className="text-faint"
                        title={`Needs ${MIN_LAPS_FOR_FIELD_RANK} clean laps to be ranked`}
                      >
                        {row.lapCount} lap{row.lapCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </td>

                  {/* Consistency + mistakes — sortable, never tinted (see header note) */}
                  <td
                    className={cn(
                      RUN_HISTORY_DATA_CLASS,
                      "py-1 pl-2 text-right",
                      row.isUser ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {row.eligible && row.consistencyScore != null
                      ? formatConsistencyScorePercent(row.consistencyScore)
                      : "—"}
                  </td>
                  <td
                    className={cn(
                      RUN_HISTORY_DATA_CLASS,
                      "py-1 pl-2 pr-1 text-right",
                      row.isUser ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {row.mistakeCount != null ? row.mistakeCount : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] leading-snug text-muted-foreground">
        green = faster than you · red = slower · purple = session best
      </p>
    </div>
  );
}
