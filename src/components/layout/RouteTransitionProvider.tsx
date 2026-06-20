"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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

export function RouteTransitionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);

  const beginTransition = useCallback((href: string) => {
    const target = normalizePath(href);
    const current = normalizePath(pathname ?? "");
    if (pathsMatch(current, target)) return;
    setPendingHref(target);
    setShowOverlay(true);
  }, [pathname]);

  useEffect(() => {
    if (!pendingHref || !showOverlay) return;
    const current = normalizePath(pathname ?? "");
    if (!pathsMatch(current, pendingHref)) return;

    // Hold the branded skeleton one paint past route commit so Next.js never
    // exposes an empty <main> between hub content and segment loading.tsx.
    let innerId = 0;
    const outerId = requestAnimationFrame(() => {
      innerId = requestAnimationFrame(() => {
        setShowOverlay(false);
        setPendingHref(null);
      });
    });
    return () => {
      cancelAnimationFrame(outerId);
      cancelAnimationFrame(innerId);
    };
  }, [pathname, pendingHref, showOverlay]);

  const value = useMemo(
    (): RouteTransitionContextValue => ({ beginTransition }),
    [beginTransition]
  );

  return (
    <RouteTransitionContext.Provider value={value}>
      {children}
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
