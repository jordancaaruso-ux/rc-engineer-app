"use client";

import { useCallback, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SwitchPill } from "@/components/ui/SwitchPill";

/**
 * Segmented single-select: one grey track holding equal-width segments, the chosen one a white
 * pill that slides to whatever you tap (`.switch-rail` in globals.css, `SwitchPill`). Founder pick
 * 2026-09-26 off the Track-First test page, replacing the ink-inverted black segment of
 * 2026-07-27. What that redesign got right still holds: the shared track is what makes it one
 * control rather than loose buttons, and yellow stays out of it — selection is state, and yellow
 * means action.
 *
 * Heights follow the test page: 36px for `md`, 32px for `sm`. Size may differ per use (call sites
 * pass `segmentClassName`); the look is identical. An `md` label never wraps: its segment grows to
 * fit the words and the others share what is left, which keeps "Write from scratch" on one line
 * at 390px.
 *
 * `chipToggleClass` is still the treatment for standalone multi-select toggle chips (layout
 * direction, handling ratings) — this control does not share it.
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

  const segSize =
    size === "sm"
      ? "min-h-8 px-3 py-1 text-xs"
      : "min-h-9 min-w-fit whitespace-nowrap px-3 py-1.5 text-sm";

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn("switch-rail w-full select-none items-stretch", className)}
    >
      <SwitchPill activeKey={value} />
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-on={active}
            aria-label={opt.ariaLabel}
            disabled={opt.disabled}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            className={cn(
              "switch-seg flex flex-1 basis-0 items-center justify-center gap-1.5 font-sans tracking-tight touch-manipulation disabled:opacity-60",
              segSize,
              !active && "hover:text-foreground",
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
