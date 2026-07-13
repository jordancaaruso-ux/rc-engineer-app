"use client";

import { useEffect } from "react";

/**
 * Dismisses the launch splash (`#pwa-splash`, rendered in layout.tsx) after a cold
 * standalone launch. The splash paints pre-hydration (CSS-gated to
 * `html[data-standalone]`); this removes it once the app is *actually* ready.
 *
 * Readiness-based, not a fixed timer: it waits for the page to finish loading
 * (`window` load) AND webfonts to be ready before revealing, so the splash never
 * fades to a half-painted page mid font-swap. A short minimum keeps the logo from
 * flashing on instant loads; a hard cap guarantees it always clears even if load
 * hangs (the CSS `pwa-splash-safety` animation is a further last-resort net).
 */
export function PwaSplashDismiss(): null {
  useEffect(() => {
    const el = document.documentElement;
    if (el.getAttribute("data-standalone") !== "true") return;

    const MIN_VISIBLE_MS = 450; // let the logo entrance land; avoid a flash
    const MAX_WAIT_MS = 2200; // never hold the splash longer than this
    const FADE_MS = 420; // matches the CSS opacity transition

    const start =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const timers: number[] = [];
    let dismissed = false;

    const reveal = (): void => {
      if (dismissed) return;
      dismissed = true;
      el.classList.add("pwa-ready");
      timers.push(
        window.setTimeout(() => el.classList.add("pwa-splash-done"), FADE_MS),
      );
    };

    const revealAfterMinimum = (): void => {
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const remaining = Math.max(0, MIN_VISIBLE_MS - (now - start));
      timers.push(window.setTimeout(reveal, remaining));
    };

    const loaded =
      document.readyState === "complete"
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            window.addEventListener("load", () => resolve(), { once: true });
          });

    const fontsReady =
      typeof document !== "undefined" && "fonts" in document
        ? document.fonts.ready.then(() => undefined)
        : Promise.resolve();

    Promise.all([loaded, fontsReady]).then(revealAfterMinimum, revealAfterMinimum);

    // Hard cap so a stalled load can't keep the splash up indefinitely.
    timers.push(window.setTimeout(reveal, MAX_WAIT_MS));

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  return null;
}
