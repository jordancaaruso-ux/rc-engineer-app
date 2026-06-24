"use client";

import { memo } from "react";
import { MOBILE_NAV } from "@/components/layout/navConfig";
import { EngineerNavIcon } from "@/components/layout/EngineerNavIcon";
import { PrimaryNavLink } from "@/components/layout/PrimaryNavLink";
import { usePrimaryNav } from "@/components/layout/PrimaryNavProvider";
import { useTodayDraftRun } from "@/components/layout/TodayDraftRunProvider";
import { cn } from "@/lib/utils";

export const BottomNav = memo(function BottomNav() {
  const { activeId } = usePrimaryNav();
  const { addRunHref, draftRunId } = useTodayDraftRun();

  return (
    <nav
      className="bottom-nav fixed inset-x-0 bottom-0 z-50 md:hidden"
      aria-label="Primary"
    >
      <div className="overflow-visible border-t border-border bg-card">
        <ul className="mx-auto grid h-[var(--mobile-tab-bar-height)] max-w-lg grid-cols-6 overflow-visible px-0.5">
          {MOBILE_NAV.map((item) => {
            const active = activeId === item.id;
            const href =
              item.smartDraft && item.id === "add-run" ? addRunHref(item.href) : item.href;
            const Icon = item.icon;
            const isEngineer = item.id === "engineer";

            return (
              <li key={item.id} className="flex min-w-0 flex-col items-center justify-center">
                <PrimaryNavLink
                  item={item}
                  href={href}
                  data-active={active ? "true" : "false"}
                  aria-current={active ? "page" : undefined}
                  aria-label={item.id === "add-run" ? item.label : undefined}
                  className={cn(
                    "tap-active flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 touch-manipulation",
                    active ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  <span
                    className={cn(
                      "relative shrink-0",
                      active ? "opacity-100" : "opacity-75"
                    )}
                  >
                    {isEngineer ? (
                      <EngineerNavIcon active={active} />
                    ) : (
                      <Icon
                        className="h-[22px] w-[22px]"
                        strokeWidth={active ? 2.25 : 1.75}
                        aria-hidden
                      />
                    )}
                    {item.smartDraft && draftRunId ? (
                      <span
                        className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-card"
                        aria-hidden
                      />
                    ) : null}
                  </span>
                  <span className="nav-tab-label truncate text-[10px] leading-tight">
                    {item.label}
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
