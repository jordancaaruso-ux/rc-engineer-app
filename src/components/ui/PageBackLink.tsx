"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ComponentProps, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
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
  historyBackToken,
  ...props
}: ComponentProps<typeof Link> & {
  /**
   * Opt in to real history navigation: when `sessionStorage[SESSIONS_RETURN_KEY]`
   * matches this token, the arrow calls `router.back()` instead of pushing `href`.
   * Same destination either way (the caller's `href` describes it fully) — going
   * back through history just avoids stacking a duplicate entry, so a second tap
   * doesn't bounce the driver between the two pages. Falls back to the plain link
   * whenever we didn't put them here: shared link, cold launch, arrived elsewhere.
   */
  historyBackToken?: { key: string; value: string } | null;
}) {
  const router = useRouter();
  // Read after mount only — sessionStorage doesn't exist on the server, and the
  // markup must match on both sides of hydration.
  const [useHistoryBack, setUseHistoryBack] = useState(false);
  useEffect(() => {
    if (!historyBackToken) {
      setUseHistoryBack(false);
      return;
    }
    try {
      setUseHistoryBack(sessionStorage.getItem(historyBackToken.key) === historyBackToken.value);
    } catch {
      setUseHistoryBack(false);
    }
  }, [historyBackToken]);

  const goBack = useCallback(() => {
    if (historyBackToken) {
      try {
        sessionStorage.removeItem(historyBackToken.key);
      } catch {
        // Non-fatal — the token is only ever an optimisation.
      }
    }
    router.back();
  }, [historyBackToken, router]);

  const onClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      // Leave modified clicks (new tab, new window) to the browser.
      if (!useHistoryBack || e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      goBack();
    },
    [useHistoryBack, goBack]
  );

  // Publish this destination to the fixed mobile chrome so the top-left JRC pill
  // becomes the back button (only string hrefs — the chrome links to a plain URL).
  const hrefString = typeof href === "string" ? href : null;
  const chromeAdoptedBack = useRegisterMobileBack(
    hrefString ?? "",
    useHistoryBack ? goBack : null
  );

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
      onClick={onClick}
      className={pageBackLinkClassName(cn(hideOnMobile && "max-md:hidden", className))}
      {...props}
    >
      <ChevronLeft className="size-[18px]" strokeWidth={2} aria-hidden />
    </Link>
  );
}
