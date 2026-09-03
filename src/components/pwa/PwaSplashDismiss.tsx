"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";

/**
 * Clears the launch splash once the app is *actually* ready — whichever splash this
 * launch is wearing.
 *
 * Two exist and only ever one shows at a time. In the browser / installed PWA it is
 * `#pwa-splash` (rendered in layout.tsx, CSS-gated to `html[data-standalone]`, painting
 * pre-hydration); in the iOS shell it is the NATIVE splash from `Splash.imageset`, which
 * is already up when the icon is tapped, so the web one is suppressed there entirely
 * (`html[data-native]`, globals.css) and this hides the native one instead.
 *
 * Readiness-based, not a fixed timer: it waits for the page to finish loading
 * (`window` load) AND webfonts to be ready before revealing, so the splash never
 * fades to a half-painted page mid font-swap. A hard cap guarantees it always clears
 * even if load hangs (the CSS `pwa-splash-safety` animation is a further last-resort
 * net for the web one; `launchShowDuration` is the native one's).
 */
export function PwaSplashDismiss(): null {
  useEffect(() => {
    const el = document.documentElement;
    const isNative = Capacitor.isNativePlatform();
    if (!isNative && el.getAttribute("data-standalone") !== "true") return;

    // Belt and braces. The bootstrap script stamps this pre-paint, which is what
    // keeps the web splash from ever showing in the shell; if the Capacitor bridge
    // was not injected in time, stamping it here still clears it at hydration
    // instead of leaving both splashes to play out.
    if (isNative) el.setAttribute("data-native", "true");

    // The web splash lifts the lockup in, then fades the foot under it, landing at
    // ~1140ms (globals.css). Dismissing before that finishes would cut the foot off
    // mid-fade, so the minimum clears it. The native splash has no entrance to protect
    // and has been up since the icon tap, so it goes the instant the app is ready — a
    // minimum there is just a slower launch.
    const MIN_VISIBLE_MS = isNative ? 0 : 1150;
    const MAX_WAIT_MS = 2600; // never hold the splash longer than this
    const FADE_MS = 420; // matches the CSS opacity transition

    const start =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const timers: number[] = [];
    let dismissed = false;

    const reveal = (): void => {
      if (dismissed) return;
      dismissed = true;
      if (isNative) {
        // Fades over `launchFadeOutDuration` (capacitor.config.ts). Swallowed rather
        // than awaited: a plugin error must never leave the app under the logo.
        void SplashScreen.hide().catch(() => {});
        return;
      }
      el.classList.add("pwa-ready");
      timers.push(
        window.setTimeout(() => el.classList.add("pwa-splash-done"), FADE_MS),
      );
    };

    const revealAfterMinimum = (): void => {
      if (MIN_VISIBLE_MS === 0) {
        reveal();
        return;
      }
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
