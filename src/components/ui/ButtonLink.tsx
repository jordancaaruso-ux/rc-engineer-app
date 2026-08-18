import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * One box for both variants. Measured 2026-08-18: primary came out **24px** tall
 * and outline **30px**, so a yellow button standing next to outline ones in a
 * toolbar sat visibly short. Two separate causes, both fixed here:
 *
 * 1. `.primary-action-chip` sets `line-height: 1` (12px at `text-xs`) where
 *    outline inherited 16px. `min-h-[30px]` + `items-center` settles it whichever
 *    line-height wins, rather than fighting the cascade over a utility.
 * 2. Only outline carried a border, making it 2px larger on both axes. Primary
 *    now carries a transparent one so the border-boxes match.
 *
 * Call sites can still override — `cn` is tailwind-merge, so a later `min-h-9`
 * (to match an input beside it) wins cleanly.
 */
const buttonBase =
  "tap-active inline-flex min-h-[30px] items-center justify-center rounded-lg border px-2.5 py-1.5 text-xs transition";

/**
 * `.primary-face` carries the lit rim and the crossing specular (globals.css),
 * replacing the flat `shadow-glow-sm` lift — yellow buttons are now the same
 * material as the Log-run circle, minus its outward aura, which stays reserved
 * for the single #1 action.
 */
const primaryClass = cn(
  buttonBase,
  "primary-action-chip primary-face border-transparent bg-primary font-bold text-primary-foreground hover:brightness-105 active:brightness-95"
);

const outlineClass = cn(
  buttonBase,
  "border-border bg-card font-medium text-foreground hover:border-primary-ink/40 hover:bg-muted/60"
);

/** Same visual as `ButtonLink` primary — use on native `<button>`. */
export function primaryButtonClassName(className?: string) {
  return cn(primaryClass, className);
}

/** Primary chip as the trailing segment of a composite input — same fill/hover as ADD chip. */
export function primarySegmentButtonClassName(className?: string) {
  return cn(
    primaryClass,
    "cursor-pointer rounded-l-none rounded-r-lg disabled:cursor-default disabled:hover:brightness-100 disabled:active:brightness-100",
    className
  );
}

/** Primary chip as the leading segment of a composite input — mirror of trailing ADD segment. */
export function primarySegmentLeadingClassName(className?: string) {
  return cn(
    "inline-flex shrink-0 items-center justify-center primary-face bg-primary text-primary-foreground",
    "rounded-l-lg rounded-r-none px-2.5 min-h-9 min-w-9",
    className
  );
}

/** Same visual as `ButtonLink` outline — use on native `<button>`. */
export function outlineButtonClassName(className?: string) {
  return cn(outlineClass, className);
}

export function buttonLinkClassName(variant: "primary" | "outline" = "primary", className?: string) {
  return cn(variant === "primary" ? primaryClass : outlineClass, className);
}

export function ButtonLink({
  href,
  variant = "primary",
  className,
  children,
  ...props
}: ComponentProps<typeof Link> & { variant?: "primary" | "outline" }) {
  return (
    <Link href={href} className={buttonLinkClassName(variant, className)} {...props}>
      {children}
    </Link>
  );
}
