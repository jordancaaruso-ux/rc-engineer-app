"use client";

import { useEffect, useRef, useState } from "react";
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
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Quiet read-only toast (founder 2026-08-02): every blocked write in the demo gets one calm
  // pill instead of scattered per-component error styling. A fetch wrap watching for the
  // middleware's `{ demo: true }` 403 — components still receive the response untouched.
  useEffect(() => {
    if (!isDemo) return;
    const original = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await original(...args);
      if (res.status === 403) {
        try {
          const peek = (await res.clone().json()) as { demo?: boolean };
          if (peek?.demo) {
            setToastVisible(true);
            if (toastTimer.current) clearTimeout(toastTimer.current);
            toastTimer.current = setTimeout(() => setToastVisible(false), 2400);
          }
        } catch {
          // non-JSON 403 — not ours
        }
      }
      return res;
    };
    return () => {
      window.fetch = original;
      if (toastTimer.current) clearTimeout(toastTimer.current);
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
      {/* The calm refusal pill. */}
      <div
        aria-live="polite"
        className={`pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center transition-opacity duration-300 ${toastVisible ? "opacity-100" : "opacity-0"}`}
      >
        <span className="rounded-full border border-border bg-[#1E1D1C]/95 px-4 py-2 text-[12.5px] text-foreground shadow-lg backdrop-blur-md">
          The demo is read-only
        </span>
      </div>
    </div>
  );
}
