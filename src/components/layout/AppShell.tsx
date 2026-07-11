"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { BottomNav } from "@/components/layout/BottomNav";
import { LogRunFab } from "@/components/layout/LogRunFab";
import { MobileBrandMark } from "@/components/layout/MobileBrandMark";
import { isHiddenNavRoute } from "@/components/layout/navConfig";
import { PrimaryNavProvider } from "@/components/layout/PrimaryNavProvider";
import { Sidebar } from "@/components/layout/sidebar";
import { TodayDraftRunProvider } from "@/components/layout/TodayDraftRunProvider";
import { RouteTransitionProvider } from "@/components/layout/RouteTransitionProvider";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hideNav = isHiddenNavRoute(pathname);

  if (hideNav) {
    return (
      <main className="page bg-background">
        {children}
      </main>
    );
  }

  return (
    <TodayDraftRunProvider>
      <PrimaryNavProvider>
        <div className="app-shell">
          <Sidebar />
          <main
            className={cn(
              "page relative",
              "pb-[calc(var(--mobile-tab-bar-height)+env(safe-area-inset-bottom))] md:pb-0"
            )}
          >
            <RouteTransitionProvider>{children}</RouteTransitionProvider>
          </main>
        </div>
        {/*
         * After <main> and outside `.app-shell` (overflow-x-hidden → scroll container)
         * so fixed positioning is not clipped on iOS. See globals.css stacking note.
         * Mobile-only floating chrome: the dock (destinations), the Log-run FAB
         * (primary action), and the account avatar (Settings + account).
         */}
        <BottomNav />
        <LogRunFab />
        <MobileBrandMark />
        <AccountMenu />
      </PrimaryNavProvider>
    </TodayDraftRunProvider>
  );
}
