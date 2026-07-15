"use client";

import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";

/**
 * Horizontal snap ruler — a tape-measure for a bounded integer (tire-prep
 * minutes, warmer °C). Founder-approved via design artifact 2026-07-14.
 *
 * A fixed yellow needle sits at the center; the tick track scrolls beneath it.
 * Drag / flick / native scroll all work; tapping a numeric label jumps to it;
 * on scroll-settle the track snaps to a value per `snapStep` / `magnetTo`.
 * Each detent crossed fires a haptic (heavier on magnet multiples). `onChange`
 * streams live while scrubbing (the parent value chip follows), settling on the
 * snapped value.
 *
 * Snapping (founder-tuned 2026-07-15 via the feel-test artifact):
 *  - `snapStep` is the base grid (minutes: 1 → every value; temp: 5 → 5° steps).
 *  - `magnetTo` + `magnetRadius` add a sticky detent: minutes snap to any integer
 *    but multiples of 5 magnetically grab within `magnetRadius` units, so a casual
 *    scrub lands on 5s while a deliberate stop still reaches a 17.
 *
 * The scroll track claims horizontal panning (`touch-pan-x`) and carries
 * `data-no-swipe` so a host `PagedCard` never mistakes a ruler scrub for a page
 * swipe (the card behind it must not flip while you dial a value).
 */
const PX_PER_UNIT = 11;
const SNAP_DELAY_MS = 120;

type Props = {
  value: number | null;
  onChange: (next: number) => void;
  min: number;
  max: number;
  /** Value used to position the track when `value` is null (untouched step). */
  defaultValue: number;
  /** Which integers get a numeric label under their tick. */
  labelAt: (v: number) => boolean;
  unit: string;
  ariaLabel: string;
  /** Base snap grid: 1 = every integer, 5 = only multiples of 5. Default 1. */
  snapStep?: number;
  /** Value multiple that magnetically grabs on settle (e.g. 5 for sticky-5s). */
  magnetTo?: number;
  /** Pull radius (in units) for `magnetTo`; within this a value snaps to the magnet. */
  magnetRadius?: number;
  className?: string;
};

