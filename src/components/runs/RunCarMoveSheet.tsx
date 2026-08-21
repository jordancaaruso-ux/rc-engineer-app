"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const PILL_BASE =
  "w-full rounded-xl px-4 py-3 text-center font-sans text-[13px] font-semibold transition-colors";

/**
 * "Move this run to another car?" — asked before it happens, not reported after.
 *
 * ============================== WHY THIS ONE GETS A QUESTION ==============================
 *
 * Every other correction on the session view is worth exactly itself: a wrong additive
 * is a wrong additive. The car is not — it is the axis the rest of the run hangs off.
 * Moving it takes the setup snapshot with it (a copy, onto the new car, or the run would
 * show numbers whose every door 404s), and it changes what "Setup vs previous run" is
 * comparing against, because the previous run is now a different car's.
 *
 * The founder's call was "editable, with a warning" (2026-08-20) — the point being that
 * the warning names what else moves. A generic "are you sure?" would be worse than none:
 * it asks for a decision without supplying anything to decide with.
 *
 * The tires deliberately do NOT move and the sheet says so, because a driver who reads
 * "your setup moves" reasonably assumes everything does. Rubber is physical and bolts on
 * to whatever is on the bench — `planCarSwap` already says so for the live form, and a
 * correction that disagreed with the form would be the app contradicting itself.
 */
export function RunCarMoveSheet({
  open,
  fromCarName,
  toCarName,
  hasSetup,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  fromCarName: string;
  toCarName: string;
  /** Whether this run carries a setup at all — a run logged without one moves nothing. */
  hasSetup: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!mounted || !open) return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/50"
        onClick={() => !busy && onCancel()}
        aria-hidden
      />
      <div
        className="fixed inset-x-0 bottom-0 z-[61] mx-auto w-full max-w-md rounded-t-[22px] border-t border-border bg-muted px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-24px_60px_-12px_rgba(0,0,0,0.55)]"
        role="dialog"
        aria-modal="true"
        aria-label={`Move this run to ${toCarName}?`}
      >
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-border" aria-hidden />
        <div className="pb-1 text-center font-sans text-[14px] font-bold tracking-tight text-foreground">
          Move this run to {toCarName}?
        </div>
        <ul className="mx-auto max-w-[22rem] list-disc space-y-1 pb-3 pl-5 pt-1 text-left font-sans text-[11.5px] leading-relaxed text-muted-foreground">
          {hasSetup ? (
            <li>
              Its setup moves too — a copy lands in {toCarName}’s setups, so the run keeps the
              numbers it was logged with.
            </li>
          ) : (
            <li>This run has no setup recorded, so there is nothing to move with it.</li>
          )}
          <li>
            “Setup vs previous run” will compare against {toCarName}’s last run instead of{" "}
            {fromCarName}’s.
          </li>
          <li>The tires and their run number stay exactly as they are.</li>
        </ul>
        {error ? (
          <div role="alert" className="pb-3 text-center font-sans text-[11px] text-destructive">
            {error}
          </div>
        ) : null}
        <div className="grid gap-2">
          <button
            type="button"
            className={cn(
              PILL_BASE,
              "bg-primary text-primary-foreground hover:brightness-105",
              busy && "pointer-events-none opacity-60"
            )}
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? "Moving…" : `Move it to ${toCarName}`}
          </button>
          <button
            type="button"
            className={cn(PILL_BASE, "border border-border bg-background text-foreground hover:bg-muted/80")}
            onClick={onCancel}
          >
            Leave it on {fromCarName}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
