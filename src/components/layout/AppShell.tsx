"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BottomNav } from "@/components/layout/BottomNav";
import { isHiddenNavRoute } from "@/components/layout/navConfig";
import { PrimaryNavProvider } from "@/components/layout/PrimaryNavProvider";
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
        <PrimaryNavProvider>
          <Sidebar />
          <BottomNav />
        </PrimaryNavProvider>
        <main
          className={cn(
            "page",
            "pb-[calc(var(--mobile-tab-bar-height)+env(safe-area-inset-bottom))] md:pb-0"
          )}
        >
          {children}
        </main>
      </div>
    </TodayDraftRunProvider>
  );
}
