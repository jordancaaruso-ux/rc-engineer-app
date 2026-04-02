"use client";

import { useMemo, useState } from "react";
import { isEndDateBeforeStartDateYmd } from "@/lib/eventDateValidation";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatEventDate } from "@/lib/formatDate";

type TrackOption = { id: string; name: string; location?: string | null };

type EventItem = {
  id: string;
  name: string;
  startDate: string | Date;
  endDate: string | Date;
  notes: string | null;
  track: { id: string; name: string; location?: string | null } | null;
};

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

function splitEvents(events: EventItem[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming: EventItem[] = [];
  const past: EventItem[] = [];
  for (const ev of events) {
    const endDay = new Date(ev.endDate);
    endDay.setHours(0, 0, 0, 0);
    if (endDay.getTime() >= today.getTime()) upcoming.push(ev);
    else past.push(ev);
  }
  upcoming.sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );
  past.sort(
    (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
  );
  return { upcoming, past };
}

function EventSection({
  title,
  subtitle,
  events,
  emptyMessage,
}: {
  title: string;
  subtitle?: string;
  events: EventItem[];
  emptyMessage: string;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="ui-title text-sm tracking-tight text-foreground">{title}</h2>
        {subtitle ? <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p> : null}
      </div>
      {events.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/60 p-4 text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      ) : (
        <ul className="rounded-lg border border-border divide-y divide-border">
          {events.map((ev) => (
            <li key={ev.id} className="px-4 py-3">
              <Link href={`/events/${ev.id}`} className="font-medium hover:underline block">
                {ev.name}
              </Link>
              <div className="text-sm text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0">
                {ev.track && (
                  <span>
                    {ev.track.name}
                    {ev.track.location ? ` (${ev.track.location})` : ""}
                  </span>
                )}
                <span>
                  {formatEventDate(ev.startDate)}
                  {new Date(ev.endDate).getTime() !== new Date(ev.startDate).getTime() &&
                    ` – ${formatEventDate(ev.endDate)}`}
                </span>
              </div>
              {ev.notes && (
                <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{ev.notes}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function EventList({
  initialEvents,
  tracks,
}: {
  initialEvents: EventItem[];
  tracks: TrackOption[];
}) {
  const router = useRouter();
  const [events, setEvents] = useState<EventItem[]>(initialEvents);
  const [name, setName] = useState("");
  const [trackId, setTrackId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const { upcoming, past } = useMemo(() => splitEvents(events), [events]);

  const dateRangeInvalid = useMemo(
    () => isEndDateBeforeStartDateYmd(startDate, endDate),
    [startDate, endDate]
  );

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage("Name is required.");
      return;
    }
    if (!trackId.trim()) {
      setMessage("Select a track for this event.");
      return;
    }
    if (dateRangeInvalid) {
      setMessage(null);
      return;
    }
    setMessage(null);
    setAdding(true);
    try {
      const start = startDate || new Date().toISOString().slice(0, 10);
      const end = endDate || start;
      const { event } = await jsonFetch<{ event: EventItem }>("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          trackId,
          startDate: start,
          endDate: end,
          notes: notes.trim() || null,
        }),
      });
      setEvents((prev) => [event, ...prev]);
      setName("");
      setTrackId("");
      setStartDate("");
      setEndDate("");
      setNotes("");
      setMessage("Event created.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to create event");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-8">
      <form onSubmit={handleAdd} className="rounded-lg border border-border bg-muted/70 p-4 space-y-3">
        <div className="ui-title text-sm text-muted-foreground">New event</div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Name *</label>
            <input
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. BRCA Nationals R3"
              required
            />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Track *</label>
            <select
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
              value={trackId}
              onChange={(e) => setTrackId(e.target.value)}
              aria-label="Track"
              required
            >
              <option value="">— Select track —</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.location ? ` (${t.location})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Start date</label>
            <input
              type="date"
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              aria-label="Start date"
            />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">End date</label>
            <input
              type="date"
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              aria-label="End date"
            />
          </div>
        </div>
        {dateRangeInvalid ? (
          <p className="text-[11px] text-destructive">
            End date must be on or after the start date.
          </p>
        ) : null}
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1">Notes (optional)</label>
          <input
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={adding || !trackId.trim() || dateRangeInvalid}
            className={cn(
              "rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-glow-sm hover:brightness-105 transition",
              (adding || !trackId.trim() || dateRangeInvalid) && "opacity-70 pointer-events-none"
            )}
          >
            {adding ? "Creating…" : "Create event"}
          </button>
          {message && (
            <span className={cn("text-xs", message === "Event created." ? "text-accent" : "text-muted-foreground")}>
              {message}
            </span>
          )}
        </div>
      </form>

      <EventSection
        title="Upcoming events"
        subtitle="End date is today or later."
        events={upcoming}
        emptyMessage="No upcoming events. Create one above or log a race meeting from Log your run."
      />

      <EventSection
        title="Past events"
        subtitle="End date before today."
        events={past}
        emptyMessage="No past events yet."
      />
    </div>
  );
}
