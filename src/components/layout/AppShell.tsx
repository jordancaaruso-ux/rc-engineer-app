"use client";

import type { CSSProperties, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { BottomNav } from "@/components/layout/BottomNav";
import { LogRunFab } from "@/components/layout/LogRunFab";
import { MobileBrandMark } from "@/components/layout/MobileBrandMark";
import { MobileBackProvider } from "@/components/layout/MobileBackContext";
import { isHiddenNavRoute, MOBILE_NAV, resolveActiveNavId } from "@/components/layout/navConfig";
import { PrimaryNavProvider } from "@/components/layout/PrimaryNavProvider";
import { Sidebar } from "@/components/layout/sidebar";
import { TodayDraftRunProvider } from "@/components/layout/TodayDraftRunProvider";
import { RouteTransitionProvider } from "@/components/layout/RouteTransitionProvider";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hideNav = isHiddenNavRoute(pathname);

  // Page-title timing line: which of the 5 dock sectors this route belongs to.
  // -1 (add run, settings, unknown) → no data attribute → bare track, no segment.
  const activeNavId = pathname ? resolveActiveNavId(pathname) : null;
  const navSector = activeNavId ? MOBILE_NAV.findIndex((item) => item.id === activeNavId) : -1;

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
        <MobileBackProvider>
          <div
            className="app-shell"
            data-nav-sector={navSector >= 0 ? navSector : undefined}
            style={navSector >= 0 ? ({ "--title-nav-sector": navSector } as CSSProperties) : undefined}
          >
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
        </MobileBackProvider>
      </PrimaryNavProvider>
    </TodayDraftRunProvider>
  );
}
