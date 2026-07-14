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
 */
export const LogRunFab = memo(function LogRunFab() {
  const pathname = usePathname();
  const router = useRouter();
  const { addRunHref, draftRunId } = useTodayDraftRun();

  if (!shouldShowLogRunFab(pathname)) return null;

  const href = addRunHref("/runs/new");
  // Draft-aware, matching DashboardTodayStrip: resume an unfinished run vs
  // start fresh.
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
      className="tap-active relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(180deg,#ffdf3d_0%,#FFD60A_38%)] text-primary-foreground shadow-[0_12px_26px_-6px_rgba(255,214,10,0.35),0_10px_22px_-8px_rgba(0,0,0,0.65),inset_0_1.5px_0_rgba(255,255,255,0.55),inset_0_-1px_0_rgba(0,0,0,0.18)] transition-transform duration-150 active:scale-95 touch-manipulation"
    >
      {draftRunId ? (
        <Flag size={25} weight="bold" aria-hidden />
      ) : (
        <Plus size={26} weight="bold" aria-hidden />
      )}
      {draftRunId ? (
        <span
          className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-background"
          aria-hidden
        />
      ) : null}
    </Link>
  );
});
