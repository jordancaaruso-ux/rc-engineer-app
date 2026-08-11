"use client";

import { useEffect } from "react";

/**
 * Master-detail behaviour for the Sessions page — desktop only.
 *
 * At lg+ the page is a master-detail layout (`.sessions-split`, globals.css): sessions on the left,
 * the open one's runs in a pane on the right. Two things have to be true for that to read as one
 * view, and neither can be expressed in CSS or in the shared markup:
 *
 *   1. SOMETHING IS OPEN ON ARRIVAL. Nothing is open by default, which is the right trackside
 *      behaviour — on a phone you scan the list and tap the one you want, and auto-expanding would
 *      push the rest off-screen. On a desktop it means landing on a split view whose entire right
 *      half is empty. A closed `<details>` cannot be revealed with CSS — `display: block` /
 *      `content-visibility: visible` on its content are both ignored, which was measured, not
 *      assumed.
 *
 *   2. ONLY ONE IS OPEN AT A TIME. Every session's pane is absolutely positioned into the same
 *      right-hand column, so a second open session lands a second pane on top of the first. They
 *      do not cleanly stack — the pane is translucent, so all of them paint through each other and
 *      the reader gets doubled member names and lap times struck over one another. Browsing the
 *      list a few rows at a time was enough to produce four panes in one column. `<details name>`
 *      would give exclusive opening natively, but the markup is shared with the phone, where the
 *      accordion is deliberately multi-open; doing it here keeps the phone untouched.
 *
 * `matchMedia` is what keeps the phone byte-for-byte untouched: below 1024px this returns before
 * touching the DOM.
 *
 * Deliberately runs once on mount and does not follow resizes. Re-running on every breakpoint
 * cross would fight a reader who had deliberately collapsed everything.
 */
export function SessionsDesktopMasterDetail() {
  useEffect(() => {
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    const root = document.querySelector(".sessions-split");
    if (!root) return;

    // A session opened from the URL (`?openGroup=`, the trip back from a run) already won.
    if (!root.querySelector("details[open]")) {
      root.querySelector(":scope > details")?.setAttribute("open", "");
    }

    // `toggle` does not bubble, so listen in the capture phase. The pane holds its own nested
    // per-driver `<details>`; only the top-level session groups share the right-hand column, so
    // anything that isn't a direct child of the split is left alone.
    const closeTheOthers = (event: Event) => {
      const opened = event.target;
      if (!(opened instanceof HTMLDetailsElement)) return;
      if (opened.parentElement !== root || !opened.open) return;
      root.querySelectorAll(":scope > details[open]").forEach((other) => {
        if (other !== opened) other.removeAttribute("open");
      });
    };

    root.addEventListener("toggle", closeTheOthers, true);
    return () => root.removeEventListener("toggle", closeTheOthers, true);
  }, []);

  return null;
}
