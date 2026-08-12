"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { TourPlacement, TourViewport } from "@/lib/demo/tourSteps";
import { DEFAULT_TOUR_PADDING } from "@/lib/demo/tourSteps";

/**
 * Turns a resolved anchor into a cutout rect and a popover position, and keeps both welded to
 * the element as the page scrolls, resizes, or reflows.
 *
 * ── Why not `useAnchoredMenuPosition` from `ui/AnchoredMenu.tsx` ──────────────
 * It is the right idea and the wrong shape, and generalising it would put every dropdown,
 * picker, and menu in the app at risk for no gain here:
 *   · it takes a `RefObject`, but tour anchors are found by selector AFTER a route commit, so
 *     the object identity in its dep array would either re-subscribe every render or never
 *     re-measure when the element is replaced;
 *   · it only ever places BELOW (`top: rect.bottom + gap`), and a coachmark needs four sides
 *     with a flip;
 *   · it discards `height`, which is exactly what the cutout is drawn from.
 * So the listener recipe below is lifted from it deliberately — capture-phase `scroll` (so a
 * scrolling `overflow-y-auto` pane counts), `resize`, `visualViewport` scroll+resize for the
 * iOS keyboard, and an 8px viewport-edge clamp. Keep the two in step if that file changes.
 */

export type HoleRect = {
  top: number;
  left: number;
  width: number;
  height: number;
  radius: string;
};

export type PopoverBox = { top: number; left: number; width: number };

export type TourGeometry = {
  hole: HoleRect | null;
  popover: PopoverBox | null;
};

const EDGE = 8;
/** Distance between the cutout and the popover. */
const GAP = 14;
const DESKTOP_POPOVER_WIDTH = 320;
const PHONE_POPOVER_MAX = 340;
/** Below this, a left/right coachmark leaves too little text width to be worth it. */
const NARROW_VIEWPORT = 420;

type Band = { top: number; bottom: number; height: number };

/**
 * The vertical strip a popover and (where possible) a cutout may occupy.
 *
 * Measured off real elements rather than parsed out of `--demo-banner-h` and
 * `--mobile-tab-bar-height`: `getComputedStyle` hands back custom properties as unresolved
 * tokens, and both of those are `calc()` expressions containing `env(safe-area-inset-*)`,
 * which is not readable from script at all. The banner and the dock are in the DOM — measure
 * them. This also means the band stays correct when the banner row wraps.
 */
function measureBand(): Band {
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  let top = EDGE;
  let bottom = viewportHeight - EDGE;

  const banner = document.querySelector<HTMLElement>("[data-demo-banner]");
  if (banner) {
    const rect = banner.getBoundingClientRect();
    // Sticky, so its bottom edge IS the first usable pixel — but only while it is on screen.
    if (rect.bottom > top) top = rect.bottom + EDGE;
  }

  // `.bottom-nav` is `display: none` at md+, and hidden outright inside the log-run wizard
  // (`body[data-logrun-wizard-chrome]`), so measuring it covers both cases without a flag.
  const dock = document.querySelector<HTMLElement>(".bottom-nav");
  if (dock && dock.getClientRects().length > 0) {
    const rect = dock.getBoundingClientRect();
    if (rect.top < bottom) bottom = rect.top - EDGE;
  }

  if (bottom < top + 40) bottom = top + 40;
  return { top, bottom, height: bottom - top };
}

