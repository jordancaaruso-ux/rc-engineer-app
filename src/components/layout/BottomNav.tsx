"use client";

import { memo } from "react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Car, ChartBar, Gauge, GearSix, PlusCircle } from "@phosphor-icons/react";
import { MOBILE_NAV, type PrimaryNavId } from "@/components/layout/navConfig";
import { EngineerNavIcon } from "@/components/layout/EngineerNavIcon";
import { PrimaryNavLink } from "@/components/layout/PrimaryNavLink";
import { usePrimaryNav } from "@/components/layout/PrimaryNavProvider";
import { useTodayDraftRun } from "@/components/layout/TodayDraftRunProvider";
import { cn } from "@/lib/utils";

/**
 * Dock icons — Phosphor duotone pairs (regular outline → solid fill when
 * active), scoped to the mobile dock. The desktop sidebar keeps the Lucide
 * set from navConfig.
 */
const DOCK_ICON_MAP: Partial<Record<PrimaryNavId, PhosphorIcon>> = {
  dashboard: Gauge,
  analysis: ChartBar,
  "add-run": PlusCircle,
  assets: Car,
  settings: GearSix,
};

export const BottomNav = memo(function BottomNav() {
  const { activeId } = usePrimaryNav();
  const { addRunHref, draftRunId } = useTodayDraftRun();
  const activeIndex = MOBILE_NAV.findIndex((item) => item.id === activeId);

  return (
    <nav
      className="bottom-nav pointer-events-none fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
      aria-label="Primary"
    >
      <div className="pointer-events-auto relative mx-auto max-w-md overflow-hidden rounded-2xl border border-white/[0.14] bg-card/[0.42] bg-gradient-to-b from-white/[0.06] to-transparent shadow-[0_20px_45px_-18px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.22)] backdrop-blur-[30px] backdrop-saturate-[1.7]">
        {/* Sliding active-tab indicator — equal grid cells, so left is index-based. */}
        <span
          aria-hidden
          className={cn(
            "absolute top-0 flex w-[calc(100%/6)] justify-center transition-[left,opacity] duration-200 ease-out",
            activeIndex < 0 && "opacity-0"
          )}
          style={{ left: `calc(${Math.max(activeIndex, 0)} * 100% / 6)` }}
        >
          <span className="h-0.5 w-7 rounded-full bg-primary shadow-[0_0_10px_1px_rgba(255,214,10,0.4)]" />
        </span>
        <ul className="grid h-14 max-w-full grid-cols-6">
          {MOBILE_NAV.map((item) => {
            const active = activeId === item.id;
            const href =
              item.smartDraft && item.id === "add-run" ? addRunHref(item.href) : item.href;
            const isEngineer = item.id === "engineer";
            const Icon = DOCK_ICON_MAP[item.id];

            return (
              <li key={item.id} className="flex min-w-0 items-stretch justify-center">
                <PrimaryNavLink
                  item={item}
                  href={href}
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
                    {item.smartDraft && draftRunId ? (
                      <span
                        className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-card"
                        aria-hidden
                      />
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
