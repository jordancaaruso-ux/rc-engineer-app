import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const primaryClass =
  "tap-active inline-flex items-center justify-center rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-glow-sm transition hover:brightness-105 active:brightness-95";

const outlineClass =
  "tap-active inline-flex items-center justify-center rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:border-accent/40 hover:bg-muted/60";

/** Same visual as `ButtonLink` primary — use on native `<button>`. */
export function primaryButtonClassName(className?: string) {
  return cn(primaryClass, className);
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
