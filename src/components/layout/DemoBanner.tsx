"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

/**
 * The demo session's persistent bar (MONETISATION_NORTH_STAR.md Phase 3, decision-board
 * pick 8A — full sentence). Renders only for the shared demo account; sits above the app
 * content in both AppShell branches. The one always-visible conversion door inside the demo.
 */
export function DemoBanner() {
  const { data: session } = useSession();
  const isDemo = session?.user?.isDemo === true;
  const ref = useRef<HTMLDivElement | null>(null);

  // The floating top chrome (JRC pill, avatar) pins to --top-chrome-y; tell it how much the
  // banner pushes everything down so the two never overlap. Cleared when the banner unmounts.
  useEffect(() => {
    if (!isDemo) return;
    const h = ref.current?.offsetHeight ?? 44;
    document.documentElement.style.setProperty("--demo-banner-h", `${h}px`);
    return () => {
      document.documentElement.style.removeProperty("--demo-banner-h");
    };
  }, [isDemo]);

  if (!isDemo) return null;

  return (
    <div
      ref={ref}
      role="status"
      className="sticky top-0 z-40 border-b border-border bg-[#1E1D1C]/95 backdrop-blur-md"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
        <p className="text-[12px] leading-snug text-muted-foreground">
          You&rsquo;re exploring a demo garage — everything&rsquo;s read-only.
        </p>
        <span className="flex items-center gap-3">
          <Link
            href="/join"
            className="whitespace-nowrap text-[12px] font-semibold text-primary underline-offset-2 hover:underline"
          >
            Get your own garage →
          </Link>
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: "/welcome" })}
            className="whitespace-nowrap text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Exit demo
          </button>
        </span>
      </div>
    </div>
  );
}
