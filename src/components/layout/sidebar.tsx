"use client";

import { memo } from "react";
import { DESKTOP_NAV } from "@/components/layout/navConfig";
import { EngineerNavIcon } from "@/components/layout/EngineerNavIcon";
import { PrimaryNavLink } from "@/components/layout/PrimaryNavLink";
import { usePrimaryNav } from "@/components/layout/PrimaryNavProvider";
import { useTodayDraftRun } from "@/components/layout/TodayDraftRunProvider";

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
              className="tap-active group min-h-9 gap-2 touch-manipulation"
            >
              <span className="flex min-w-0 items-center gap-2">
                {isEngineer ? (
                  <EngineerNavIcon className="h-4 w-4" />
                ) : (
                  <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                )}
                <span className="truncate">{item.label}</span>
              </span>
              {active ? (
                <span className="nav-active-indicator h-1 w-6 shrink-0 rounded-full bg-primary group-hover:w-10" />
              ) : null}
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
