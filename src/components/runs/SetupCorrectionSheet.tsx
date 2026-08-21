"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEnterExit } from "@/components/ui/Collapse";
import { formatRunDateOnly, formatRunTimeOnly } from "@/lib/formatDate";
import { Button } from "@/components/ui/Button";

/**
 * "Did your other runs have this wrong too?"
 *
 * ============================== WHY THE QUESTION IS ASKED AT ALL ==============================
 *
 * A wrong number on a setup sheet is almost never wrong for one run — the driver
 * turned a screw at the track and didn't write it down, so every run logged after
 * that carries a value the car stopped having. Correcting them one at a time is
 * the same edit typed ten times, and the tenth gets skipped.
 *
 * It is a question and not an automatic cascade because the app cannot tell a
 * stale sheet from a real change. `lib/runs/setupCorrectionCascade` makes the best
 * guess it can and ticks those; the driver confirms.
 *
 * ============================== WHY EVERY LATER RUN IS LISTED ==============================
 *
 * Only some are ticked, but all are shown, with what each one currently says. A
 * picker that hid the runs it had decided against would be making the decision
 * while looking like it was asking — and the one case where the rule guesses wrong
 * (a run the driver hand-fixed weeks ago, beyond a change) is exactly the case that
 * would be invisible.
 *
 * ============================== AND WHY EARLIER RUNS ARE DIFFERENT ==============================
 *
 * Since 2026-08-21 the walk also runs backwards, because correcting the NEWEST run
 * on a car had nothing after it and so could never ask anything — which is exactly
 * when a driver has just noticed the sheet has been wrong for a while.
 *
 * Earlier runs sit above the divider and arrive UNTICKED, and the list stops at the
 * run where the value was last set on purpose. Forward, a run holding the old value
 * demonstrably inherited it. Backward, the app is guessing at intent — "it has been
 * wrong all along" and "I fixed this one run" look identical from here — so the
 * driver ticks (founder: "show them until the time it's changed, no tick").
 */

export type CorrectionCandidate = {
  runId: string;
  displayValue: string;
  holdsOldValue: boolean;
  alreadyCorrect: boolean;
  defaultPicked: boolean;
  occurredAtIso: string;
  sessionLabel: string;
  eventName: string | null;
  /** Which way this run sits from the one that was corrected. */
  side: "earlier" | "later";
  /** Where the walk stopped — this run's value was typed on purpose. */
  stopsWalk: boolean;
};

export type PendingCorrection = {
  runId: string;
  field: { key: string; label: string };
  previousDisplay: string;
  nextDisplay: string;
  candidates: CorrectionCandidate[];
  /** 1-based place in this save's queue of questions, when it moved more than one box. */
  queueIndex?: number;
  queueTotal?: number;
};

