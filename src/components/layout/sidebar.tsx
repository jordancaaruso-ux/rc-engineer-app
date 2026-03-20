"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/engineer", label: "Engineer Chat" },
  { href: "/runs/new", label: "Log your run" },
  { href: "/runs/history", label: "Analysis" },
  { href: "/events", label: "Events" },
  { href: "/cars", label: "Cars" },
  { href: "/tracks", label: "Tracks" },
  { href: "/setup", label: "Setup" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="flex items-center justify-between">
        <div className="sidebar-logo">
          <span className="text-accent">RC</span> Engineer
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname?.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              data-active={active ? "true" : "false"}
              className={cn("group")}
            >
              <span>{item.label}</span>
              {active && (
                <span className="h-1 w-6 rounded-full bg-accent group-hover:w-10 transition-all" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div>Track session ready</div>
        <div className="text-[10px] mt-1 opacity-80">
          Built for touring car engineers.
        </div>
      </div>
    </aside>
  );
}

