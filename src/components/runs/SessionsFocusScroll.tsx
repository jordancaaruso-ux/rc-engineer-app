"use client";

import { useEffect } from "react";

/**
 * Scrolls the returned-to run row into view on Sessions (`?openGroup=<runId>`).
 *
 * The containing session group is already server-rendered open, so the row exists
 * by the time this mounts. Centring it — rather than restoring a raw pixel offset —
 * is what makes the round trip feel continuous: the list re-renders at a different
 * height once a group is expanded, so the old offset would point somewhere else.
 *
 * Runs once per run id. If the row isn't in the DOM (filtered out, or past the
 * pager's cut) it does nothing rather than jumping to the top.
 */
export function SessionsFocusScroll({ runId }: { runId: string | null }) {
  useEffect(() => {
    if (!runId) return;
    const row = document.querySelector<HTMLElement>(
      `[data-run-row="${CSS.escape(runId)}"]`
    );
    if (!row) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // One frame's grace so the group's layout has settled before we measure.
    const raf = requestAnimationFrame(() => {
      row.scrollIntoView({
        block: "center",
        behavior: reduceMotion ? "auto" : "smooth",
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [runId]);

  return null;
}
