"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { EngineerStarterQuestion } from "@/lib/engineerStarterQuestions";

/**
 * Tappable starter questions above the composer (founder call, 2026-08-18).
 * A tap FILLS the composer — it never sends. See `engineerStarterQuestions.ts`
 * for why, and for the question set itself.
 *
 * Two presentations of one list:
 *
 * - **rail** — the phone. One horizontally scrolling row. Wrapping three rows of
 *   chips at 390px pushes the composer under the bottom dock, so it never wraps.
 * - **board** — `lg` and up. The empty transcript row is ~400×300px of nothing on
 *   a monitor; the same questions fill it as a grid.
 *
 * Exactly one renders at a time (the rail is `lg:hidden`), so there is never a
 * duplicate set on screen.
 */

/** Slow enough to read past, fast enough to notice. ~26s across a full rail. */
const DRIFT_PX_PER_SECOND = 20;
const HOLD_AT_START_MS = 900;
const HOLD_AT_END_MS = 1200;
const REWIND_MS = 650;
/** Below this there is nothing hidden to reveal, so the rail stays still. */
const MIN_OVERFLOW_PX = 8;

export function EngineerStarterQuestions({
  questions,
  variant,
  disabled = false,
  onPick,
  className,
}: {
  questions: EngineerStarterQuestion[];
  variant: "rail" | "board";
  disabled?: boolean;
  /** Fills the composer with `question.text`. Never sends. */
  onPick: (question: EngineerStarterQuestion) => void;
  className?: string;
}) {
  if (questions.length === 0) return null;
  return variant === "board" ? (
    <StarterBoard questions={questions} disabled={disabled} onPick={onPick} className={className} />
  ) : (
    <StarterRail questions={questions} disabled={disabled} onPick={onPick} className={className} />
  );
}

/* ── Phone: the drifting rail ─────────────────────────────────────────────── */

function StarterRail({
  questions,
  disabled,
  onPick,
  className,
}: {
  questions: EngineerStarterQuestion[];
  disabled: boolean;
  onPick: (question: EngineerStarterQuestion) => void;
  className?: string;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const stoppedRef = useRef(false);
  const [overflows, setOverflows] = useState(false);
  const [stopped, setStopped] = useState(false);

  /**
   * The drift yields to the thumb: the first real interaction stops it for good
   * and hands over to ordinary finger-scroll, from wherever it had got to. A
   * button that slides out from under a finger already reaching for it is a bug,
   * not a flourish — and by the time you've touched it, the drift has done its
   * one job, which is telling you there are more than four.
   */
  const stopDrift = useCallback(() => {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    setStopped(true);
  }, []);

  /**
   * Which edges get a soft cut. Written straight to the DOM rather than through
   * state: the drift fires `scroll` every frame, and re-rendering the rail 60
   * times a second to move a gradient 24px would be absurd.
   */
  const paintEdges = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const max = rail.scrollWidth - rail.clientWidth;
    rail.dataset.fadeStart = String(rail.scrollLeft > 4);
    rail.dataset.fadeEnd = String(rail.scrollLeft < max - 4);
  }, []);

  // Is anything actually hidden off the right edge? With two short chips on a
  // wide phone there is nothing to reveal, and a rail that drifts anyway is noise.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      setOverflows(rail.scrollWidth - rail.clientWidth > MIN_OVERFLOW_PX);
      paintEdges();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [questions.length, paintEdges]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || !overflows || stopped) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let lastMs = 0;
    let phaseMs = 0;
    let phase: "holdStart" | "forward" | "holdEnd" | "rewind" = "holdStart";
    // Our own position authority — reading `scrollLeft` back each frame loses the
    // sub-pixel remainder at 20px/s and the rail never moves.
    let pos = 0;
    let rewindFrom = 0;

    const step = (now: number) => {
      if (stoppedRef.current) return;
      const dt = lastMs ? Math.min(now - lastMs, 64) : 0;
      lastMs = now;
      phaseMs += dt;

      const max = Math.max(0, rail.scrollWidth - rail.clientWidth);
      if (max <= MIN_OVERFLOW_PX) {
        frame = requestAnimationFrame(step);
        return;
      }

      if (phase === "holdStart") {
        if (phaseMs >= HOLD_AT_START_MS) {
          phase = "forward";
          phaseMs = 0;
        }
      } else if (phase === "forward") {
        pos += (DRIFT_PX_PER_SECOND * dt) / 1000;
        if (pos >= max) {
          pos = max;
          phase = "holdEnd";
          phaseMs = 0;
        }
        rail.scrollLeft = pos;
      } else if (phase === "holdEnd") {
        if (phaseMs >= HOLD_AT_END_MS) {
          phase = "rewind";
          phaseMs = 0;
          rewindFrom = pos;
        }
      } else {
        // Eased return to the first chip. No duplicate copy of the list in the
        // DOM: the rail shows what's over there, then brings you back.
        const t = Math.min(1, phaseMs / REWIND_MS);
        pos = rewindFrom * (1 - (1 - (1 - t) ** 3));
        rail.scrollLeft = pos;
        if (t >= 1) {
          pos = 0;
          rail.scrollLeft = 0;
          phase = "holdStart";
          phaseMs = 0;
        }
      }

      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [overflows, stopped]);

  return (
    <div
      ref={railRef}
      role="group"
      aria-label="Suggested questions"
      className={cn("engineer-starter-rail flex gap-1.5 pb-0.5", className)}
      onScroll={paintEdges}
      onPointerDown={stopDrift}
      onTouchStart={stopDrift}
      onWheel={stopDrift}
      onKeyDown={stopDrift}
      onFocus={stopDrift}
    >
      {questions.map((q) => (
        <StarterChip key={q.id} question={q} disabled={disabled} onPick={onPick} shape="pill" />
      ))}
    </div>
  );
}

