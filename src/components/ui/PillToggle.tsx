"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Apple-style segmented pill: a rounded-full track holding equal-width segments,
 * the active one lifted onto a `bg-muted` surface. This is the treatment the
 * Assets hub "Mine / Global" scope toggle uses — factored out here so every
 * single-select slider (Engineer Chat / Compare, answer mode) reads identically.
 *
 * Each segment is `flex-1` so labels of any length stay evenly spaced and the
 * whole control spans its container's width. Yellow stays reserved for actions,
 * so the active segment is neutral (charcoal-muted), never `bg-primary`.
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
      className={cn(
        "flex w-full items-center gap-0.5 rounded-full border border-border bg-background/45 p-0.5",
        className
      )}
    >
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
            aria-label={opt.ariaLabel}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex-1 rounded-full px-3 py-1.5 text-[12px] font-semibold tracking-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              on
                ? "bg-muted text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                : "text-muted-foreground hover:text-foreground",
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