/** Nearest ancestor that actually scrolls, or null for the document. */
function scrollableAncestor(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * Bring the anchor into the band.
 *
 * Over-tall anchors are TOP-aligned rather than centred. Stop 4's anchor is the whole
 * `RunDetailPanel` — four sections deep — which on a 390px screen is taller than the band. A
 * centred tall anchor puts its middle on screen and both labelled ends off it; top-aligning
 * shows the section headings the copy is describing. Letting the cutout run off the bottom of
 * the screen is correct here. Falling back to a centred popover with no cutout would not be:
 * it would hide the very thing being described.
 */
function scrollIntoBand(el: HTMLElement, instant: boolean): void {
  // Nested scrollers first — the Sessions rail is `overflow-y-auto` inside the page.
  const scroller = scrollableAncestor(el);
  if (scroller) {
    const elRect = el.getBoundingClientRect();
    const boxRect = scroller.getBoundingClientRect();
    if (elRect.height > boxRect.height - EDGE * 2 || elRect.top < boxRect.top + EDGE) {
      scroller.scrollTop += elRect.top - boxRect.top - EDGE;
    } else if (elRect.bottom > boxRect.bottom - EDGE) {
      scroller.scrollTop += elRect.bottom - boxRect.bottom + EDGE;
    }
  }

  const band = measureBand();
  const rect = el.getBoundingClientRect();
  const tooTall = rect.height > band.height;
  const targetTop = tooTall ? band.top : band.top + (band.height - rect.height) / 2;
  const delta = rect.top - targetTop;

  // Sub-pixel nudges are not worth a scroll event storm.
  if (Math.abs(delta) < 2) return;
  window.scrollBy({ top: delta, behavior: instant ? "auto" : "smooth" });
}

function readRadius(el: HTMLElement): string {
  const radius = window.getComputedStyle(el).borderRadius;
  // Cards are `rounded-xl`, the run CTA is `rounded-2xl`, the composer row has none of its own.
  return radius && radius !== "0px" ? radius : "14px";
}

export function useTourPlacement({
  el,
  placement,
  viewport,
  padding = DEFAULT_TOUR_PADDING,
  popoverRef,
  nonce,
  reducedMotion,
}: {
  el: HTMLElement | null;
  placement: TourPlacement;
  viewport: TourViewport;
  padding?: number;
  popoverRef: RefObject<HTMLElement | null>;
  /** Changes when the step does, to re-run the one-shot scroll. */
  nonce: string;
  reducedMotion: boolean;
}): TourGeometry {
  const [geometry, setGeometry] = useState<TourGeometry>({ hole: null, popover: null });

  // Read through a ref so `place` stays referentially stable and the scroll/resize listeners
  // subscribe once rather than on every render. Written in an effect: every reader of it runs
  // from a listener or a rAF, i.e. after commit.
  const latest = useRef({ el, placement, viewport, padding });
  useEffect(() => {
    latest.current = { el, placement, viewport, padding };
  }, [el, placement, viewport, padding]);

  const place = useCallback(() => {
    const { el: anchor, placement: side, viewport: vp, padding: pad } = latest.current;
    if (!anchor || !anchor.isConnected) {
      setGeometry({ hole: null, popover: null });
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;

    const hole: HoleRect = {
      top: rect.top - pad,
      left: rect.left - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
      radius: readRadius(anchor),
    };

    const popoverEl = popoverRef.current;
    const width =
      vp === "mobile"
        ? Math.min(viewportWidth - EDGE * 2, PHONE_POPOVER_MAX)
        : Math.min(DESKTOP_POPOVER_WIDTH, viewportWidth - EDGE * 2);

    // Width first, then read the height it wrapped to.
    let height = 160;
    if (popoverEl) {
      popoverEl.style.width = `${width}px`;
      height = popoverEl.offsetHeight || height;
    }

    // A narrow screen has no room for a side-mounted popover; force the vertical axis.
    let resolvedSide: TourPlacement = side;
    if (viewportWidth < NARROW_VIEWPORT && (side === "left" || side === "right")) {
      resolvedSide = "bottom";
    }

    let left: number;
    let top: number;
    if (resolvedSide === "left") {
      left = hole.left - GAP - width;
      top = hole.top + hole.height / 2 - height / 2;
    } else if (resolvedSide === "right") {
      left = hole.left + hole.width + GAP;
      top = hole.top + hole.height / 2 - height / 2;
    } else if (resolvedSide === "top") {
      left = hole.left + hole.width / 2 - width / 2;
      top = hole.top - GAP - height;
    } else {
      left = hole.left + hole.width / 2 - width / 2;
      top = hole.top + hole.height + GAP;
    }

    // Flip to the opposite side when the preferred one would fall off, then clamp.
    if (resolvedSide === "left" && left < EDGE) left = hole.left + hole.width + GAP;
    else if (resolvedSide === "right" && left + width > viewportWidth - EDGE) {
      left = hole.left - GAP - width;
    } else if (resolvedSide === "top" && top < EDGE) top = hole.top + hole.height + GAP;
    else if (resolvedSide === "bottom" && top + height > viewportHeight - EDGE) {
      top = hole.top - GAP - height;
    }

    const band = measureBand();
    left = Math.max(EDGE, Math.min(left, viewportWidth - width - EDGE));
    // An anchor taller than the band leaves nowhere clear to put the popover, so it is allowed
    // to overlap the cutout rather than being pushed off screen.
    top = Math.max(band.top, Math.min(top, band.bottom - height));

    setGeometry({
      hole,
      popover: { top: Math.round(top), left: Math.round(left), width },
    });
  }, [popoverRef]);

  // One-shot scroll when the step (or its anchor) changes, then place.
  useEffect(() => {
    if (!el) {
      setGeometry({ hole: null, popover: null });
      return;
    }

    let raf = 0;
    let settle: ReturnType<typeof setTimeout> | null = null;

    scrollIntoBand(el, reducedMotion);

    // Smooth scrolling leaves the rect in motion for ~300ms, so place once now (so nothing
    // flashes at the old position) and again once it has come to rest.
    raf = requestAnimationFrame(place);
    const onScrollEnd = () => place();
    if ("onscrollend" in window) {
      window.addEventListener("scrollend", onScrollEnd, { once: true });
    }
    settle = setTimeout(place, reducedMotion ? 30 : 420);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (settle) clearTimeout(settle);
      window.removeEventListener("scrollend", onScrollEnd);
    };
  }, [el, nonce, place, reducedMotion]);

  // Keep it welded. The scrim blocks touch panning, but wheel and keyboard scrolling still
  // move the document and the iOS visual viewport can still shift under it.
  useEffect(() => {
    if (!el) return;

    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        place();
      });
    };

    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);

    // The composer textarea grows as it is typed into, and a card can reflow when its data
    // streams in — neither fires a scroll or resize event.
    const observer = new ResizeObserver(schedule);
    observer.observe(el);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [el, place]);

  return geometry;
}
