"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DESKTOP_NAV, resolveActiveNavId } from "@/components/layout/navConfig";
import { useTodayDraftRun } from "@/components/layout/TodayDraftRunProvider";

export function Sidebar() {
  const pathname = usePathname();
  const activeId = resolveActiveNavId(pathname ?? "");
  const { addRunHref, refreshDraft } = useTodayDraftRun();

  return (
    <aside className="sidebar hidden md:flex">
      <nav className="sidebar-nav">
        {DESKTOP_NAV.map((item) => {
          const active = activeId === item.id;
          const href =
            item.smartDraft && item.id === "add-run" ? addRunHref(item.href) : item.href;
          const Icon = item.icon;
          const prefetch = item.prefetch !== false;

          return (
            <Link
              key={item.id}
              href={href}
              prefetch={prefetch}
              onClick={() => {
                if (item.smartDraft) void refreshDraft();
              }}
              data-active={active ? "true" : "false"}
              className="tap-active group gap-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                <span className="truncate">{item.label}</span>
              </span>
              {active ? (
                <span className="h-1 w-6 shrink-0 rounded-full bg-primary transition-all group-hover:w-10" />
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div>Track session ready</div>
        <div className="mt-1 text-[10px] opacity-80">Built for touring car engineers.</div>
      </div>
    </aside>
  );
}
