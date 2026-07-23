"use client";

import { Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  ArrowRight,
  Check,
  Drop,
  Flag,
  FloppyDisk,
  Gauge,
  Timer,
  Tire,
  Wrench,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  WIZARD_STEPS,
  nextWalkStep,
  stepLabel,
  walkStepIds,
  type WizardStepId,
  type WizardStepStatus,
} from "@/lib/runs/wizardWalk";

/**
 * Log-run wizard chrome — model F2 (founder decision 2026-07-18, see
 * docs/design/log-run-navigation.md + artifact rounds). ONE bottom surface
 * replaces the old summary card + dock-costume tab bar + floating action row:
 *
 * - **Row 0 (2026-07-18 polish round, E1):** a grabber handle on the bar's
 *   top edge — the iOS-sheet cue that this surface expands into the summary
 *   sheet (founder: "map ▴" alone was undiscoverable). Tapping it (or the
 *   step name) opens the sheet.
 * - **Row 1:** ‹ previous step (on Session it opens the exit prompt) · the
 *   step name + "n of 6" button (opens the map sheet) · the step's primary
 *   action ("Tires" … "Laps" mid-flow, "Complete" on Feedback, "Save edits"
 *   when editing a completed run) — styled per the C3 decision: −21° dark
 *   notch + top-light yellow gradient + real arrow/flag icons (no "→"/🏁
 *   text glyphs).
 * - **Row 2:** six one-tap step ticks (icons always visible — founder:
 *   "don't remove the icon of what's completed"; amber dot = required
 *   missing).
 * - **Row 3:** the progression track — ONE continuous bar split evenly per
 *   step; a sector fills yellow IN PLACE when its step's data is in (founder
 *   picked in-place over left-to-right count fill and over the per-tick
 *   underlines he found confusing). Polish round P2: the internal seams are
 *   −21° angled cuts (the JRC glyph angle) instead of vertical hairlines.
 * - **Map sheet** (tap the step name): six labeled rows with live values +
 *   "prefilled" chips, plus Save draft / Mark run complete — the old summary
 *   card's content, moved into the thumb zone.
 * - **"← Exit"** top-left (was "Save & exit"): with nothing entered it just
 *   leaves; otherwise it asks — Save draft & exit / Discard / Keep logging.
 *
 * **V9 pre-run boundary (founder-locked 2026-07-18; the one-time toast was
 * removed 2026-07-18 per founder — the save button carries the cue instead):**
 * - The Setup→Laps seam is visible: a dashed −21° divider in the ticks row and
 *   a matching gap in the progression track. (The BEFORE / AFTER text labels
 *   under the track were dropped — founder: irrelevant.)
 * - The subtitle is phase-aware ("n of 6" retired): "Before the run · n of 4"
 *   on pre steps, "After the run · n of 2" on post steps. When all four
 *   pre-run steps are in, the line goes green: "Pre-run logged ✓ — you're
 *   ready to run".
 * - **Pre-run-complete cue:** the instant all four pre-run steps' data is in,
 *   the row-1 save button takes the same yellow fill as the primary CTA pill
 *   (shared YELLOW_FILL) — an always-there "you can bank this now" affordance.
 *   This replaced the earlier one-time toast.
 * - **Retro guard** ("wording is the whole fix" — no retro mode): once any
 *   post-run data exists (laps or rating), the "you're ready to run" tail
 *   drops everywhere and the save button's yellow cue never lights — a driver
 *   logging the whole run after driving must never be told to go run it.
 * - A 34px 💾 circle sits in row 1 on EVERY step — draft bail-out anywhere
 *   (closes the decision doc's "draft bail-outs drop" falsifier), yellow once
 *   pre-run is complete. When editing a completed run it saves edits instead
 *   (completion preserved).
 *
 * The bar is visibly a card edge, NOT the dock (deliberate: flow chrome must
 * not impersonate global chrome). It now serves desktop too — the old side
 * rail and desktop pill mirror are gone. While mounted it stamps
 * `data-logrun-wizard-chrome` on <body> so the global dock and brand pill
 * hide via globals.css. The bottom chrome hides while a text field has focus.
 */

const STEP_ICONS: Record<WizardStepId, PhosphorIcon> = {
  session: Flag,
  equipment: Tire,
  prep: Drop,
  setup: Wrench,
  laps: Timer,
  feel: Gauge,
};

export type WizardSheetRow = {
  key: string;
  label: string;
  value: string;
  state: "ok" | "chg" | "miss";
  /** Value still equals what the prefill tap carried in → "prefilled" chip. */
  prefilled?: boolean;
  go: WizardStepId;
};

