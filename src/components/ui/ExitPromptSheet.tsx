"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * "You're part-way through something — how do you want to leave?" as a bottom sheet.
 *
 * The shape is lifted from the log-run wizard's exit prompt so bailing out of a long entry flow
 * looks the same wherever you do it. Portalled to `document.body` rather than rendered in place:
 * these prompts open from inside cards, and any transformed ancestor would quietly turn `fixed`
 * into `absolute` and strand the sheet mid-page.
 */

const PILL_BASE =
  "tap-active inline-flex h-10 items-center justify-center gap-1.5 rounded-full px-4 font-sans text-[12.5px] font-bold transition-transform duration-150 active:scale-95 touch-manipulation";

const PILL_PRIMARY = cn(
  PILL_BASE,
  "bg-[linear-gradient(180deg,#FFDF3D_0%,#FFD60A_55%,#F1C700_100%)] text-primary-foreground shadow-[0_10px_22px_-8px_rgba(255,214,10,0.35),inset_0_1px_0_rgba(255,255,255,0.4)] hover:brightness-[0.96]"
);
const PILL_DANGER = cn(
  PILL_BASE,
  "border border-destructive/40 bg-destructive/10 text-destructive"
);
const PILL_OUTLINE = cn(
  PILL_BASE,
  "border border-white/10 bg-card/90 text-foreground hover:bg-muted"
);

export type ExitPromptSheetProps = {
  open: boolean;
  title: string;
  /** One line under the title — what leaving actually costs. */
  detail?: ReactNode;
  saveLabel: string;
  discardLabel: string;
  stayLabel: string;
  /** Shown above the buttons when the last save didn't land. */
  error?: string | null;
  /** Disables everything but "stay" while a save is in flight. */
  busy?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onStay: () => void;
};

export function ExitPromptSheet({
  open,
  title,
  detail,
  saveLabel,
  discardLabel,
  stayLabel,
  error,
  busy = false,
  onSave,
  onDiscard,
  onStay,
}: ExitPromptSheetProps) {
  // Portals need a DOM; this renders inside server-rendered pages.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onStay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onStay]);

  if (!mounted || !open) return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/50"
        onClick={() => !busy && onStay()}
        aria-hidden
      />
      <div
        className="fixed inset-x-0 bottom-0 z-[61] mx-auto w-full max-w-md rounded-t-[22px] border-t border-white/10 bg-[#1E1D1C] px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-24px_60px_-12px_rgba(0,0,0,0.8)]"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-border" aria-hidden />
        <div className="pb-1 text-center font-sans text-[14px] font-bold tracking-tight text-foreground">
          {title}
        </div>
        {detail ? (
          <div className="pb-3 text-center font-sans text-[11px] text-muted-foreground">
            {detail}
          </div>
        ) : null}
        {error ? (
          <div className="pb-3 text-center font-sans text-[11px] text-destructive">{error}</div>
        ) : null}
        <div className="grid gap-2">
          <button
            type="button"
            className={cn(PILL_PRIMARY, busy && "pointer-events-none opacity-60")}
            onClick={onSave}
            disabled={busy}
            aria-busy={busy}
          >
            {saveLabel}
          </button>
          <button
            type="button"
            className={cn(PILL_DANGER, busy && "pointer-events-none opacity-60")}
            onClick={onDiscard}
            disabled={busy}
          >
            {discardLabel}
          </button>
          <button type="button" className={PILL_OUTLINE} onClick={onStay}>
            {stayLabel}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