export function SetupCorrectionSheet({
  correction,
  displayTimeZone,
  onClose,
  onApply,
}: {
  /** Null keeps the sheet closed. */
  correction: PendingCorrection | null;
  displayTimeZone?: string | null;
  onClose: () => void;
  onApply: (runIds: string[]) => Promise<void>;
}) {
  const open = correction != null;
  const sheet = useEnterExit(open, 300);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const firstPickedRef = useRef<HTMLButtonElement | null>(null);

  // Each new correction starts from the rule's answer, not from whatever was
  // ticked the last time the sheet was open.
  useEffect(() => {
    if (!correction) return;
    const next: Record<string, boolean> = {};
    for (const c of correction.candidates) next[c.runId] = c.defaultPicked;
    setPicked(next);
    setError(null);
  }, [correction]);

  /*
   * Open onto the first run the rule ticked, not onto the top of the list.
   *
   * The runs immediately after the corrected one are often ones that already agree
   * — the driver hand-fixed a couple before giving up — and those are listed but
   * unticked. Left at the top, the sheet shows a screen of unticked rows under a
   * button claiming it will fix five, which reads as broken. Same reasoning, and
   * the same transform-proof `offsetTop` measurement, as `PickerSheet`.
   */
  useEffect(() => {
    if (!sheet.mounted) return;
    const list = listRef.current;
    const row = firstPickedRef.current;
    if (!list) return;
    if (!row) {
      list.scrollTop = 0;
      return;
    }
    list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 3);
  }, [sheet.mounted, correction]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const chosen = useMemo(
    () => (correction?.candidates ?? []).filter((c) => picked[c.runId]).map((c) => c.runId),
    [correction, picked]
  );

  /*
   * A ticked run holding some third value is the one genuinely destructive
   * outcome here, so it is counted and said out loud before the button is
   * pressed — not warned about afterwards.
   */
  const overwriteCount = useMemo(
    () =>
      (correction?.candidates ?? []).filter(
        (c) => picked[c.runId] && !c.holdsOldValue && !c.alreadyCorrect
      ).length,
    [correction, picked]
  );

  if (!sheet.mounted || typeof document === "undefined" || !correction) return null;

  const firstDefaultRunId = correction.candidates.find((c) => c.defaultPicked)?.runId ?? null;

  /*
   * Grouped by ADJACENCY, not by date. Runs arrive in `sortAt` order, and a driver
   * who logs a run, backfills an older one, then logs again produces the same day
   * twice — which is honest, and is why the group key carries its position rather
   * than just the date string.
   *
   * The group also breaks when the SIDE changes, so the "run you fixed" divider can
   * be drawn between them: a day that straddles the correction is two groups, which
   * is what lets the driver see that half of Sunday came before it.
   */
  const groups: Array<{
    key: string;
    day: string;
    side: "earlier" | "later";
    rows: CorrectionCandidate[];
  }> = [];
  for (const c of correction.candidates) {
    const day = formatRunDateOnly(new Date(c.occurredAtIso), displayTimeZone);
    const last = groups[groups.length - 1];
    if (last && last.day === day && last.side === c.side) last.rows.push(c);
    else groups.push({ key: `${day}#${groups.length}`, day, side: c.side, rows: [c] });
  }
  const hasEarlier = correction.candidates.some((c) => c.side === "earlier");

  async function apply() {
    if (chosen.length === 0 || applying) return;
    setApplying(true);
    setError(null);
    try {
      await onApply(chosen);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update those runs");
      setApplying(false);
    }
  }

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[70] flex items-end justify-center bg-black/50 transition-opacity duration-300 ease-out motion-reduce:transition-none sm:items-center",
        sheet.entered ? "opacity-100" : "opacity-0"
      )}
      role="dialog"
      aria-modal="true"
      // "other" once earlier runs can be listed — the accessible name is the only description
      // a screen reader gets, so it cannot promise a direction the sheet does not hold to.
      aria-label={`Apply the ${correction.field.label} correction to ${hasEarlier ? "other" : "later"} runs`}
      data-cascade-sheet
      onClick={onClose}
    >
      <div
        className={cn(
          "flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-card/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-16px_40px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl transition-transform duration-300 ease-out motion-reduce:transition-none sm:rounded-2xl sm:pb-2",
          "max-h-[min(85dvh,42rem)]",
          sheet.entered ? "translate-y-0" : "translate-y-full sm:translate-y-4"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-3 sm:hidden">
          <div className="mx-auto h-1 w-9 rounded-full bg-white/15" aria-hidden />
        </div>

        <div className="flex items-start justify-between gap-2 px-4 pb-2 pt-2.5">
          <div className="min-w-0">
            {/*
              "1 of 2" when the save corrected more than one box. Without it, answering the
              first question and being handed a second identical-looking sheet reads as the
              first one having failed.
            */}
            {correction.queueTotal && correction.queueTotal > 1 ? (
              <p className="pb-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-primary-ink">
                {correction.queueIndex ?? 1} of {correction.queueTotal}
              </p>
            ) : null}
            <h2 className="text-[15px] font-bold tracking-tight text-foreground">
              {hasEarlier ? "Did your other runs have this wrong too?" : "Did later runs have this wrong too?"}
            </h2>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[13px] text-muted-foreground">
              <span className="font-medium text-foreground">{correction.field.label}</span>
              <span className="tabular-nums line-through">{correction.previousDisplay}</span>
              <span aria-hidden>→</span>
              <span className="tabular-nums font-semibold text-foreground">
                {correction.nextDisplay}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="tap-active -mr-1 flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <X className="size-5" strokeWidth={2} aria-hidden />
          </button>
        </div>

        {/* `relative` makes this the offsetParent of every row, which is what lets
            the open-onto-the-first-tick effect above measure it. */}
        <div
          ref={listRef}
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2"
        >
          {groups.map((group, groupIndex) => (
            <div key={group.key}>
              <div className="px-1.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {group.day}
              </div>
              {group.rows.map((c) => {
                const on = Boolean(picked[c.runId]);
                const overwrites = !c.holdsOldValue && !c.alreadyCorrect;
                // The rule's first tick — where the sheet opens. Read off the plan,
                // not off `picked`, so unticking it can't move the scroll.
                const isFirstDefault = c.runId === firstDefaultRunId;
                return (
                  <button
                    key={c.runId}
                    ref={isFirstDefault ? firstPickedRef : undefined}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPicked((p) => ({ ...p, [c.runId]: !p[c.runId] }))}
                    /*
                     * Only the tick is yellow. Tinting the whole row put six yellow
                     * blocks on a 390px screen, and yellow is the app's ACTION colour
                     * — a selected row is a state, not an action. The border carries
                     * the selection instead.
                     */
                    className={cn(
                      "tap-active mb-1.5 flex w-full items-center gap-3 rounded-lg border px-2.5 py-2 text-left transition-colors",
                      on
                        ? "border-primary-ink/45 bg-card"
                        : "border-border bg-background/40 hover:bg-muted/50"
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"
                      )}
                    >
                      {on ? <Check className="size-3.5" strokeWidth={3} /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground">
                        {c.sessionLabel}
                      </span>
                      {/*
                        The time, not just the event. A day of testing is a column of
                        rows all reading "Testing run · TFTR", and a driver picking
                        which of them to correct cannot tell one from another without
                        something that differs.
                      */}
                      <span className="block truncate text-[11.5px] text-muted-foreground">
                        {[formatRunTimeOnly(new Date(c.occurredAtIso), displayTimeZone), c.eventName]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-right text-[11.5px] tabular-nums",
                        overwrites ? "font-semibold text-destructive" : "text-muted-foreground"
                      )}
                    >
                      {c.alreadyCorrect ? "already fixed" : `says ${c.displayValue}`}
                    </span>
                  </button>
                );
              })}
              {/*
                Why the list ends where it does. Only said on the earlier side, which is the
                only one that is truncated — forward, every run is listed anyway, so a note
                claiming the list stopped would be wrong.
              */}
              {group.side === "earlier" && group.rows.some((c) => c.stopsWalk) ? (
                <p className="px-1.5 pb-1.5 pt-0.5 text-[11px] leading-snug text-faint">
                  Older runs aren’t listed — this is where the value last changed on purpose.
                </p>
              ) : null}
              {/*
                The divider, marking where the list crosses the run that was corrected.

                Drawn after the LAST earlier group, whether or not later runs follow. It first
                only appeared between the two sides, which meant the case the backward walk
                exists for — correcting the newest run on a car, so there is no later side —
                got a column of forty sessions with nothing saying they were all before it
                (driven, 2026-08-21).
              */}
              {group.side === "earlier" && groups[groupIndex + 1]?.side !== "earlier" ? (
                <div className="flex items-center gap-2 px-1.5 pb-0.5 pt-3">
                  <span className="h-px flex-1 bg-primary-ink/30" aria-hidden />
                  <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-primary-ink">
                    the run you fixed
                  </span>
                  <span className="h-px flex-1 bg-primary-ink/30" aria-hidden />
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="border-t border-white/10 px-4 pt-2.5">
          <p className="pb-2 text-[11.5px] leading-snug text-muted-foreground">
            {overwriteCount > 0 ? (
              <span className="text-destructive">
                {overwriteCount} ticked {overwriteCount === 1 ? "run says" : "runs say"} something
                else — that value would be replaced.
              </span>
            ) : hasEarlier ? (
              "Runs before this one are listed but never ticked for you."
            ) : (
              "Runs logged before this one are never touched."
            )}
          </p>
          {error ? (
            <p role="alert" className="pb-2 text-[12px] text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2 pb-1">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={applying}>
              Just this run
            </Button>
            <Button
              type="button"
              /*
               * Loud only when pressing it would do something. With nothing ticked there is
               * no action to name, and a filled yellow button saying "None chosen" reads as
               * the primary door being broken rather than unarmed — which is now the RESTING
               * state of every backward-only correction, since earlier runs never self-tick.
               */
              variant={chosen.length === 0 ? "outline" : undefined}
              className="flex-1"
              onClick={() => void apply()}
              disabled={chosen.length === 0 || applying}
            >
              {/*
                "other", not "later", the moment earlier runs can be ticked — a button
                promising to fix later runs while the driver has ticked two from Saturday
                is the app describing something it is not about to do.
              */}
              {applying
                ? "Fixing…"
                : chosen.length === 0
                  ? "None chosen"
                  : `Fix ${chosen.length} ${hasEarlier ? "other" : "later"} ${
                      chosen.length === 1 ? "run" : "runs"
                    }`}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