export function RulerPicker({
  value,
  onChange,
  min,
  max,
  defaultValue,
  labelAt,
  unit,
  ariaLabel,
  snapStep = 1,
  magnetTo,
  magnetRadius = 0,
  className,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const readoutRef = useRef<HTMLSpanElement | null>(null);
  const needleRef = useRef<HTMLSpanElement | null>(null);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastValue = useRef<number | null>(null);
  /** Ignore scroll events caused by our own programmatic positioning. */
  const settling = useRef(false);

  const clamp = useCallback(
    (v: number) => Math.max(min, Math.min(max, v)),
    [min, max]
  );
  const leftFor = useCallback(
    (v: number) => (v - min) * PX_PER_UNIT + PX_PER_UNIT / 2,
    [min]
  );

  /** Snap a continuous position to a value: base grid, with a magnetic pull toward `magnetTo`. */
  const settleValue = useCallback(
    (raw: number) => {
      if (magnetTo && magnetTo > 0) {
        const m = Math.round(raw / magnetTo) * magnetTo;
        if (Math.abs(raw - m) <= magnetRadius) return clamp(m);
      }
      return clamp(Math.round(raw / snapStep) * snapStep);
    },
    [clamp, magnetTo, magnetRadius, snapStep]
  );

  const valueAt = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return min;
    return settleValue((el.scrollLeft - PX_PER_UNIT / 2) / PX_PER_UNIT + min);
  }, [settleValue, min]);

  // Initial position (and external value sync while not actively scrubbing).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = clamp(value ?? defaultValue);
    if (lastValue.current === target) return;
    lastValue.current = target;
    settling.current = true;
    el.scrollLeft = leftFor(target);
    if (readoutRef.current) readoutRef.current.textContent = `${target} ${unit}`;
    requestAnimationFrame(() => {
      settling.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const v = valueAt();
    if (v !== lastValue.current) {
      // Multiples of the magnet are the "strong" detents — heavier buzz + a brief
      // needle flare (the only feedback on iOS web, where haptics are silent).
      const heavy = magnetTo != null && magnetTo > 0 && v % magnetTo === 0;
      lastValue.current = v;
      if (readoutRef.current) readoutRef.current.textContent = `${v} ${unit}`;
      onChange(v);
      haptic(heavy ? "medium" : "light");
      if (heavy && needleRef.current) {
        const n = needleRef.current;
        n.style.boxShadow = "0 0 16px rgba(255,214,10,0.95)";
        n.style.height = "26px";
        if (pulseTimer.current) clearTimeout(pulseTimer.current);
        pulseTimer.current = setTimeout(() => {
          n.style.boxShadow = "";
          n.style.height = "";
        }, 150);
      }
    }
    if (settling.current) return;
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => {
      const settled = valueAt();
      el.scrollTo({ left: leftFor(settled), behavior: "smooth" });
    }, SNAP_DELAY_MS);
  }, [leftFor, magnetTo, onChange, unit, valueAt]);

  useEffect(() => {
    return () => {
      if (snapTimer.current) clearTimeout(snapTimer.current);
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
    };
  }, []);

  // Pointer drag-to-scrub (touch scrolls natively; this covers mouse).
  const drag = useRef<{ startX: number; startLeft: number } | null>(null);
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const el = scrollRef.current;
    if (!el) return;
    drag.current = { startX: e.clientX, startLeft: el.scrollLeft };
    el.setPointerCapture(e.pointerId);
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || !drag.current) return;
    el.scrollLeft = drag.current.startLeft - (e.clientX - drag.current.startX);
  }, []);
  const onPointerUp = useCallback(() => {
    drag.current = null;
  }, []);

  const onTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const jump = (e.target as HTMLElement).closest<HTMLElement>("[data-jump]");
      if (!jump || !scrollRef.current) return;
      scrollRef.current.scrollTo({ left: leftFor(Number(jump.dataset.jump)), behavior: "smooth" });
    },
    [leftFor]
  );

  const ticks: React.ReactNode[] = [];
  for (let v = min; v <= max; v++) {
    const is10 = v % 10 === 0;
    const is5 = v % 5 === 0;
    ticks.push(
      <span
        key={v}
        style={{ width: PX_PER_UNIT }}
        className="relative flex flex-none flex-col items-center"
      >
        <span
          className={cn(
            "w-px",
            is10 ? "h-[17px] bg-faint" : is5 ? "h-[13px] bg-faint" : "h-2 bg-border"
          )}
        />
        {labelAt(v) ? (
          <span
            data-jump={v}
            className="absolute top-[19px] cursor-pointer font-mono text-[9px] tabular-nums text-faint hover:text-muted-foreground"
          >
            {v}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <div
      data-no-swipe
      className={cn("relative pb-3 pt-2.5", className)}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value ?? defaultValue}
    >
      <span
        ref={readoutRef}
        className="pointer-events-none absolute left-1/2 top-1.5 z-[3] -translate-x-1/2 font-mono text-[11px] tabular-nums text-accent"
      />
      <span
        ref={needleRef}
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-6 z-[2] h-5 w-0.5 -translate-x-1/2 rounded-[1px] bg-accent shadow-[0_0_8px_rgba(255,214,10,0.5)] transition-[height,box-shadow] duration-100"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-6 z-[1] h-10 w-14 bg-gradient-to-r from-secondary to-transparent"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute right-0 top-6 z-[1] h-10 w-14 bg-gradient-to-l from-secondary to-transparent"
      />
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={onTrackClick}
        className="mt-3.5 cursor-grab touch-pan-x select-none overflow-y-hidden overflow-x-auto overscroll-contain active:cursor-grabbing [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {/* w-max so the track sizes to its content — otherwise it collapses to
            the viewport width, the ticks overflow, and the trailing px-[50%] pad
            lands inside the box instead of after the last tick, cutting the last
            ~half-viewport of values off from ever reaching the center needle. */}
        <div className="flex h-[34px] w-max items-start px-[50%]">{ticks}</div>
      </div>
    </div>
  );
}
