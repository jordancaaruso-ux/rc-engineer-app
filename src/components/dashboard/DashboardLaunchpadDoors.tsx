"use client";

import { useRef } from "react";
import Link from "next/link";
import { BarChart3, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRouteTransition } from "@/components/layout/RouteTransitionProvider";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

/** Past this many px of movement, the gesture is a scroll, not a tap. */
const SCROLL_CANCEL_THRESHOLD_PX = 10;

type LaunchpadDoor = { href: string; label: string; icon: LucideIcon };

/**
 * The dashboard is a launchpad, not a report: detail lives in the deep tabs.
 * These two doors route there — Analysis owns the debrief (trends, per-run,
 * setup changes, pace vs field); the Engineer tab owns the conversation.
 */
const DOORS: LaunchpadDoor[] = [
  // Straight into the most recent session, pre-expanded (`expandLatest=1` opens
  // the latest group in Sessions) — not the Analysis landing page.
  { href: "/runs/history?expandLatest=1", label: "See the debrief", icon: BarChart3 },
  { href: "/engineer", label: "Ask the Engineer", icon: Sparkles },
];

export function DashboardLaunchpadDoors() {
  return (
    <div className="grid grid-cols-2 gap-2">
      {DOORS.map((door) => (
        <LaunchpadDoorTile key={door.href} door={door} />
      ))}
    </div>
  );
}

function LaunchpadDoorTile({ door }: { door: LaunchpadDoor }) {
  const { beginTransition, cancelTransition } = useRouteTransition();
  const Icon = door.icon;
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  return (
    <Link
      href={door.href}
      prefetch
      className="tap-active block"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        pointerStartRef.current = { x: event.clientX, y: event.clientY };
        beginTransition(door.href);
      }}
      onPointerMove={(event) => {
        // A scroll drag starts as a pointerdown on the tile; once it moves past
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
      <SurfaceCard
        variant="panel"
        // Element-level `hover:` (not `group-hover`) so the glow is bound to the
        // physically hovered card and can never spill onto its sibling door.
        className="transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_0_0_1px_rgba(255,214,10,0.22),0_18px_44px_-16px_rgba(255,214,10,0.22)]"
        contentClassName="flex items-center gap-2.5 px-3.5 py-3"
      >
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-border bg-background/50 text-muted-foreground transition-colors group-hover:text-foreground">
          <Icon className="size-[15px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-[13px] font-semibold tracking-tight text-foreground">
          {door.label}
        </span>
      </SurfaceCard>
    </Link>
  );
}
