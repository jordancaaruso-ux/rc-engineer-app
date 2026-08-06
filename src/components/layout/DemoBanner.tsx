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

  /**
   * Put the visitor back where they were reading when they tapped into the demo.
   *
   * The landing page drops a `/welcome#section` breadcrumb in sessionStorage on the way in (see
   * the capture script at the bottom of public/landing/index.html) — it has to happen there
   * because the fragment is the whole point and a fragment never reaches the server.
   *
   * Validated hard before use: only `/welcome`, optionally with a simple fragment. It is a
   * redirect target read out of client-controlled storage, so anything else — an absolute URL, a
   * protocol-relative `//evil.example`, another path — is discarded rather than followed.
   */
  function exitDemo(): void {
    let target = "/welcome";
    try {
      const stored = window.sessionStorage.getItem("jrc-demo-return");
      if (stored && /^\/welcome(#[A-Za-z0-9_-]+)?$/.test(stored)) target = stored;
      window.sessionStorage.removeItem("jrc-demo-return");
    } catch {
      // storage blocked — the default target is already correct
    }
    // `redirect: false` then navigate by hand: NextAuth completes the sign-out through a server
    // redirect, and relying on that to carry a fragment back is not something to trust.
    void signOut({ redirect: false }).then(() => {
      window.location.assign(target);
    });
  }

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
        <span className="flex items-center gap-2.5">
          <Link
            href="/join"
            className="whitespace-nowrap text-[12px] font-semibold text-primary underline-offset-2 hover:underline"
          >
            Get your own garage →
          </Link>
          {/*
            A real button, not an 11px text link. Leaving a demo is a thing a visitor should be
            able to find without hunting: it read as fine print next to the yellow CTA, so people
            went looking for a back gesture instead.
          */}
          <button
            type="button"
            onClick={exitDemo}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/40 hover:bg-muted"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {/* door + arrow leaving it */}
              <path d="M9.5 2H3.5v12h6" />
              <path d="M11 5.5 13.5 8 11 10.5" />
              <path d="M13.5 8H6.5" />
            </svg>
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
