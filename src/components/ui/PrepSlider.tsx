"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";

/**
 * Chunky rail slider for a bounded integer — founder-approved via the slider
 * feel-test artifacts 2026-07-29, replacing the tape `RulerPicker` (retired:
 * its 120ms JS snap timer fought iOS momentum scroll, and a horizontal scroll
 * region inside the vertical run form kept losing the gesture to the page).
 *
 * Anatomy: a continuous 14px rail, accent fill, 26px white thumb riding on top.
 * The row's top-right readout grows ~24% while a finger is down (the only live
 * feedback on iOS web, where haptics are silent) — no floating value bubble.
 * On stepped scales with few stops (warmer temp: 11 × 5°C) hairline detent
 * notches fade in only while dragging; at rest the rail is clean. `touch-action:
 * none` claims the gesture outright — a drag that starts on the rail can never
 * be stolen by page scroll, matching native slider behaviour.
 *
 * The optional − / + stepper (minutes: 41 stops ≈ 7px apart) repeats while held,
 * accelerating after ~1.5s, so 5 → 45 is a hold, not 40 taps.
 */

/** Thumb radius (px) — the rail is inset by this so the thumb centre reaches both ends. */
const THUMB_R = 13;
/** Drag-only detent notches appear when a scale has at most this many stops. */
const MAX_NOTCH_STOPS = 14;
/** Hold-to-repeat: initial delay, tick, ticks before accelerating, fast tick (ms). */
const HOLD_DELAY_MS = 380;
const HOLD_TICK_MS = 95;
const HOLD_FAST_AFTER = 12;
const HOLD_FAST_TICK_MS = 45;

const SPRING = "[transition-timing-function:cubic-bezier(0.34,1.4,0.64,1)]";

type Props = {
  value: number | null;
  onChange: (next: number) => void;
  min: number;
  max: number;
  /** Snap grid: 1 = every integer (minutes), 5 = 5° steps (temp). */
  step: number;
  /** Thumb position while `value` is null (untouched step). */
  defaultValue: number;
  label: string;
  /** Readout unit, e.g. "min" / "°C". */
  unit: string;
  ariaLabel: string;
  /** Show the quiet − / + fine adjuster (dense scales only). */
  withStepper?: boolean;
  className?: string;
};

