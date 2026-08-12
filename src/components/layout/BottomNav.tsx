"use client";

import { memo } from "react";
import { MOBILE_NAV } from "@/components/layout/navConfig";
import { LogRunFab } from "@/components/layout/LogRunFab";
import { PrimaryNavLink } from "@/components/layout/PrimaryNavLink";
import { usePrimaryNav } from "@/components/layout/PrimaryNavProvider";
import { cn } from "@/lib/utils";

/**
 * Mobile bottom chrome (nav restructure 2026-08-12): a full-bleed glass slab
 * holding five destinations and the yellow Log-run circle, static on scroll,
 * nothing collapses.
 *
 * **Full-bleed, not a floating pill.** The pill spent its side inset and float gap
 * on air, which is what squeezed six destinations to ~42.7px and cost the labels.
 * Edge to edge, five cells land at 60px at 390px and the labels come back — and a
 * bar welded to the bottom edge reads as the app's floor rather than as a control
 * hovering over the page. The Ideas cap left the bar entirely (it is
 * `IdeasEdgeTab` now), which is the other half of where the width came from.
 *
 * The Log-run circle keeps its identity — a circle at matched height, never a nav
 * cell (founder-locked 2026-07-14). Only the surface behind it changed. When
 * `shouldShowLogRunFab` suppresses it the cell grid stretches into the slot.
 *
 * Glyphs come from the JRC "Solid Form" set (`navConfig` → `JRCIcons`) — solid in
 * both states, so active reads as the ink swap plus the sliding tick, not an
 * outline→fill change.
 */
export const BottomNav = memo(function BottomNav() {
  // The DOCK cell, not the section: Events, Garage and Tools all light `More`.
  const { mobileActiveId: activeId } = usePrimaryNav();
  const activeIndex = MOBILE_NAV.findIndex((item) => item.id === activeId);
  // Grid + indicator geometry both come from the destination count so adding a
  // tab can't leave the sliding indicator pointing at the wrong cell.
  const cellCount = MOBILE_NAV.length;

  return (
    <nav
      className="bottom-nav pointer-events-none fixed inset-x-0 bottom-0 z-50 md:hidden"
      aria-label="Primary"
    >
      <div className="bottom-nav-slab pointer-events-auto">
        <div className="flex items-center gap-2.5">
          <div
            className="relative grid min-w-0 flex-1"
            style={{ gridTemplateColumns: `repeat(${cellCount}, minmax(0, 1fr))` }}
          >
            {/* Sliding active-cell tick — equal grid cells, so left is index-based.
                Desktop measures instead (`TopRail`), because label-width tabs are
                not equal; this is the same 28×2 mark in both places. */}
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
              <span className="nav-tick" />
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
                  className={cn(
                    "tap-active flex h-[46px] min-w-0 flex-col items-center justify-center gap-[3px] touch-manipulation transition-colors duration-150",
                    active ? "text-primary-ink" : "text-muted-foreground"
                  )}
                >
                  <span className="relative shrink-0">
                    <Icon size={24} className="dock-icon" aria-hidden />
                  </span>
                  {/*
                    9.5px is the ceiling that keeps "Dashboard" on one line inside a
                    60px cell. `muted-foreground` and never `faint` — at this size the
                    decorative tone stops being legible, in either theme.
                  */}
                  <span className="dock-label">{item.label}</span>
                </PrimaryNavLink>
              );
            })}
          </div>
          <LogRunFab />
        </div>
        {/*
          Home indicator. Inside the slab and below the row, so on a gesture phone
          the bar owns the whole bottom edge instead of ending just above the
          system's own bar.
        */}
        <span className="dock-home-indicator" aria-hidden />
      </div>
    </nav>
  );
});
