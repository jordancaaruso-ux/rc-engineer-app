"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * A short confirmation that carries one optional follow-up action.
 *
 * ============================== WHY THIS EXISTS ==============================
 *
 * Saving a setup from "All setups" is one tap and asks nothing: it keeps the name the row already
 * had (founder call 2026-08-11). But a driver who wants their own name for it needs somewhere to
 * say so, and a `window.prompt` before the save was exactly the friction being removed — every
 * save paid for a rename almost nobody wanted.
 *
 * So the save happens, and the rename is offered afterwards and can be ignored. Ignoring it is the
 * common path, which is why the toast times out rather than waiting to be dismissed.
 *
 * ============================== WHY IT IS NOT A TOAST LIBRARY ==============================
 *
 * One message at a time, one action, no queue, no provider. A second save replaces the first
 * message — on this screen a driver saves one row, sees it land, and moves on. Anything more is
 * machinery for a problem this app does not have.
 *
 * Portaled to `<body>`: the car page sits inside elements with their own stacking contexts, so a
 * z-index here would compete with its siblings rather than with the app chrome.
 */

export type ToastAction = {
  label: string;
  onClick: () => void;
};

const VISIBLE_MS = 6000;
const FADE_MS = 200;

export function ActionToast({
  message,
  action,
  onDismiss,
  raised = false,
}: {
  /** Null hides the toast. Changing the message restarts the timer. */
  message: string | null;
  action?: ToastAction | null;
  onDismiss: () => void;
  /**
   * Sit clear of a fixed bottom bar rather than under it. The log-run wizard's
   * bar is 132px tall at 390px wide (measured), so 9rem leaves a gap without
   * floating the toast into the middle of the screen.
   */
  raised?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!message) {
      setShown(false);
      return;
    }
    setShown(true);
    const hide = window.setTimeout(() => setShown(false), VISIBLE_MS);
    const clear = window.setTimeout(() => dismissRef.current(), VISIBLE_MS + FADE_MS);
    return () => {
      window.clearTimeout(hide);
      window.clearTimeout(clear);
    };
  }, [message]);

  if (!mounted || !message) return null;

  return createPortal(
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex justify-center px-4",
        raised
          ? "pb-[max(9rem,calc(env(safe-area-inset-bottom)+9rem))]"
          : "pb-[max(1rem,env(safe-area-inset-bottom))]"
      )}
      // Polite: a save the driver just asked for is not an interruption worth cutting speech for.
      role="status"
      aria-live="polite"
    >
      <div
        className={cn(
          "pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border border-white/10 bg-card/95 py-2.5 pl-4 pr-2.5 shadow-[0_8px_30px_-8px_rgba(0,0,0,0.7)] backdrop-blur-xl",
          "transition-all duration-200 ease-out motion-reduce:transition-none",
          shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        )}
      >
        <span className="min-w-0 flex-1 text-[13px] text-foreground">{message}</span>
        {action ? (
          <button
            type="button"
            onClick={() => {
              action.onClick();
              onDismiss();
            }}
            className="tap-active shrink-0 rounded-md px-2.5 py-1.5 text-[13px] font-semibold text-primary-ink transition hover:bg-primary/10"
          >
            {action.label}
          </button>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
