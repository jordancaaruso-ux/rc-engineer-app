"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useReducedMotion } from "@/components/ui/motion";
import { TourOverlay, type TourPhase } from "@/components/demo/tour/TourOverlay";
import { useTourAnchor } from "@/components/demo/tour/useTourAnchor";
import { useTourPlacement } from "@/components/demo/tour/useTourPlacement";
import {
  DEMO_TOUR_START_EVENT,
  markTourDone,
  markTourRunning,
  readTourState,
  readTourUrlOverride,
} from "@/lib/demo/demoTourSession";
import {
  isOnStepRoute,
  isRunDetailPath,
  routeForStep,
  stepsForViewport,
  viewportForWidth,
  type TourStep,
  type TourViewport,
} from "@/lib/demo/tourSteps";

/**
 * The demo walkthrough's controller: who sees it, which stop is showing, and getting the
 * browser to the page that stop lives on.
 *
 * Mounted by `AppShell` OUTSIDE `.app-shell` (which is `overflow-x-hidden`, and so clips
 * `position: fixed` descendants on iOS — the same reason `BottomNav` sits out there) and only
 * in the non-hidden-nav branch, which hands us `/demo`, `/login`, `/welcome`, `/join` and
 * `/privacy` suppression for free via `isHiddenNavRoute`.
 *
 * Note on the welcome overlay: `WelcomeScreen` portals at `z-[70]`, above this. It cannot
 * co-occur — it needs `!seen && !hasCar && !hasAnyRun` and `scripts/seed-demo-account.ts`
 * writes `onboardingSeenAt` on an account that has runs — but if that seed ever changes, the
 * two will fight and this is the note that says why.
 */

/** Lets the dashboard's `.rc-reveal` card entrance land before the dim drops. One knob. */
const START_DELAY_MS = 600;

/**
 * How long to wait for a `router.push` to actually commit before forcing it.
 *
 * `PrimaryNavProvider` documents App Router pushes wedging as a recurring failure in the
 * installed PWA. A wedged push here would leave a visitor staring at a flat dim with no popover
 * and Escape as the only way out. The step index is written to `sessionStorage` BEFORE every
 * push, so a hard navigation resumes on exactly the right stop — which is the only reason this
 * heal is safe rather than destructive.
 */
const NAV_WEDGE_MS = 1500;

/** After this long on a flat dim, say something rather than look broken. */
const SLOW_NAV_MS = 1200;

function currentViewport(): TourViewport {
  if (typeof window === "undefined") return "desktop";
  return viewportForWidth(window.innerWidth);
}

/**
 * The destination for a `run-detail` step: the first run on the list already on screen.
 *
 * Read from `data-run-id`, not from an href, because neither run row IS a link — the desktop
 * workbench rail selects into its own pane and the phone's table row calls `router.push` from a
 * click handler. Both carry the attribute for exactly this.
 *
 * Nothing is fetched and no id is hardcoded. Returns null when the season has no runs, and the
 * caller then skips the stop rather than pushing at a page that cannot exist.
 */
function findFirstRunHref(): string | null {
  const rows = document.querySelectorAll<HTMLElement>("[data-run-id]");
  for (const row of rows) {
    const id = row.getAttribute("data-run-id");
    if (!id) continue;
    // Only trust a row that is actually on screen — both trees can be in the DOM at once.
    if (row.getClientRects().length === 0) continue;
    const href = `/runs/${encodeURIComponent(id)}`;
    if (isRunDetailPath(href)) return href;
  }
  return null;
}

