"use client";

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

export function HubNavLink({ link }: { link: NavHubLink }) {
  const { beginTransition } = useRouteTransition();
  const Icon = HUB_ICON_MAP[link.icon];

  return (
    <li>
      <Link
        href={link.href}
        prefetch
        className="tap-active block"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          beginTransition(link.href);
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
