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
  //
  // Observed, not measured once (fixed 2026-08-11): this row `flex-wrap`s, so its height
  // changes with viewport width — and a one-shot read on mount left `--demo-banner-h` stale
  // after a rotate or a resize that rewrapped it, dragging `--top-chrome-y` out with it. The
  // walkthrough exposed it by adding a third control to the row, which makes wrapping more
  // likely at 390px, but the bug predates it.
  useEffect(() => {
    if (!isDemo) return;
    const el = ref.current;
    if (!el) return;
    const publish = () => {
      document.documentElement.style.setProperty("--demo-banner-h", `${el.offsetHeight}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
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
      // `data-demo-banner` is the walkthrough's handle for measuring the top of its safe band.
      // It measures this element rather than parsing `--demo-banner-h`, because that variable
      // is a calc() containing env(safe-area-inset-top), which script cannot resolve.
      data-demo-banner
      // `bg-muted`, not the `bg-[#1E1D1C]` the walkthrough branch was written against —
      // that literal predates light mode and would paint a charcoal bar across the top
      // of the paper theme.
      className="sticky top-0 z-40 border-b border-border bg-muted/95 backdrop-blur-md"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      {/*
        The yellow edge (founder pick 2026-08-08, "Bar 2"). A 2px rule welded to the very top
        of the screen — above the safe-area inset, so on iOS standalone it paints under the
        notch and the demo announces itself before any content does.

        It is a rule and not a fill on purpose: yellow is action-only in this palette, and a
        solid yellow bar would spend the accent on furniture and leave every real yellow
        beneath it — the primary buttons, the rating dial, the chart line — arguing with the
        ceiling. On the edge it costs no surface area, so the one filled yellow button below
        stays the loudest thing on the page for the whole visit.
      */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-primary"
      />
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
        <p className="text-[12px] leading-snug text-muted-foreground">
          You&rsquo;re in a demo garage — everything&rsquo;s{" "}
          <strong className="font-semibold text-foreground">read-only</strong>.
        </p>
        {/*
          `flex-wrap` on the control group itself, not just on the row above it: the outer row
          wrapping only moves this whole group to its own line, and at 390px the controls need
          not fit on one line either — "Exit demo" was pushed off the right edge and clipped.
          `--demo-banner-h` is observed, so a wrapped group republishes its height instead of
          leaving the top chrome overlapping. Kept after the walkthrough button came out
          (2026-08-12): it is what makes a third control safe to add back.
        */}
        <span className="flex flex-wrap items-center justify-end gap-2.5">
          {/*
            A "Take the tour" button sat here until 2026-08-12, talking to `DemoTour` through a
            storage write + window event (`requestDemoTourStart`) because this banner renders in
            BOTH AppShell branches while the tour rendered in one. Pulled with the walkthrough
            itself — see the note in AppShell for why and for how to put it back.
          */}
          {/*
            A filled button, not a text link. This is the one thing the demo exists to sell,
            and it sat at the same weight as the sentence explaining the demo was read-only.
          */}
          <Link
            href="/join"
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 py-1.5 text-[12px] font-bold text-primary-foreground transition-transform hover:-translate-y-px"
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
        <span className="rounded-full border border-border bg-muted/95 px-4 py-2 text-[12.5px] text-foreground shadow-lg backdrop-blur-md">
          The demo is read-only
        </span>
      </div>
    </div>
  );
}
