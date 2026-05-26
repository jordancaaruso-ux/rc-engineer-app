"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BottomNav } from "@/components/layout/BottomNav";
import { isHiddenNavRoute } from "@/components/layout/navConfig";
import { Sidebar } from "@/components/layout/sidebar";
import { TodayDraftRunProvider } from "@/components/layout/TodayDraftRunProvider";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hideNav = isHiddenNavRoute(pathname);

  if (hideNav) {
    return <main className="page">{children}</main>;
  }

  return (
    <TodayDraftRunProvider>
      <div className="app-shell">
        <Sidebar />
        <main
          className={cn(
            "page",
            "pb-[calc(var(--mobile-tab-bar-height)+var(--mobile-tab-fab-overhang)+env(safe-area-inset-bottom))] md:pb-0"
          )}
        >
          {children}
        </main>
        <BottomNav />
      </div>
    </TodayDraftRunProvider>
  );
}
