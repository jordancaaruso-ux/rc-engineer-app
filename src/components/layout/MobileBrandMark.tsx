"use client";

import Link from "next/link";
import { JrcMark } from "@/components/brand/JrcMark";

/**
 * Mobile-only brand mark, pinned top-left to balance the account avatar
 * (`AccountMenu`) top-right. White mark on a glass pill (matches the avatar's
 * surface for legibility over the photo wash). Links to the dashboard.
 * Desktop uses the sidebar brand instead.
 */
export function MobileBrandMark() {
  return (
    <Link
      href="/"
      aria-label="JRC Race Engineer — dashboard"
      className="tap-active fixed left-4 z-40 flex h-[34px] items-center rounded-full border border-white/[0.15] bg-card/70 px-3.5 shadow-[0_2px_10px_rgba(0,0,0,0.45)] backdrop-blur-[20px] backdrop-saturate-[1.4] transition-transform duration-150 active:scale-95 md:hidden"
      style={{ top: "var(--top-chrome-y)" }}
    >
      <JrcMark variant="white" className="h-[15px] opacity-95" />
    </Link>
  );
}
