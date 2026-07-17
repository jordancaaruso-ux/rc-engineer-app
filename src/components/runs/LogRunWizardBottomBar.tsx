"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Drop, Flag, Gauge, Timer, Tire, Wrench } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  WIZARD_STEPS,
  nextWalkStep,
  stepLabel,
  walkStepIds,
  type WizardStepId,
} from "@/lib/runs/wizardWalk";
import type { WizardStepStatus } from "@/components/runs/LogRunWizardRail";

/**
 * Log-run wizard chrome — mobile only (founder spec 2026-07-17 v5, revised
 * v5.1 after the founder's first drive). Three fixed pieces:
 *
 * - **Step bar** replacing the app dock: six tabs (dock glass DNA, dashed
 *   divider at the pre-run→after-run boundary), full width — the old Save
 *   circle is gone (drive verdict: icon-only was too subtle).
 * - **Action row** pinned above the bar (founder picked over in-content
 *   links, which scrolled away): the persistent "what now" —
 *   "Next: <step> →" naming the destination tab (founder 2026-07-17) through
 *   Prep · the seam pair on Setup ("Run done — laptimes →" / "Not run yet —
 *   save draft 💾") · "Next: Feedback →" on Laps · Save on Feedback
 *   (label/color follow the DECLARED badge — Save never decides completion).
 * - **Escape hatch** top-left, where the brand pill normally sits: "← Save &
 *   exit" — the founder's fix for the flow feeling trapped; one tap banks the
 *   draft (or the declared complete) and leaves.
 *
 * While mounted it stamps `data-logrun-wizard-chrome` on <body> so the global
 * dock (`.bottom-nav`) and the brand pill (`.mobile-brand-mark`) hide via
 * globals.css. The bottom chrome hides while a text field has focus (the
 * keyboard would ride it over the field); the escape pill stays.
 */

const STEP_ICONS: Record<WizardStepId, PhosphorIcon> = {
  session: Flag,
  equipment: Tire,
  prep: Drop,
  setup: Wrench,
  laps: Timer,
  feel: Gauge,
};

const PILL_PRIMARY =
  "tap-active inline-flex h-11 items-center gap-1.5 rounded-full bg-primary px-4 font-sans text-[12.5px] font-bold text-primary-foreground shadow-[0_12px_26px_-6px_rgba(255,214,10,0.35),0_10px_22px_-8px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.4)] transition-transform duration-150 hover:bg-[#E6BE00] active:scale-95 touch-manipulation";
const PILL_OUTLINE =
  "tap-active inline-flex h-11 items-center gap-1.5 rounded-full border border-white/10 bg-card/90 px-4 font-sans text-[12.5px] font-bold text-foreground shadow-[0_10px_22px_-8px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-[20px] transition-transform duration-150 hover:bg-muted active:scale-95 touch-manipulation";

function isTextEntry(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "range", "submit", "file"].includes(el.type);
  }
  return false;
}

