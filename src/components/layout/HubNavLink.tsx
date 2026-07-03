"use client";

import { useRef } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Battery,
  Calendar,
  Car,
  ChevronRight,
  CircleDot,
  Disc,
  FlaskConical,
  GitCompare,
  History,
  Layers,
  MapPin,
  Video,
  Wrench,
} from "lucide-react";
import type { NavHubIconKey, NavHubLink } from "@/components/layout/navConfig";
import { useRouteTransition } from "@/components/layout/RouteTransitionProvider";
import { HubRowTitle } from "@/components/ui/panel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

const HUB_ICON_MAP: Record<NavHubIconKey, LucideIcon> = {
  car: Car,
  disc: Disc,
  battery: Battery,
  layers: Layers,
  "map-pin": MapPin,
  "circle-dot": CircleDot,
  flask: FlaskConical,
  calendar: Calendar,
  history: History,
  video: Video,
  "git-compare": GitCompare,
  wrench: Wrench,
};

/** Past this many px of movement, the gesture is a scroll, not a tap. */
const SCROLL_CANCEL_THRESHOLD_PX = 10;

export function HubNavLink({ link }: { link: NavHubLink }) {
  const { beginTransition, cancelTransition } = useRouteTransition();
  const Icon = HUB_ICON_MAP[link.icon];
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  return (
    <li>
      <Link
        href={link.href}
        prefetch
        className="tap-active block"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          pointerStartRef.current = { x: event.clientX, y: event.clientY };
          beginTransition(link.href);
        }}
        onPointerMove={(event) => {
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
        }}
        onPointerCancel={() => {
          pointerStartRef.current = null;
          cancelTransition();
        }}
        onClick={() => {
          pointerStartRef.current = null;
        }}
      >
        <SurfaceCard variant="panel" contentClassName="flex items-center gap-3 px-4 py-3">
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-border bg-background/50 text-muted-foreground transition-colors group-hover:text-foreground">
            <Icon className="size-[15px]" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <HubRowTitle as="span" className="block">
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
