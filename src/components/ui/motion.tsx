"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Motion primitives — zero-dependency, SSR-safe, and reduced-motion-first.
 *
 * The rule (VISUAL_NORTH_STAR discipline): reduced motion means the END STATE,
 * immediately — not a shorter animation. Every primitive here honours that.
 *
 * Card entrance and the sparkline draw-in are pure CSS (`.rc-reveal` / `.rc-draw`
 * in globals.css) so they need no JS and can't cause hydration flashes. This file
 * carries only the one motion that genuinely needs JS: the rolling number.
 */

/** Tracks the user's `prefers-reduced-motion` setting, live. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** A plausible neighbouring value so the digits actually travel (not a count from 0). */
function defaultFrom(value: number): number {
  if (!Number.isFinite(value)) return value;
  if (Number.isInteger(value)) {
    // Counts settle up from a near neighbour: 34 rolls in from ~32.
    return Math.max(0, value - Math.max(1, Math.round(Math.abs(value) * 0.06)));
  }
  // Decimals (lap times, wheel-time seconds) settle DOWN from just above.
  return value * 1.008;
}

/**
 * A number that rolls to `value` once, on first mount, then stays put.
 *
 * Server and first client render both show `format(value)` (the final string),
 * so there's no hydration mismatch and no flash of a wrong number; the roll is
 * layered on in an effect. Reduced motion skips straight to the final value.
 *
 * `format` receives the interpolated (fractional) value each frame — pass a
 * formatter that rounds/fixes as needed (`String(Math.round(n))`, `formatLap`,
 * `formatDrivingDuration`, …).
 */
export function RollingNumber({
  value,
  format,
  from,
  durationMs = 700,
  className,
}: {
  value: number;
  format: (n: number) => string;
  /** Override the start of the roll; defaults to a near neighbour of `value`. */
  from?: number;
  durationMs?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const rafRef = useRef<number | null>(null);
  const playedRef = useRef(false);

  useEffect(() => {
    if (reduced || playedRef.current) {
      setDisplay(value);
      return;
    }
    playedRef.current = true;
    const start = from ?? defaultFrom(value);
    let t0: number | null = null;
    const tick = (t: number) => {
      if (t0 === null) t0 = t;
      const p = Math.min((t - t0) / durationMs, 1);
      const eased = 1 - Math.pow(1 - p, 4); // quartic-out: quick, then settles
      setDisplay(start + (value - start) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // Play exactly once; `value` changes on a live refresh land via the reduced/
    // played guards above rather than re-triggering a roll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  return (
    <span className={cn("tabular-nums", className)} suppressHydrationWarning>
      {format(display)}
    </span>
  );
}
