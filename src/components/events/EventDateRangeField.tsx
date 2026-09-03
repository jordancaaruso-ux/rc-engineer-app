"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEnterExit } from "@/components/ui/Collapse";
import { PickerTrigger } from "@/components/ui/PickerSheet";

/**
 * When a meeting runs — one control, not two date boxes.
 *
 * A club race is one day and a big meeting is a weekend, and the old pair of `<input type="date">`
 * made the driver answer that twice: open a wheel, spin to the day, then do the whole thing again
 * for an end date that is usually the same day they just picked (founder 2026-09-03). Here one tap
 * on a day *is* a one-day event, and a second tap on a later day stretches it to a range. There is
 * no invalid state to warn about either: taps are sorted into start and end, so an end can never
 * land before its start.
 *
 * Everything is a `YYYY-MM-DD` string end to end — the same shape the date inputs emitted and the
 * API still takes. No `Date` maths in local time, so a meeting can't slide a day for a driver who
 * is east of UTC, which is every driver this app has.
 */

const LOCALE = "en-GB";
/** Monday-first, matching the en-GB calendars every club in range prints. */
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isYmd(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function partsOf(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}

/** Midday UTC on that calendar day — a fixed point for formatting, never for arithmetic. */
function utcNoon(ymd: string): Date {
  const { y, m, d } = partsOf(ymd);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function localTodayYmd(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Inclusive day span, e.g. the 1st to the 5th is 5 days. */
function dayCount(startYmd: string, endYmd: string): number {
  const ms = utcNoon(endYmd).getTime() - utcNoon(startYmd).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

function fmt(ymd: string, options: Intl.DateTimeFormatOptions): string {
  return utcNoon(ymd).toLocaleDateString(LOCALE, { ...options, timeZone: "UTC" });
}

/**
 * "3 Sept 2026", or "1 – 5 Nov 2026" with the parts both ends share said once. Drivers read
 * these on a card, not in a form, so the range that spans a month or a new year spells both
 * halves out rather than leaving them to infer it.
 */
export function formatEventDateRange(startYmd: string, endYmd: string): string {
  if (!isYmd(startYmd)) return "";
  if (!isYmd(endYmd) || endYmd === startYmd) {
    return fmt(startYmd, { day: "numeric", month: "short", year: "numeric" });
  }
  const a = partsOf(startYmd);
  const b = partsOf(endYmd);
  const end = fmt(endYmd, { day: "numeric", month: "short", year: "numeric" });
  if (a.y !== b.y) {
    return `${fmt(startYmd, { day: "numeric", month: "short", year: "numeric" })} – ${end}`;
  }
  if (a.m !== b.m) return `${fmt(startYmd, { day: "numeric", month: "short" })} – ${end}`;
  return `${a.d} – ${end}`;
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

export function EventDateRangeField({
  startYmd,
  endYmd,
  onChange,
  label = "Dates",
  placeholder = "Pick the dates",
  triggerClassName,
  className,
}: {
  startYmd: string;
  endYmd: string;
  /** Always a valid pair: `end` is the same day for a one-day meeting, never earlier than `start`. */
  onChange: (next: { startYmd: string; endYmd: string }) => void;
  label?: string;
  placeholder?: string;
  /** Surface classes for the closed field — call sites match the card they sit in. */
  triggerClassName?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const sheet = useEnterExit(open, 300);
  /**
   * True once a range is settled, so the next tap starts a new one rather than stretching the
   * old one. Without it a third tap has no honest meaning — the driver would be nudging one end
   * of a range they can no longer see the shape of.
   */
  const [settled, setSettled] = useState(true);

  const start = isYmd(startYmd) ? startYmd : "";
  const end = isYmd(endYmd) ? endYmd : start;
  const today = useMemo(() => localTodayYmd(), []);

  const [cursor, setCursor] = useState(() => {
    const from = start || today;
    const { y, m } = partsOf(from);
    return { y, m };
  });

  // Open on the month the meeting is in, not wherever last month's browsing left off.
  useEffect(() => {
    if (!open) return;
    setSettled(true);
    const from = start || today;
    const { y, m } = partsOf(from);
    setCursor({ y, m });
    // Re-pointing the calendar is an open-time decision; later edits move the selection, not
    // the month, or picking day 1 of a range would scroll the second tap off screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cells = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor]);
  const monthLabel = useMemo(
    () => fmt(`${cursor.y}-${pad(cursor.m)}-01`, { month: "long", year: "numeric" }),
    [cursor]
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

  const summary = start ? formatEventDateRange(start, end) : "";
  const span = start && end !== start ? dayCount(start, end) : 1;

  return (
    <div className={cn("min-w-0", className)}>
      <label className="mb-1 block text-[11px] text-muted-foreground">{label}</label>
      <PickerTrigger
        onClick={() => setOpen(true)}
        open={open}
        aria-label={label}
        placeholder={!start}
        className={cn("form-control", triggerClassName)}
      >
        {summary || placeholder}
      </PickerTrigger>

      {sheet.mounted
        ? createPortal(
            // Portalled for the same reason as PickerSheet: these forms sit inside cards, and a
            // transformed ancestor turns `fixed` into `absolute` and strands the sheet mid-page.
            <div
              className={cn(
                "fixed inset-0 z-[70] flex items-end justify-center bg-black/50 transition-opacity duration-300 ease-out motion-reduce:transition-none sm:items-center",
                sheet.entered ? "opacity-100" : "opacity-0"
              )}
              role="dialog"
              aria-modal="true"
              aria-label={label}
              onClick={() => setOpen(false)}
            >
              <div
                className={cn(
                  "flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-card/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-16px_40px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl transition-transform duration-300 ease-out motion-reduce:transition-none sm:rounded-2xl sm:pb-2",
                  sheet.entered ? "translate-y-0" : "translate-y-full sm:translate-y-4"
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-4 pt-3 sm:hidden">
                  <div className="mx-auto h-1 w-9 rounded-full bg-white/15" aria-hidden />
                </div>
                <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-2.5">
                  <h2 className="min-w-0 truncate text-[15px] font-bold tracking-tight text-foreground">
                    {label}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                    className="tap-active -mr-1 flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                  >
                    <X className="size-5" strokeWidth={2} aria-hidden />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2 px-4 py-1">
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    aria-label="Previous month"
                    className="tap-active flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                  >
                    <ChevronLeft className="size-5" strokeWidth={2} aria-hidden />
                  </button>
                  <span
                    aria-live="polite"
                    className="min-w-0 truncate text-[13px] font-semibold text-foreground"
                  >
                    {monthLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    aria-label="Next month"
                    className="tap-active flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                  >
                    <ChevronRight className="size-5" strokeWidth={2} aria-hidden />
                  </button>
                </div>

                <div className="grid grid-cols-7 gap-0.5 px-3 pb-1">
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

                <div className="grid grid-cols-7 gap-0.5 px-3 pb-2">
                  {cells.map((day, i) => {
                    if (!day) return <div key={i} aria-hidden />;
                    const isStart = day === start;
                    const isEnd = day === end;
                    const inRange = Boolean(start) && day > start && day < end;
                    const isEdge = isStart || isEnd;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => pick(day)}
                        aria-pressed={isEdge || inRange}
                        aria-label={fmt(day, {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                        className={cn(
                          "tap-active flex h-10 items-center justify-center rounded-md text-[13px] tabular-nums transition-colors",
                          isEdge
                            ? "primary-face bg-primary font-bold text-primary-foreground"
                            : inRange
                              ? "bg-primary/15 font-semibold text-foreground"
                              : "text-foreground hover:bg-muted/60",
                          // Today is a hint, never a selection — the ring drops the moment it is one.
                          !isEdge && day === today && "ring-1 ring-inset ring-primary-ink/45"
                        )}
                      >
                        {partsOf(day).d}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-border px-4 pb-1 pt-2.5">
                  <span className="min-w-0 truncate text-[12px] text-foreground">
                    {summary ? (
                      <>
                        <span className="font-semibold">{summary}</span>
                        {span > 1 ? (
                          <span className="text-muted-foreground"> · {span} days</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-muted-foreground">{placeholder}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="tap-active shrink-0 rounded-md primary-face bg-primary px-3.5 py-1.5 text-[12px] font-semibold text-primary-foreground transition hover:brightness-95"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
