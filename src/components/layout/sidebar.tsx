"use client";

import { memo } from "react";
import { DESKTOP_NAV } from "@/components/layout/navConfig";
import { EngineerNavIcon } from "@/components/layout/EngineerNavIcon";
import { PrimaryNavLink } from "@/components/layout/PrimaryNavLink";
import { usePrimaryNav } from "@/components/layout/PrimaryNavProvider";
import { useTodayDraftRun } from "@/components/layout/TodayDraftRunProvider";
import { cn } from "@/lib/utils";

export const Sidebar = memo(function Sidebar() {
  const { activeId } = usePrimaryNav();
  const { addRunHref } = useTodayDraftRun();

  return (
    <aside className="sidebar hidden md:flex">
      <nav className="sidebar-nav">
        {DESKTOP_NAV.map((item) => {
          const active = activeId === item.id;
          const href =
            item.smartDraft && item.id === "add-run" ? addRunHref(item.href) : item.href;
          const Icon = item.icon;
          const isEngineer = item.id === "engineer";

          return (
            <PrimaryNavLink
              key={item.id}
              item={item}
              href={href}
              data-active={active ? "true" : "false"}
              className={cn(
                "tap-active min-h-9 touch-manipulation",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className={cn("shrink-0", active ? "opacity-100" : "opacity-75")}>
                  {isEngineer ? (
                    <EngineerNavIcon active={active} className="h-4 w-4" />
                  ) : (
                    <Icon
                      className="h-4 w-4"
                      strokeWidth={active ? 2.25 : 1.75}
                      aria-hidden
                    />
                  )}
                </span>
                <span className="nav-sidebar-label truncate">{item.label}</span>
              </span>
            </PrimaryNavLink>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div>Track session ready</div>
        <div className="mt-1 text-[10px] opacity-80">Built for touring car engineers.</div>
      </div>
    </aside>
  );
});
