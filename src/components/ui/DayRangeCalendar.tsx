"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A month grid where one tap is a day and a second tap is a range.
 *
 * Lifted out of `EventDateRangeField` (2026-09-16) so "Import your last runs" could offer the
 * same calendar without a second sheet on top of its own. The picking rule is the one drivers
 * already know from the meeting-dates control: taps are sorted into start and end, so an end can
 * never land before its start, and once a range is settled the next tap starts a new one instead
 * of silently nudging an end the driver can no longer see.
 *
 * Everything is a `YYYY-MM-DD` string end to end. No `Date` maths in local time, so a day can't
 * slide for a driver east of UTC, which is every driver this app has.
 */

const LOCALE = "en-GB";
/** Monday-first, matching the en-GB calendars every club in range prints. */
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function isYmd(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function partsOf(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}

/** Midday UTC on that calendar day — a fixed point for formatting, never for arithmetic. */
export function utcNoon(ymd: string): Date {
  const { y, m, d } = partsOf(ymd);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function localTodayYmd(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Inclusive day span, e.g. the 1st to the 5th is 5 days. */
export function dayCount(startYmd: string, endYmd: string): number {
  const ms = utcNoon(endYmd).getTime() - utcNoon(startYmd).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export function fmtYmd(ymd: string, options: Intl.DateTimeFormatOptions): string {
  return utcNoon(ymd).toLocaleDateString(LOCALE, { ...options, timeZone: "UTC" });
}

/** The 42 cells of a month grid: `null` where the week runs outside it. */
function monthGrid(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  // getUTCDay is Sunday-first; shift so Monday leads the row.
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < 42; i += 1) {
    const day = i - lead + 1;
    cells.push(day >= 1 && day <= days ? `${year}-${pad(month)}-${pad(day)}` : null);
  }
  return cells;
}

export function DayRangeCalendar({
  startYmd,
  endYmd,
  onChange,
  minYmd = null,
  maxYmd = null,
  disabled = false,
  /** Changing this re-points the calendar at the selection and starts a fresh range. */
  resetKey,
  className,
}: {
  startYmd: string;
  endYmd: string;
  /** Always a valid pair: `end` is the same day for a one-day pick, never earlier than `start`. */
  onChange: (next: { startYmd: string; endYmd: string }) => void;
  /** Days outside these bounds are shown greyed, not hidden — the month keeps its shape. */
  minYmd?: string | null;
  maxYmd?: string | null;
  disabled?: boolean;
  resetKey?: string | number;
  className?: string;
}) {
  const start = isYmd(startYmd) ? startYmd : "";
  const end = isYmd(endYmd) ? endYmd : start;
  const today = useMemo(() => localTodayYmd(), []);

  /**
   * True once a range is settled, so the next tap starts a new one rather than stretching the
   * old one. Without it a third tap has no honest meaning.
   */
  const [settled, setSettled] = useState(true);
  const [cursor, setCursor] = useState(() => {
    const { y, m } = partsOf(start || today);
    return { y, m };
  });

  // Point at the month the selection is in when the calendar is (re)opened, not wherever last
  // month's browsing left off. Re-pointing is an open-time decision; later edits move the
  // selection, not the month, or picking day 1 of a range would scroll the second tap off screen.
  useEffect(() => {
    if (resetKey === undefined) return;
    setSettled(true);
    const { y, m } = partsOf(start || today);
    setCursor({ y, m });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const cells = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor]);
  const monthLabel = useMemo(
    () => fmtYmd(`${cursor.y}-${pad(cursor.m)}-01`, { month: "long", year: "numeric" }),
    [cursor],
  );

  function step(by: number) {
    setCursor((c) => {
      const next = c.m + by;
      if (next < 1) return { y: c.y - 1, m: 12 };
      if (next > 12) return { y: c.y + 1, m: 1 };
      return { y: c.y, m: next };
    });
  }

  function pick(day: string) {
    if (settled || !start) {
      onChange({ startYmd: day, endYmd: day });
      setSettled(false);
      return;
    }
    // The second tap is the other end, whichever side of the first it lands on.
    const next = day < start ? { startYmd: day, endYmd: start } : { startYmd: start, endYmd: day };
    onChange(next);
    setSettled(true);
  }

  // A month with nothing pickable in it is a dead end; the arrow that leads there is dropped.
  const monthFloor = `${cursor.y}-${pad(cursor.m)}-01`;
  const monthCeiling = `${cursor.y}-${pad(cursor.m)}-31`;
  const canStepBack = !minYmd || minYmd < monthFloor;
  const canStepForward = !maxYmd || maxYmd > monthCeiling;

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center justify-between gap-2 py-1">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={disabled || !canStepBack}
          aria-label="Previous month"
          className="tap-active flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted disabled:opacity-30"
        >
          <ChevronLeft className="size-5" strokeWidth={2} aria-hidden />
        </button>
        <span aria-live="polite" className="min-w-0 truncate text-[13px] font-semibold text-foreground">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={disabled || !canStepForward}
          aria-label="Next month"
          className="tap-active flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted disabled:opacity-30"
        >
          <ChevronRight className="size-5" strokeWidth={2} aria-hidden />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 pb-1">
        {WEEKDAYS.map((d, i) => (
          <div
            key={i}
            aria-hidden
            className="py-1 text-center text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (!day) return <div key={i} aria-hidden />;
          const outOfReach = Boolean((minYmd && day < minYmd) || (maxYmd && day > maxYmd));
          const isStart = day === start;
          const isEnd = day === end;
          const inRange = Boolean(start) && day > start && day < end;
          const isEdge = isStart || isEnd;
          return (
            <button
              key={i}
              type="button"
              onClick={() => pick(day)}
              disabled={disabled || outOfReach}
              aria-pressed={isEdge || inRange}
              aria-label={fmtYmd(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              className={cn(
                "tap-active flex h-10 items-center justify-center rounded-md text-[13px] tabular-nums transition-colors",
                isEdge
                  ? "primary-face bg-primary font-bold text-primary-foreground"
                  : inRange
                    ? "bg-primary/15 font-semibold text-foreground"
                    : "text-foreground hover:bg-muted/60",
                // Today is a hint, never a selection — the ring drops the moment it is one.
                !isEdge && day === today && "ring-1 ring-inset ring-primary-ink/45",
                outOfReach && "pointer-events-none text-faint opacity-40",
              )}
            >
              {partsOf(day).d}
            </button>
          );
        })}
      </div>
    </div>
  );
}
