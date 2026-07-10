"use client";

import { useEffect, useState } from "react";

/**
 * True once the window has scrolled past `threshold` px — drives the floating
 * actions' collapse-to-icon on scroll (they expand again at the top). rAF-
 * throttled, passive listener; reads once on mount so a restored scroll
 * position starts in the right state.
 */
export function useScrolled(threshold = 12): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      setScrolled(window.scrollY > threshold);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [threshold]);
  return scrolled;
}
