"use client";

import { memo } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Flag, Plus } from "@phosphor-icons/react";
import { shouldShowLogRunFab } from "@/components/layout/navConfig";
import { useTodayDraftRun } from "@/components/layout/TodayDraftRunProvider";
import { haptic } from "@/lib/haptics";

/**
 * The "Log run" action — the app's #1 action, an icon-only yellow circle
 * sitting beside the dock bar at matched height (founder-locked 2026-07-14;
 * previously a labeled pill floating on its own row). Rendered in-row by
 * `BottomNav`, mobile only (desktop keeps "Add run" in the sidebar).
 *
 * The specular treatment (bright top rim over the gradient) is deliberate and
 * founder-kept — don't flatten it to a solid fill.
 *
 * Draft-aware: resumes today's draft run when one exists — the + swaps to a
 * flag and a green dot rides the rim (locked draft indicator) — otherwise
 * starts a new run. Suppressed on create/edit surfaces with their own primary
 * action (see `shouldShowLogRunFab`); the dock bar stretches into this slot.
 *
 * On the dashboard (2026-07-16) the loud yellow Start-run bar owns the action,
 * so the circle goes BLACK / outline-only there — two yellow things would clash
 * — and always points at a fresh run (the bar carries the draft-resume state).
 * Everywhere else it stays the yellow circle, now wearing the ambient aura glow
 * (`logrun-glow`) matched to the dashboard bar.
 */
export const LogRunFab = memo(function LogRunFab() {
  const pathname = usePathname();
  const router = useRouter();
  const { addRunHref, draftRunId } = useTodayDraftRun();

  if (!shouldShowLogRunFab(pathname)) return null;

  const isDashboard = pathname === "/";

  // On the dashboard: quiet black/outline "+", always a fresh run (the bar above
  // handles finishing today's draft). Elsewhere: draft-aware yellow circle.
  if (isDashboard) {
    const warmNew = () => router.prefetch("/runs/new");
    return (
      <Link
        href="/runs/new"
        prefetch={false}
        onPointerEnter={warmNew}
        onTouchStart={warmNew}
        onClick={() => haptic("light")}
        aria-label="Start a new run"
        className="tap-active flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/15 bg-[rgba(19,18,17,0.92)] text-muted-foreground shadow-[0_6px_16px_-10px_rgba(0,0,0,0.65)] backdrop-blur transition-transform duration-150 active:scale-95 touch-manipulation"
      >
        <Plus size={24} weight="bold" aria-hidden />
      </Link>
    );
  }

  const href = addRunHref("/runs/new");
  // Draft-aware, matching the dashboard Start-run CTA: resume an unfinished run
  // vs start fresh.
  const label = draftRunId ? "Finish run" : "Log run";
  const warm = () => router.prefetch(href);

  return (
    <Link
      href={href}
      prefetch={false}
      onPointerEnter={warm}
      onTouchStart={warm}
      onClick={() => haptic("light")}
      aria-label={label}
      className="tap-active logrun-glow relative isolate flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(180deg,#ffdf3d_0%,#FFD60A_38%)] text-primary-foreground shadow-[0_12px_26px_-6px_rgba(255,214,10,0.35),0_10px_22px_-8px_rgba(0,0,0,0.65),inset_0_1.5px_0_rgba(255,255,255,0.55),inset_0_-1px_0_rgba(0,0,0,0.18)] transition-transform duration-150 active:scale-95 touch-manipulation"
    >
      {/* Moving-hotspot face layer — matched to the dashboard bar. */}
      <span className="logrun-fx" aria-hidden />
      {draftRunId ? (
        <Flag size={25} weight="bold" aria-hidden className="relative z-[2]" />
      ) : (
        <Plus size={26} weight="bold" aria-hidden className="relative z-[2]" />
      )}
      {draftRunId ? (
        <span
          className="absolute right-0.5 top-0.5 z-[2] h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-background"
          aria-hidden
        />
      ) : null}
    </Link>
  );
});