/** The exact yellow finish shared by every primary action — the CTA pills and
 *  the pre-run-complete save button — so they read as one control (top-light
 *  gradient, dark label/icon, soft yellow cast shadow). */
const YELLOW_FILL =
  "bg-[linear-gradient(180deg,#FFDF3D_0%,#FFD60A_55%,#F1C700_100%)] text-primary-foreground shadow-[0_10px_22px_-8px_rgba(255,214,10,0.35),inset_0_1px_0_rgba(255,255,255,0.4)] hover:brightness-[0.96]";

const PILL_PRIMARY = cn(
  "tap-active inline-flex h-10 items-center justify-center gap-1.5 rounded-full px-4 font-sans text-[12.5px] font-bold transition-transform duration-150 active:scale-95 touch-manipulation",
  YELLOW_FILL
);

/** The −21° dark notch that leads the primary CTA's label (C3, matching the
 *  dashboard Start-run bar's mark). */
function CtaNotch() {
  return (
    <span
      aria-hidden
      className="inline-block h-[0.76em] w-[5.5px] -skew-x-[21deg] rounded-[1px] bg-[rgba(18,17,16,0.88)]"
    />
  );
}
const PILL_OUTLINE =
  "tap-active inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-white/10 bg-card/90 px-4 font-sans text-[12.5px] font-bold text-foreground transition-transform duration-150 hover:bg-muted active:scale-95 touch-manipulation";