export function LogRunWizardBottomBar({
  current,
  statusById,
  onSelect,
  markedComplete,
  canSave,
  saving,
  saveSuccess,
  onSave,
  onSaveDraft,
  onExit,
}: {
  current: WizardStepId;
  statusById?: Partial<Record<WizardStepId, WizardStepStatus>>;
  onSelect: (id: WizardStepId) => void;
  /** Declared completion state — styles the Save action, never decided here. */
  markedComplete: boolean;
  canSave: boolean;
  saving: boolean;
  saveSuccess: boolean;
  /** Save with the declared intent (Feedback action + the escape hatch). */
  onSave: () => void;
  /** Explicit draft save — the Setup boundary's "Not run yet" walk-away. */
  onSaveDraft: () => void;
  /** "← Save & exit": banks the run and leaves (plain exit when unsaveable). */
  onExit: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => setMounted(true), []);

  // Hide the global dock + brand pill while the wizard owns the chrome.
  useEffect(() => {
    document.body.setAttribute("data-logrun-wizard-chrome", "1");
    return () => document.body.removeAttribute("data-logrun-wizard-chrome");
  }, []);

  // Keyboard-hide: any focused text field suppresses the bottom chrome.
  // focusout fires before the next focusin when tabbing between fields —
  // debounce the re-check so the bar doesn't flicker in between. (A timer,
  // not rAF: frames can stall while the keyboard animates.)
  useEffect(() => {
    let t: number | undefined;
    const sync = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => setKeyboardOpen(isTextEntry(document.activeElement)), 80);
    };
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", sync);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", sync);
    };
  }, []);

  if (!mounted) return null;

  const nextId = nextWalkStep(current, walkStepIds());
  const busy = !canSave || saving;
  const saveLabel = saveSuccess
    ? "Saved ✓"
    : saving
      ? "Saving…"
      : markedComplete
        ? "Save 🏁"
        : "Save 💾";

  return createPortal(
    <>
      {/* Escape hatch — sits where the brand pill lives (hidden via CSS). */}
      <button
        type="button"
        onClick={onExit}
        disabled={saving}
        className={cn(
          "tap-active fixed left-4 z-40 flex h-[34px] items-center gap-1 rounded-full border border-white/[0.15] bg-card/70 px-3.5 font-sans text-[11px] font-bold text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.45)] backdrop-blur-[20px] backdrop-saturate-[1.4] transition-transform duration-150 active:scale-95 md:hidden",
          saving && "opacity-60"
        )}
        style={{ top: "var(--top-chrome-y)" }}
        title="Saves what you have and leaves — finish the log any time."
      >
        ← Save &amp; exit
      </button>

      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col gap-2 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden",
          "transition-[opacity,transform] duration-150",
          keyboardOpen && "translate-y-6 opacity-0"
        )}
        aria-hidden={keyboardOpen || undefined}
      >
        {/* Action row — the persistent forward motion (v5.1 N1). */}
        <div className="pointer-events-auto mx-auto flex w-full max-w-md flex-wrap items-center justify-end gap-2">
          {current === "setup" ? (
            <>
              <button
                type="button"
                className={cn(PILL_OUTLINE, busy && "pointer-events-none opacity-60")}
                onClick={onSaveDraft}
                disabled={busy}
              >
                {saving ? "Saving…" : "Not run yet — save draft 💾"}
              </button>
              <button type="button" className={PILL_PRIMARY} onClick={() => onSelect("laps")}>
                Run done — laptimes →
              </button>
            </>
          ) : current === "feel" ? (
            <button
              type="button"
              className={cn(
                markedComplete ? PILL_PRIMARY : PILL_OUTLINE,
                busy && "pointer-events-none opacity-60"
              )}
              onClick={onSave}
              disabled={busy}
              aria-busy={saving && !saveSuccess}
              title={
                markedComplete
                  ? "Marked complete — saving finishes the run."
                  : "Saves as a draft — tap the Draft badge to mark complete."
              }
            >
              {saveLabel}
            </button>
          ) : nextId ? (
            <button type="button" className={PILL_PRIMARY} onClick={() => onSelect(nextId)}>
              Next: {stepLabel(nextId)} →
            </button>
          ) : null}
        </div>

        {/* Step bar — replaces the app dock; full width (no circle). */}
        <nav
          className="pointer-events-auto mx-auto flex h-14 w-full max-w-md items-stretch overflow-hidden rounded-full border border-white/[0.06] bg-card/[0.32] bg-[linear-gradient(180deg,rgba(255,255,255,0.07),transparent_42%)] px-1 shadow-[0_22px_48px_-18px_rgba(0,0,0,0.68),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_0_0_0.5px_rgba(255,255,255,0.06)] backdrop-blur-[40px] backdrop-saturate-[1.9]"
          role="tablist"
          aria-label="Log run steps"
        >
          {WIZARD_STEPS.map((s, i) => {
            const Icon = STEP_ICONS[s.id];
            const cur = s.id === current;
            const st = statusById?.[s.id];
            const next = WIZARD_STEPS[i + 1];
            const seamAfter = s.preRun && next && !next.preRun;
            return (
              <div key={s.id} className="flex min-w-0 flex-1">
                <button
                  type="button"
                  role="tab"
                  aria-selected={cur}
                  aria-label={`${s.label}${cur ? " (current)" : ""}`}
                  onClick={() => onSelect(s.id)}
                  className={cn(
                    "tap-active flex min-w-0 flex-1 touch-manipulation flex-col items-center justify-center gap-0.5 transition-colors duration-150",
                    cur ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  <span className="relative shrink-0">
                    <Icon size={19} weight={cur ? "fill" : "regular"} aria-hidden />
                    {st?.attention ? (
                      <span
                        className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-amber-400"
                        aria-hidden
                      />
                    ) : st?.done && !cur ? (
                      <span
                        className="absolute -right-2 -top-1 text-[9px] font-bold leading-none text-[#4FD089]"
                        aria-hidden
                      >
                        ✓
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "max-w-full truncate font-sans text-[8px] leading-none tracking-tight",
                      cur ? "font-bold" : "font-medium"
                    )}
                  >
                    {s.label}
                  </span>
                </button>
                {seamAfter ? (
                  <span
                    aria-hidden
                    className="my-3.5 w-px shrink-0 [background:repeating-linear-gradient(to_bottom,rgba(255,255,255,0.18)_0_4px,transparent_4px_8px)]"
                  />
                ) : null}
              </div>
            );
          })}
        </nav>
      </div>
    </>,
    document.body
  );
}
