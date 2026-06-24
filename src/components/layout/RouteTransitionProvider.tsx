"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { usePathname } from "next/navigation";
import { loadingSkeletonForPath } from "@/components/ui/PageSkeletons";

type RouteTransitionContextValue = {
  beginTransition: (href: string) => void;
};

const RouteTransitionContext = createContext<RouteTransitionContextValue | null>(null);

function normalizePath(href: string): string {
  const path = href.split("?")[0]?.split("#")[0] ?? href;
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function pathsMatch(current: string, target: string): boolean {
  return current === target || current.startsWith(`${target}/`);
}

/** Minimum overlay hold so pathname can commit before segment loading.tsx paints. */
const OVERLAY_MIN_HOLD_MS = 180;

export function RouteTransitionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);
  const overlayStartedAtRef = useRef(0);

  const beginTransition = useCallback((href: string) => {
    const target = normalizePath(href);
    const current = normalizePath(pathname ?? "");
    if (pathsMatch(current, target)) return;
    overlayStartedAtRef.current = performance.now();
    // Paint overlay synchronously before Link navigation swaps route content.
    flushSync(() => {
      setPendingHref(target);
      setShowOverlay(true);
    });
  }, [pathname]);

  useLayoutEffect(() => {
    if (!pendingHref || !showOverlay) return;
    const current = normalizePath(pathname ?? "");
    if (!pathsMatch(current, pendingHref)) return;

    // Pathname can update before App Router mounts segment loading.tsx — hold the
    // branded skeleton until a minimum dwell + extra paints so <main> never gaps.
    let rafId = 0;
    let timeoutId = 0;
    let cancelled = false;

    const finish = () => {
      if (cancelled) return;
      setShowOverlay(false);
      setPendingHref(null);
    };

    const scheduleDismiss = () => {
      const elapsed = performance.now() - overlayStartedAtRef.current;
      const remaining = Math.max(0, OVERLAY_MIN_HOLD_MS - elapsed);
      timeoutId = window.setTimeout(() => {
        rafId = requestAnimationFrame(() => {
          rafId = requestAnimationFrame(() => {
            rafId = requestAnimationFrame(finish);
          });
        });
      }, remaining);
    };

    scheduleDismiss();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      cancelAnimationFrame(rafId);
    };
  }, [pathname, pendingHref, showOverlay]);

  const value = useMemo(
    (): RouteTransitionContextValue => ({ beginTransition }),
    [beginTransition]
  );

  return (
    <RouteTransitionContext.Provider value={value}>
      <div className="flex min-h-[100dvh] flex-1 flex-col bg-background md:min-h-0">
        {children}
      </div>
      {showOverlay && pendingHref ? (
        <div
          className="pointer-events-none absolute inset-0 z-10 flex min-h-0 flex-1 flex-col bg-background"
          aria-busy="true"
          aria-live="polite"
        >
          {loadingSkeletonForPath(pendingHref)}
        </div>
      ) : null}
    </RouteTransitionContext.Provider>
  );
}

export function useRouteTransition(): RouteTransitionContextValue {
  const ctx = useContext(RouteTransitionContext);
  if (!ctx) {
    throw new Error("useRouteTransition must be used within RouteTransitionProvider");
  }
  return ctx;
}
