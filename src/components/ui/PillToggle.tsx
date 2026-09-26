"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SwitchPill } from "@/components/ui/SwitchPill";

/**
 * A small single-select switch: a grey track holding equal-width segments, the chosen one a white
 * pill that slides to whatever you tap — the same look as `SegmentedControl` (`.switch-rail` in
 * globals.css, founder pick 2026-09-26). Until then this was a round-ended track whose chosen
 * segment was `bg-muted` on near-white, which on paper you could barely see.
 *
 * Each segment is `flex-1` so labels of any length stay evenly spaced and the whole control spans
 * its container's width. Yellow stays reserved for actions, so the chosen segment is white, never
 * `bg-primary`.
 *
 * Semantics default to `radiogroup` (a persisted setting); pass `role="tablist"`
 * when the control switches a visible panel.
 */
export type PillToggleOption<T extends string> = {
  value: T;
  label: ReactNode;
  /** Accessible label when `label` is not plain text. */
  ariaLabel?: string;
};

export function PillToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  role = "radiogroup",
  disabled = false,
  className,
}: {
  options: ReadonlyArray<PillToggleOption<T>>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
  role?: "radiogroup" | "tablist";
  disabled?: boolean;
  className?: string;
}) {
  const itemRole = role === "tablist" ? "tab" : "radio";
  return (
    <div
      role={role}
      aria-label={ariaLabel}
      className={cn("switch-rail w-full items-stretch", className)}
    >
      <SwitchPill activeKey={value} />
      {options.map((opt) => {
        const on = opt.value === value;
        const selectedProps =
          itemRole === "tab" ? { "aria-selected": on } : { "aria-checked": on };
        return (
          <button
            key={opt.value}
            type="button"
            role={itemRole}
            {...selectedProps}
            data-on={on}
            aria-label={opt.ariaLabel}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "switch-seg min-h-8 flex-1 px-3 py-1.5 text-[12px] tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              !on && "hover:text-foreground",
              disabled && "opacity-60"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
