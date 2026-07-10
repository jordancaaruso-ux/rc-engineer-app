"use client";

import { memo } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus } from "@phosphor-icons/react";
import { shouldShowLogRunFab } from "@/components/layout/navConfig";
import { useTodayDraftRun } from "@/components/layout/TodayDraftRunProvider";
import { useScrolled } from "@/components/layout/useScrolled";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/**
 * Floating "Log run" action — the app's #1 action, lifted out of the mobile
 * dock (2026-07-06) so the dock holds pure destinations. A labeled yellow pill
 * pinned bottom-right, above the floating dock, on mobile only (desktop keeps
 * "Add run" in the sidebar).
 *
 * Draft-aware: resumes today's draft run when one exists (green dot), otherwise
 * starts a new run — same behavior the old add-run dock tab had. Suppressed on
 * create/edit surfaces with their own primary action (see
 * `shouldShowLogRunFab`).
 *
 * Bottom offset tracks the dock's own footprint — `max(0.75rem, safe-area)` pad
 * + `h-14` (3.5rem) height + a ~0.75rem gap — so the pill floats a constant
 * distance above the dock on both flat and notched devices. Right edge is
 * aligned to the dock via the shared `mx-auto max-w-md px-4` container.
 */
export const LogRunFab = memo(function LogRunFab() {
  const pathname = usePathname();
  const router = useRouter();
  const { addRunHref, draftRunId } = useTodayDraftRun();
  const collapsed = useScrolled();

  if (!shouldShowLogRunFab(pathname)) return null;

  const href = addRunHref("/runs/new");
  // Draft-aware, matching DashboardTodayStrip: resume an unfinished run vs start
  // fresh. The green dot doubles the signal.
  const label = draftRunId ? "Finish run" : "Log run";
  const warm = () => router.prefetch(href);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 px-4 md:hidden"
      style={{
        bottom: "calc(max(0.75rem, env(safe-area-inset-bottom)) + 4.25rem)",
      }}
    >
      <div className="mx-auto flex max-w-md justify-end">
        <Link
          href={href}
          prefetch={false}
          onPointerEnter={warm}
          onTouchStart={warm}
          onClick={() => haptic("light")}
          aria-label={label}
          className={cn(
            "pointer-events-auto tap-active relative inline-flex h-12 items-center rounded-full bg-primary font-sans text-sm font-bold text-primary-foreground shadow-[0_12px_26px_-6px_rgba(255,214,10,0.35),0_10px_22px_-8px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.4)] transition-[padding] duration-200 ease-out hover:bg-[#E6BE00] active:scale-95 touch-manipulation",
            collapsed ? "px-3" : "pl-3.5 pr-4"
          )}
        >
          <Plus size={22} weight="bold" aria-hidden />
          <span
            className={cn(
              "overflow-hidden whitespace-nowrap transition-all duration-200 ease-out",
              collapsed ? "ml-0 max-w-0 opacity-0" : "ml-1.5 max-w-[6rem] opacity-100"
            )}
          >
            {label}
          </span>
          {draftRunId ? (
            <span
              className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-background"
              aria-hidden
            />
          ) : null}
        </Link>
      </div>
    </div>
  );
});
