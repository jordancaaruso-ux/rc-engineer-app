"use client";

import { memo } from "react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Car, ChartBar, Gauge, UsersThree } from "@phosphor-icons/react";
import { MOBILE_NAV, type PrimaryNavId } from "@/components/layout/navConfig";
import { EngineerNavIcon } from "@/components/layout/EngineerNavIcon";
import { PrimaryNavLink } from "@/components/layout/PrimaryNavLink";
import { usePrimaryNav } from "@/components/layout/PrimaryNavProvider";
import { cn } from "@/lib/utils";

/**
 * Dock icons — Phosphor (regular outline → solid fill when active), scoped to
 * the mobile dock's five destinations. `add-run` and `settings` are no longer
 * dock items (they moved to the floating `LogRunFab` and the account
 * `AccountMenu`). Engineer uses `EngineerNavIcon`; the desktop sidebar keeps the
 * Lucide set from navConfig.
 */
const DOCK_ICON_MAP: Partial<Record<PrimaryNavId, PhosphorIcon>> = {
  dashboard: Gauge,
  analysis: ChartBar,
  assets: Car,
  teams: UsersThree,
};

export const BottomNav = memo(function BottomNav() {
  const { activeId } = usePrimaryNav();
  const activeIndex = MOBILE_NAV.findIndex((item) => item.id === activeId);

  return (
    <nav
      className="bottom-nav pointer-events-none fixed inset-x-0 bottom-0 z-50 px-7 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
      aria-label="Primary"
    >
      <div className="pointer-events-auto relative mx-auto max-w-[302px] overflow-hidden rounded-full border border-white/[0.06] bg-card/[0.32] bg-[linear-gradient(180deg,rgba(255,255,255,0.07),transparent_42%)] shadow-[0_22px_48px_-18px_rgba(0,0,0,0.68),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_0_0_0.5px_rgba(255,255,255,0.06)] backdrop-blur-[40px] backdrop-saturate-[1.9]">
        {/* Sliding active-tab indicator — equal grid cells, so left is index-based. */}
        <span
          aria-hidden
          className={cn(
            "absolute top-0 flex w-[calc(100%/5)] justify-center transition-[left,opacity] duration-200 ease-out",
            activeIndex < 0 && "opacity-0"
          )}
          style={{ left: `calc(${Math.max(activeIndex, 0)} * 100% / 5)` }}
        >
          <span className="h-0.5 w-7 rounded-full bg-primary shadow-[0_0_10px_1px_rgba(255,214,10,0.4)]" />
        </span>
        <ul className="grid h-[49px] max-w-full grid-cols-5">
          {MOBILE_NAV.map((item) => {
            const active = activeId === item.id;
            const isEngineer = item.id === "engineer";
            const Icon = DOCK_ICON_MAP[item.id];

            return (
              <li key={item.id} className="flex min-w-0 items-stretch justify-center">
                <PrimaryNavLink
                  item={item}
                  href={item.href}
                  data-active={active ? "true" : "false"}
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  className={cn(
                    "tap-active flex w-full items-center justify-center touch-manipulation transition-colors duration-150",
                    active ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  <span className="relative shrink-0">
                    {isEngineer ? (
                      <EngineerNavIcon
                        active={active}
                        filled={active}
                        className="h-6 w-6"
                      />
                    ) : Icon ? (
                      <Icon size={24} weight={active ? "fill" : "regular"} aria-hidden />
                    ) : null}
                  </span>
                </PrimaryNavLink>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
});
