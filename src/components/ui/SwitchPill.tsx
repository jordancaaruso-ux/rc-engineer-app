"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * The white pill that slides under a switch's chosen option (founder pick 2026-09-26, the
 * Track-First test page's switch, "use your best judgement" on slide vs jump: slide).
 *
 * Drop it as the FIRST child of a `.switch-rail` whose options are `.switch-seg` and carry
 * `data-on="true"` when chosen. It measures the chosen option and moves there, so it works for
 * equal-width segments and for options sized to their words alike. Until it has measured (the
 * server render, a rail that starts hidden) the chosen option wears the pill itself — see the
 * `.switch-rail` block in globals.css — so there is never a frame with no pill.
 *
 * `activeKey` is whatever identifies the chosen option; a change slides the pill. A resize or a
 * font swap re-seats it without a slide. Reduced motion turns the slide off in CSS.
 */
export function SwitchPill({ activeKey }: { activeKey: unknown }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const slideNext = useRef(false);

  useLayoutEffect(() => {
    const pill = ref.current;
    const rail = pill?.parentElement;
    if (!pill || !rail) return;
    seatPill(rail, pill, slideNext.current);
    slideNext.current = true;
  }, [activeKey]);

  useEffect(() => {
    const pill = ref.current;
    const rail = pill?.parentElement;
    if (!pill || !rail || typeof ResizeObserver === "undefined") return;
    // Watching the options too catches the ones sized to their words, whose widths change
    // with counts arriving or the font loading while the rail itself stays the same width.
    const ro = new ResizeObserver(() => seatPill(rail, pill, false));
    ro.observe(rail);
    for (const child of Array.from(rail.children)) if (child !== pill) ro.observe(child);
    return () => ro.disconnect();
  }, []);

  return <span ref={ref} aria-hidden className="switch-pill" />;
}

function seatPill(rail: HTMLElement, pill: HTMLElement, slide: boolean) {
  const on = Array.from(rail.children).find(
    (c): c is HTMLElement => c !== pill && c instanceof HTMLElement && c.dataset.on === "true"
  );
  if (!on || on.offsetWidth === 0) {
    // Hidden or nothing chosen: hand the look back to the option itself.
    rail.removeAttribute("data-pill");
    delete pill.dataset.at;
    return;
  }
  const at = `${on.offsetLeft}:${on.offsetWidth}`;
  // A resize notice that changes nothing must not cut a slide short.
  if (pill.dataset.at === at && rail.hasAttribute("data-pill")) return;
  pill.dataset.at = at;
  const instant = !slide || !rail.hasAttribute("data-pill");
  if (instant) rail.setAttribute("data-pill", "settle");
  pill.style.width = `${on.offsetWidth}px`;
  pill.style.transform = `translateX(${on.offsetLeft}px)`;
  if (instant) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (rail.getAttribute("data-pill") === "settle") rail.setAttribute("data-pill", "ready");
      })
    );
  }
}
