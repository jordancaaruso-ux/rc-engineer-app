import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const primaryClass =
  "inline-flex items-center justify-center rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-glow-sm transition hover:brightness-105";

const outlineClass =
  "inline-flex items-center justify-center rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted/60";

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
