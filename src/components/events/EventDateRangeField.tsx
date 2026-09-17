"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEnterExit } from "@/components/ui/Collapse";
import { PickerTrigger } from "@/components/ui/PickerSheet";
import {
  DayRangeCalendar,
  dayCount,
  fmtYmd,
  isYmd,
  partsOf,
} from "@/components/ui/DayRangeCalendar";

/**
 * When a meeting runs — one control, not two date boxes.
 *
 * A club race is one day and a big meeting is a weekend, and the old pair of `<input type="date">`
 * made the driver answer that twice: open a wheel, spin to the day, then do the whole thing again
 * for an end date that is usually the same day they just picked (founder 2026-09-03). Here one tap
 * on a day *is* a one-day event, and a second tap on a later day stretches it to a range.
 *
 * The grid itself is `DayRangeCalendar` (lifted out 2026-09-16 so "Import your last runs" could
 * show the same calendar inline); this file is the field, its sheet, and the summary line.
 */

/**
 * "3 Sept 2026", or "1 – 5 Nov 2026" with the parts both ends share said once. Drivers read
 * these on a card, not in a form, so the range that spans a month or a new year spells both
 * halves out rather than leaving them to infer it.
 */
export function formatEventDateRange(startYmd: string, endYmd: string): string {
  if (!isYmd(startYmd)) return "";
  if (!isYmd(endYmd) || endYmd === startYmd) {
    return fmtYmd(startYmd, { day: "numeric", month: "short", year: "numeric" });
  }
  const a = partsOf(startYmd);
  const b = partsOf(endYmd);
  const end = fmtYmd(endYmd, { day: "numeric", month: "short", year: "numeric" });
  if (a.y !== b.y) {
    return `${fmtYmd(startYmd, { day: "numeric", month: "short", year: "numeric" })} – ${end}`;
  }
  if (a.m !== b.m) return `${fmtYmd(startYmd, { day: "numeric", month: "short" })} – ${end}`;
  return `${a.d} – ${end}`;
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
  /** Bumped on every open so the calendar re-points at the selection and starts a fresh range. */
  const [opens, setOpens] = useState(0);

  const start = isYmd(startYmd) ? startYmd : "";
  const end = isYmd(endYmd) ? endYmd : start;

  const summary = useMemo(() => (start ? formatEventDateRange(start, end) : ""), [start, end]);
  const span = start && end !== start ? dayCount(start, end) : 1;

  return (
    <div className={cn("min-w-0", className)}>
      <label className="mb-1 block text-[11px] text-muted-foreground">{label}</label>
      <PickerTrigger
        onClick={() => {
          setOpens((n) => n + 1);
          setOpen(true);
        }}
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

                <DayRangeCalendar
                  startYmd={start}
                  endYmd={end}
                  onChange={onChange}
                  resetKey={opens}
                  className="px-3 pb-2"
                />

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
