"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Finds the element a walkthrough stop points at, across a route change, and does not report it
 * until it has stopped moving.
 *
 * Anchors are `data-tour="<id>"` attributes rather than refs. Half the host components are
 * server components (`RecentRunsCard`, `DashboardListCard`, fragments of `SessionsWorkbench`),
 * and a ref-registration context would force `"use client"` onto them and thread a callback
 * through `CardPanel` / `SurfaceCard`, which enumerate their props and forward nothing. A
 * `data-` attribute is inert markup that works identically on the server and costs nothing on
 * the ~100% of sessions where the tour never runs.
 */

export type TourAnchorStatus = "pending" | "found" | "missing";

export type TourAnchorResult = {
  el: HTMLElement | null;
  status: TourAnchorStatus;
};

/**
 * `/engineer` is `force-dynamic` behind a lazy client chunk and `/runs/history` diffs setups
 * across up to 40 runs. A 2s deadline drops those stops on a cold demo visit; 5s does not.
 */
const DEFAULT_DEADLINE_MS = 5000;

/**
 * Some anchors appear via a *style* change rather than a DOM insert — an element already in the
 * tree going from `display: none` to visible when the window crosses `xl`. MutationObserver
 * with `attributes: true, subtree: true` over the whole body would be far more expensive than
 * this tick.
 */
const POLL_MS = 250;

/**
 * How long to keep re-measuring before accepting a rect.
 *
 * `.rc-reveal` (globals.css) animates `translateY(14px) → none` from `opacity: 0` over
 * 250–460ms, and it is applied APP-WIDE to `.page-body > *` with an `nth-child` stagger.
 * Measure on the first frame and the spotlight lands 14px low around an element that is not
 * even visible yet. Two consecutive identical rects is cheaper and more robust than chasing
 * `el.getAnimations()` promises — which would also have to special-case reduced motion, where
 * there are no animations to wait on at all.
 */
const SETTLE_CAP_MS = 600;
const SETTLE_EPSILON = 0.5;

function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  // All three matter: `getClientRects` catches `display:none` and detached nodes, the computed
  // check catches `visibility:hidden` (which still has a box), and `offsetParent` is what
  // actually separates the dashboard's `hidden xl:grid` twin from its `xl:hidden` twin.
  if (el.getClientRects().length === 0) return false;
  if (window.getComputedStyle(el).visibility === "hidden") return false;
  if (el.offsetParent === null && window.getComputedStyle(el).position !== "fixed") return false;
  return true;
}

function resolve(anchorIds: readonly string[]): HTMLElement | null {
  for (const id of anchorIds) {
    // Ordered candidates: the first VISIBLE match wins, which is how one step serves both the
    // dashboard's desktop and phone trees without a conditional in the step data.
    const matches = document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(id)}"]`);
    for (const el of matches) {
      if (isVisible(el)) return el;
    }
  }
  return null;
}

function sameRect(a: DOMRect | null, b: DOMRect): boolean {
  if (!a) return false;
  return (
    Math.abs(a.top - b.top) < SETTLE_EPSILON &&
    Math.abs(a.left - b.left) < SETTLE_EPSILON &&
    Math.abs(a.width - b.width) < SETTLE_EPSILON &&
    Math.abs(a.height - b.height) < SETTLE_EPSILON
  );
}

/**
 * @param anchorIds ordered `data-tour` candidates; first visible wins
 * @param enabled   false parks the hook (no observers, no timers)
 * @param nonce     bump to force a re-resolve — the controller changes it on route + viewport
 */
export function useTourAnchor(
  anchorIds: readonly string[],
  {
    enabled,
    nonce,
    deadlineMs = DEFAULT_DEADLINE_MS,
  }: { enabled: boolean; nonce: string; deadlineMs?: number },
): TourAnchorResult {
  const [result, setResult] = useState<TourAnchorResult>({ el: null, status: "pending" });

  // The ids are a fresh array literal on every render of the caller; depending on the array
  // itself would restart every observer each render. The joined key is the real dependency.
  const key = anchorIds.join("|");
  const idsRef = useRef<readonly string[]>(anchorIds);

  // Written in an effect, not during render — the resolver only ever reads it from a timer,
  // an observer callback, or a rAF, all of which run after commit.
  useEffect(() => {
    idsRef.current = anchorIds;
  }, [anchorIds]);

  useEffect(() => {
    if (!enabled) {
      setResult({ el: null, status: "pending" });
      return;
    }

    setResult({ el: null, status: "pending" });

    let cancelled = false;
    let raf = 0;
    let settleRaf = 0;
    let poll: ReturnType<typeof setInterval> | null = null;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    let observer: MutationObserver | null = null;

    const stopWatching = () => {
      if (observer) observer.disconnect();
      observer = null;
      if (poll) clearInterval(poll);
      poll = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    /** Re-measure until two consecutive frames agree, then report. */
    const settleThenReport = (el: HTMLElement) => {
      const startedAt = performance.now();
      let previous: DOMRect | null = null;

      const tick = () => {
        if (cancelled) return;
        // The element can be torn out mid-settle by a route commit that lost a race.
        if (!el.isConnected || !isVisible(el)) {
          previous = null;
          startWatching();
          return;
        }
        const rect = el.getBoundingClientRect();
        if (sameRect(previous, rect) || performance.now() - startedAt > SETTLE_CAP_MS) {
          if (deadline) clearTimeout(deadline);
          deadline = null;
          setResult({ el, status: "found" });
          return;
        }
        previous = rect;
        settleRaf = requestAnimationFrame(tick);
      };

      settleRaf = requestAnimationFrame(tick);
    };

    const attempt = () => {
      if (cancelled) return;
      const el = resolve(idsRef.current);
      if (!el) return;
      stopWatching();
      settleThenReport(el);
    };

    function startWatching() {
      stopWatching();
      // MutationObserver, not polling, for the common case: an App Router commit is a single
      // synchronous DOM swap, so this fires within a frame of the route landing, where a 250ms
      // poll would cost up to 250ms of dimmed screen with no popover on it.
      observer = new MutationObserver(() => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          attempt();
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
      poll = setInterval(attempt, POLL_MS);
    }

    // Same-route stops (3 → 4) resolve on this first synchronous try and never observe at all.
    attempt();

    if (!cancelled) {
      startWatching();
      deadline = setTimeout(() => {
        if (cancelled) return;
        stopWatching();
        if (process.env.NODE_ENV !== "production") {
          console.warn(`[demo-tour] no visible anchor for [${idsRef.current.join(", ")}]`);
        }
        // Not a dead end: the overlay renders centred, with the same copy and controls.
        setResult({ el: null, status: "missing" });
      }, deadlineMs);
    }

    return () => {
      cancelled = true;
      stopWatching();
      if (settleRaf) cancelAnimationFrame(settleRaf);
      if (deadline) clearTimeout(deadline);
    };
  }, [enabled, key, nonce, deadlineMs]);

  return result;
}
