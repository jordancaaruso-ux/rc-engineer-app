"use client";

import { useEffect, useId, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import type { TourGeometry } from "@/components/demo/tour/useTourPlacement";

/**
 * The walkthrough's chrome: scrim, cutout, popover. Pure presentation — every decision about
 * which stop is showing lives in `DemoTour`, so this is what `/debug/demo-tour-preview` drives
 * with fabricated geometry.
 *
 * ── Stacking ─────────────────────────────────────────────────────────────────
 * Existing occupants: `DemoBanner` 40, `.bottom-nav` 50, the demo read-only toast 50,
 * `AnchoredMenu` default 60, `WelcomeScreen` 70, `#pwa-splash` 100. 64/65/66 puts the tour
 * above every dropdown (so no menu paints through the dim) and below the welcome overlay and
 * the PWA splash, neither of which can co-occur with it anyway.
 *
 * Portalled to `document.body` because `.app-shell` is `overflow-x-hidden`, which makes it a
 * scroll container and therefore a clip box for `position: fixed` descendants on iOS — the
 * same reason `BottomNav` renders outside it in `AppShell`.
 */

export type TourPhase = "navigating" | "placed";

export type TourOverlayProps = {
  phase: TourPhase;
  geometry: TourGeometry;
  /** True when the anchor never appeared — popover centres, no cutout. */
  centred: boolean;
  title: string;
  body: string;
  stepIndex: number;
  stepCount: number;
  /** Releases the scrim so the element inside the cutout is usable. */
  handover: boolean;
  nextLabel: string;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  popoverRef: RefObject<HTMLDivElement | null>;
  /** Shown under the flat dim if a route is taking an unreasonable time. */
  slowNavigation?: boolean;
};

export function TourOverlay({
  phase,
  geometry,
  centred,
  title,
  body,
  stepIndex,
  stepCount,
  handover,
  nextLabel,
  onNext,
  onBack,
  onSkip,
  popoverRef,
  slowNavigation = false,
}: TourOverlayProps) {
  const titleId = useId();
  const bodyId = useId();
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
  }, []);

  if (typeof document === "undefined") return null;

  const placed = phase === "placed";
  const hole = placed && !centred ? geometry.hole : null;
  const popover = placed ? geometry.popover : null;

  /**
   * Focus the popover CONTAINER on each step, not the Next button.
   *
   * Focusing Next makes VoiceOver and NVDA announce "Next, button" and skip straight past the
   * sentence the stop exists to deliver. Focusing the labelled dialog reads title, then body,
   * then the controls.
   */
  const dialog = (
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      tabIndex={-1}
      className={cn(
        "rc-tour-pop fixed z-[66] flex flex-col gap-2.5 rounded-xl border p-4",
        // `elevate`, not white: a white rim is invisible on paper. The drop shadow
        // moved to `.rc-tour-pop` in globals.css so it can differ per theme.
        "border-elevate/[0.12] bg-card",
        "focus:outline-none"
      )}
      style={
        popover && !centred
          ? { top: popover.top, left: popover.left, width: popover.width }
          : {
              top: "50%",
              left: "50%",
              width: "min(340px, calc(100vw - 2rem))",
              transform: "translate(-50%, -50%)",
            }
      }
      onKeyDown={(event) => {
        // The scrim stops the pointer but not the keyboard, so without this Tab walks straight
        // out into the dimmed app behind. `inert` on `.app-root` is not an option: React owns
        // that subtree and toggling attributes on it from a portal fights hydration.
        if (event.key !== "Tab") return;
        const focusables = popoverRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled])"
        );
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <h2 id={titleId} className="ui-title text-[15.5px] font-bold leading-tight text-foreground">
        {title}
      </h2>
      <p id={bodyId} className="text-[12.5px] leading-relaxed text-muted-foreground">
        {body}
      </p>

      {/*
        Progress is the page title's own timing line, not a dot row.
        `.page-title::before` (globals.css) already draws a −21° yellow sector on a hairline
        track to show which of N destinations you are in — "yellow here carries location, not
        decoration". Reusing it means the app has one way of showing position in a set, not two.
        `aria-hidden` because the live region below carries the count in words.
      */}
      <div
        aria-hidden="true"
        className="rc-tour-rail"
        style={
          {
            "--rc-tour-i": stepIndex,
            "--rc-tour-n": stepCount,
          } as React.CSSProperties
        }
      >
        <i />
      </div>

      <div className="flex items-center gap-2">
        <span className="type-timestamp mr-auto text-[10px] tabular-nums text-faint">
          {String(stepIndex + 1).padStart(2, "0")} / {String(stepCount).padStart(2, "0")}
        </span>
        <button
          type="button"
          onClick={onSkip}
          className="rounded-md px-3 py-1.5 text-[12px] font-bold text-muted-foreground transition-colors hover:text-foreground"
        >
          Skip
        </button>
        {stepIndex > 0 ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded-md border border-border px-3 py-1.5 text-[12px] font-bold text-muted-foreground transition-colors hover:border-foreground/35 hover:text-foreground"
          >
            Back
          </button>
        ) : null}
        <button
          type="button"
          onClick={onNext}
          className="rounded-md primary-face bg-primary px-3 py-1.5 text-[12px] font-bold text-primary-foreground transition-transform hover:-translate-y-px"
        >
          {nextLabel}
        </button>
      </div>
    </div>
  );

  return createPortal(
    <>
      {/*
        Swallows every pointer event, including over the cutout — the tour chose the route, so
        a click on the spotlighted CTA would strand it somewhere it did not plan for. The one
        exception is the handover stop, where using the thing inside the hole is the point.
        Backdrop clicks do NOT dismiss: Skip is always visible and Escape works, but a mis-tap
        beside a popover on a phone would otherwise end a once-per-visit tour with no obvious
        way back.
      */}
      <div
        className={cn("fixed inset-0 z-[64]", handover && "pointer-events-none")}
        onPointerDown={(event) => event.preventDefault()}
        // Flat dim between routes: the hole and popover are gone, so the scrim paints it.
        style={phase === "navigating" ? { background: "rgb(var(--page-bg-rgb) / 0.78)" } : undefined}
      />

      {hole ? (
        <div
          aria-hidden="true"
          className="rc-tour-hole pointer-events-none fixed z-[65]"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
            borderRadius: hole.radius,
          }}
        />
      ) : null}

      {phase === "navigating" ? (
        slowNavigation ? (
          <p className="fixed inset-x-0 top-1/2 z-[66] text-center text-[12.5px] text-muted-foreground">
            Loading…
          </p>
        ) : null
      ) : (
        dialog
      )}

      {/*
        Announce the step change in words. Swapping `aria-labelledby` alone is unreliable across
        screen readers when the dialog node itself persists between steps.
      */}
      <p className="sr-only" aria-live="polite">
        {placed ? `Step ${stepIndex + 1} of ${stepCount}: ${title}` : ""}
      </p>
    </>,
    document.body
  );
}
