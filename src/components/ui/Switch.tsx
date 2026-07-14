"use client";

import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";

/**
 * iOS-style toggle switch: a rounded track with a sliding knob. On = accent
 * (this is a control affordance, not data), off = muted charcoal. Accessible as
 * `role="switch"` with keyboard/space via the native button. Pair with a label
 * row (label on the left, switch on the right) — see the log-run share toggle.
 */
export function Switch({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => {
        haptic("light");
        onChange(!checked);
      }}
      className={cn(
        "relative inline-flex h-6 w-[42px] shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        checked ? "border-primary bg-primary" : "border-border bg-muted",
        disabled && "opacity-50",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-[21px]" : "translate-x-[3px]"
        )}
      />
    </button>
  );
}
