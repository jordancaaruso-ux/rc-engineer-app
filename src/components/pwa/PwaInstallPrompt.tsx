"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

import { isHiddenNavRoute } from "@/components/layout/navConfig";
import { PRODUCT_NAME } from "@/lib/brand/brandNames";
import { cn } from "@/lib/utils";

/**
 * Smart, gentle "Add to Home Screen" hint for iOS Safari.
 *
 * iOS has no `beforeinstallprompt` event and no one-tap install, so this is a
 * *custom instructional* card pointing at the Share → Add to Home Screen flow —
 * the only way to install a PWA on iOS, and the gateway that later unlocks web push.
 *
 * Shows only when ALL are true:
 *   - iOS device (iPhone / iPad)
 *   - Safari (Chrome/Firefox/Edge on iOS can't add to the home screen)
 *   - not already running installed (standalone)
 *   - the user has been around a little (2nd visit onward)
 *   - not previously dismissed (persisted ~60 days)
 *   - NOT the shared demo account — asking a stranger evaluating the product to install
 *     somebody else's read-only garage to their home screen is the wrong ask at the wrong
 *     moment, and it competes with the demo's own conversion door ("Get your own garage").
 *
 * Portaled to <body> so a transformed ancestor (route-transition wrapper, page-body
 * reveal) can never trap its `position: fixed`.
 *
 * Never over a control (test drive W1-30, 2026-09-26). It used to sit at the foot of the
 * screen above everything, dock included, and covered the Log run steps and a setup
 * editor's Save until it was closed. It now sits just above the dock, under every bar,
 * sheet and scrim the app portals to <body>, leaves the page room to scroll clear of it,
 * and stays off the screens whose own bar owns the bottom edge — see `.pwa-install` in
 * globals.css.
 */

const DISMISS_KEY = "pwa-install-dismissed-at";
const VISITS_KEY = "pwa-install-visits";
const DISMISS_TTL_MS = 60 * 24 * 60 * 60 * 1000; // ~60 days
const SHOW_AFTER_MS = 2500;

function isEligible(): boolean {
  if (typeof window === "undefined") return false;

  const nav = window.navigator;
  const ua = nav.userAgent || "";

  const isIOS =
    /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS 13+ reports as desktop Safari — detect via touch points.
    (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  if (!isIOS) return false;

  // Only Safari can install on iOS. Exclude the in-app browsers / other engines.
  const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios|opt\//i.test(ua);
  if (!isSafari) return false;

  const isStandalone =
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    (nav as Navigator & { standalone?: boolean }).standalone === true;
  if (isStandalone) return false;

  try {
    const dismissedAt = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_TTL_MS) return false;
  } catch {
    // localStorage blocked (private mode) — fall through; the visit gate still applies.
  }

  return true;
}

/** Increment and return the visit counter (best-effort; 1 if storage is blocked). */
function bumpVisits(): number {
  try {
    const next = Number(window.localStorage.getItem(VISITS_KEY) || 0) + 1;
    window.localStorage.setItem(VISITS_KEY, String(next));
    return next;
  } catch {
    return 1;
  }
}

export function PwaInstallPrompt(): React.ReactNode {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState(false); // drives the slide-in transition
  const { data: session, status } = useSession();
  const isDemo = session?.user?.isDemo === true;
  /** The eligibility pass is a one-shot: `bumpVisits` writes, so it must not run twice. */
  const decided = useRef(false);
  const pathname = usePathname();
  const cardRef = useRef<HTMLDivElement | null>(null);
  /** The card's height, for the room the page leaves under it. */
  const [cardHeight, setCardHeight] = useState(0);

  useEffect(() => {
    setMounted(true);
    // Wait for the session before deciding. `useSession` reports "loading" on first paint, so an
    // unguarded pass would read isDemo as false and schedule the card for a demo visitor anyway —
    // the 2.5s delay usually hides that, which is exactly what makes it an intermittent bug.
    if (status === "loading") return;
    if (isDemo) return;
    if (decided.current) return;
    decided.current = true;

    if (!isEligible()) return;

    const visits = bumpVisits();
    if (visits < 2) return; // never nag on the very first visit

    const timer = window.setTimeout(() => {
      setVisible(true);
      // next frame → transition from off-screen to resting
      window.requestAnimationFrame(() => setShown(true));
    }, SHOW_AFTER_MS);

    return () => window.clearTimeout(timer);
  }, [status, isDemo]);

  // Covers the case the effect cannot: a session that resolves to the demo *after* the card is
  // already on screen. Hiding is correct either way — nothing about the demo should ask for this.
  useEffect(() => {
    if (isDemo && visible) {
      setShown(false);
      setVisible(false);
    }
  }, [isDemo, visible]);

  // Measured, not guessed, like `SetupEditorSaveBar`'s spacer: the copy wraps to a third line
  // on a narrow phone, and the card measures 0 while a screen's own bar has it hidden.
  useEffect(() => {
    const el = cardRef.current;
    if (!visible || !el) return;
    const measure = () => setCardHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible]);

  function dismiss(): void {
    setShown(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    window.setTimeout(() => setVisible(false), 220);
  }

  if (!mounted || !visible) return null;

  return createPortal(
    <div
      // No dock on the signed-out pages at any width: the card keeps its old place there.
      className={cn("pwa-install", isHiddenNavRoute(pathname) && "is-dockless")}
      style={{ "--pwa-install-h": `${cardHeight}px` } as CSSProperties}
    >
      {/* In the flow at the foot of <body>: the room that lets the page scroll clear of the card. */}
      <div aria-hidden="true" className="pwa-install-room" />
      <div
        ref={cardRef}
        role="dialog"
        aria-label={`Install ${PRODUCT_NAME}`}
        /* z-28: under every bar, sheet and scrim portaled to <body> (the lowest is 29). The
           row is click-through, so only the card itself takes a tap, not the air beside it. */
        className="pwa-install-card pointer-events-none fixed inset-x-0 z-[28] flex justify-center px-4"
        style={{
          transform: shown ? "translateY(0)" : "translateY(140%)",
          opacity: shown ? 1 : 0,
          transition: "transform 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease",
        }}
      >
        <div className="glass-card pointer-events-auto relative w-full max-w-sm rounded-2xl border border-white/10 p-4 shadow-2xl">
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <CloseIcon />
          </button>

          <div className="flex items-start gap-3 pr-6">
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl primary-face bg-primary text-primary-foreground"
            >
              <BoltIcon />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-bold leading-tight text-foreground">
                Install {PRODUCT_NAME}
              </p>
              <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                Add it to your home screen for a full-screen app — faster to open at the
                track, and the first step to run alerts.
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-secondary/60 px-3 py-2 text-[13px] text-foreground">
            <span>Tap</span>
            <ShareIcon />
            <span className="font-semibold">Share</span>
            <span className="text-muted-foreground">→</span>
            <span className="font-semibold">Add to Home Screen</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ShareIcon(): React.ReactNode {
  // iOS system share glyph — arrow out of a tray.
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className="shrink-0 text-primary-ink"
      aria-hidden="true"
    >
      <path
        d="M12 3v12M12 3l-4 4M12 3l4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 11H5.5A1.5 1.5 0 0 0 4 12.5v6A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5H17"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BoltIcon(): React.ReactNode {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l0-8Z" />
    </svg>
  );
}

function CloseIcon(): React.ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