const PILL_DANGER =
  "tap-active inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-4 font-sans text-[12.5px] font-bold text-destructive transition-transform duration-150 active:scale-95 touch-manipulation";

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
  rows,
  editingCompleted,
  canSave,
  saving,
  saveSuccess,
  hasContent,
  exitOpen,
  onExitOpenChange,
  onSaveDraft,
  onComplete,
  onExitSave,
  onExitDiscard,
}: {
  current: WizardStepId;
  statusById?: Partial<Record<WizardStepId, WizardStepStatus>>;
  onSelect: (id: WizardStepId) => void;
  /** Map-sheet rows — one per step, live values (the old summary card's job). */
  rows: WizardSheetRow[];
  /** The run was already saved complete — completion is preserved, never
   *  offered again (single "Save edits"). */
  editingCompleted: boolean;
  canSave: boolean;
  saving: boolean;
  saveSuccess: boolean;
  /** Anything worth saving? Gates the exit prompt — an untouched run leaves
   *  without ceremony. */
  hasContent: boolean;
  /** Exit prompt visibility is owned by the form so system-back on Session
   *  can open the same prompt. */
  exitOpen: boolean;
  onExitOpenChange: (open: boolean) => void;
  /** Explicit draft save (map sheet). */
  onSaveDraft: () => void;
  /** Feedback primary: Mark run complete (or Save edits when editingCompleted). */
  onComplete: () => void;
  /** Exit prompt "Save & exit": banks draft/completion, then leaves. */
  onExitSave: () => void;
  /** Exit prompt "Discard" (and the no-content fast path): leaves without saving. */
  onExitDiscard: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => setMounted(true), []);

  // V9 phase state — derived from the same statusById the ticks render.
  const preIds = WIZARD_STEPS.filter((s) => s.preRun).map((s) => s.id);
  const postIds = WIZARD_STEPS.filter((s) => !s.preRun).map((s) => s.id);
  const stepDone = (id: WizardStepId) => Boolean(statusById?.[id]?.done);
  const preDoneCount = preIds.filter(stepDone).length;
  const postDoneCount = postIds.filter(stepDone).length;
  const preComplete = preDoneCount === preIds.length;
  /** Any after-the-run data → the log is retro; live-flavored wording would
   *  assert a future that already happened, so the tail drops and the toast
   *  never fires. */
  const postRunData = postIds.some(stepDone);
  const currentIsPre = WIZARD_STEPS.some((s) => s.id === current && s.preRun);
  /** Once every pre-run step is in, the row-1 save button goes yellow — the
   *  "you can bank this now" cue that replaced the one-time toast. Suppressed
   *  for retro logs (post-run data already exists) and when editing a completed
   *  run, exactly as the toast was. */
  const highlightSave = preComplete && !postRunData && !editingCompleted;

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

  const walk = walkStepIds();
  const nextId = nextWalkStep(current, walk);
  const prevId = walk[walk.indexOf(current) - 1] ?? null;
  const doneCount = walk.filter((id) => statusById?.[id]?.done).length;
  const busy = !canSave || saving;

  const jump = (id: WizardStepId) => {
    setSheetOpen(false);
    onSelect(id);
  };

  const requestExit = () => {
    if (saving) return;
    if (!hasContent && !editingCompleted) {
      onExitDiscard();
      return;
    }
    setSheetOpen(false);
    onExitOpenChange(true);
  };

  const primaryContent =
    current === "feel" ? (
      editingCompleted ? (
        <>
          <CtaNotch />
          {saveSuccess ? "Saved ✓" : saving ? "Saving…" : "Save edits"}
        </>
      ) : saving ? (
        <>
          <CtaNotch />
          Saving…
        </>
      ) : (
        <>
          <CtaNotch />
          Complete
          <Flag size={15} weight="fill" aria-hidden />
        </>
      )
    ) : nextId ? (
      <>
        <CtaNotch />
        Next
        <ArrowRight size={15} weight="bold" aria-hidden />
      </>
    ) : null;

  return createPortal(
    <>
      {/* Exit — takes the brand pill's corner (hidden via CSS). Asks about
          saving when there's anything to lose; otherwise just leaves. */}
      <button
        type="button"
        onClick={requestExit}
        disabled={saving}
        className={cn(
          "tap-active fixed left-4 z-40 flex h-[34px] items-center gap-1 rounded-full border border-white/[0.15] bg-card/70 px-3.5 font-sans text-[11px] font-bold text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.45)] backdrop-blur-[20px] backdrop-saturate-[1.4] transition-transform duration-150 active:scale-95 md:hidden",
          saving && "opacity-60"
        )}
        style={{ top: "var(--top-chrome-y)" }}
        title="Leave the log — you'll be asked whether to save."
      >
        ← Exit
      </button>

      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-0 z-50 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-6",
          "transition-[opacity,transform] duration-150",
          keyboardOpen && "translate-y-6 opacity-0"
        )}
        aria-hidden={keyboardOpen || undefined}
      >
        {/* The one surface: actions · ticks · progression track. Card-edged
            on purpose — it must not read as the app dock. */}
        <div className="pointer-events-auto mx-auto grid w-full max-w-md gap-1.5 rounded-[20px] border border-white/[0.08] bg-card/[0.78] bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent_40%)] p-2 shadow-[0_22px_48px_-18px_rgba(0,0,0,0.68),inset_0_1px_0_rgba(255,255,255,0.22)] backdrop-blur-[40px] backdrop-saturate-[1.7]">
          {/* Grabber (E1) — the sheet cue; opens the run summary. */}
          <button
            type="button"
            onClick={() => setSheetOpen((v) => !v)}
            aria-expanded={sheetOpen}
            aria-label="Open the run summary"
            className="tap-active -mb-1.5 -mt-1 flex h-4 w-full touch-manipulation items-center justify-center"
          >
            <span className="h-1 w-[34px] rounded-full bg-white/[0.22]" aria-hidden />
          </button>
          {/* min-w-0: as a grid item this row's min-width defaults to auto —
              the nowrap green subtitle would otherwise widen the whole bar
              past the container and shove the CTA off-screen. */}
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => (prevId ? jump(prevId) : requestExit())}
              className="tap-active flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-card/80 text-[17px] leading-none text-foreground transition-transform duration-150 active:scale-95 touch-manipulation"
              aria-label={prevId ? `Back to ${stepLabel(prevId)}` : "Exit the log"}
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setSheetOpen((v) => !v)}
              className="tap-active min-w-0 flex-1 rounded-lg px-1.5 py-0.5 text-left touch-manipulation"
              aria-expanded={sheetOpen}
              aria-label="Open the run map"
            >
              <span className="block truncate font-sans text-[13px] font-bold tracking-tight text-foreground">
                {stepLabel(current)}
              </span>
              {/* V9 phase-aware subtitle — the persistent home of the green
                  line once pre-run is in (tail drops when the log is retro).
                  The tail also yields to space: at 390px the full W1 line
                  truncates mid-word beside the CTA, so narrow viewports keep
                  the clean status and the toast carries the full sentence. */}
              <span className="block truncate font-sans text-[10.5px] font-medium text-muted-foreground">
                {currentIsPre ? (
                  preComplete ? (
                    <span className="font-bold text-[#4FD089]">
                      Pre-run logged ✓
                      {postRunData ? null : (
                        <span className="hidden min-[430px]:inline"> — you&rsquo;re ready to run</span>
                      )}
                    </span>
                  ) : (
                    `Before the run · ${preDoneCount} of ${preIds.length}`
                  )
                ) : (
                  `After the run · ${postDoneCount} of ${postIds.length}`
                )}
              </span>
            </button>
            {/* Draft bail-out on every step (Save edits when the run is already
                complete — completion is preserved, never demoted). Goes yellow
                once every pre-run step is in — the "bank it now" cue that
                replaced the one-time toast. */}
            <button
              type="button"
              onClick={() => {
                if (busy) return;
                if (editingCompleted) onComplete();
                else onSaveDraft();
              }}
              disabled={busy}
              className={cn(
                "tap-active flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-[transform,background-color,border-color,color,box-shadow] duration-200 active:scale-95 touch-manipulation",
                highlightSave
                  ? cn("border-transparent", YELLOW_FILL)
                  : "border-white/10 bg-card/80 text-foreground",
                busy && "opacity-60"
              )}
              aria-label={editingCompleted ? "Save edits" : "Save draft"}
              title={
                editingCompleted
                  ? "Save changes — the run stays complete."
                  : "Save what you have — finish the run any time."
              }
            >
              {saveSuccess ? (
                <Check size={17} weight="bold" aria-hidden className="text-[#4FD089]" />
              ) : (
                <FloppyDisk size={18} aria-hidden />
              )}
            </button>
            {primaryContent ? (
              <button
                type="button"
                className={cn(
                  PILL_PRIMARY,
                  "shrink-0",
                  current === "feel" && busy && "pointer-events-none opacity-60"
                )}
                onClick={() => {
                  if (current === "feel") onComplete();
                  else if (nextId) jump(nextId);
                }}
                disabled={current === "feel" ? busy : false}
                aria-busy={current === "feel" && saving && !saveSuccess}
                title={
                  current === "feel"
                    ? editingCompleted
                      ? "Save changes — the run stays complete."
                      : "Mark this run finished and save."
                    : `Go to ${nextId ? stepLabel(nextId) : ""}`
                }
              >
                {primaryContent}
              </button>
            ) : null}
          </div>

          {/* One-tap step ticks — icons always shown, current in yellow.
              V9: a dashed −21° seam between Setup and Laps marks the
              pre-run → post-run boundary. */}
          <div className="flex" role="tablist" aria-label="Log run steps">
            {WIZARD_STEPS.map((s, i) => {
              const Icon = STEP_ICONS[s.id];
              const cur = s.id === current;
              const st = statusById?.[s.id];
              return (
                <Fragment key={s.id}>
                  {!s.preRun && WIZARD_STEPS[i - 1]?.preRun ? (
                    <div aria-hidden className="flex w-2.5 shrink-0 items-center justify-center">
                      <span className="h-5 w-px -skew-x-[21deg] [background:repeating-linear-gradient(180deg,#3a3835_0_3px,transparent_3px_6px)]" />
                    </div>
                  ) : null}
                  <button
                    type="button"
                    role="tab"
                    aria-selected={cur}
                    aria-label={`${s.label}${cur ? " (current)" : ""}${st?.done ? " — logged" : ""}`}
                    onClick={() => jump(s.id)}
                    className={cn(
                      "tap-active flex min-w-0 flex-1 touch-manipulation items-center justify-center py-1.5 transition-colors duration-150",
                      cur ? "text-primary" : st?.done ? "text-foreground/85" : "text-muted-foreground"
                    )}
                  >
                    <span className="relative shrink-0">
                      <Icon size={19} weight={cur ? "fill" : "regular"} aria-hidden />
                      {st?.attention ? (
                        <span
                          className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-amber-400"
                          aria-hidden
                        />
                      ) : null}
                    </span>
                  </button>
                </Fragment>
              );
            })}
          </div>

          {/* Progression track (P2) — ONE bar, a sector per step, filling in
              place; the internal seams are −21° cuts. The segment row bleeds
              past the clipped edges so the outer ends stay square while every
              seam stays angled. V9: a wider gap under the ticks' seam splits
              the bar into its Before / After halves. */}
          <div
            className="relative h-[7px] overflow-hidden rounded-[3px] bg-[#141310] shadow-[inset_0_0_0_1px_#34322f]"
            role="img"
            aria-label={`${doneCount} of ${walk.length} logged`}
          >
            <div className="absolute -inset-x-[5px] inset-y-0 flex gap-[3px]" aria-hidden>
              {WIZARD_STEPS.map((s, i) => (
                <Fragment key={s.id}>
                  {!s.preRun && WIZARD_STEPS[i - 1]?.preRun ? (
                    <span className="w-[7px] shrink-0" />
                  ) : null}
                  <span
                    className={cn(
                      "flex-1 -skew-x-[21deg] transition-colors duration-300",
                      statusById?.[s.id]?.done ? "bg-primary" : "bg-[#232120]"
                    )}
                  />
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Map sheet — labeled rows with live values + the save actions. */}
      {sheetOpen ? (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/50"
            onClick={() => setSheetOpen(false)}
            aria-hidden
          />
          <div
            className="fixed inset-x-0 bottom-0 z-[61] mx-auto w-full max-w-md rounded-t-[22px] border-t border-white/10 bg-[#1E1D1C] px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-24px_60px_-12px_rgba(0,0,0,0.8)]"
            role="dialog"
            aria-label="Run map"
          >
            <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-border" aria-hidden />
            <div className="pb-1">
              {rows.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => jump(r.go)}
                  className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
                >
                  <span
                    className={cn(
                      "shrink-0 font-sans text-[12.5px]",
                      r.go === current ? "font-bold text-primary" : "text-muted-foreground"
                    )}
                  >
                    {r.label}
                  </span>
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span
                      className={cn(
                        "min-w-0 truncate font-sans text-[12.5px] font-medium",
                        r.state === "miss"
                          ? "text-amber-600 dark:text-amber-300"
                          : r.state === "chg"
                            ? "text-primary"
                            : "text-foreground"
                      )}
                    >
                      {r.value}
                    </span>
                    {r.prefilled && r.state !== "miss" ? (
                      <span className="shrink-0 rounded-[5px] border border-border px-1.5 py-px text-[9.5px] font-semibold uppercase leading-none tracking-[0.07em] text-faint">
                        prefilled
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
            <div className="grid gap-2 pt-1.5">
              {editingCompleted ? (
                <button
                  type="button"
                  className={cn(PILL_PRIMARY, busy && "pointer-events-none opacity-60")}
                  onClick={onComplete}
                  disabled={busy}
                  aria-busy={saving && !saveSuccess}
                  title="Save changes — the run stays complete."
                >
                  {saveSuccess ? "Saved ✓" : saving ? "Saving…" : "Save edits"}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className={cn(PILL_OUTLINE, busy && "pointer-events-none opacity-60")}
                    onClick={onSaveDraft}
                    disabled={busy}
                    aria-busy={saving && !saveSuccess}
                    title="Save what you have — finish the run any time."
                  >
                    {saveSuccess ? "Saved ✓" : saving ? "Saving…" : "Save draft 💾"}
                  </button>
                  <button
                    type="button"
                    className={cn(PILL_PRIMARY, busy && "pointer-events-none opacity-60")}
                    onClick={onComplete}
                    disabled={busy}
                    title="Mark this run finished and save."
                  >
                    {saving ? "Saving…" : "Mark run complete 🏁"}
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      ) : null}

      {/* Exit prompt — the escape asks instead of silently saving. */}
      {exitOpen ? (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/50"
            onClick={() => onExitOpenChange(false)}
            aria-hidden
          />
          <div
            className="fixed inset-x-0 bottom-0 z-[61] mx-auto w-full max-w-md rounded-t-[22px] border-t border-white/10 bg-[#1E1D1C] px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-24px_60px_-12px_rgba(0,0,0,0.8)]"
            role="dialog"
            aria-label="Leave this run?"
          >
            <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-border" aria-hidden />
            <div className="pb-1 text-center font-sans text-[14px] font-bold tracking-tight text-foreground">
              Leave this run?
            </div>
            <div className="pb-3 text-center font-sans text-[11px] text-muted-foreground">
              {editingCompleted
                ? "The run stays complete either way — this is only about your edits."
                : "A draft keeps everything — finish it any time from the dashboard."}
            </div>
            <div className="grid gap-2">
              <button
                type="button"
                className={cn(PILL_PRIMARY, busy && "pointer-events-none opacity-60")}
                onClick={onExitSave}
                disabled={busy}
                aria-busy={saving && !saveSuccess}
              >
                {saving
                  ? "Saving…"
                  : editingCompleted
                    ? "Save changes & exit"
                    : "Save draft 💾 & exit"}
              </button>
              <button
                type="button"
                className={cn(PILL_DANGER, saving && "pointer-events-none opacity-60")}
                onClick={onExitDiscard}
                disabled={saving}
              >
                {editingCompleted ? "Discard changes" : "Discard — exit without saving"}
              </button>
              <button
                type="button"
                className={PILL_OUTLINE}
                onClick={() => onExitOpenChange(false)}
              >
                Keep logging
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>,
    document.body
  );
}
