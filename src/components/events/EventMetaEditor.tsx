"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { eventDateToYmd } from "@/lib/eventDateParse";
import { isEndDateBeforeStartDateYmd } from "@/lib/eventDateValidation";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { TireTypeCombobox } from "@/components/tires/TireTypeCombobox";
import { AdditiveTypeCombobox } from "@/components/additives/AdditiveTypeCombobox";

type TrackOption = { id: string; name: string; location?: string | null };

type Props = {
  eventId: string;
  initialName: string;
  initialTrackId: string | null;
  initialLegacyTrackLabel?: string | null;
  initialIsLegacyTrack?: boolean;
  initialStartDate: string | Date;
  initialEndDate: string | Date;
  initialNotes: string | null;
  initialControlledTireTypeId: string | null;
  initialControlledAdditiveTypeId: string | null;
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
  const [controlAdditiveEnabled, setControlAdditiveEnabled] = useState(
    Boolean(props.initialControlledAdditiveTypeId)
  );
  const [controlledAdditiveTypeId, setControlledAdditiveTypeId] = useState(
    props.initialControlledAdditiveTypeId ?? ""
  );
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
  const hasLegacyTrack = Boolean(props.initialIsLegacyTrack && props.initialLegacyTrackLabel?.trim());
  const canSaveWithoutTrackLink = hasLegacyTrack && !trackId.trim();

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage("Name is required.");
      return;
    }
    if (!trackId.trim() && !hasLegacyTrack) {
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
          ...(trackId.trim() ? { trackId } : {}),
          startDate,
          endDate,
          notes: notes.trim() || null,
          controlledTireTypeId: controlledTireTypeId.trim() || null,
          controlledAdditiveTypeId: controlAdditiveEnabled ? controlledAdditiveTypeId.trim() || null : null,
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
    <SurfaceCard variant="panel" overflowHidden={false} contentClassName="text-sm space-y-3">
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
          <label className="block text-[11px] text-muted-foreground mb-1">
            Track{hasLegacyTrack && !trackId.trim() ? " (legacy)" : " *"}
          </label>
          {hasLegacyTrack && !trackId.trim() ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              {props.initialLegacyTrackLabel} — catalog track removed. Select a new track below to re-link, or leave
              unchanged to keep this legacy venue.
            </p>
          ) : null}
          <select
            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
            value={trackId}
            onChange={(e) => setTrackId(e.target.value)}
            aria-label="Track"
          >
            <option value="">{hasLegacyTrack ? "— Keep legacy track —" : "— Select track —"}</option>
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
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={controlAdditiveEnabled}
            onChange={(e) => {
              setControlAdditiveEnabled(e.target.checked);
              if (!e.target.checked) setControlledAdditiveTypeId("");
            }}
            className="h-3.5 w-3.5 shrink-0 accent-primary"
          />
          <span>Control additive</span>
        </label>
        {controlAdditiveEnabled ? (
          <AdditiveTypeCombobox
            value={controlledAdditiveTypeId}
            onChange={setControlledAdditiveTypeId}
            placeholder="Search spec additive"
            aria-label="Event spec additive type"
            allowInlineCreate={false}
          />
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving || (!trackId.trim() && !canSaveWithoutTrackLink) || dateRangeInvalid}
          onClick={() => void save()}
          className={cn(
            buttonLinkClassName("primary"),
            "text-xs px-3 py-1.5",
            (saving || (!trackId.trim() && !canSaveWithoutTrackLink) || dateRangeInvalid) &&
              "opacity-70 pointer-events-none"
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
    </SurfaceCard>
  );
}
