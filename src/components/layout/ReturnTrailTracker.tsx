"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  noteTraversal,
  recordPathname,
  rememberScroll,
  takeReturnScroll,
} from "@/lib/navigation/returnTrail";

/**
 * Records every pathname the driver walks through into the return trail
 * (`returnTrail.ts`), so every `PageBackLink` can tell "the page my arrow
 * points at is where they just came from" and go back through real history —
 * which restores their scroll position — instead of pushing a fresh visit.
 *
 * It also keeps the driver's place when a back control has to PUSH instead:
 * every tap notes where they are on the page, and arriving by a pushed return
 * puts them back there (`recordPush` asks for it).
 *
 * Mounted once in the root layout, renders nothing. Lives at the layout so it
 * survives every navigation; the ordering subtlety of its effect against the
 * pages' own is handled inside `trailSaysCameFrom`, not here.
 */
export function ReturnTrailTracker() {
  const pathname = usePathname();
  /*
   * Which route changes are moves through history, the only ones that pop the trail. Declared
   * before the recording effect, so a page the browser loaded by back/forward (a reload in
   * between, or back into the app from another site) is known before its first record.
   */
  useEffect(() => {
    try {
      const entry = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      if (entry?.type === "back_forward") noteTraversal(window.location.pathname);
    } catch {
      // No navigation timing: every change then reads as a push, which is never wrong, only
      // slower (a plain link instead of history back).
    }
    // Capture, so it is heard before the router's own popstate handler starts the route change.
    const onPop = () => noteTraversal(window.location.pathname);
    window.addEventListener("popstate", onPop, true);
    return () => window.removeEventListener("popstate", onPop, true);
  }, []);

  useEffect(() => {
    if (pathname) recordPathname(pathname);
  }, [pathname]);

  // Capture phase, so the place is noted before whatever the tap does can move the page.
  useEffect(() => {
    const note = () => rememberScroll(window.location.pathname, window.scrollY);
    document.addEventListener("click", note, true);
    return () => document.removeEventListener("click", note, true);
  }, []);

  /*
   * A pushed return asked for the driver's place back. Layout effect, so the first try lands
   * before the page paints. The ref holds what was taken for this pathname, because the take
   * consumes it and a Strict Mode re-run of this effect would otherwise find nothing.
   */
  const restoreRef = useRef<{ pathname: string; y: number } | null>(null);
  useLayoutEffect(() => {
    if (!pathname) return;
    if (restoreRef.current?.pathname !== pathname) restoreRef.current = null;
    const y = takeReturnScroll(pathname);
    if (y != null) restoreRef.current = { pathname, y };
    return restoreRef.current ? holdScroll(restoreRef.current.y) : undefined;
  }, [pathname]);

  return null;
}

/** Long enough for a page to stream in over a slow connection at the track. */
const HOLD_MS = 4000;
/** Anything the driver does themselves ends the hold at once. */
const GIVE_UP_ON = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/**
 * Put the window at `y` and keep it there while the page fills in. A returning page often
 * arrives as its loading skeleton, too short to hold `y`, and grows as its data streams; the
 * router's own scroll to the top can also land after the first try. Stops after `HOLD_MS`, and
 * the moment the driver touches, scrolls or types — it never fights them.
 */
function holdScroll(y: number): () => void {
  const started = performance.now();
  let frame = 0;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    for (const type of GIVE_UP_ON) window.removeEventListener(type, stop, true);
  };
  const step = () => {
    if (stopped) return;
    const scroller = document.scrollingElement ?? document.documentElement;
    const room = scroller.scrollHeight - window.innerHeight;
    if (room >= y - 2 && Math.abs(window.scrollY - y) > 1) {
      window.scrollTo({ top: Math.min(y, room), behavior: "auto" });
    }
    if (performance.now() - started >= HOLD_MS) {
      stop();
      return;
    }
    frame = requestAnimationFrame(step);
  };
  for (const type of GIVE_UP_ON) {
    window.addEventListener(type, stop, { capture: true, passive: true });
  }
  step();
  return stop;
}
