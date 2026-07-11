"use client";

import { useEffect } from "react";

/**
 * Fades out the launch splash (`#pwa-splash`, rendered in layout.tsx) after a
 * cold standalone launch. The splash itself is CSS-gated to `html[data-standalone]`
 * so it paints pre-hydration; this just removes it once the app is ready.
 */
export function PwaSplashDismiss(): null {
  useEffect(() => {
    const el = document.documentElement;
    if (el.getAttribute("data-standalone") !== "true") return;
    const fade = window.setTimeout(() => el.classList.add("pwa-ready"), 500);
    const done = window.setTimeout(() => el.classList.add("pwa-splash-done"), 1100);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, []);

  return null;
}
