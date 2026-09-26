"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ComponentProps, type MouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useRegisterMobileBack } from "@/components/layout/MobileBackContext";
import {
  cameFromPathname,
  hrefPathname,
  recordPush,
  returnParentAmong,
} from "@/lib/navigation/returnTrail";
import { cn } from "@/lib/utils";

/** Muted icon-only back control for `.page-header` — not a primary (yellow) action. */
export function pageBackLinkClassName(className?: string) {
  return cn(
    "tap-active inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background/50 text-muted-foreground transition hover:bg-muted/60 hover:text-foreground",
    className
  );
}

/**
 * The page a back control points at: the first of `alternateParents` the return trail says the
 * driver opened this page from, else `defaultHref`. Resolved after mount, because the trail lives
 * in sessionStorage, so the server render and the first client render both say `defaultHref`.
 *
 * Exported for `SessionsBrowser`, which drives the phone's back control over the Sessions page and
 * must name the same destination as the header's arrow, or that arrow stops hiding.
 */
export function useReturnParent(
  defaultHref: string | null,
  alternateParents?: readonly string[]
): string | null {
  const pathname = usePathname();
  // A string, so the fresh array each server render sends doesn't re-run the effect.
  const alternatesKey = alternateParents?.join("\n") ?? "";
  const [matched, setMatched] = useState<string | null>(null);
  useEffect(() => {
    setMatched(
      alternatesKey && pathname ? returnParentAmong(pathname, alternatesKey.split("\n")) : null
    );
  }, [alternatesKey, pathname]);
  return (alternatesKey ? matched : null) ?? defaultHref;
}

export function PageBackLink({
  href,
  className,
  historyBackToken,
  alternateParents,
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
  /**
   * Other pages this one opens from, each a parent in its own right: team sessions opens from
   * the team's page as well as from Analysis. When the return trail says the driver came from
   * one of them, the arrow goes back there instead. `href` stays the answer for every arrival
   * the trail doesn't recognise. Only read when `href` is a string.
   */
  alternateParents?: readonly string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
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

  /*
   * The app-wide return trail (see `returnTrail.ts`): when the page this arrow
   * points at is the page the driver actually came from, back is real history
   * navigation — which restores their scroll position — with no per-door token.
   * The token above still wins where it's wired; the trail covers every other
   * door. Read after mount for the same hydration reason as the token.
   */
  const hrefString = useReturnParent(typeof href === "string" ? href : null, alternateParents);
  const [trailBack, setTrailBack] = useState(false);
  useEffect(() => {
    const target = hrefString ? hrefPathname(hrefString) : null;
    setTrailBack(target != null && pathname != null && cameFromPathname(target, pathname));
  }, [hrefString, pathname]);
  const canHistoryBack = useHistoryBack || trailBack;

  const onClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      // Leave modified clicks (new tab, new window) to the browser.
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      if (!canHistoryBack) {
        // The plain link pushes. Say so to the trail, or a push to the page underneath is
        // misread as a return (`recordPush`).
        if (hrefString) recordPush(hrefString);
        return;
      }
      e.preventDefault();
      goBack();
    },
    [canHistoryBack, goBack, hrefString]
  );

  // Publish this destination to the fixed mobile chrome so the top-left JRC pill
  // becomes the back button (only string hrefs — the chrome links to a plain URL).
  const chromeAdoptedBack = useRegisterMobileBack(
    hrefString ?? "",
    canHistoryBack ? goBack : null
  );

  // Only once the chrome is *actually* showing this back control would the header
  // copy be a redundant second arrow on mobile — hide it then, keep it on desktop.
  // False on the server render (adoption happens in an effect), so this class is
  // the same on both sides of hydration and can only ever change post-mount.
  const hideOnMobile = chromeAdoptedBack && hrefString != null;

  return (
    <Link
      href={hrefString ?? href}
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
