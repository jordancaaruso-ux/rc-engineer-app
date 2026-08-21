"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { RunAdditiveTimingPanel } from "@/components/runs/RunAdditiveTimingPanel";
import { pruneTirePrepForSave, type TirePrepStep } from "@/lib/runs/tirePrep";

const PILL_BASE =
  "w-full rounded-xl px-4 py-3 text-center font-sans text-[13px] font-semibold transition-colors";

/**
 * Correcting the tire prep on a logged run, without leaving it.
 *
 * ============================== WHY A SHEET AND NOT A BOX ==============================
 *
 * Every other correction on the session view is one value with one control, so it lives in
 * the stat well it belongs to. Prep is not one value: it is up to three ordered applications,
 * each carrying additive-or-not, minutes, bench-or-warmers, towels and a temperature. That is
 * a panel, and a panel does not fit in a `StatWellCell` on a 390px screen.
 *
 * Until 2026-08-21 the answer was a link into the log-run wizard's prep step, which promised
 * a `?back=` return that nothing read — so correcting the prep dumped the driver on the
 * dashboard. The founder's call was that prep should be fixable "from within session details",
 * so the control comes to the run instead of the run going to the control.
 *
 * ============================== WHY IT HOSTS THE WIZARD'S OWN PANEL ==============================
 *
 * `RunAdditiveTimingPanel` is already fully controlled — it holds no state of its own beyond
 * which slider drawer is open. Hosting it unchanged means there is exactly ONE prep control in
 * the product; a second copy built for this sheet would drift from the one drivers learn while
 * logging, and every future change to prep would have to be made twice.
 *
 * ============================== WHY THE ADDITIVE COMES WITH IT ==============================
 *
 * A step's "did you re-apply?" is meaningless without knowing what was applied, so the panel
 * carries both and this sheet saves both in one PATCH. The Additive stat well keeps its own
 * one-tap picker — swapping the additive alone is the common correction and should not cost a
 * sheet — and the two write the same field through the same route.
 *
 * `controlAdditive` is deliberately NOT passed. That lock exists so an event can mandate a spec
 * additive while the run is being logged; this run already recorded what it actually ran, and
 * its event is fixed, so the free picker is the honest control here.
 *
 * ============================== DRAFT, THEN SAVE ==============================
 *
 * Edits are held locally and committed on Save, unlike the inline cells which write on blur.
 * Prep is a shape rather than a value — adding an application and then setting its minutes is
 * two edits that only mean something together, and writing after each one would stamp a
 * half-built step onto the run.
 */
export function TirePrepSheet({
  open,
  initialSteps,
  initialAdditiveTypeId,
  busy = false,
  error,
  onSave,
  onCancel,
}: {
  open: boolean;
  initialSteps: TirePrepStep[];
  /** "" when the run recorded no additive. */
  initialAdditiveTypeId: string;
  busy?: boolean;
  error?: string | null;
  onSave: (next: { tirePrep: TirePrepStep[]; additiveTypeId: string }) => void;
  onCancel: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [steps, setSteps] = useState<TirePrepStep[]>(initialSteps);
  const [additiveTypeId, setAdditiveTypeId] = useState(initialAdditiveTypeId);

  /*
   * Re-seed from the run every time the sheet opens. The panel is mounted by the run view and
   * is not unmounted between opens, so without this a driver who edited, cancelled, and opened
   * it again would be met with the edits they had just thrown away.
   */
  useEffect(() => {
    if (!open) return;
    setSteps(initialSteps);
    setAdditiveTypeId(initialAdditiveTypeId);
  }, [open, initialSteps, initialAdditiveTypeId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, busy, onCancel]);

  if (!mounted || !open) return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/50"
        onClick={() => !busy && onCancel()}
        aria-hidden
      />
      {/*
        Capped and scrollable rather than sized to its content: three applications with both
        sliders open is taller than a phone, and the save buttons must stay reachable.
      */}
      <div
        className="fixed inset-x-0 bottom-0 z-[61] mx-auto flex max-h-[88svh] w-full max-w-md flex-col rounded-t-[22px] border-t border-border bg-muted px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-24px_60px_-12px_rgba(0,0,0,0.55)]"
        role="dialog"
        aria-modal="true"
        aria-label="Change this run's tire prep"
      >
        <div className="mx-auto mb-2 h-1 w-9 flex-none rounded-full bg-border" aria-hidden />
        <div className="flex-none pb-1 text-center font-sans text-[14px] font-bold tracking-tight text-foreground">
          Tire prep for this run
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-2">
          <RunAdditiveTimingPanel
            additiveTypeId={additiveTypeId}
            onAdditiveTypeIdChange={setAdditiveTypeId}
            tirePrep={steps}
            onTirePrepChange={setSteps}
          />
        </div>

        {error ? (
          <div
            role="alert"
            className="flex-none pb-2 text-center font-sans text-[11px] text-destructive"
          >
            {error}
          </div>
        ) : null}

        <div className="grid flex-none gap-2 pt-1">
          <button
            type="button"
            className={cn(
              PILL_BASE,
              "bg-primary text-primary-foreground hover:brightness-105",
              busy && "pointer-events-none opacity-60"
            )}
            /*
             * Pruned on the way out, the same call the log-run form makes: an application the
             * driver added and then left blank is an unfinished thought, not a record of
             * nothing happening.
             */
            onClick={() =>
              onSave({ tirePrep: pruneTirePrepForSave(steps), additiveTypeId })
            }
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? "Saving…" : "Save prep"}
          </button>
          <button
            type="button"
            className={cn(
              PILL_BASE,
              "border border-border bg-background text-foreground hover:bg-muted/80"
            )}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
