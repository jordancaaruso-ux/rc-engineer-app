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
 * on scroll-settle the track snaps to the nearest integer. Each detent crossed
 * fires a light haptic. `onChange` streams live while scrubbing (the parent
 * value chip follows), settling on the snapped value.
 */
const PX_PER_UNIT = 9;
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
  className,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const readoutRef = useRef<HTMLSpanElement | null>(null);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const valueAt = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return min;
    return clamp(Math.round((el.scrollLeft - PX_PER_UNIT / 2) / PX_PER_UNIT) + min);
  }, [clamp, min]);

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
      lastValue.current = v;
      if (readoutRef.current) readoutRef.current.textContent = `${v} ${unit}`;
      onChange(v);
      haptic("light");
    }
    if (settling.current) return;
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => {
      const settled = valueAt();
      el.scrollTo({ left: leftFor(settled), behavior: "smooth" });
    }, SNAP_DELAY_MS);
  }, [leftFor, onChange, unit, valueAt]);

  useEffect(() => {
    return () => {
      if (snapTimer.current) clearTimeout(snapTimer.current);
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
      <span key={v} className="relative flex w-[9px] flex-none flex-col items-center">
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
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-6 z-[2] h-5 w-0.5 -translate-x-1/2 rounded-[1px] bg-accent shadow-[0_0_8px_rgba(255,214,10,0.5)]"
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
        className="mt-3.5 cursor-grab select-none overflow-y-hidden overflow-x-auto overscroll-contain active:cursor-grabbing [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex h-[34px] items-start px-[50%]">{ticks}</div>
      </div>
    </div>
  );
}
