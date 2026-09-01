"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { recordPathname } from "@/lib/navigation/returnTrail";

/**
 * Records every pathname the driver walks through into the return trail
 * (`returnTrail.ts`), so every `PageBackLink` can tell "the page my arrow
 * points at is where they just came from" and go back through real history —
 * which restores their scroll position — instead of pushing a fresh visit.
 *
 * Mounted once in the root layout, renders nothing. Lives at the layout so it
 * survives every navigation; the ordering subtlety of its effect against the
 * pages' own is handled inside `trailSaysCameFrom`, not here.
 */
export function ReturnTrailTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) recordPathname(pathname);
  }, [pathname]);
  return null;
}
