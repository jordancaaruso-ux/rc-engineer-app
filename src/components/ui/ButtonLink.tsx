import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * One box for every variant. Measured 2026-08-18: primary came out **24px** tall
 * and outline **30px**, so a yellow button standing next to outline ones in a
 * toolbar sat visibly short. Two separate causes, both fixed here:
 *
 * 1. `.primary-action-chip` sets `line-height: 1` where outline inherited 16px.
 *    A `min-h-*` + `items-center` settles it whichever line-height wins, rather
 *    than fighting the cascade over a utility.
 * 2. Only outline carried a border, making it 2px larger on both axes. Primary
 *    and door carry a transparent one so the border-boxes match.
 *
 * 36px, 13.5px type and 10px corners since 2026-09-25 (founder pick "D · Apple
 * style", benched on the real pages): at 30px with 12px type the chips read as
 * tags rather than buttons. 36px is also an input's height, so a button beside a
 * field matches it without a call-site `min-h-9`.
 *
 * Call sites can still override — `cn` is tailwind-merge, so a later `min-h-*`,
 * `px-*` or `text-*` wins cleanly.
 */
const buttonBase =
  "tap-active inline-flex min-h-9 items-center justify-center rounded-[10px] border px-3.5 py-1.5 text-[13.5px] tracking-[-0.005em] transition";

/**
 * `.primary-face` carries the whole yellow material (globals.css): light from above
 * and a shadow in the yellow's own gold, with the hover and press shadows living on
 * the class rather than here. The 1.5px cream/bronze bevel and the crossing sheen
 * stay on the Log-run circle and the dashboard bar, which is the point — that face
 * marks the single #1 action, and it stops meaning anything if 87 buttons wear it.
 *
 * Weight is `font-semibold`, not `font-bold`, from the same change. Bold + 12px +
 * yellow at once is three kinds of emphasis stacked on a word like "Edit"; 600 is
 * the register the rest of the paper theme is set in.
 */
const primaryClass = cn(
  buttonBase,
  "primary-action-chip primary-face border-transparent bg-primary font-semibold text-primary-foreground hover:brightness-105 active:brightness-95"
);

const outlineClass = cn(
  buttonBase,
  "border-border bg-card font-medium text-foreground hover:border-primary-ink/40 hover:bg-muted/60"
);

/**
 * The door: a button that goes somewhere rather than doing something — "Open the lab",
 * "View all 8 cars". Apple's grey button: ink at 5.5% over the card, ink words, no shadow
 * (founder pick 2026-09-25, "D · Apple style"). Yellow stays for doing things, so a hub page
 * keeps one or two yellows instead of one per card. `BandFoot` draws the same grey at band
 * width.
 */
const doorClass = cn(
  buttonBase,
  "border-transparent bg-foreground/[0.055] font-semibold text-foreground hover:bg-foreground/[0.08] active:bg-foreground/[0.1]"
);

export type ButtonVariant = "primary" | "outline" | "door";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: primaryClass,
  outline: outlineClass,
  door: doorClass,
};

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

export function buttonLinkClassName(variant: ButtonVariant = "primary", className?: string) {
  return cn(VARIANT_CLASS[variant], className);
}

export function ButtonLink({
  href,
  variant = "primary",
  className,
  children,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return (
    <Link href={href} className={buttonLinkClassName(variant, className)} {...props}>
      {children}
    </Link>
  );
}
