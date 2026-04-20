"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/engineer", label: "Engineer" },
  { href: "/runs/new", label: "Log your run" },
  { href: "/laps/import", label: "Lap-time import" },
  { href: "/runs/history", label: "Sessions" },
  { href: "/videos/overlay", label: "Video analysis" },
  { href: "/setup", label: "Setup" },
  { href: "/events", label: "Events" },
  { href: "/cars", label: "Cars" },
  { href: "/tracks", label: "Tracks" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeHref = useMemo(() => {
    for (const item of navItems) {
      const active = item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
      if (active) return item.href;
    }
    return null;
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [mobileOpen]);

  return (
    <>
      {/* Desktop sidebar (unchanged) */}
      <aside className="sidebar hidden md:flex">
        <div className="flex items-center justify-between">
          <div className="sidebar-logo">
            <span className="text-primary">RC</span> Engineer
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                data-active={active ? "true" : "false"}
                className={cn("group")}
              >
                <span>{item.label}</span>
                {active && (
                  <span className="h-1 w-6 rounded-full bg-primary group-hover:w-10 transition-all" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div>Track session ready</div>
          <div className="text-[10px] mt-1 opacity-80">Built for touring car engineers.</div>
        </div>
      </aside>

      {/* Mobile: hamburger + overlay drawer */}
      <div className="md:hidden">
        {!mobileOpen ? (
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
            className="fixed left-3 top-3 z-[60] pointer-events-auto inline-flex items-center justify-center rounded-lg border border-border bg-secondary/90 p-2 text-foreground backdrop-blur-md shadow-glow-sm hover:bg-secondary/100 transition"
          >
            <span className="sr-only">Open menu</span>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path d="M4 7H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M4 12H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M4 17H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}

        {mobileOpen && (
          <div className="fixed inset-0 z-40">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="absolute inset-0 bg-black/55"
            />

            <aside
              role="dialog"
              aria-modal="true"
              aria-label="Navigation menu"
              className="absolute left-0 top-0 h-full w-72 max-w-[85vw] border-r border-border bg-secondary/95 backdrop-blur-md shadow-glow-sm overflow-y-auto"
            >
              <div className="flex items-center justify-between px-4 py-4 border-b border-border">
                <div className="sidebar-logo">
                  <span className="text-primary">RC</span> Engineer
                </div>
                <button
                  type="button"
                  aria-label="Close menu"
                  onClick={() => setMobileOpen(false)}
                  className="rounded-lg border border-border bg-card/40 px-2 py-1 text-xs text-muted-foreground hover:bg-card/60 hover:text-foreground transition"
                >
                  Close
                </button>
              </div>

              <nav className="sidebar-nav px-2 py-2">
                {navItems.map((item) => {
                  const active = item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      data-active={active ? "true" : "false"}
                      className={cn("group")}
                      onClick={() => setMobileOpen(false)}
                    >
                      <span>{item.label}</span>
                      {active && (
                        <span className="h-1 w-6 rounded-full bg-primary group-hover:w-10 transition-all" />
                      )}
                    </Link>
                  );
                })}
              </nav>

              <div className="sidebar-footer px-4 py-4">
                <div className="text-[11px] text-muted-foreground">
                  Track session ready{activeHref ? ` · ${navItems.find((n) => n.href === activeHref)?.label}` : ""}.
                </div>
                <div className="text-[10px] mt-1 opacity-80">Built for touring car engineers.</div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </>
  );
}