export function DemoTour() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const reducedMotion = useReducedMotion();

  const [viewport, setViewport] = useState<TourViewport>("desktop");
  const [running, setRunning] = useState(false);
  const [index, setIndex] = useState(0);
  const [slowNav, setSlowNav] = useState(false);
  // `undefined` = not read yet, `null` = read and there was no `?tour` param. Those have to be
  // distinct: gating the start on "is null" would block the ordinary case forever.
  const [override, setOverride] = useState<"force" | "suppress" | null | undefined>(undefined);
  const [hasAsked, setHasAsked] = useState(false);

  const popoverRef = useRef<HTMLDivElement | null>(null);
  const wedgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set while WE are navigating, so a browser Back is not mistaken for our own push. */
  const navigatingTo = useRef<string | null>(null);

  const isDemo = session?.user?.isDemo === true;
  const devForce = override === "force" && process.env.NODE_ENV !== "production";
  const eligible = (isDemo || devForce) && override !== "suppress";

  const steps = useMemo(() => stepsForViewport(viewport), [viewport]);
  const step: TourStep | undefined = steps[index];

  // Read the URL override once. `window.location.search`, not `useSearchParams()` — that hook
  // opts its whole subtree into a client-side bailout, and this mounts on every page.
  useEffect(() => {
    setOverride(readTourUrlOverride());
  }, []);

  // Viewport tracking. Crossing xl mid-tour re-picks which of the dashboard's twin-rendered
  // anchors is the visible one, so it has to re-resolve rather than sit on a `display:none` node.
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1280px)");
    const sync = () => setViewport(currentViewport());
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Start / resume. Waits for the URL override to have been read at least once.
  useEffect(() => {
    if (!eligible || override === undefined) return;
    const state = readTourState();

    if (state.status === "running") {
      // Resuming after a reload or the wedge heal — no delay, the visitor was mid-tour.
      setIndex(state.stepIndex);
      setRunning(true);
      return;
    }
    if (state.status === "done" && !devForce) return;
    // Auto-start is the dashboard only: it is where the demo now lands, and stop 1 is there.
    if (pathname !== "/" && !devForce) return;

    const timer = setTimeout(() => {
      markTourRunning(0);
      setIndex(0);
      setRunning(true);
    }, START_DELAY_MS);
    return () => clearTimeout(timer);
    // Deliberately not re-running on every pathname change: once started, the tour owns
    // navigation and re-evaluating "should I auto-start" on each stop would restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, override, devForce]);

  // The demo banner's "Take the tour".
  useEffect(() => {
    if (!eligible) return;
    const onStart = () => {
      setHasAsked(false);
      setIndex(0);
      setRunning(true);
    };
    window.addEventListener(DEMO_TOUR_START_EVENT, onStart);
    return () => window.removeEventListener(DEMO_TOUR_START_EVENT, onStart);
  }, [eligible]);

  const onRoute = step ? isOnStepRoute(step, viewport, pathname) : false;

  // Arrived where we were pushing to — stand down the wedge heal.
  useEffect(() => {
    if (!running) return;
    if (onRoute && wedgeTimer.current) {
      clearTimeout(wedgeTimer.current);
      wedgeTimer.current = null;
      navigatingTo.current = null;
    }
  }, [running, onRoute, pathname]);

  const stop = useCallback(() => {
    markTourDone();
    setRunning(false);
    setSlowNav(false);
    if (wedgeTimer.current) clearTimeout(wedgeTimer.current);
    wedgeTimer.current = null;
    navigatingTo.current = null;
  }, []);

  /** Push to a step's page, persisting the index first so a wedge can be healed by reload. */
  const goToStep = useCallback(
    (targetIndex: number) => {
      const forward = targetIndex >= index;

      /*
       * Walk past any stop that cannot resolve a destination. Only `run-detail` can fail, and
       * only when the season has no runs at all — skipping beats pushing at a page that does
       * not exist. The direction comes from the move, so stepping Back past a skipped stop
       * does not bounce forward again.
       */
      let cursor = targetIndex;
      let target: TourStep | undefined;
      for (;;) {
        target = steps[cursor];
        if (!target) break;
        const resolvable =
          target.routeKind !== "run-detail" ||
          isOnStepRoute(target, viewport, pathname) ||
          findFirstRunHref() !== null;
        if (resolvable) break;
        cursor = forward ? cursor + 1 : cursor - 1;
        if (cursor < 0) return; // nothing to go back to; stay put rather than closing
      }

      if (!target) {
        stop();
        return;
      }

      markTourRunning(cursor);
      setIndex(cursor);

      if (isOnStepRoute(target, viewport, pathname)) return;

      const href =
        target.routeKind === "run-detail" ? findFirstRunHref() : routeForStep(target, viewport);
      if (!href) return; // guarded by the walk above

      navigatingTo.current = href;
      router.push(href);

      if (wedgeTimer.current) clearTimeout(wedgeTimer.current);
      wedgeTimer.current = setTimeout(() => {
        // Still not there: force it. `sessionStorage` already holds the step index, so the
        // remount resumes here rather than starting over.
        if (navigatingTo.current) window.location.assign(navigatingTo.current);
      }, NAV_WEDGE_MS);
    },
    [steps, viewport, pathname, router, stop, index]
  );

  const next = useCallback(() => {
    if (index >= steps.length - 1) {
      stop();
      return;
    }
    goToStep(index + 1);
  }, [index, steps.length, goToStep, stop]);

  const back = useCallback(() => {
    if (index === 0) return;
    goToStep(index - 1);
  }, [index, goToStep]);

  // An anchor is only worth hunting for once we are on its page.
  const anchorEnabled = running && onRoute && Boolean(step);
  const anchor = useTourAnchor(step?.anchors ?? [], {
    enabled: anchorEnabled,
    nonce: `${step?.id ?? ""}:${pathname ?? ""}:${viewport}`,
  });

  const geometry = useTourPlacement({
    el: anchor.status === "found" ? anchor.el : null,
    placement: step?.placement[viewport] ?? "bottom",
    viewport,
    padding: step?.padding,
    popoverRef,
    nonce: `${step?.id ?? ""}:${viewport}`,
    reducedMotion,
  });

  const phase: TourPhase = onRoute && anchor.status !== "pending" ? "placed" : "navigating";

  // Only complain about a slow page once it has actually been slow.
  useEffect(() => {
    if (!running || phase !== "navigating") {
      setSlowNav(false);
      return;
    }
    const timer = setTimeout(() => setSlowNav(true), SLOW_NAV_MS);
    return () => clearTimeout(timer);
  }, [running, phase, index]);

  // Focus the popover on each new stop so the dialog is read from its title down.
  useEffect(() => {
    if (!running || phase !== "placed") return;
    popoverRef.current?.focus({ preventScroll: true });
  }, [running, phase, index]);

  // Keyboard. Bound to the document because focus lives in the popover, which is portalled —
  // but it stands down during the handover so Enter still sends the composer's message.
  useEffect(() => {
    if (!running) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
      if (event.key === "Escape") {
        event.preventDefault();
        stop();
        return;
      }
      if (typing) return;
      if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        back();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [running, next, back, stop]);

  /*
   * A route change we did not cause — browser Back, or a link inside the handover cutout.
   * Close rather than fight it: the visitor has left the path the tour was walking, and
   * dragging them back would be worse than ending quietly.
   */
  useEffect(() => {
    if (!running || !step) return;
    if (navigatingTo.current) return; // our own push, still in flight
    if (isOnStepRoute(step, viewport, pathname)) return;
    stop();
  }, [running, step, viewport, pathname, stop]);

  /*
   * Notice when the visitor actually asks something during the handover, so "Skip this" can
   * become "Next".
   *
   * Listens on the anchor rather than reaching into `EngineerChatPanel` — the tour must not
   * own any of that component's state, and this stays correct if the composer is restyled.
   * The composer is a div, not a form, so there is no submit event: it sends on the Send
   * button and on Enter-without-Shift, and both are watched here.
   */
  useEffect(() => {
    if (!running || !step?.handover) return;
    const host = anchor.status === "found" ? anchor.el : null;
    if (!host) return;

    const onClick = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('button[aria-label="Send"]')) {
        setHasAsked(true);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey) setHasAsked(true);
    };

    host.addEventListener("click", onClick, true);
    host.addEventListener("keydown", onKeyDown, true);
    return () => {
      host.removeEventListener("click", onClick, true);
      host.removeEventListener("keydown", onKeyDown, true);
    };
  }, [running, step?.handover, anchor.status, anchor.el]);

  useEffect(() => {
    return () => {
      if (wedgeTimer.current) clearTimeout(wedgeTimer.current);
    };
  }, []);

  if (!eligible || !running || !step) return null;

  const isLast = index === steps.length - 1;
  const nextLabel = isLast ? "Done" : step.handover && !hasAsked ? "Skip this" : "Next";

  return (
    <TourOverlay
      phase={phase}
      geometry={geometry}
      centred={anchor.status === "missing"}
      title={step.title}
      body={step.body}
      stepIndex={index}
      stepCount={steps.length}
      handover={Boolean(step.handover)}
      nextLabel={nextLabel}
      onNext={next}
      onBack={back}
      onSkip={stop}
      popoverRef={popoverRef}
      slowNavigation={slowNav}
    />
  );
}
