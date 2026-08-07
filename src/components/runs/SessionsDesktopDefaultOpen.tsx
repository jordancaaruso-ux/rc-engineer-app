"use client";

import { useEffect } from "react";

/**
 * Open the newest session on the Sessions page — desktop only.
 *
 * At lg+ the page is a master-detail layout (`.sessions-split`, globals.css): sessions on the left,
 * the open one's runs in a pane on the right. Nothing is open by default, which is the right
 * trackside behaviour — on a phone you scan the list and tap the one you want, and auto-expanding
 * would push the rest off-screen. On a desktop it means landing on a split view whose entire right
 * half is empty.
 *
 * Done in JS rather than CSS or markup because neither can express "desktop only" here. Markup is
 * shared (one server render feeds both), and a closed `<details>` cannot be revealed with CSS —
 * `display: block` / `content-visibility: visible` on its content are both ignored, which was
 * measured, not assumed. `matchMedia` is what keeps the phone byte-for-byte untouched: below
 * 1024px this returns before touching the DOM.
 *
 * Deliberately runs once on mount and does not follow resizes. Re-running on every breakpoint cross
 * would fight a reader who had deliberately collapsed everything.
 */
export function SessionsDesktopDefaultOpen() {
  useEffect(() => {
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    const root = document.querySelector(".sessions-split");
    if (!root) return;
    // A session opened from the URL (`?openGroup=`, the trip back from a run) already won.
    if (root.querySelector("details[open]")) return;
    root.querySelector(":scope > details")?.setAttribute("open", "");
  }, []);

  return null;
}
