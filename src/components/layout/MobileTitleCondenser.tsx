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
 * behaviour-only addition. Reveal is driven by an IntersectionObserver (fires
 * regardless of which element actually scrolls — more robust than a window
 * scroll listener), with the root inset from the top by the corner-chrome band
 * so the handoff lands exactly as the big title passes behind the pills.
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
    let io: IntersectionObserver | null = null;
    let raf = 0;
    let lastEl: Element | null = null;
    let lastText = "";
    let lastSector: boolean | null = null;

    const resolve = () => {
      const titleEl = document.querySelector<HTMLElement>(".page-title");
      const text = titleEl?.textContent?.trim() ?? "";
      const sector =
        document.querySelector(".app-shell")?.hasAttribute("data-nav-sector") ?? false;
      // Only re-render on an actual change (was firing every observer callback).
      if (sector !== lastSector) {
        lastSector = sector;
        setHasSector(sector);
      }
      // Nothing meaningful changed → keep the existing observer running.
      if (titleEl === lastEl && text === lastText) return;
      lastEl = titleEl;
      lastText = text;
      setTitle(text);

      io?.disconnect();
      io = null;
      if (!titleEl || !text) {
        setShown(false);
        return;
      }
      const corner = document.querySelector('[aria-label="Account and settings"]');
      const bandBottom = corner ? corner.getBoundingClientRect().bottom : 54;
      io = new IntersectionObserver(
        ([entry]) => {
          // Shown once the big title has risen fully above the corner band.
          setShown(entry.boundingClientRect.bottom <= bandBottom + 1);
        },
        { root: null, threshold: 0, rootMargin: `-${Math.ceil(bandBottom)}px 0px 0px 0px` },
      );
      io.observe(titleEl);
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(resolve);
    };

    schedule();
    // Re-resolve when the route content mutates (skeleton → real title, etc.).
    // childList only — the title changes by element swap, never in-place text
    // edits, so we skip `characterData` which previously fired on every animated
    // number roll / clock tick and forced a layout read each time.
    const scope = document.querySelector("main.page") ?? document.body;
    const mo = new MutationObserver(schedule);
    mo.observe(scope, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);

    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      io?.disconnect();
      window.removeEventListener("resize", schedule);
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
