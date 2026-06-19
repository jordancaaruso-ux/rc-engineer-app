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
        <ul className="mx-auto grid h-[var(--mobile-tab-bar-height)] max-w-lg grid-cols-6 overflow-visible px-1">
          {MOBILE_NAV.map((item) => {
            const active = activeId === item.id;
            const href =
              item.smartDraft && item.id === "add-run" ? addRunHref(item.href) : item.href;
            const Icon = item.icon;
            const isEngineer = item.id === "engineer";

            return (
              <li key={item.id} className="flex flex-col items-center justify-end pb-1.5">
                <PrimaryNavLink
                  item={item}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  aria-label={item.id === "add-run" ? item.label : undefined}
                  className={cn(
                    "tap-active flex min-h-11 min-w-0 flex-col items-center justify-end gap-1 px-1 touch-manipulation",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className="relative shrink-0">
                    {isEngineer ? (
                      <EngineerNavIcon active={active} />
                    ) : (
                      <Icon className="h-5 w-5" aria-hidden />
                    )}
                    {item.smartDraft && draftRunId ? (
                      <span
                        className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-card"
                        aria-hidden
                      />
                    ) : null}
                  </span>
                  <span className="ui-title truncate text-[10px] leading-none">{item.label}</span>
                  <span
                    className={cn(
                      "h-1 w-1 rounded-full bg-accent",
                      active ? "opacity-100" : "opacity-0"
                    )}
                    aria-hidden
                  />
                </PrimaryNavLink>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
});
