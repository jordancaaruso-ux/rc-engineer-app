"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { NavHubLink } from "@/components/layout/navConfig";
import { HUB_ICON_MAP } from "@/components/layout/hubIcons";
import { useRouteTransition } from "@/components/layout/RouteTransitionProvider";
import { HubRowTitle } from "@/components/ui/panel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

/** Past this many px of movement, the gesture is a scroll, not a tap. */
const SCROLL_CANCEL_THRESHOLD_PX = 10;

/**
 * `card` — the standalone glass tile used by the generic hubs (Analysis, etc.).
 * `row` — a flush row for a single-card hub (Assets), divided by hairlines and
 * carrying an optional live `count` in the right column (mono, like the sessions
 * one-card).
 * `door` — a header-only glass card: the tool's name IS the section header
 * (accent stripe + hairline, same signpost as the cards it sits under), with a
 * chevron on that row and nothing below it. Founder-picked 2026-07-18 so the
 * Analysis tool doors stop reading as a different system from the data cards
 * above them. No icon and no description by design.
 * Same tap / route-transition behavior in every variant.
 */
export function HubNavLink({
  link,
  variant = "card",
  count,
}: {
  link: NavHubLink;
  variant?: "card" | "row" | "door";
  count?: number;
}) {
  const { beginTransition, cancelTransition } = useRouteTransition();
  const Icon = HUB_ICON_MAP[link.icon];
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  const linkHandlers = {
    onPointerDown: (event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      pointerStartRef.current = { x: event.clientX, y: event.clientY };
      beginTransition(link.href);
    },
    onPointerMove: (event: ReactPointerEvent) => {
      // A scroll drag starts as a pointerdown on the card; once it moves past
      // the threshold, dismiss the overlay so it can't strand over the page.
      const start = pointerStartRef.current;
      if (!start) return;
      if (
        Math.abs(event.clientX - start.x) > SCROLL_CANCEL_THRESHOLD_PX ||
        Math.abs(event.clientY - start.y) > SCROLL_CANCEL_THRESHOLD_PX
      ) {
        pointerStartRef.current = null;
        cancelTransition();
      }
    },
    onPointerCancel: () => {
      pointerStartRef.current = null;
      cancelTransition();
    },
    onClick: () => {
      pointerStartRef.current = null;
    },
  };

  if (variant === "door") {
    return (
      <li>
        <Link href={link.href} prefetch className="tap-active block" {...linkHandlers}>
          <SurfaceCard variant="panel">
            {/* `eyebrow-root` (hairline + pad) composed by hand rather than via
                <Eyebrow> so the chevron can sit beside the label, not inside it. */}
            <div className="eyebrow-root group flex items-center gap-2">
              <span className="eyebrow-label min-w-0 flex-1">{link.label}</span>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                aria-hidden
              />
            </div>
          </SurfaceCard>
        </Link>
      </li>
    );
  }

  if (variant === "row") {
    return (
      <li>
        <Link href={link.href} prefetch className="tap-active block" {...linkHandlers}>
          <div className="group flex min-w-0 items-center gap-3 px-3 py-3 transition hover:bg-muted/50 sm:px-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-secondary text-muted-foreground transition-colors group-hover:text-foreground">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <HubRowTitle as="span" className="block text-[17px] sm:text-[18px]">
                {link.label}
              </HubRowTitle>
            </span>
            {typeof count === "number" ? (
              <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">
                {count}
              </span>
            ) : null}
            <ChevronRight
              className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
              aria-hidden
            />
          </div>
        </Link>
      </li>
    );
  }

  return (
    <li>
      <Link href={link.href} prefetch className="tap-active block" {...linkHandlers}>
        <SurfaceCard variant="panel" contentClassName="flex items-center gap-3 px-4 py-3">
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-border bg-background/50 text-muted-foreground transition-colors group-hover:text-foreground">
            <Icon className="size-[15px]" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <HubRowTitle as="span" className="block text-[17px] sm:text-[18px]">
              {link.label}
            </HubRowTitle>
          </span>
          <ChevronRight
            className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
            aria-hidden
          />
        </SurfaceCard>
      </Link>
    </li>
  );
}
