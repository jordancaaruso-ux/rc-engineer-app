"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EventsSeasonModel } from "@/lib/events/seasonTypes";
import { Collapse } from "@/components/ui/Collapse";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { EventAddForm, type TrackOption } from "@/components/events/EventAddForm";
import {
  EventList,
  type EventListItem,
  type EventListStats,
} from "@/components/events/EventList";
import { SeasonTimeline } from "@/components/events/desktop/SeasonTimeline";
import { NextUpCard, NothingBookedCard } from "@/components/events/desktop/NextUpCard";
import { VenueRecordsCard } from "@/components/events/desktop/VenueRecordsCard";
import { RecentFormCard } from "@/components/events/desktop/RecentFormCard";

/**
 * The Events page — header and body for both breakpoints (design handoff "Events —
 * desktop redesign / Season", 2026-08-08).
 *
 * A twin render, the same call `DashboardDesktop` and `SessionsWorkbench` made: at xl+ the
 * season timeline composition takes over, below it the phone list renders unchanged. The
 * two are genuinely different compositions of one model rather than a re-flow — a
 * twelve-month, three-lane timeline has no phone equivalent at 390px, and squeezing one in
 * would be worse than the list.
 *
 * It owns the header too, rather than leaving that to `page.tsx`, for one reason: the
 * "New event" button and the nothing-booked card's "Book Saturday 15 Aug" button open the
 * same form, and one piece of state cannot span a server component boundary. The
 * alternative was two `<h1>Events</h1>`s in the DOM with one hidden per breakpoint.
 */
