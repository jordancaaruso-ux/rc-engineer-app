import Link from "next/link";
import type { ComponentProps } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** Muted icon-only back control for `.page-header` — not a primary (yellow) action. */
export function pageBackLinkClassName(className?: string) {
  return cn(
    "tap-active inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background/50 text-muted-foreground transition hover:bg-muted/60 hover:text-foreground",
    className
  );
}

export function PageBackLink({
  href,
  className,
  ...props
}: ComponentProps<typeof Link>) {
  return (
    <Link href={href} prefetch aria-label="Back" className={pageBackLinkClassName(className)} {...props}>
      <ChevronLeft className="size-[18px]" strokeWidth={2} aria-hidden />
    </Link>
  );
}
