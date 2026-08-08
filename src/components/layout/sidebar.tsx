"use client";

import { memo } from "react";
import Link from "next/link";
import { JrcMark } from "@/components/brand/JrcMark";
import { PRODUCT_NAME } from "@/lib/brand/brandNames";
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
      {/* Yellow mark at rail width: at 18px the white chrome mark reads as a smudge. */}
      <Link href="/" aria-label={`${PRODUCT_NAME} — dashboard`} className="sidebar-brand">
        <JrcMark variant="yellow" className="h-[18px] opacity-90" />
      </Link>
      <nav className="sidebar-nav">
        {DESKTOP_NAV.map((item, i) => {
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
                "tap-active touch-manipulation",
                // Settings is the tail of the list and sits at the foot of the rail.
                i === DESKTOP_NAV.length - 1 && "sidebar-nav-tail"
              )}
            >
              <Icon size={20} aria-hidden />
              <span className="nav-sidebar-label">{item.label}</span>
            </PrimaryNavLink>
          );
        })}
      </nav>
    </aside>
  );
});