export function PrepSlider({
  value,
  onChange,
  min,
  max,
  step,
  defaultValue,
  label,
  unit,
  ariaLabel,
  withStepper = false,
  className,
}: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [live, setLive] = useState(false);
  const dragging = useRef(false);

  // Out-of-range stored values (e.g. 60min logged under the old 1–90 tape) keep
  // their honest readout; only the thumb position clamps to the rail.
  const shown = value ?? defaultValue;
  const frac = Math.max(0, Math.min(1, (shown - min) / (max - min)));

  // Live value for hold-repeat closures (intervals outlive renders).
  const shownRef = useRef(shown);
  shownRef.current = shown;

  const commit = (raw: number) => {
    const v = Math.max(min, Math.min(max, Math.round(raw / step) * step));
    if (v === shownRef.current && value != null) return;
    haptic("light");
    onChange(v);
  };

  const fracFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const span = r.width - 2 * THUMB_R;
    if (span <= 0) return 0;
    const x = Math.max(THUMB_R, Math.min(r.width - THUMB_R, clientX - r.left));
    return (x - THUMB_R) / span;
  };

  const commitFromEvent = (clientX: number) => {
    commit(min + fracFromClientX(clientX) * (max - min));
  };

  // ── hold-to-repeat stepper ─────────────────────────────────────────────
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTick = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (holdTick.current) clearInterval(holdTick.current);
    holdTimer.current = null;
    holdTick.current = null;
  };
  useEffect(() => stopHold, []);

  const startHold = (dir: 1 | -1) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const fire = () => commit(shownRef.current + dir * step);
    fire();
    holdTimer.current = setTimeout(() => {
      let n = 0;
      holdTick.current = setInterval(() => {
        fire();
        n += 1;
        if (n === HOLD_FAST_AFTER && holdTick.current) {
          clearInterval(holdTick.current);
          holdTick.current = setInterval(fire, HOLD_FAST_TICK_MS);
        }
      }, HOLD_TICK_MS);
    }, HOLD_DELAY_MS);
  };

  // ── geometry (CSS calc — no resize listeners) ──────────────────────────
  const leftFor = (f: number) =>
    `calc(${THUMB_R}px + ${f} * (100% - ${2 * THUMB_R}px))`;

  const stops = Math.round((max - min) / step);
  const notches: number[] = [];
  if (stops <= MAX_NOTCH_STOPS) {
    for (let v = min; v <= max; v += step) notches.push(v);
  }

  return (
    <div className={cn("select-none", className)} data-no-swipe>
      <div className="mb-0.5 flex min-h-[28px] items-center gap-2.5">
        <span className="text-[13px] font-medium text-foreground">{label}</span>
        {withStepper ? (
          <div className="flex gap-0.5">
            {([
              ["−", -1, value != null && shown <= min],
              ["+", 1, value != null && shown >= max],
            ] as const).map(([glyph, dir, disabled]) => (
              <button
                key={glyph}
                type="button"
                disabled={disabled}
                aria-label={`${dir === 1 ? "Increase" : "Decrease"} ${ariaLabel}`}
                onPointerDown={startHold(dir)}
                onPointerUp={stopHold}
                onPointerCancel={stopHold}
                onPointerLeave={stopHold}
                className="h-7 w-[30px] rounded-md font-mono text-base leading-none text-faint transition active:bg-accent active:text-accent-foreground disabled:text-border disabled:active:bg-transparent disabled:active:text-border"
              >
                {glyph}
              </button>
            ))}
          </div>
        ) : null}
        <span
          className={cn(
            "ml-auto origin-right font-mono text-[15px] tabular-nums transition-transform duration-150",
            SPRING,
            value == null ? "text-faint" : "text-primary-ink",
            live && "scale-[1.24]"
          )}
        >
          {value == null ? "—" : value}
          <span className="ml-0.5 text-[10.5px] text-faint">{unit}</span>
        </span>
      </div>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={shown}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          setLive(true);
          commitFromEvent(e.clientX);
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          commitFromEvent(e.clientX);
        }}
        onPointerUp={() => {
          dragging.current = false;
          setLive(false);
        }}
        onPointerCancel={() => {
          dragging.current = false;
          setLive(false);
        }}
        onKeyDown={(e) => {
          let v: number | null = null;
          if (e.key === "ArrowRight" || e.key === "ArrowUp") v = shown + step;
          else if (e.key === "ArrowLeft" || e.key === "ArrowDown") v = shown - step;
          else if (e.key === "Home") v = min;
          else if (e.key === "End") v = max;
          if (v == null) return;
          e.preventDefault();
          commit(v);
        }}
        className="relative h-11 cursor-pointer touch-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary-ink"
      >
        {/* rail + fill */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 h-3.5 -translate-y-1/2 rounded-full bg-muted"
        />
        <span
          aria-hidden
          style={{ width: leftFor(frac) }}
          className="pointer-events-none absolute left-0 top-1/2 h-3.5 -translate-y-1/2 rounded-full bg-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
        />
        {/* drag-only detent notches (temp) — hidden at rest, the covered stop stays hidden */}
        {notches.map((v) => (
          <span
            key={v}
            aria-hidden
            style={{ left: leftFor((v - min) / (max - min)) }}
            className={cn(
              "pointer-events-none absolute top-1/2 h-1.5 w-[1.5px] -translate-x-1/2 -translate-y-1/2 rounded-[1px] transition-opacity duration-200",
              v < shown ? "bg-black/40" : "bg-faint",
              live && v !== shown ? "opacity-55" : "opacity-0"
            )}
          />
        ))}
        {/* thumb */}
        <span
          aria-hidden
          style={{ left: leftFor(frac) }}
          className={cn(
            "pointer-events-none absolute top-1/2 h-[26px] w-[26px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white transition-transform duration-150",
            SPRING,
            "shadow-[0_0_1px_rgba(0,0,0,0.35),0_1px_2px_rgba(0,0,0,0.4),0_4px_10px_rgba(0,0,0,0.35)]",
            live && "scale-[1.14]"
          )}
        />
      </div>
    </div>
  );
}
