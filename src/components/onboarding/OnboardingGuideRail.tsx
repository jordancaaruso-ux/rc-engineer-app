"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { shouldShowLogRunFab } from "@/components/layout/navConfig";
import { cn } from "@/lib/utils";
import type { OnboardingProgress, OnboardingStepId } from "@/lib/onboarding/progress";

/**
 * The guided-intro chip — docs/ONBOARDING_NORTH_STAR.md (founder-locked
 * 2026-07-22, round 3: "guide chip + highlighted taps").
 *
 * While the garage is unfinished, a floating chip above the dock narrates the
 * next step ("Setting up · 2 of 4 · Add your car") and the next REQUIRED TAP
 * carries a pulsing yellow ring — the dock's Garage icon, then the "Add car"
 * row, and so on. The ring is pure CSS keyed off `data-guide-target` on
 * `<body>` (set here) matching `data-guide` anchors on real controls, so a
 * missing anchor after a UI change degrades to tap-the-chip-to-navigate —
 * the guide can soften but never break.
 *
 * Progress is DERIVED (never a stored counter): the chip re-reads it on every
 * route change, on tab focus, and on a slow poll while active, so adding a car
 * from anywhere ticks the step. When everything is done and no run exists yet
 * it turns into the quiet yellow payoff — "Garage ready · Log your first run".
 */

type GuideView = {
  state: { seen: boolean; completed: boolean; resumeDismissed: boolean };
  progress: OnboardingProgress;
  hasAnyRun: boolean;
  showPayoff: boolean;
};

/** Which anchor should pulse for this step from this page. Null = chip is the tap. */
function anchorFor(stepId: OnboardingStepId, pathname: string): string | null {
  if (stepId === "you") return pathname.startsWith("/settings") ? "you-section" : null;
  if (stepId === "car") {
    if (pathname.startsWith("/cars")) return "add-car";
    if (pathname === "/assets") return "assets-cars";
    return "dock-garage";
  }
  if (stepId === "track") {
    if (pathname.startsWith("/tracks")) return "track-pick";
    if (pathname === "/assets") return "assets-tracks";
    return "dock-garage";
  }
  if (stepId === "tires") {
    if (pathname.startsWith("/tire-sets")) return "add-tire-set";
    if (pathname === "/assets") return "assets-tires";
    return "dock-garage";
  }
  return null;
}

export function OnboardingGuideRail() {
  const router = useRouter();
  const pathname = usePathname();
  const [view, setView] = useState<GuideView | null>(null);
  /** Once the guide has nothing left to do, stop fetching for the session. */
  const retiredRef = useRef(false);

  const refetch = useCallback(async () => {
    if (retiredRef.current) return;
    try {
      const res = await fetch("/api/onboarding", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as GuideView;
      if (!data?.progress) return;
      if (
        data.state.completed ||
        data.state.resumeDismissed ||
        (data.progress.complete && data.hasAnyRun)
      ) {
        retiredRef.current = true;
      }
      setView(data);
    } catch {
      // Network hiccup: keep whatever we last knew; the next trigger retries.
    }
  }, []);

  // Route changes are the main "did they just do the step?" signal; focus and a
  // slow poll cover same-page mutations (adding a car doesn't navigate).
  useEffect(() => {
    void refetch();
  }, [refetch, pathname]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    const poll = window.setInterval(() => {
      if (!retiredRef.current && document.visibilityState === "visible") void refetch();
    }, 20_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(poll);
    };
  }, [refetch]);

  const active =
    view != null &&
    view.state.seen &&
    !view.state.completed &&
    !view.state.resumeDismissed &&
    !(view.progress.complete && view.hasAnyRun) &&
    // The run wizard (and other sticky-save flows) own their bottom chrome.
    shouldShowLogRunFab(pathname);

  const next = active ? view.progress.nextStep : null;
  const ready = active && view.showPayoff;
  // On the dashboard the payoff card carries the moment — don't say it twice.
  const show = active && (next != null || (ready && pathname !== "/"));

  // The pulsing ring: body-level dataset drives pure-CSS anchor highlights.
  useEffect(() => {
    const target = show && next ? anchorFor(next.id, pathname ?? "") : null;
    if (target) document.body.dataset.guideTarget = target;
    else delete document.body.dataset.guideTarget;
    return () => {
      delete document.body.dataset.guideTarget;
    };
  }, [show, next, pathname]);

  if (!show || view == null) return null;

  const idx = next ? view.progress.steps.findIndex((s) => s.id === next.id) : -1;
  const anchored = next ? anchorFor(next.id, pathname ?? "") !== null : false;
  const onTarget = next ? pathname === next.href || pathname?.startsWith(`${next.href}/`) : false;

  async function tap() {
    if (ready) {
      // Mark finished so the guide never resurfaces, then hand off to run 1.
      void fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete", skippedSteps: [] }),
      });
      retiredRef.current = true;
      setView(null);
      router.push("/runs/new");
      return;
    }
    if (next && !onTarget) router.push(next.href);
  }

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 bottom-[calc(var(--mobile-tab-bar-height)+env(safe-area-inset-bottom)+0.5rem)] px-2 md:bottom-5"
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={() => void tap()}
        className={cn(
          "pointer-events-auto mx-auto flex w-full max-w-md items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left shadow-[0_14px_34px_-12px_rgba(0,0,0,0.65)] backdrop-blur-xl transition",
          ready
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-card/95 hover:bg-card"
        )}
      >
        {ready ? (
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-[9.5px] uppercase tracking-[0.12em] opacity-70">
              Garage ready
            </span>
            <span className="block truncate text-[13px] font-bold">Log your first run</span>
          </span>
        ) : (
          <>
            <span className="flex shrink-0 items-center gap-1" aria-hidden>
              {view.progress.steps.map((s, i) => (
                <span
                  key={s.id}
                  className={cn(
                    "block size-1.5 rounded-full",
                    s.done ? "bg-primary/40" : i === idx ? "bg-primary" : "bg-border"
                  )}
                />
              ))}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-[9.5px] uppercase tracking-[0.12em] text-faint">
                Setting up · {idx + 1} of {view.progress.total}
                {anchored && !onTarget ? " · follow the yellow" : ""}
              </span>
              <span className="block truncate text-[13px] font-bold text-foreground">
                {next?.title}
              </span>
            </span>
          </>
        )}
        <ArrowRight
          aria-hidden
          className={cn("size-4 shrink-0", ready ? "" : "text-primary")}
          strokeWidth={2.6}
        />
      </button>
    </div>
  );
}
