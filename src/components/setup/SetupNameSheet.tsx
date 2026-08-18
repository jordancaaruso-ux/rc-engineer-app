"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * "What do you want to call it?" as a bottom sheet — the one question a fork has to ask.
 *
 * ============================== WHY IT ASKS AT ALL ==============================
 *
 * Founder call, 2026-08-17, REVERSING the 2026-08-16 line in `useSetupEditorSave` that had the
 * fork name itself. That line carried over the 2026-08-11 ruling which took a `window.prompt` off
 * the All-setups bookmark, and it was carried one step too far: those are different jobs. The
 * bookmark keeps a row that ALREADY HAS A TITLE — asking adds a question with one right answer.
 * A fork makes a thing that has no title at all, and the generated one was actively bad: fork the
 * same setup twice and both copies are called "Mod A (edited)", fork a fork and you get
 * "Mod A (edited) (edited)". The Rename link offered instead is 11px of grey in the corner of the
 * bar and vanishes the moment the driver navigates away.
 *
 * ============================== WHY A SHEET, NOT A `window.prompt` ==============================
 *
 * The browser's own box is what Rename still uses, and it is the cheapest possible build — but it
 * throws the driver out of the app to a system dialog, and in the iOS Capacitor shell those are
 * suppressible. The shape here is lifted from `ExitPromptSheet` so a question asked mid-flow looks
 * the same wherever the app asks one.
 *
 * The field opens FOCUSED AND SELECTED: the suggested name is a one-tap accept for a driver who
 * doesn't care, and typing replaces it whole for one who does. That is the entire reason a
 * suggestion is worth having.
 */

const PILL_BASE =
  "tap-active inline-flex h-10 flex-1 items-center justify-center rounded-full px-4 font-sans text-[12.5px] font-bold transition-transform duration-150 active:scale-95 touch-manipulation disabled:pointer-events-none disabled:opacity-60";

export function SetupNameSheet({
  open,
  title,
  detail,
  suggestedName,
  confirmLabel,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  /** One line under the title — what this copy is, and what it leaves alone. */
  detail?: string;
  /** Prefilled and pre-selected. May be empty, which just means the driver types from scratch. */
  suggestedName: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState(suggestedName);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setMounted(true), []);

  /*
   * The suggestion is re-seeded on every OPEN, not once: the name of the setup being forked can
   * change under this component (a Rename lands, or a save moves the driver onto a new row), and a
   * sheet opened afterwards must suggest the current one rather than whatever it first mounted with.
   */
  useEffect(() => {
    if (!open) return;
    setName(suggestedName);
  }, [open, suggestedName]);

  // Focus after the sheet is actually in the DOM. `autoFocus` fires before the portal paints on
  // some renders, which lands the caret without the selection and defeats type-to-replace.
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!mounted || !open) return null;

  const trimmed = name.trim();

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/50"
        onClick={() => !busy && onCancel()}
        aria-hidden
      />
      {/*
        A form, not a div with a button: on a phone this is what turns the keyboard's return key
        into "Go", which is how the one-tap accept actually gets taken.
      */}
      <form
        className="fixed inset-x-0 bottom-0 z-[61] mx-auto w-full max-w-md rounded-t-[22px] border-t border-white/10 bg-muted px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-24px_60px_-12px_rgba(0,0,0,0.8)]"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault();
          if (busy || !trimmed) return;
          onConfirm(trimmed);
        }}
      >
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-border" aria-hidden />
        <label
          htmlFor="setup-name-sheet-input"
          className="block pb-1 text-center font-sans text-[14px] font-bold tracking-tight text-foreground"
        >
          {title}
        </label>
        {detail ? (
          <p className="pb-3 text-center font-sans text-[11px] text-muted-foreground">{detail}</p>
        ) : null}
        <input
          id="setup-name-sheet-input"
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          // 80 is what the API truncates to; letting the driver type past it means the name they
          // read back is not the one they wrote.
          maxLength={80}
          placeholder="Name this setup"
          autoComplete="off"
          className="ui-control w-full rounded-lg border border-border bg-input px-3.5 py-3 text-foreground outline-none transition-colors placeholder:text-faint focus:border-primary-ink disabled:opacity-60"
        />
        {error ? (
          <p className="pt-2 text-center font-sans text-[11px] text-destructive">{error}</p>
        ) : null}
        <div className="flex gap-2 pt-3">
          <button
            type="button"
            className={cn(PILL_BASE, "border border-white/10 bg-card/90 text-foreground")}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            // Empty is not a name. The button says so by going flat rather than by refusing on press.
            disabled={busy || !trimmed}
            aria-busy={busy}
            className={cn(
              PILL_BASE,
              "bg-[linear-gradient(180deg,#FFDF3D_0%,#FFD60A_55%,#F1C700_100%)] text-primary-foreground shadow-[0_10px_22px_-8px_rgba(255,214,10,0.35),inset_0_1px_0_rgba(255,255,255,0.4)]"
            )}
          >
            {busy ? "Saving…" : confirmLabel}
          </button>
        </div>
      </form>
    </>,
    document.body
  );
}
