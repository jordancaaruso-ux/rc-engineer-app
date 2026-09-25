"use client";

import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";

/**
 * iPhone-style toggle switch: a rounded track with a sliding knob. Accessible as
 * `role="switch"` with keyboard/space via the native button.
 *
 * The look is a founder pick (2026-09-25, off a bench of the real log-run Tires step): the
 * iPhone switch one size down, 44×27. Off is a grey track you can find on a white card — the
 * old one was near-white with a hairline, and "Different front and rear" beside it read as a
 * caption, not a control. On is the lit yellow of `.primary-face`, without its shadow: a
 * track sits in the card, it doesn't lift off it like a button. The knob is white with a
 * soft shadow. Put it right after its words (the Tires step's "Different front and rear"),
 * not across the card from them.
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
        "relative inline-flex h-[27px] w-[44px] shrink-0 items-center rounded-full transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        checked
          ? "bg-primary bg-[linear-gradient(180deg,rgb(var(--color-primary-lit))_0%,rgb(var(--color-primary))_55%,rgb(var(--color-primary-deep))_100%)]"
          : "bg-foreground/10",
        disabled && "opacity-50",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block h-[23px] w-[23px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_3px_1px_rgba(0,0,0,0.06),0_0_0_0.5px_rgba(0,0,0,0.04)] transition-transform motion-reduce:transition-none",
          checked ? "translate-x-[19px]" : "translate-x-[2px]"
        )}
      />
    </button>
  );
}
