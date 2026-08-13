"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CaretDown } from "@phosphor-icons/react";
import { IconTools } from "@/components/icons/JRCIcons";
import { HUB_ICON_MAP } from "@/components/layout/hubIcons";
import { TOOLS_HUB_LINKS } from "@/components/layout/navConfig";
import { usePrimaryNav } from "@/components/layout/PrimaryNavProvider";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/**
 * Desktop `Tools` — a dropdown, not a door (founder call 2026-08-13).
 *
 * The rail tab used to land on `/tools`, a hub page whose entire content was
 * three links: you clicked a word to reach a page of words, then clicked one of
 * those. On the phone that page still earns its place (the dock has no room for
 * Tools, so `/more` → `/tools` is the only way in), which is why the route
 * stays. On desktop the rail has the room to show the three destinations
 * themselves, so the click that used to cost a page load now costs a menu.
 *
 * Behaviour is deliberately `AccountMenu`'s — click to open, click-away or Esc
 * to close — so the app has one dropdown vocabulary rather than two.
 */

/** Gap between the rail's bottom edge and the top of the panel. */
const PANEL_GAP_PX = 8;

/** Is `href` the tool the driver is currently inside? */
function isCurrentTool(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ToolsNavMenu({ active }: { active: boolean }) {
  const pathname = usePathname() ?? "";
  const { beginNav } = usePrimaryNav();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<Array<HTMLAnchorElement | null>>([]);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  // A committed navigation must not leave the menu hanging over the new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  /*
   * Where the panel goes, in viewport coordinates.
   *
   * Left-aligned with the tab; top on the RAIL's bottom edge, not the tab's —
   * the tab is 36px inside a 64px row, so hanging the panel off the button
   * would float it inside the bar and clip it on the hairline.
   */
  const place = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const b = button.getBoundingClientRect();
    const railBottom = button.closest(".top-rail")?.getBoundingClientRect().bottom ?? b.bottom;
    const next = { left: b.left, top: railBottom + PANEL_GAP_PX };
    // Same numbers must not mean a new object — the scroll/resize listeners call
    // this constantly, and a fresh object every time re-renders the panel.
    setAnchor((prev) => (prev && prev.left === next.left && prev.top === next.top ? prev : next));
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    // The rail is sticky, so scrolling the page does not move it — but the demo
    // banner above it collapses on scroll, which does.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      // The panel is portaled to <body>, so "inside" is two elements, not one.
      // The button is excluded as well, or its own mousedown would close the
      // menu a frame before its click reopened it.
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  /**
   * Open-with-a-keystroke lands on a row; open-with-the-mouse leaves focus alone.
   *
   * The row to focus is recorded, not focused here: the panel does not exist yet
   * (it renders only once `open` AND `anchor` are set, which is at minimum the
   * next commit), so a `focus()` in this handler — or in a `requestAnimationFrame`
   * scheduled from it — has nothing to aim at and silently leaves focus on the
   * button. The effect below fires once the rows are actually mounted.
   */
  const pendingFocusRef = useRef<number | null>(null);

  const openTo = useCallback(
    (index: number) => {
      pendingFocusRef.current = index;
      place();
      setOpen(true);
    },
    [place]
  );

  useEffect(() => {
    if (!open || !anchor) return;
    const index = pendingFocusRef.current;
    if (index === null) return;
    pendingFocusRef.current = null;
    itemsRef.current[index]?.focus();
  }, [open, anchor]);

  function onButtonKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      openTo(0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openTo(TOOLS_HUB_LINKS.length - 1);
    }
  }

  function onItemKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      const next = (index + step + TOOLS_HUB_LINKS.length) % TOOLS_HUB_LINKS.length;
      itemsRef.current[next]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      itemsRef.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      itemsRef.current[TOOLS_HUB_LINKS.length - 1]?.focus();
    } else if (e.key === "Tab") {
      // Tabbing out of the last row would otherwise leave the panel open behind
      // whatever gets focus next.
      setOpen(false);
    }
  }

  /*
   * Portaled to <body>, and fixed rather than absolute.
   *
   * `.top-rail` is `position: sticky; z-index: 20`, which makes it a stacking
   * context — so a panel rendered inside it is capped at 20 no matter what
   * z-index it carries, and the Sessions filter bar (`z-30`, full width) paints
   * straight over the top of it. Measured, not guessed: `elementsFromPoint` over
   * the first row returned the search input. 55 clears page content and stays
   * under the dialogs at 60+.
   */
  const panel =
    open && anchor
      ? createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label="Tools"
            style={{ left: anchor.left, top: anchor.top }}
            /* Same glass recipe as `AccountMenu`. */
            className="fixed z-[55] w-60 overflow-hidden rounded-2xl border border-elevate/[0.12] bg-card/[0.85] p-1.5 shadow-[0_24px_50px_-18px_rgba(0,0,0,0.8)] backdrop-blur-[34px] backdrop-saturate-[1.4]"
          >
            {TOOLS_HUB_LINKS.map((link, index) => {
              const Icon = HUB_ICON_MAP[link.icon];
              const here = isCurrentTool(pathname, link.href);

              return (
                <Link
                  key={link.href}
                  ref={(node) => {
                    itemsRef.current[index] = node;
                  }}
                  href={link.href}
                  role="menuitem"
                  aria-current={here ? "page" : undefined}
                  onKeyDown={(e) => onItemKeyDown(e, index)}
                  onClick={() => {
                    setOpen(false);
                    haptic("light");
                    // Same wedge self-heal every rail tab arms (PrimaryNavLink),
                    // and it keeps the Tools tab lit while the route commits.
                    beginNav("tools", link.href);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-[13.5px] transition-colors hover:bg-muted",
                    here ? "bg-muted/60 font-semibold text-primary-ink" : "text-foreground"
                  )}
                >
                  <span className={cn(!here && "text-muted-foreground")} aria-hidden>
                    <Icon className="size-[17px]" />
                  </span>
                  {link.label}
                </Link>
              );
            })}
          </div>,
          document.body
        )
      : null;

  /*
   * A bare button, no positioning wrapper — the panel is portaled, so nothing
   * here has to anchor it. That matters for the active tick: `TopRail.measure()`
   * reads `offsetLeft` off `[data-active="true"]`, and a `position: relative`
   * wrapper would become this button's offsetParent and measure it at 0, parking
   * the tick at the far left of the rail. With no wrapper the offsetParent is
   * `.top-rail-nav`, exactly as it is for every other tab.
   */
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-current={active ? "page" : undefined}
        data-active={active ? "true" : "false"}
        onClick={() => {
          haptic("light");
          setOpen((v) => !v);
        }}
        onKeyDown={onButtonKeyDown}
        className="tap-active top-rail-item"
      >
        <IconTools size={18} aria-hidden />
        <span>Tools</span>
        <CaretDown size={11} weight="bold" aria-hidden className="top-rail-caret" />
      </button>
      {panel}
    </>
  );
}
