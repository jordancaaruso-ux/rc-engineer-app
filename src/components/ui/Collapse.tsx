"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/components/ui/motion";

/**
 * Smooth expand/collapse — the one animated-height primitive.
 *
 * Extracted from the RecentRunsCard accordion so every expanding card reads the
 * same: 300ms ease-out, height via the `grid-rows 0fr→1fr` trick plus an opacity
 * fade, `visibility` in the transition list so closing content stays visible
 * until the collapse finishes then leaves the a11y tree / tab order.
 *
 * Two ways to drive it:
 *  - **Always-mounted** (cheap content, e.g. a stat strip): keep the component
 *    mounted and just flip `open`. Both directions animate — the internal rAF
 *    `entered` flag also plays the OPEN animation when the node is freshly
 *    mounted already-open.
 *  - **Mount-on-demand** (heavy content, e.g. a run's full detail): gate the
 *    mount with `useEnterExit` so the subtree stays mounted through the close
 *    animation, then unmounts — you never keep N expensive subtrees alive.
 *
 * Reduced motion collapses straight to the end state (no transition), per the
 * motion.tsx doctrine.
 */
export function Collapse({
  open,
  children,
  className,
  contentClassName,
  durationMs = 300,
  id,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  durationMs?: number;
  id?: string;
}) {
  const reduced = useReducedMotion();
  // Freshly mounted already-open? Start closed for one frame so the height/fade
  // has somewhere to travel from, then flip open on the next frame.
  const [entered, setEntered] = useState(open && reduced);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    if (reduced) {
      setEntered(true);
      return;
    }
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [open, reduced]);

  const shown = open && entered;

  return (
    <div
      id={id}
      className={cn(
        "grid transition-[grid-template-rows,opacity,visibility] ease-out motion-reduce:transition-none",
        shown ? "grid-rows-[1fr] opacity-100" : "invisible grid-rows-[0fr] opacity-0",
        className,
      )}
      style={{ transitionDuration: `${durationMs}ms` } as CSSProperties}
    >
      <div className={cn("min-h-0 overflow-hidden", contentClassName)}>{children}</div>
    </div>
  );
}

/**
 * Enter/exit lifecycle for mount-on-demand animations (bottom sheets, and the
 * heavy expanded rows that shouldn't stay mounted while collapsed).
 *
 * `mounted` is true while open OR during the `durationMs` close transition, so
 * the exit animation gets to play before the subtree leaves the tree. `entered`
 * is the visual "in" state — false on the first mounted frame (so an enter
 * animation has a starting point), true one rAF later. Reduced motion skips the
 * two-frame dance and lands on the end state immediately.
 */
export function useEnterExit(
  open: boolean,
  durationMs = 300,
): { mounted: boolean; entered: boolean } {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(open);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    const clearRaf = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    if (open) {
      clearTimer();
      setMounted(true);
      if (reduced) {
        setEntered(true);
      } else {
        setEntered(false);
        rafRef.current = requestAnimationFrame(() => setEntered(true));
      }
      return () => clearRaf();
    }

    // Closing: play the exit, then unmount once the transition is done.
    clearRaf();
    setEntered(false);
    if (reduced) {
      setMounted(false);
      return;
    }
    timerRef.current = window.setTimeout(() => {
      setMounted(false);
      timerRef.current = null;
    }, durationMs);
    return () => clearTimer();
  }, [open, reduced, durationMs]);

  return { mounted, entered };
}
