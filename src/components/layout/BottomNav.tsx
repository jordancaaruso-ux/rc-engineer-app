"use client";

import { memo } from "react";
import { MOBILE_NAV } from "@/components/layout/navConfig";
import { IdeasDockCap } from "@/components/layout/IdeasDockCap";
import { LogRunFab } from "@/components/layout/LogRunFab";
import { PrimaryNavLink } from "@/components/layout/PrimaryNavLink";
import { usePrimaryNav } from "@/components/layout/PrimaryNavProvider";
import { cn } from "@/lib/utils";

/**
 * Mobile bottom chrome, one row (founder-locked 2026-07-14, artifact round 3
 * "F1 — divided cap"): a glass bar holding the Ideas utility cap behind a
 * hairline plus the destinations in `MOBILE_NAV`, and the yellow Log-run circle
 * floating beside the bar at matched height. Static on scroll — nothing collapses.
 * When `LogRunFab` is suppressed (create/edit flows) the bar stretches to fill
 * the row.
 *
 * Glyphs come from the JRC "Solid Form" set (`navConfig` → `JRCIcons`) — solid
 * in both states, so active reads as the yellow colour swap plus the sliding
 * indicator, not an outline→fill change.
 */
export const BottomNav = memo(function BottomNav() {
  const { activeId } = usePrimaryNav();
  const activeIndex = MOBILE_NAV.findIndex((item) => item.id === activeId);
  // Grid + indicator geometry both come from the destination count so adding a
  // tab can't leave the sliding indicator pointing at the wrong cell.
  const cellCount = MOBILE_NAV.length;

  return (
    <nav
      className="bottom-nav pointer-events-none fixed inset-x-0 bottom-0 z-50 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
      aria-label="Primary"
    >
      <div className="pointer-events-auto mx-auto flex max-w-md items-center gap-2.5">
        <div className="relative flex h-14 min-w-0 flex-1 items-stretch overflow-hidden rounded-full border border-white/[0.06] bg-card/[0.32] bg-[linear-gradient(180deg,rgba(255,255,255,0.07),transparent_42%)] shadow-[0_22px_48px_-18px_rgba(0,0,0,0.68),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_0_0_0.5px_rgba(255,255,255,0.06)] backdrop-blur-[40px] backdrop-saturate-[1.9]">
          <IdeasDockCap />
          <div
            className="relative grid min-w-0 flex-1"
            style={{ gridTemplateColumns: `repeat(${cellCount}, minmax(0, 1fr))` }}
          >
            {/* Sliding active-tab indicator — equal grid cells, so left is index-based. */}
            <span
              aria-hidden
              className={cn(
                "absolute top-0 flex justify-center transition-[left,opacity] duration-200 ease-out",
                activeIndex < 0 && "opacity-0"
              )}
              style={{
                width: `calc(100% / ${cellCount})`,
                left: `calc(${Math.max(activeIndex, 0)} * 100% / ${cellCount})`,
              }}
            >
              <span className="h-0.5 w-7 rounded-full bg-primary shadow-[0_0_10px_1px_rgba(255,214,10,0.4)]" />
            </span>
            {MOBILE_NAV.map((item) => {
              const active = activeId === item.id;
              const Icon = item.icon;

              return (
                <PrimaryNavLink
                  key={item.id}
                  item={item}
                  href={item.href}
                  data-active={active ? "true" : "false"}
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  className={cn(
                    "tap-active flex min-w-0 items-center justify-center touch-manipulation transition-colors duration-150",
                    active ? "text-primary-ink" : "text-muted-foreground"
                  )}
                >
                  <span className="relative shrink-0">
                    <Icon size={24} className="dock-icon" aria-hidden />
                  </span>
                </PrimaryNavLink>
              );
            })}
          </div>
        </div>
        <LogRunFab />
      </div>
    </nav>
  );
});