/* ── Desktop: the empty-state board ──────────────────────────────────────── */

function StarterBoard({
  questions,
  disabled,
  onPick,
  className,
}: {
  questions: EngineerStarterQuestion[];
  disabled: boolean;
  onPick: (question: EngineerStarterQuestion) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Suggested questions"
      className={cn("engineer-starter-board grid w-full max-w-lg grid-cols-2 gap-2", className)}
    >
      {questions.map((q) => (
        <StarterChip key={q.id} question={q} disabled={disabled} onPick={onPick} shape="card" />
      ))}
    </div>
  );
}

/* ── The chip itself ─────────────────────────────────────────────────────── */

function StarterChip({
  question,
  disabled,
  onPick,
  shape,
}: {
  question: EngineerStarterQuestion;
  disabled: boolean;
  onPick: (question: EngineerStarterQuestion) => void;
  shape: "pill" | "card";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(question)}
      // The full question is what lands in the box — show it on hover so a
      // desktop driver knows what a tap is about to write.
      title={question.text}
      className={cn(
        // Outline, never a yellow fill: these are prompts, not the action. Yellow
        // fill stays on Send. The dot is `primary-ink` — yellow doing a foreground
        // job, matching the pinned dot on the subject bar right above.
        "tap-active group inline-flex shrink-0 items-center gap-1.5 border border-border bg-card text-left",
        "text-foreground transition hover:border-faint disabled:pointer-events-none disabled:opacity-50",
        shape === "pill"
          ? "whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium"
          : "items-start rounded-lg px-3 py-2.5 text-[13px] font-medium leading-snug",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1 shrink-0 rounded-full bg-primary-ink/60 transition group-hover:bg-primary-ink",
          shape === "card" && "mt-[0.42em]",
        )}
      />
      {/* The short label in both shapes. The card has more room, but the full
          question belongs in the composer where it can be edited, not on a
          button the driver has to read six of. */}
      <span>{question.label}</span>
    </button>
  );
}
