"use client";

import { memo } from "react";
import Link from "next/link";
import { JrcMark } from "@/components/brand/JrcMark";
import { DESKTOP_NAV } from "@/components/layout/navConfig";
import { PrimaryNavLink } from "@/components/layout/PrimaryNavLink";
import { usePrimaryNav } from "@/components/layout/PrimaryNavProvider";
import { useTodayDraftRun } from "@/components/layout/TodayDraftRunProvider";
import { cn } from "@/lib/utils";

export const Sidebar = memo(function Sidebar() {
  const { activeId } = usePrimaryNav();
  const { addRunHref } = useTodayDraftRun();

  return (
    <aside className="sidebar hidden md:flex">
      <Link href="/" aria-label="JRC Race Engineer — dashboard" className="sidebar-brand">
        <JrcMark variant="white" className="h-5 opacity-90" />
      </Link>
      <nav className="sidebar-nav">
        {DESKTOP_NAV.map((item) => {
          const active = activeId === item.id;
          const href =
            item.smartDraft && item.id === "add-run" ? addRunHref(item.href) : item.href;
          const Icon = item.icon;

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
                  <Icon size={18} aria-hidden />
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
