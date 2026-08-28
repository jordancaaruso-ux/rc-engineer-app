"use client";

import { useCallback, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Segmented single-select: one inset rail holding equal-width segments, with the
 * selected segment ink-inverted (`bg-foreground` + dark text) so "chosen" reads
 * instantly. Redesigned 2026-07-27 — was flat `chipToggleClass` chips in a gapped
 * row, where selected (`bg-muted`) vs unselected (`bg-secondary`) was grey-on-grey
 * and the options read as two loose buttons rather than one control. The shared
 * rail is what makes it a control; the inversion is what makes the state obvious.
 * Yellow stays out of it — selection is state, and yellow means action.
 *
 * Segments are `rounded-md` inside the `rounded-lg` rail (concentric radii: 8px
 * outer − 3px padding ≈ 5px inner) and `flex-1 basis-0` so labels of any length
 * stay aligned. Size may differ per use; the style is identical.
 *
 * `chipToggleClass` is still the treatment for standalone multi-select toggle
 * chips (layout direction, handling ratings) — this control no longer shares it.
 *
 * Semantics: `role="radiogroup"` + `role="radio"` per segment, with Left/Right
 * (and Up/Down) arrow keys walking the options like a native radio group.
 */
export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  /** Optional leading glyph (kept small; decorative). */
  icon?: ReactNode;
  /** Accessible label when `label` is not plain text. */
  ariaLabel?: string;
  /**
   * Render de-emphasized (fainter text, no hover lift) — a "hint" segment that
   * is still tappable but reads as not-yet-available (e.g. a Teams segment for a
   * user with no team, whose click routes to team setup). Does not disable the
   * click; the parent decides what selecting it does.
   */
  muted?: boolean;
  /**
   * Inert: a segment that exists to report an answer rather than offer a choice —
   * a timing source that was searched and came back with nothing. It stays on the
   * rail carrying its `0`, because removing it would read as "we never looked".
   * Skipped by arrow-key navigation so the keyboard can't land somewhere dead.
   */
  disabled?: boolean;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "md",
  className,
  segmentClassName,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
  size?: "sm" | "md";
  className?: string;
  /** Per-call-site padding / text size. Style stays identical; only the size may differ. */
  segmentClassName?: string;
}) {
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const count = options.length;

  const move = useCallback(
    (delta: number) => {
      if (count === 0) return;
      // Walk over inert segments rather than stopping on one — an arrow key that
      // lands on a disabled option leaves the group with no usable selection.
      for (let step = 1; step <= count; step += 1) {
        const next = (((activeIndex + delta * step) % count) + count) % count;
        const opt = options[next];
        if (opt && !opt.disabled) {
          onChange(opt.value);
          return;
        }
      }
    },
    [activeIndex, count, options, onChange]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      }
    },
    [move]
  );

  const segText = size === "sm" ? "text-xs" : "text-sm";
  const segPad = size === "sm" ? "px-3 py-1" : "px-4 py-1.5";

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        "flex w-full select-none items-stretch gap-[3px] rounded-lg border border-border bg-secondary p-[3px]",
        className
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.ariaLabel}
            disabled={opt.disabled}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex flex-1 basis-0 items-center justify-center gap-1.5 rounded-md font-sans tracking-tight transition-colors duration-150 touch-manipulation disabled:opacity-60",
              segText,
              segPad,
              active
                ? "bg-foreground font-semibold text-background shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
                : "font-medium text-muted-foreground hover:text-foreground",
              // A "hint" segment that is inactive reads fainter, still tappable.
              !active && opt.muted && "text-muted-foreground/45 hover:text-muted-foreground/45",
              segmentClassName
            )}
          >
            {opt.icon ? (
              <span className="shrink-0" aria-hidden>
                {opt.icon}
              </span>
            ) : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
