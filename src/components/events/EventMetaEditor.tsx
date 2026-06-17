"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { eventDateToYmd } from "@/lib/eventDateParse";
import { isEndDateBeforeStartDateYmd } from "@/lib/eventDateValidation";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { TireTypeCombobox } from "@/components/tires/TireTypeCombobox";

type TrackOption = { id: string; name: string; location?: string | null };

type Props = {
  eventId: string;
  initialName: string;
  initialTrackId: string | null;
  initialStartDate: string | Date;
  initialEndDate: string | Date;
  initialNotes: string | null;
  initialControlledTireTypeId: string | null;
  runCount: number;
};

export function EventMetaEditor(props: Props) {
  const router = useRouter();
  const [tracks, setTracks] = useState<TrackOption[]>([]);
  const [name, setName] = useState(props.initialName);
  const [trackId, setTrackId] = useState(props.initialTrackId ?? "");
  const [startDate, setStartDate] = useState(eventDateToYmd(props.initialStartDate));
  const [endDate, setEndDate] = useState(eventDateToYmd(props.initialEndDate));
  const [notes, setNotes] = useState(props.initialNotes ?? "");
  const [controlledTireTypeId, setControlledTireTypeId] = useState(props.initialControlledTireTypeId ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/tracks", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { tracks?: TrackOption[] }) => {
        if (!alive || !Array.isArray(d.tracks)) return;
        setTracks(d.tracks);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const dateRangeInvalid = useMemo(
    () => isEndDateBeforeStartDateYmd(startDate, endDate),
    [startDate, endDate]
  );

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage("Name is required.");
      return;
    }
    if (!trackId.trim()) {
      setMessage("Select a track for this event.");
      return;
    }
    if (dateRangeInvalid) return;

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(props.eventId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          trackId,
          startDate,
          endDate,
          notes: notes.trim() || null,
          controlledTireTypeId: controlledTireTypeId.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        event?: { name?: string };
        merged?: boolean;
        eventId?: string;
      };
      if (!res.ok) {
        setMessage(data.error ?? "Could not save.");
        return;
      }
      if (data.merged && data.eventId && data.eventId !== props.eventId) {
        router.replace(`/events/${encodeURIComponent(data.eventId)}`);
        return;
      }
      if (data.event?.name) setName(data.event.name);
      setMessage("Saved.");
      router.refresh();
    } catch {
      setMessage("Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm space-y-3">
      <div>
        <div className="text-sm font-medium text-foreground">Event details</div>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {props.runCount} run{props.runCount === 1 ? "" : "s"} linked to this event.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1">Name *</label>
          <input
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
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
        <p className="text-[11px] text-destructive">End date must be on or after the start date.</p>
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
      <div>
        <label className="block text-[11px] text-muted-foreground mb-1">Controlled / spec tire (optional)</label>
        <TireTypeCombobox
          value={controlledTireTypeId}
          onChange={setControlledTireTypeId}
          placeholder="Search spec tire type"
          aria-label="Event spec tire type"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving || !trackId.trim() || dateRangeInvalid}
          onClick={() => void save()}
          className={cn(
            buttonLinkClassName("primary"),
            "text-xs px-3 py-1.5",
            (saving || !trackId.trim() || dateRangeInvalid) && "opacity-70 pointer-events-none"
          )}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {message ? (
          <span className={cn("text-xs", message === "Saved." ? "text-accent" : "text-muted-foreground")}>
            {message}
          </span>
        ) : null}
      </div>
    </div>
  );
}
