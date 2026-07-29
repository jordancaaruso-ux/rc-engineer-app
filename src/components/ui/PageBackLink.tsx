"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { ChevronLeft } from "lucide-react";
import { useRegisterMobileBack } from "@/components/layout/MobileBackContext";
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
  // Publish this destination to the fixed mobile chrome so the top-left JRC pill
  // becomes the back button (only string hrefs — the chrome links to a plain URL).
  const hrefString = typeof href === "string" ? href : null;
  const chromeAdoptedBack = useRegisterMobileBack(hrefString ?? "");

  // Only once the chrome is *actually* showing this back control would the header
  // copy be a redundant second arrow on mobile — hide it then, keep it on desktop.
  // False on the server render (adoption happens in an effect), so this class is
  // the same on both sides of hydration and can only ever change post-mount.
  const hideOnMobile = chromeAdoptedBack && hrefString != null;

  return (
    <Link
      href={href}
      prefetch
      aria-label="Back"
      className={pageBackLinkClassName(cn(hideOnMobile && "max-md:hidden", className))}
      {...props}
    >
      <ChevronLeft className="size-[18px]" strokeWidth={2} aria-hidden />
    </Link>
  );
}
