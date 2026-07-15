"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Compact page title that fades into the fixed mobile top band (between the JRC
 * pill and the account avatar) once the large `.page-title` scrolls out of
 * view — the iOS large-title → inline-title handoff, on-brand.
 *
 * Reads the current title text + nav-sector straight from the DOM (`.page-title`
 * / `.app-shell[data-nav-sector]`), so it needs zero per-page wiring and stays a
 * behaviour-only addition.
 *
 * Reveal is driven by a capture-phase scroll listener (catches whichever element
 * actually scrolls, window or a nested container) that reads the live title rect
 * each frame and applies **hysteresis** at the top edge of the screen: the
 * compact title only reveals once the big title has scrolled fully off the top
 * (its bottom passes y=0) and hides the moment it re-enters, so the big and
 * compact titles are never visible at the same time — on the way down or up
 * (the old single-snapshot IntersectionObserver could reveal too early and get
 * stuck shown).
 *
 * A MutationObserver re-resolves the title whenever the route content changes,
 * so it survives the `loading.tsx` skeleton → real-title swap (the skeleton has
 * no title text; a one-shot read at mount would latch empty and never recover).
 * Mobile-only (CSS-gated); pages without a `.page-title` render nothing.
 *
 * Approved via the title-collapse artifact (2026-07-14, "compact title").
 */
export function MobileTitleCondenser() {
  const pathname = usePathname();
  const [title, setTitle] = useState("");
  const [hasSector, setHasSector] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let rafResolve = 0;
    let rafShown = 0;
    let titleEl: HTMLElement | null = null;
    let lastEl: Element | null = null;
    let lastText = "";
    let lastSector: boolean | null = null;

    // Reveal the compact title ONLY once the big title has scrolled fully above
    // the top edge of the screen (its bottom passes y=0), so the big and compact
    // titles are never on screen at the same time. Small hysteresis with *both*
    // thresholds off-screen (reveal at −6, hide the moment it re-enters at 0)
    // kills boundary flicker without ever letting the two overlap.
    const updateShown = () => {
      if (!titleEl) {
        setShown(false);
        return;
      }
      const titleBottom = titleEl.getBoundingClientRect().bottom;
      setShown((prev) => (prev ? titleBottom < 0 : titleBottom <= -6));
    };

    const resolve = () => {
      const el = document.querySelector<HTMLElement>(".page-title");
      const text = el?.textContent?.trim() ?? "";
      const sector =
        document.querySelector(".app-shell")?.hasAttribute("data-nav-sector") ?? false;
      if (sector !== lastSector) {
        lastSector = sector;
        setHasSector(sector);
      }
      if (el !== lastEl || text !== lastText) {
        lastEl = el;
        lastText = text;
        titleEl = el && text ? el : null;
        setTitle(text);
      }
      updateShown();
    };

    const scheduleResolve = () => {
      cancelAnimationFrame(rafResolve);
      rafResolve = requestAnimationFrame(resolve);
    };
    const onScroll = () => {
      cancelAnimationFrame(rafShown);
      rafShown = requestAnimationFrame(updateShown);
    };

    scheduleResolve();
    // Re-resolve when the route content mutates (skeleton → real title, etc.).
    // childList only — the title changes by element swap, never in-place text
    // edits, so we skip `characterData` which previously fired on every animated
    // number roll / clock tick and forced a layout read each time.
    const scope = document.querySelector("main.page") ?? document.body;
    const mo = new MutationObserver(scheduleResolve);
    mo.observe(scope, { childList: true, subtree: true });
    // Capture phase so scrolling in any nested container still updates us.
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", scheduleResolve);

    return () => {
      cancelAnimationFrame(rafResolve);
      cancelAnimationFrame(rafShown);
      mo.disconnect();
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", scheduleResolve);
    };
  }, [pathname]);

  if (!title) return null;

  return (
    <div className="title-condenser" data-shown={shown} aria-hidden>
      {hasSector ? <span className="title-condenser-mark" /> : null}
      <span className="page-title-condensed">{title}</span>
    </div>
  );
}
