"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { foldMobileNavId, resolveActiveNavId, type PrimaryNavId } from "@/components/layout/navConfig";

type PrimaryNavContextValue = {
  activeId: PrimaryNavId | null;
  /**
   * The same answer folded onto the five dock cells — Events, Garage and Tools
   * report as `more`. Both are published from here rather than resolved in the
   * dock so the optimistic tab (`pendingNavId`) applies to both equally.
   */
  mobileActiveId: PrimaryNavId | null;
  /** `href` arms the wedge self-heal for that destination — see `SOFT_NAV_HEAL_MS`. */
  beginNav: (id: PrimaryNavId, href: string) => void;
};

const PrimaryNavContext = createContext<PrimaryNavContextValue | null>(null);

/** Light shells only — Engineer / Sessions / garage hubs warm via Link hover. */
const PREFETCH_ROUTES = ["/", "/analysis", "/cars", "/settings"] as const;

/**
 * If a soft `<Link>` navigation hasn't committed within this window, we assume
 * the App Router client has wedged (a documented, recurring failure in the
 * installed PWA / webview — see `NewRunForm.navigateAway`) and escape with a
 * hard navigation. Every primary destination is prefetched, so a healthy soft
 * nav commits in well under this; the fallback only ever fires on a real wedge.
 *
 * The timer lives here, not per-link, so it always tracks the *latest* nav
 * intent: tapping a second tab replaces the first tap's target instead of
 * stacking beside it, and any committed navigation disarms it. Per-link timers
 * meant an abandoned destination could fire ~700ms after you'd already landed
 * somewhere else, hard-reloading the document (and flashing the PWA splash).
 */
const SOFT_NAV_HEAL_MS = 700;

/** Sets `data-nav-pending` on `<html>` during optimistic tab switches (no React re-render of page). */
function NavPendingMarker() {
  const pathname = usePathname();
  const { activeId } = usePrimaryNav();
  const pathnameId = resolveActiveNavId(pathname ?? "");
  const isPending = activeId !== null && activeId !== pathnameId;

  useEffect(() => {
    document.documentElement.toggleAttribute("data-nav-pending", isPending);
    return () => document.documentElement.removeAttribute("data-nav-pending");
  }, [isPending]);

  return null;
}

export function PrimaryNavProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingNavId, setPendingNavId] = useState<PrimaryNavId | null>(null);
  const pathnameId = resolveActiveNavId(pathname ?? "");
  const healTimerRef = useRef<number | null>(null);

  const disarmSoftNavFallback = useCallback(() => {
    if (healTimerRef.current === null) return;
    window.clearTimeout(healTimerRef.current);
    healTimerRef.current = null;
  }, []);

  // A committed navigation means the client router is alive — drop the
  // optimistic tab and any heal armed for a destination we've moved past.
  useEffect(() => {
    setPendingNavId(null);
    disarmSoftNavFallback();
  }, [pathname, disarmSoftNavFallback]);

  useEffect(() => disarmSoftNavFallback, [disarmSoftNavFallback]);

  useEffect(() => {
    const prefetchRoutes = () => {
      // Warm primary tabs only. Log Run is warmed on FAB / nav hover
      // (LogRunFab, PrimaryNavLink) so the heavy form chunk is not pulled idle.
      for (const route of PREFETCH_ROUTES) router.prefetch(route);
    };

    if (typeof requestIdleCallback === "function") {
      const idleId = requestIdleCallback(prefetchRoutes);
      return () => cancelIdleCallback(idleId);
    }

    const timeoutId = window.setTimeout(prefetchRoutes, 0);
    return () => window.clearTimeout(timeoutId);
  }, [router]);

  const beginNav = useCallback(
    (id: PrimaryNavId, href: string) => {
      setPendingNavId(id);
      if (typeof window === "undefined") return;
      disarmSoftNavFallback();
      healTimerRef.current = window.setTimeout(() => {
        healTimerRef.current = null;
        // Read live, not through a stale closure: a successful soft nav has
        // already disarmed this, so reaching here means nothing committed.
        if (window.location.pathname !== href) window.location.assign(href);
      }, SOFT_NAV_HEAL_MS);
    },
    [disarmSoftNavFallback]
  );

  const value = useMemo((): PrimaryNavContextValue => {
    const activeId = pendingNavId ?? pathnameId;
    return { activeId, mobileActiveId: foldMobileNavId(activeId), beginNav };
  }, [pendingNavId, pathnameId, beginNav]);

  return (
    <PrimaryNavContext.Provider value={value}>
      <NavPendingMarker />
      {children}
    </PrimaryNavContext.Provider>
  );
}

export function usePrimaryNav(): PrimaryNavContextValue {
  const ctx = useContext(PrimaryNavContext);
  if (!ctx) {
    throw new Error("usePrimaryNav must be used within PrimaryNavProvider");
  }
  return ctx;
}
