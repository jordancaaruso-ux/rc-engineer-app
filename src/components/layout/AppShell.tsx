"use client";

import type { CSSProperties, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { BottomNav } from "@/components/layout/BottomNav";
import { MobileBrandMark } from "@/components/layout/MobileBrandMark";
import { MobileTitleCondenser } from "@/components/layout/MobileTitleCondenser";
import { MobileBackProvider } from "@/components/layout/MobileBackContext";
import {
  isHiddenNavRoute,
  MOBILE_NAV,
  resolveActiveMobileNavId,
} from "@/components/layout/navConfig";
import { PrimaryNavProvider } from "@/components/layout/PrimaryNavProvider";
import { IdeasEdgeTab } from "@/components/layout/IdeasEdgeTab";
import { TopRail } from "@/components/layout/TopRail";
import { TodayDraftRunProvider } from "@/components/layout/TodayDraftRunProvider";
import { RouteTransitionProvider } from "@/components/layout/RouteTransitionProvider";
import { DemoBanner } from "@/components/layout/DemoBanner";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hideNav = isHiddenNavRoute(pathname);

  // Page-title timing line: which dock sector this route belongs to, and how many
  // sectors there are. -1 (add run, settings, unknown) → no data attribute → bare
  // track, no segment.
  //
  // The COUNT is published alongside the sector because the CSS used to hardcode
  // five slots (`width: 20%`). Teams joined MOBILE_NAV as a sixth destination, so
  // its tick resolved to `left: 100%` — past the right end of the title, where it
  // dangled on `/teams` and was clipped away entirely on `/teams/[teamId]`. Deriving
  // the slot width from the nav means a seventh destination cannot repeat it.
  // The DOCK cell, not the section — the phone reaches Tools from Analysis rather than
  // through a cell of its own, and the timing line has to agree with the dock underneath
  // it. The count is four since the 2026-08-18 restructure, which is exactly the change
  // the hardcoded `width: 20%` above would have broken a second time.
  const activeNavId = pathname ? resolveActiveMobileNavId(pathname) : null;
  const navSector = activeNavId ? MOBILE_NAV.findIndex((item) => item.id === activeNavId) : -1;

  if (hideNav) {
    return (
      <>
        <DemoBanner />
        <main className="page bg-background">
          {children}
        </main>
      </>
    );
  }

  return (
    <TodayDraftRunProvider>
      <PrimaryNavProvider>
        <MobileBackProvider>
          <DemoBanner />
          {/*
           * The rail is a ROW above the page, where the sidebar was a COLUMN beside
           * it — so it sits here, outside `.app-shell`, next to the banner.
           *
           * Outside and not inside, because `.app-shell` is `overflow-x: hidden`
           * and the spec computes `overflow-y` from `visible` to `auto` for that —
           * making the shell a scrollport that never actually scrolls (the document
           * does). A `position: sticky` rail inside it therefore resolves its
           * offsets against a container that stays put, and simply scrolled away.
           * Out here it sticks against the document, exactly as `DemoBanner` does.
           */}
          <TopRail />
          <div
            className="app-shell"
            data-nav-sector={navSector >= 0 ? navSector : undefined}
            style={
              navSector >= 0
                ? ({
                    "--title-nav-sector": navSector,
                    "--title-nav-count": MOBILE_NAV.length,
                  } as CSSProperties)
                : undefined
            }
          >
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
           * Mobile-only floating chrome: the dock bar (Ideas cap + destinations,
           * with the Log-run circle rendered in-row by BottomNav) and the
           * account avatar (Settings + account).
           */}
          <BottomNav />
          <MobileBrandMark />
          <MobileTitleCondenser />
          <AccountMenu />
          {/*
           * Ideas — the edge tab on the phone, and the panel both platforms open
           * (the rail's Ideas button reaches it through `openIdeasPanel`). Out here
           * with BottomNav for the same fixed-position reason, and mounted once so
           * there is a single panel and a single fetch.
           */}
          <IdeasEdgeTab />
          {/*
           * The demo walkthrough used to mount here — out beside BottomNav rather than inside
           * `.app-shell`, for the same fixed-position clipping reason, and only in this branch
           * so `isHiddenNavRoute` kept it off /demo, /login, /welcome and /join for free.
           *
           * Unmounted 2026-08-12 (founder): on a phone the popover works too hard to align to
           * specific cards, and it misses more often than it lands. The whole tour is still in
           * the tree — `src/components/demo/tour/`, `src/lib/demo/tourSteps.ts`, and the
           * `/debug/demo-tour-preview` harness — so bringing it back is re-adding
           * `<DemoTour />` here and the "Take the tour" button in DemoBanner. Fix the mobile
           * anchoring before that happens.
           */}
        </MobileBackProvider>
      </PrimaryNavProvider>
    </TodayDraftRunProvider>
  );
}
