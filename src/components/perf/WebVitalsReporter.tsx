"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";

import { queueMetric } from "@/lib/perf/clientBeacon";
import { normalizeRoutePath } from "@/lib/perf/routeKey";

/**
 * Real-user monitoring. This is the authoritative "how slow did that page feel" signal:
 * App Router cannot put a `Server-Timing` header on a page render, and DevTools does not
 * exist on the phone, so client TTFB / LCP / INP keyed by route is what we rank pages by.
 *
 * Mounted only when PERF_INSTRUMENTATION=1, behind `next/dynamic`, so the vendored
 * web-vitals code lands in a chunk that is never fetched with the layer off.
 */

/**
 * MUST stay at module scope. `useReportWebVitals` has `[reportFn]` in its effect deps,
 * so an inline arrow re-subscribes on every render and double-reports.
 */
function report(metric: {
  id: string;
  name: string;
  value: number;
  rating?: string;
  navigationType?: string;
}): void {
  queueMetric({
    name: metric.name,
    value: metric.value,
    metricId: metric.id,
    rating: metric.rating ?? null,
    navigationType: metric.navigationType ?? null,
    route: normalizeRoutePath(window.location.pathname),
  });
}

/**
 * Soft-navigation timing, which web-vitals does not measure: it only knows about
 * document loads, and most of this app's navigation is client-side. We stamp the clock
 * on the interaction that starts a nav and read it when the pathname commits.
 */
let navStartedAt: number | null = null;

if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("a[href], button")) {
        navStartedAt = performance.now();
      }
    },
    { capture: true, passive: true }
  );
  window.addEventListener("popstate", () => {
    navStartedAt = performance.now();
  });
}

export default function WebVitalsReporter(): null {
  useReportWebVitals(report);

  const pathname = usePathname();
  const previousPath = useRef(pathname);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    if (navStartedAt != null) {
      queueMetric({
        name: "soft-nav",
        value: performance.now() - navStartedAt,
        route: normalizeRoutePath(pathname),
        fromRoute: normalizeRoutePath(previousPath.current),
      });
    }
    previousPath.current = pathname;
    navStartedAt = null;
  }, [pathname]);

  return null;
}
