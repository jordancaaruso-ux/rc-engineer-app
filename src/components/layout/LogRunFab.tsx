"use client";

import { memo } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Flag } from "@phosphor-icons/react";
import { IconAddRun } from "@/components/icons/JRCIcons";
import { shouldShowLogRunFab } from "@/components/layout/navConfig";
import { useDraftRun } from "@/components/layout/DraftRunProvider";
import { haptic } from "@/lib/haptics";
import { warmNewRunForm } from "@/lib/runs/warmNewRunForm";

/**
 * The "Log run" action — the app's #1 action, an icon-only yellow circle
 * sitting beside the dock cells at matched height (founder-locked 2026-07-14;
 * previously a labeled pill floating on its own row). Rendered in-row by
 * `BottomNav`, mobile only — desktop's equivalent is the rail's "Log run" button
 * (`TopRail`), which mirrors the dashboard rule below.
 *
 * The face IS a solid fill as of 2026-08-16, reversing the older "don't flatten
 * it to a solid fill" rule. The gradient went with the drifting white hotspot in
 * the "04 + sheen" pass: light now lives at the rim (cream top, bronze bottom)
 * plus `.logrun-fx`'s crossing band, matching the dashboard bar exactly. The rim
 * is still the point — flattening it to a bare disc is what's out.
 *
 * This circle and that bar are now the ONLY two things in the app wearing the band
 * (founder call 2026-08-18). It briefly rode every yellow button via `.primary-face`
 * and read as noise rather than emphasis; the sweep that pulled it back deliberately
 * left these two alone, because they are the same #1 action in two places. Adding it
 * to a third surface undoes the point of the sweep.
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
  const { addRunHref, activeDraftRunId } = useDraftRun();

  if (!shouldShowLogRunFab(pathname)) return null;

  const isDashboard = pathname === "/";

  // On the dashboard: quiet black/outline "+", always a fresh run (the bar above
  // handles finishing today's draft). Elsewhere: draft-aware yellow circle.
  if (isDashboard) {
    const warmNew = () => {
      router.prefetch("/runs/new");
      warmNewRunForm();
    };
    return (
      <Link
        href="/runs/new"
        prefetch={false}
        onPointerEnter={warmNew}
        onTouchStart={warmNew}
        onClick={() => haptic("light")}
        aria-label="Start a new run"
        className="tap-active flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border border-elevate/15 bg-surface-runna-deep/90 text-muted-foreground shadow-[0_6px_16px_-10px_rgba(0,0,0,0.65)] backdrop-blur transition-transform duration-150 active:scale-95 touch-manipulation"
      >
        <IconAddRun size={24} aria-hidden />
      </Link>
    );
  }

  const href = addRunHref("/runs/new");
  // Draft-aware, matching the dashboard Start-run CTA: resume an unfinished run
  // vs start fresh.
  const label = activeDraftRunId ? "Finish run" : "Log run";
  const warm = () => {
    router.prefetch(href);
    warmNewRunForm();
  };

  return (
    <Link
      href={href}
      prefetch={false}
      onPointerEnter={warm}
      onTouchStart={warm}
      onClick={() => haptic("light")}
      aria-label={label}
      className="tap-active logrun-glow relative isolate flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_10px_22px_-8px_rgba(0,0,0,0.65),inset_0_1.5px_0_rgba(255,252,230,0.62),inset_0_-1.5px_0_rgba(122,90,0,0.3)] transition-transform duration-150 active:scale-95 touch-manipulation"
    >
      {/* Sheen face layer — matched to the dashboard bar. */}
      <span className="logrun-fx" aria-hidden />
      {activeDraftRunId ? (
        <Flag size={25} weight="bold" aria-hidden className="relative z-[2]" />
      ) : (
        <IconAddRun size={26} aria-hidden className="relative z-[2]" />
      )}
      {activeDraftRunId ? (
        <span
          className="absolute right-0.5 top-0.5 z-[2] h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-background"
          aria-hidden
        />
      ) : null}
    </Link>
  );
});
