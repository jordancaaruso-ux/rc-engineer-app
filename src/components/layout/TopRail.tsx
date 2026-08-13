"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Lightbulb } from "@phosphor-icons/react";
import { JrcMark } from "@/components/brand/JrcMark";
import { PRODUCT_NAME } from "@/lib/brand/brandNames";
import { IconAddRun } from "@/components/icons/JRCIcons";
import { AccountMenu } from "@/components/layout/AccountMenu";
import {
  DESKTOP_NAV,
  NAV_ADD_RUN,
  NAV_SETTINGS,
  shouldShowLogRunFab,
} from "@/components/layout/navConfig";
import { openIdeasPanel } from "@/components/layout/IdeasEdgeTab";
import { PrimaryNavLink } from "@/components/layout/PrimaryNavLink";
import { usePrimaryNav } from "@/components/layout/PrimaryNavProvider";
import { ToolsNavMenu } from "@/components/layout/ToolsNavMenu";
import { useTodayDraftRun } from "@/components/layout/TodayDraftRunProvider";
import { haptic } from "@/lib/haptics";
import { warmNewRunForm } from "@/lib/runs/warmNewRunForm";
import { cn } from "@/lib/utils";

/** Half the 28px tick — the offset from a tab's centre to the tick's left edge. */
const TICK_HALF = 14;

/**
 * Desktop primary navigation: a 64px top rail (nav restructure 2026-08-12).
 *
 * Replaces the 76px left sidebar. The rail was never the problem — the shape was:
 * a permanent left gutter spent 76px of every page's width on nine icon-and-label
 * stacks that fit inside 64px of HEIGHT laid out horizontally. The container goes
 * 1684 → 1760px and the page title sits where the eye already starts.
 *
 * Seven destinations, not nine: `Add run` and `Settings` moved to the right-hand
 * utility cluster (see `DESKTOP_NAV`). A verb and a preference were sharing a list
 * with seven places, which a vertical rail could absorb and a horizontal one
 * cannot — every item now costs width that the content wants.
 *
 * The active tick is the phone's, moved to the bottom edge of the rail: one
 * vocabulary across both platforms, replacing desktop's instant `elevate/0.05`
 * fill-only treatment (`transition-duration: 0ms`).
 */
export const TopRail = memo(function TopRail() {
  const { activeId } = usePrimaryNav();
  const { addRunHref, draftRunId } = useTodayDraftRun();
  const pathname = usePathname();
  const router = useRouter();

  const listRef = useRef<HTMLDivElement | null>(null);
  const [tick, setTick] = useState<{ x: number; shown: boolean }>({ x: 0, shown: false });

  /**
   * Measure, never derive from the index.
   *
   * The dock can compute `left` from a cell index because its five cells are an
   * equal-fraction grid. These tabs are label-width — "Analysis" and "Engineer"
   * are not the same size — so an index would put the tick under the wrong tab by
   * a growing margin along the row.
   */
  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) {
      setTick((t) => ({ ...t, shown: false }));
      return;
    }
    setTick({ x: active.offsetLeft + active.offsetWidth / 2 - TICK_HALF, shown: true });
  }, []);

  useEffect(() => {
    measure();
  }, [measure, activeId]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    // Resize covers the window AND the rail's own reflow; fonts covers the reflow
    // that happens after Sora loads, which moves every tab's centre and would
    // otherwise leave the tick measured against fallback metrics.
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    window.addEventListener("resize", measure);
    void document.fonts?.ready.then(measure).catch(() => {});
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const settingsActive = activeId === "settings";
  const showLogRun = shouldShowLogRunFab(pathname);
  /*
   * The log-run button goes quiet on the dashboard, mirroring the mobile FAB rule
   * (2026-07-16): the dashboard's own yellow Start-run bar owns that action, and
   * two yellow calls to action ~200px apart split the one thing the page is asking
   * for. Same rule, same reason, other platform — and like the FAB, the quiet
   * version always points at a fresh run, because the bar carries draft-resume.
   */
  const isDashboard = pathname === "/";
  const logRunHref = isDashboard ? "/runs/new" : addRunHref(NAV_ADD_RUN.href);
  const logRunLabel = !isDashboard && draftRunId ? "Finish run" : "Log run";
  const warmLogRun = () => {
    router.prefetch(logRunHref);
    warmNewRunForm();
  };

  return (
    <header className="top-rail hidden md:flex" aria-label="Primary">
      <div className="top-rail-inner">
        <Link href="/" aria-label={`${PRODUCT_NAME} — dashboard`} className="top-rail-brand">
          <JrcMark variant="yellow" className="h-[17px]" />
        </Link>

        <nav ref={listRef} className="top-rail-nav" aria-label="Sections">
          {DESKTOP_NAV.map((item) => {
            const active = activeId === item.id;
            const Icon = item.icon;

            /*
             * Tools is the one tab that opens rather than goes (2026-08-13): its
             * destination was a page holding nothing but three links, which the
             * rail has the width to show itself. `/tools` still exists for the
             * phone, which reaches it through `More`.
             */
            if (item.id === "tools") {
              return <ToolsNavMenu key={item.id} active={active} />;
            }

            return (
              <PrimaryNavLink
                key={item.id}
                item={item}
                href={item.href}
                data-active={active ? "true" : "false"}
                aria-current={active ? "page" : undefined}
                className="tap-active top-rail-item"
              >
                <Icon size={18} aria-hidden />
                <span>{item.label}</span>
              </PrimaryNavLink>
            );
          })}
          {/* The dock's tick, on the bottom edge. Measured — see `measure`. */}
          <span
            aria-hidden
            className={cn("top-rail-tick", !tick.shown && "is-hidden")}
            style={{ transform: `translateX(${tick.x}px)` }}
          >
            <span className="nav-tick" />
          </span>
        </nav>

        <div className="top-rail-cluster">
          {/* Labelled, unlike the gear beside it: a lightbulb alone reads as
              "tips" or "hints", and the panel it opens is the driver's own
              scratchpad. Settings needs no word — a gear is a gear. */}
          <button
            type="button"
            onClick={() => openIdeasPanel()}
            aria-label="Ideas and reminders"
            className="tap-active top-rail-utility has-label"
          >
            <Lightbulb size={18} weight="fill" aria-hidden />
            <span>Ideas</span>
          </button>

          <span className="top-rail-divider" aria-hidden />

          <PrimaryNavLink
            item={NAV_SETTINGS}
            href={NAV_SETTINGS.href}
            data-active={settingsActive ? "true" : "false"}
            aria-current={settingsActive ? "page" : undefined}
            aria-label={NAV_SETTINGS.label}
            className="tap-active top-rail-utility"
          >
            <NAV_SETTINGS.icon size={18} aria-hidden />
          </PrimaryNavLink>

          {showLogRun ? (
            <Link
              href={logRunHref}
              prefetch={false}
              onPointerEnter={warmLogRun}
              onClick={() => haptic("light")}
              aria-label={logRunLabel}
              className={cn("top-rail-logrun", isDashboard && "is-quiet")}
            >
              <IconAddRun size={17} aria-hidden className="shrink-0" />
              <span>{logRunLabel}</span>
            </Link>
          ) : null}

          {/*
            Desktop had no account door at all while Settings lived in the sidebar
            — sign-out was reachable only by navigating to /settings and hunting
            for it. Same menu the phone's floating avatar opens.
          */}
          <AccountMenu variant="inline" />
        </div>
      </div>
    </header>
  );
});
