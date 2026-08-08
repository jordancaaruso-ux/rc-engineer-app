"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Eyebrow, HubRowTitle } from "@/components/ui/panel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { CollapsibleAddRow } from "@/components/assets/CollapsibleAddRow";
import { formatEventDate } from "@/lib/formatDate";
import { formatLap } from "@/lib/runLaps";
import { splitEventsForPicker } from "@/lib/events/splitEventsForPicker";
import { EventAddForm, type TrackOption } from "@/components/events/EventAddForm";

export type EventListItem = {
  id: string;
  name: string;
  startDate: string | Date;
  endDate: string | Date;
  notes: string | null;
  practiceSourceUrl?: string | null;
  resultsSourceUrl?: string | null;
  hasLiveRcLink?: boolean;
  controlledTireTypeId?: string | null;
  controlledTireType?: { id: string; displayName: string; modelCode: string } | null;
  controlledAdditiveTypeId?: string | null;
  controlledAdditiveType?: { id: string; displayName: string; modelCode: string } | null;
  track: { id: string; name: string; location?: string | null } | null;
  trackLabel?: string | null;
  isLegacyTrack?: boolean;
};

/**
 * Per-event evidence, keyed by event id — what a row shows instead of the removed status
 * badge. Absent for an event created moments ago, which is correct: it has no runs yet.
 */
export type EventListStats = Record<
  string,
  { runCount: number; bestLapSeconds: number | null; vsVenueSeconds: number | null }
>;

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { ...init, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

function splitEvents(events: EventListItem[]) {
  return splitEventsForPicker(events);
}

/**
 * The evidence line that replaced the `Planned` / `LiveRC linked` badge (2026-08-08).
 *
 * The badge described whether a LiveRC URL had been pasted, but sat where event status
 * belongs — so a club day raced in April still read `Planned`. What actually tells twelve
 * identical "Clubday · Boronia" rows apart is how they went: runs, best lap, and whether
 * it beat the venue. Same change as the desktop table, because the badge was wrong on
 * both.
 */
function EventEvidence({
  stats,
}: {
  stats: EventListStats[string] | undefined;
}) {
  if (!stats || stats.runCount === 0) return null;
  const { runCount, bestLapSeconds, vsVenueSeconds } = stats;
  const faster = vsVenueSeconds != null && vsVenueSeconds < 0;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
      <span>
        {runCount} {runCount === 1 ? "run" : "runs"}
      </span>
      {bestLapSeconds != null ? (
        <span className="text-foreground">{formatLap(bestLapSeconds)}</span>
      ) : null}
      {vsVenueSeconds != null && Math.abs(vsVenueSeconds) >= 0.0005 ? (
        <span className={cn("font-bold", faster ? "text-[#4FD089]" : "text-destructive")}>
          {faster ? "▼" : "▲"} {Math.abs(vsVenueSeconds).toFixed(3)}
        </span>
      ) : null}
    </span>
  );
}

/** A subheader row + the section's event rows, flush inside the single card's `<ul>`. */
function EventSectionRows({
  title,
  subtitle,
  events,
  emptyMessage,
  stats,
}: {
  title: string;
  subtitle?: string;
  events: EventListItem[];
  emptyMessage: string;
  stats: EventListStats;
}) {
  return (
    <>
      <li className="bg-muted/20 px-4 pb-1.5 pt-3">
        <Eyebrow>{title}</Eyebrow>
        {subtitle ? <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p> : null}
      </li>
      {events.length === 0 ? (
        <li className="px-4 py-3 text-sm text-muted-foreground">{emptyMessage}</li>
      ) : (
        events.map((ev) => (
          <li key={ev.id}>
            <Link
              href={`/events/${ev.id}`}
              prefetch
              className="tap-active block px-4 py-3 transition hover:bg-muted/50"
            >
              <div className="flex items-center gap-2">
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <HubRowTitle as="span">{ev.name}</HubRowTitle>
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              </div>
              <div className="text-sm text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0">
                {(ev.track || ev.trackLabel) && (
                  <span>
                    {ev.track?.name ?? ev.trackLabel}
                    {ev.track?.location ? ` (${ev.track.location})` : ""}
                    {ev.isLegacyTrack ? (
                      <span className="text-amber-700 dark:text-amber-400"> · legacy track</span>
                    ) : null}
                  </span>
                )}
                <span>
                  {formatEventDate(ev.startDate)}
                  {new Date(ev.endDate).getTime() !== new Date(ev.startDate).getTime() &&
                    ` – ${formatEventDate(ev.endDate)}`}
                </span>
              </div>
              <EventEvidence stats={stats[ev.id]} />
              {ev.notes && (
                <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{ev.notes}</p>
              )}
            </Link>
          </li>
        ))
      )}
    </>
  );
}

export function EventList({
  initialEvents,
  tracks,
  stats = {},
}: {
  initialEvents: EventListItem[];
  tracks: TrackOption[];
  stats?: EventListStats;
}) {
  const pathname = usePathname();
  const [events, setEvents] = useState<EventListItem[]>(initialEvents);
  const [trackOptions, setTrackOptions] = useState<TrackOption[]>(tracks);
  const [addOpen, setAddOpen] = useState(false);

  const { upcoming, past } = useMemo(() => splitEvents(events), [events]);

  /** Same dataset as Log your run: user-scoped GET /api/tracks, refetched whenever user lands on Events (and on tab focus). */
  useEffect(() => {
    if (pathname !== "/events") return;
    let alive = true;
    jsonFetch<{ tracks: TrackOption[] }>("/api/tracks")
      .then(({ tracks: list }) => {
        if (!alive || !Array.isArray(list)) return;
        setTrackOptions(list);
      })
      .catch(() => {
        if (!alive) return;
      });
    return () => {
      alive = false;
    };
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/events") return;
    function onVisibility() {
      if (document.visibilityState !== "visible") return;
      void jsonFetch<{ tracks: TrackOption[] }>("/api/tracks").then(({ tracks: list }) => {
        if (Array.isArray(list)) setTrackOptions(list);
      });
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [pathname]);

  return (
    <SurfaceCard variant="panel" contentClassName="p-0" overflowHidden={false}>
      <ul className="divide-y divide-border">
        <CollapsibleAddRow label="New event" open={addOpen} onOpenChange={setAddOpen}>
          <EventAddForm
            tracks={trackOptions}
            onCreated={(event) => {
              const created = event as EventListItem;
              setEvents((prev) => [created, ...prev.filter((e) => e.id !== created.id)]);
              setAddOpen(false);
            }}
          />
        </CollapsibleAddRow>

        <EventSectionRows
          title="Upcoming events"
          subtitle="End date is today or later."
          events={upcoming}
          emptyMessage="No upcoming events. Create one above or log a race meeting from Log your run."
          stats={stats}
        />

        <EventSectionRows
          title="Past events"
          subtitle="End date before today."
          events={past}
          emptyMessage="No past events yet."
          stats={stats}
        />
      </ul>
    </SurfaceCard>
  );
}