export function EventsView({
  model,
  tracks,
  initialEvents,
  stats,
}: {
  model: EventsSeasonModel;
  tracks: TrackOption[];
  initialEvents: EventListItem[];
  stats: EventListStats;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [suggestedYmd, setSuggestedYmd] = useState<string | null>(null);
  const { scope, years, strip, venues, events, logged, nextUp, cadence, todayYmd } = model;

  function openAdd(ymd: string | null) {
    setSuggestedYmd(ymd);
    setAddOpen(true);
    // The form lives below the fold of the control row on a short window.
    requestAnimationFrame(() => {
      document.getElementById("events-new")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  const metaLine = [
    scope.year == null ? "All time" : `Season ${scope.year}`,
    `${strip.events.value ?? 0} ${strip.events.value === 1 ? "event" : "events"}`,
    `${strip.venues.value ?? 0} ${strip.venues.value === 1 ? "venue" : "venues"}`,
    `${strip.daysOnTrack.value ?? 0} days on track`,
  ].join(" · ");

  return (
    <>
      <header className="page-header events-header">
        <div className="min-w-0">
          <h1 className="page-title">Events</h1>
        </div>
        <span className="hidden shrink-0 font-mono text-[11px] uppercase tracking-[.12em] text-muted-foreground xl:inline">
          {metaLine}
        </span>
        <div className="ml-auto hidden shrink-0 items-center gap-3.5 xl:flex">
          <YearToggle years={years} year={scope.year} />
          <button
            type="button"
            onClick={() => (addOpen ? setAddOpen(false) : openAdd(null))}
            aria-expanded={addOpen}
            aria-controls="events-new"
            className="tap-active inline-flex min-h-[38px] items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-bold tracking-[-.01em] text-primary-foreground shadow-glow-sm transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {addOpen ? (
              <X className="size-4" strokeWidth={2.6} aria-hidden />
            ) : (
              <Plus className="size-4" strokeWidth={2.6} aria-hidden />
            )}
            {addOpen ? "Close" : "New event"}
          </button>
        </div>
      </header>

      <section className="page-body events-wide max-w-2xl">
        {/* ── Desktop (xl+) ─────────────────────────────────────────────────── */}
        <div className="hidden min-w-0 flex-col gap-5 xl:flex">
          <div id="events-new" className="scroll-mt-4">
            <Collapse open={addOpen}>
              <SurfaceCard contentClassName="p-6">
                {/* The form is nine short fields; at the page's 1760px cap they would each
                    stretch to a metre of empty input. Hold it to a form's measure and let
                    the card carry the width. */}
                <div className="max-w-3xl">
                  <EventAddForm
                    tracks={tracks}
                    suggestedStartYmd={suggestedYmd}
                    onCreated={() => setAddOpen(false)}
                  />
                </div>
              </SurfaceCard>
            </Collapse>
          </div>

          {/* A brand-new account has nothing to lane, rank or tabulate. Four empty cards
              would be a worse first screen than one honest one, so the whole composition
              waits until there is something to draw.

              Keyed on the account having no events in ANY year — not on this scope being
              empty. `/events?year=1999` on a real account is an empty scope, not a new
              driver, and telling someone with 16 meetings that their season hasn't started
              would be worse than an empty timeline. */}
          {years.length === 0 && venues.length === 0 ? (
            <FirstRunCard onNewEvent={() => openAdd(null)} />
          ) : (
            <>
          <SeasonTimeline
            year={scope.year}
            years={years}
            events={events}
            venues={venues}
            strip={strip}
            todayYmd={todayYmd}
          />

          <div className="grid grid-cols-[380px_minmax(0,1fr)] items-start gap-5 2xl:grid-cols-[420px_420px_minmax(0,1fr)]">
            {nextUp ? (
              <NextUpCard nextUp={nextUp} />
            ) : cadence ? (
              <NothingBookedCard cadence={cadence} onNewEvent={openAdd} />
            ) : null}

            <VenueRecordsCard venues={venues} year={scope.year} hasOtherYears={years.length > 1} />

            {/* Below 1536 the third column wraps under the other two rather than
                squeezing a five-column table into 300px. */}
            <div className="col-span-2 min-w-0 2xl:col-span-1">
              <RecentFormCard events={logged} totalCount={logged.length} />
            </div>
          </div>

          {strip.truncated ? (
            <p className="text-[11.5px] text-faint">
              Volume figures cover your most recent 4,000 completed runs.
            </p>
          ) : null}
            </>
          )}
        </div>

        {/* ── Phone / tablet ────────────────────────────────────────────────── */}
        <div className="xl:hidden">
          <EventList initialEvents={initialEvents} tracks={tracks} stats={stats} />
        </div>
      </section>
    </>
  );
}

/** Nothing logged and nothing booked — the only honest thing to draw is the way in. */
function FirstRunCard({ onNewEvent }: { onNewEvent: () => void }) {
  return (
    <SurfaceCard variant="hero" contentClassName="p-0" className="rounded-2xl">
      <div className="flex items-center gap-3 border-b border-border px-6 py-3.5">
        <span className="h-3.5 w-[3px] shrink-0 skew-x-[-21deg] rounded-sm bg-primary" aria-hidden />
        <span className="font-mono text-[10px] font-bold uppercase tracking-[.2em] text-foreground">
          No events yet
        </span>
      </div>
      <div className="px-6 pb-8 pt-6">
        <p className="text-pretty text-[20px] font-bold leading-[1.2] tracking-[-.02em] text-foreground">
          Your season starts with the first meeting you put in.
        </p>
        <p className="mt-2 max-w-[52ch] text-[12.5px] leading-relaxed text-muted-foreground">
          Add a race day and this page becomes your year on one screen — every venue on its
          own lane, your best lap at each of them, and how each meeting compared with the
          last time you were there.
        </p>
        <button
          type="button"
          onClick={onNewEvent}
          className="tap-active mt-5 inline-flex min-h-[38px] items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-bold tracking-[-.01em] text-primary-foreground shadow-glow-sm transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Plus className="size-4" strokeWidth={2.6} aria-hidden />
          New event
        </button>
      </div>
    </SurfaceCard>
  );
}

/**
 * Year scope as links, not a client toggle — the page is a server component and stays one,
 * so a season is server-rendered and linkable (`/events?year=2026`).
 *
 * Only years that actually hold events are offered, and with a single season there is
 * nothing to toggle between — the control hides rather than sitting there as one dead
 * pill. The handoff drew a fixed `2026 · 2025 · All time`; the founder's account has one
 * season in it, so two of those three would always resolve to "nothing here".
 */
function YearToggle({ years, year }: { years: number[]; year: number | null }) {
  if (years.length < 2) return null;
  const options: Array<{ label: string; value: string; active: boolean }> = years.map((y) => ({
    label: String(y),
    value: String(y),
    active: year === y,
  }));
  options.push({ label: "All time", value: "all", active: year == null });

  return (
    <div
      role="group"
      aria-label="Season"
      className="flex items-center gap-0.5 rounded-full border border-border bg-background/45 p-0.5"
    >
      {options.map((option) => (
        <Link
          key={option.value}
          href={`/events?year=${option.value}`}
          prefetch={false}
          aria-current={option.active ? "true" : undefined}
          className={cn(
            "tap-active rounded-full px-3.5 py-[5px] text-[11px] font-semibold tracking-[-.01em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            option.active
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}
