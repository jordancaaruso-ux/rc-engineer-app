"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatLap } from "@/lib/runLaps";
import { cn } from "@/lib/utils";
import {
  SHEET_CARD_CLASS,
  SHEET_PILL_OUTLINE,
  SHEET_PILL_PRIMARY,
  SHEET_SCRIM_CLASS,
} from "@/components/ui/ExitPromptSheet";

/**
 * "N other runs from today aren't logged" — the sheet that opens the moment a driver's session
 * lands on the run they are logging and the timing site has more of theirs from the same day.
 *
 * Its whole job is to be impossible to miss AND impossible to confuse with the other door on
 * this step. Once a session is on the run, every other row in the list offers to add its LAPS
 * to this run (a run split by a break). This sheet offers whole RUNS beside it, so it lists the
 * sessions in full — date, time, laps, best — and says "as runs" on the button; never "import",
 * never "add".
 *
 * Every row is ticked to start with and can be unticked: a two-lap false start or a mate's go on
 * the car is not a run the driver wants in their log. The button counts what is ticked.
 *
 * "Not now" is remembered on the device (see `backfillDeclined.ts`); tapping the scrim is not.
 */
export type BackfillOfferSheetSession = {
  sessionUrl: string;
  when: string | null;
  lapCount: number | null;
  bestLapSeconds: number | null;
};

export function BackfillOfferSheet({
  open,
  dayWord,
  sessions,
  onAccept,
  onDecline,
  onDismiss,
}: {
  open: boolean;
  /** "today", or the day's label when the picked session is older. */
  dayWord: string;
  sessions: readonly BackfillOfferSheetSession[];
  /** The sessions still ticked when the driver said yes. Never called with an empty list. */
  onAccept: (selectedUrls: string[]) => void;
  onDecline: () => void;
  onDismiss: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Everything ticked each time the sheet opens — the offer is "log the day", opting out is the edit.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (open) setSelected(new Set(sessions.map((s) => s.sessionUrl)));
  }, [open, sessions]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);

  if (!mounted || !open || sessions.length === 0) return null;

  const total = sessions.length;
  const title = `${total} other ${total === 1 ? "run" : "runs"} from ${dayWord} ${total === 1 ? "isn't" : "aren't"} logged`;
  const count = sessions.filter((s) => selected.has(s.sessionUrl)).length;
  const acceptLabel =
    count === 0
      ? "Log them as runs"
      : count === total
        ? total === 1
          ? "Log it as a run"
          : `Log them as ${total} runs`
        : `Log ${count} of ${total} as ${count === 1 ? "a run" : "runs"}`;

  const toggle = (url: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });

  return createPortal(
    <>
      <div className={SHEET_SCRIM_CLASS} onClick={onDismiss} aria-hidden />
      <div className={SHEET_CARD_CLASS} role="dialog" aria-modal="true" aria-label={title}>
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-border" aria-hidden />
        <div className="pb-1 text-center font-sans text-[14px] font-bold tracking-tight text-foreground text-balance">
          {title}
        </div>
        <div className="pb-3 text-center font-sans text-[11px] text-muted-foreground">
          Marked unconfirmed until you check {total === 1 ? "it" : "them"}.
        </div>
        {/* The day in order, so a driver can tell "runs 2 and 3" from the times alone. Scrolls
            inside itself: a nine-heat club day must not push the buttons off the phone. */}
        <ul className="mb-3 max-h-[38vh] space-y-1 overflow-y-auto">
          {sessions.map((s) => {
            const on = selected.has(s.sessionUrl);
            const line = [
              s.when ?? "Time unknown",
              s.lapCount != null ? `${s.lapCount} lap${s.lapCount === 1 ? "" : "s"}` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={s.sessionUrl}>
                <label
                  className={cn(
                    "flex cursor-pointer select-none items-center gap-2.5 rounded-md border border-border bg-surface-runna px-2.5 py-2 transition",
                    !on && "opacity-60"
                  )}
                >
                  <input
                    type="checkbox"
                    className="shrink-0 accent-primary"
                    checked={on}
                    onChange={() => toggle(s.sessionUrl)}
                    aria-label={line}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">{line}</span>
                  {s.bestLapSeconds != null ? (
                    <span className="flex shrink-0 items-baseline gap-1 leading-tight">
                      <span className="text-[9px] font-medium uppercase tracking-wide text-faint">Best</span>
                      <span className="fig-stat text-[12px] font-medium text-foreground">
                        {formatLap(s.bestLapSeconds)}
                      </span>
                    </span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
        <div className="grid gap-2">
          <button
            type="button"
            className={cn(SHEET_PILL_PRIMARY, count === 0 && "pointer-events-none opacity-50")}
            disabled={count === 0}
            onClick={() => onAccept(sessions.filter((s) => selected.has(s.sessionUrl)).map((s) => s.sessionUrl))}
          >
            {acceptLabel}
          </button>
          <button type="button" className={SHEET_PILL_OUTLINE} onClick={onDecline}>
            Not now
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
