"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { JrcMark } from "@/components/brand/JrcMark";
import { PRODUCT_NAME } from "@/lib/brand/brandNames";
import { useMobileBackAction, useMobileBackHref } from "@/components/layout/MobileBackContext";

/**
 * Mobile-only top-left corner control, pinned to balance the account avatar
 * (`AccountMenu`) top-right. White mark on a glass pill (matches the avatar's
 * surface for legibility over the photo wash). Desktop uses the sidebar brand.
 *
 * On pages with a back destination it morphs into the back button (the fixed
 * pill otherwise covered the header's back arrow); everywhere else it's the JRC
 * mark linking to the dashboard.
 */
/* No `left-4`. The pill is pinned with `--page-gutter-left`, the same value `.page-body`
   pads with, so its outer edge lands exactly on the left edge of the cards below it.
   Tailwind's `left-4` is 1rem and the gutter is 1.25rem, so it used to hang 4px proud of
   them (founder, 2026-09-05, off his phone). `AccountMenu` carries the mirror of this. */
const PILL_CLASS =
  "mobile-brand-mark tap-active fixed z-40 flex h-[34px] items-center justify-center rounded-full border border-white/[0.15] bg-card/70 shadow-[0_2px_10px_rgba(0,0,0,0.45)] backdrop-blur-[20px] backdrop-saturate-[1.4] transition-transform duration-150 active:scale-95 md:hidden";

const PILL_POSITION = { top: "var(--top-chrome-y)", left: "var(--page-gutter-left)" } as const;

export function MobileBrandMark() {
  const backHref = useMobileBackHref();
  const getBackAction = useMobileBackAction();

  if (backHref) {
    return (
      <Link
        href={backHref}
        prefetch
        aria-label="Back"
        // The href stays the truth of *where* back goes; the action only changes
        // *how* (history rather than a push), so the pill keeps working unhydrated.
        onClick={(e) => {
          const action = getBackAction();
          if (!action) return;
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          action();
        }}
        className={`${PILL_CLASS} w-[34px] text-foreground`}
        style={PILL_POSITION}
      >
        <ChevronLeft className="size-[19px]" strokeWidth={2.25} aria-hidden />
      </Link>
    );
  }

  return (
    <Link
      href="/"
      aria-label={`${PRODUCT_NAME} — dashboard`}
      className={`${PILL_CLASS} px-3.5`}
      style={PILL_POSITION}
    >
      <JrcMark variant="white" className="h-[15px] opacity-95" />
    </Link>
  );
}
