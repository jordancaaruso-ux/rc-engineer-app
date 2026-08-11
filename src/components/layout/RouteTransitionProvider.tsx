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
import { usePathname } from "next/navigation";
import { loadingSkeletonForPath } from "@/components/ui/PageSkeletons";

type RouteTransitionContextValue = {
  beginTransition: (href: string) => void;
  cancelTransition: () => void;
};

const RouteTransitionContext = createContext<RouteTransitionContextValue | null>(null);

function normalizePath(href: string): string {
  const path = href.split("?")[0]?.split("#")[0] ?? href;
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function pathsMatch(current: string, target: string): boolean {
  return current === target || current.startsWith(`${target}/`);
}

/**
 * Max wait before we *reveal* the skeleton. We no longer paint the overlay on
 * tap — an instant/cached navigation commits well within this window and never
 * flashes a skeleton at all. Only a navigation that hasn't committed by now
 * (genuinely slow route/data) reveals the branded skeleton. This replaces the
 * old forced minimum-hold that made *every* tap sit on grey cards for ~180ms.
 */
const OVERLAY_SHOW_DELAY_MS = 120;

/**
 * When a placeholder is allowed to become VISIBLE, measured from the tap.
 *
 * The same deadline `rc-skeleton-shell` applies to `loading.tsx` (globals.css), so a
 * soft navigation and a hard one behave identically — which they did not before:
 * `loading.tsx` had no delay at all and painted its cards the instant the server
 * flushed the shell.
 *
 * Mounting (above) stays earlier and cheaper than revealing, so the two are
 * different numbers; subtracting keeps the number the USER experiences at 400ms
 * rather than 120 + 400.
 */
const SKELETON_VISIBLE_AFTER_MS = 400;

/**
 * Backstop: if `beginTransition` arms a transition but navigation never commits
 * (e.g. a touch `pointerdown` that turns into a scroll, not a tap), self-dismiss
 * so a revealed overlay can't strand and hide the whole page.
 */
const OVERLAY_MAX_HOLD_MS = 1500;

export function RouteTransitionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);
  const pendingHrefRef = useRef<string | null>(null);
  const showTimerRef = useRef(0);
  const strandTimerRef = useRef(0);

  const clearTimers = useCallback(() => {
    window.clearTimeout(showTimerRef.current);
    window.clearTimeout(strandTimerRef.current);
    showTimerRef.current = 0;
    strandTimerRef.current = 0;
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    pendingHrefRef.current = null;
    setPendingHref(null);
    setShowOverlay(false);
  }, [clearTimers]);

  const beginTransition = useCallback((href: string) => {
    const target = normalizePath(href);
    const current = normalizePath(pathname ?? "");
    if (pathsMatch(current, target)) return;
    clearTimers();
    pendingHrefRef.current = target;
    setPendingHref(target);
    // Do NOT paint immediately — the current page stays put. Reveal the skeleton
    // only if the route hasn't committed within the show-delay; fast navigations
    // swap straight to content with no grey flash.
    showTimerRef.current = window.setTimeout(() => {
      if (pendingHrefRef.current) setShowOverlay(true);
    }, OVERLAY_SHOW_DELAY_MS);
    strandTimerRef.current = window.setTimeout(reset, OVERLAY_MAX_HOLD_MS);
  }, [pathname, clearTimers, reset]);

  const cancelTransition = useCallback(() => {
    reset();
  }, [reset]);

  useLayoutEffect(() => {
    if (!pendingHrefRef.current) return;
    const current = normalizePath(pathname ?? "");
    if (!pathsMatch(current, pendingHrefRef.current)) return;

    // Committed. Cancel any pending reveal; if the skeleton is already showing,
    // lift it after one frame so the committed segment (content or its own
    // loading.tsx) paints first and <main> never gaps for a frame.
    clearTimers();
    pendingHrefRef.current = null;
    const rafId = requestAnimationFrame(() => {
      setShowOverlay(false);
      setPendingHref(null);
    });
    return () => cancelAnimationFrame(rafId);
  }, [pathname, clearTimers]);

  const value = useMemo(
    (): RouteTransitionContextValue => ({ beginTransition, cancelTransition }),
    [beginTransition, cancelTransition]
  );

  return (
    <RouteTransitionContext.Provider value={value}>
      <div className="flex min-h-[100dvh] flex-1 flex-col md:min-h-0">
        {children}
      </div>
      {showOverlay && pendingHref ? (
        <div
          /* No `bg-background` here — `PageLoadingShell` carries it, INSIDE the
             delayed fade. On this element it would paint opaque the moment the
             overlay mounts and blank the page the visitor is still reading, 280ms
             before the placeholder it is covering for is allowed to appear. */
          className="pointer-events-none absolute inset-0 z-10 flex min-h-0 flex-1 flex-col"
          aria-busy="true"
          aria-live="polite"
          style={
            {
              "--rc-skeleton-wait": `${SKELETON_VISIBLE_AFTER_MS - OVERLAY_SHOW_DELAY_MS}ms`,
            } as React.CSSProperties
          }
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
