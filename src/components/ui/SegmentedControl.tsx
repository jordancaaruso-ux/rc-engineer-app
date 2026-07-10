"use client";

import { useCallback, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { chipToggleClass } from "@/components/ui/chipToggle";

/**
 * Segmented single-select: a row of equal-width flat chips (no sliding pill), so
 * it matches every other toggle group in the app via the shared `chipToggleClass`
 * treatment — `rounded-md` border, neutral `bg-muted` active surface, yellow
 * reserved for actions. Two or more segments; each is `flex-1 basis-0` so labels
 * of any length stay aligned. Size may differ per use; the style is identical.
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
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "md",
  className,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const count = options.length;

  const move = useCallback(
    (delta: number) => {
      if (count === 0) return;
      const next = (activeIndex + delta + count) % count;
      const opt = options[next];
      if (opt) onChange(opt.value);
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
      className={cn("flex w-full select-none gap-1", className)}
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
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            className={cn(
              chipToggleClass(active),
              "flex flex-1 basis-0 items-center justify-center gap-1.5",
              segText,
              segPad,
              // A "hint" segment that is inactive reads fainter, still tappable.
              !active && opt.muted && "text-muted-foreground/45 hover:text-muted-foreground/45"
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
