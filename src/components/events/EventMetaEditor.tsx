"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { eventDateToYmd } from "@/lib/eventDateParse";
import { isEndDateBeforeStartDateYmd } from "@/lib/eventDateValidation";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { TrackCombobox } from "@/components/runs/TrackCombobox";
import { TireTypeCombobox } from "@/components/tires/TireTypeCombobox";
import { AdditiveTypeCombobox } from "@/components/additives/AdditiveTypeCombobox";

type TrackOption = {
  id: string;
  name: string;
  location?: string | null;
  gripTags?: string[];
  layoutTags?: string[];
};

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
  initialPracticeSourceUrl: string | null;
  initialResultsSourceUrl: string | null;
  initialMyRcmUrl: string | null;
  initialRaceClass: string | null;
  runCount: number;
};

export function EventMetaEditor(props: Props) {
  const router = useRouter();
  const [tracks, setTracks] = useState<TrackOption[]>([]);
  const [favouriteTrackIds, setFavouriteTrackIds] = useState<string[]>([]);
  const [name, setName] = useState(props.initialName);
  const [trackId, setTrackId] = useState(props.initialTrackId ?? "");
  const [startDate, setStartDate] = useState(eventDateToYmd(props.initialStartDate));
  const [endDate, setEndDate] = useState(eventDateToYmd(props.initialEndDate));
  const [notes, setNotes] = useState(props.initialNotes ?? "");
  const [tireControlled, setTireControlled] = useState(
    Boolean(props.initialControlledTireTypeId)
  );
  const [controlledTireTypeId, setControlledTireTypeId] = useState(props.initialControlledTireTypeId ?? "");
  const [controlAdditiveEnabled, setControlAdditiveEnabled] = useState(
    Boolean(props.initialControlledAdditiveTypeId)
  );
  const [controlledAdditiveTypeId, setControlledAdditiveTypeId] = useState(
    props.initialControlledAdditiveTypeId ?? ""
  );
  const [practiceSourceUrl, setPracticeSourceUrl] = useState(props.initialPracticeSourceUrl ?? "");
  const [resultsSourceUrl, setResultsSourceUrl] = useState(props.initialResultsSourceUrl ?? "");
  const [myRcmUrl, setMyRcmUrl] = useState(props.initialMyRcmUrl ?? "");
  const [raceClass, setRaceClass] = useState(props.initialRaceClass ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // `favouritesFirst=1` is what makes the route return `favouriteIds` at all — without the
  // flag it answers with an empty array rather than omitting the field, which reads like a
  // driver with no favourites instead of a question that was never asked.
  useEffect(() => {
    let alive = true;
    fetch("/api/tracks?favouritesFirst=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { tracks?: TrackOption[]; favouriteIds?: string[] }) => {
        if (!alive || !Array.isArray(d.tracks)) return;
        setTracks(d.tracks);
        if (Array.isArray(d.favouriteIds)) setFavouriteTrackIds(d.favouriteIds);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /**
   * The catalog arrives from a client fetch, so for the first frame the picker has nothing to
   * look this event's track up in and falls back to its placeholder — a form that reads "Select
   * track…" over an event that has one. `initialLegacyTrackLabel` is the resolved
   * "Name (Location)" for every event, legacy or not (the prop name predates that), so the
   * current row can be seeded from it and merged rather than replaced: a track that has since
   * left this driver's catalog scope then still names itself instead of blanking on arrival.
   */
  const trackChoices = useMemo(() => {
    const seedId = props.initialTrackId?.trim();
    if (!seedId || tracks.some((t) => t.id === seedId)) return tracks;
    return [{ id: seedId, name: props.initialLegacyTrackLabel ?? "Current track" }, ...tracks];
  }, [tracks, props.initialTrackId, props.initialLegacyTrackLabel]);

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
          controlledTireTypeId: tireControlled ? controlledTireTypeId.trim() || null : null,
          controlledAdditiveTypeId: controlAdditiveEnabled ? controlledAdditiveTypeId.trim() || null : null,
          practiceSourceUrl: practiceSourceUrl.trim() || null,
          resultsSourceUrl: resultsSourceUrl.trim() || null,
          myRcmUrl: myRcmUrl.trim() || null,
          raceClass: raceClass.trim() || null,
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
        <div className="min-w-0">
          <label className="block text-[11px] text-muted-foreground mb-1">Name *</label>
          <input
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        {/*
          `min-w-0`, or a long venue name pushes this grid column past the card. A grid child's
          default `min-width: auto` sizes to its content, and the picker's trigger is one
          unbroken line where the `<select>` was a control with its own small intrinsic width —
          so the blow-out only appears once the trigger is allowed to want the space.
        */}
        <div className="min-w-0">
          <label className="block text-[11px] text-muted-foreground mb-1">
            Track{hasLegacyTrack && !trackId.trim() ? " (legacy)" : " *"}
          </label>
          {hasLegacyTrack && !trackId.trim() ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              {props.initialLegacyTrackLabel} — catalog track removed. Select a new track below to re-link, or leave
              unchanged to keep this legacy venue.
            </p>
          ) : null}
          {/*
            Same walk-back from the native `<select>` as the create form above — a venue list
            is the one list that keeps growing, and re-linking an event was the other place
            still spinning the iOS wheel.

            No inline "add a track" here on purpose: this form re-points an existing meeting
            at a track in the catalog, and the create-a-track door belongs where a driver is
            recording somewhere new.

            The `<select>`'s empty first row survives as the sheet's clear row, which labels
            itself from `placeholder` — hence the legacy wording below. A driver who picks a
            track and changes their mind can still choose "Keep legacy track" and land back on
            the unlinked state, which is the only way this form ever offered it.
          */}
          <div className="mt-1">
            <TrackCombobox
              tracks={trackChoices}
              value={trackId}
              onChange={setTrackId}
              favouriteTrackIds={favouriteTrackIds}
              placeholder={hasLegacyTrack ? "Keep legacy track" : "Select track…"}
              aria-label="Track"
            />
          </div>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="min-w-0">
          <label className="block text-[11px] text-muted-foreground mb-1">Start date</label>
          <input
            type="date"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label="Start date"
          />
        </div>
        <div className="min-w-0">
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
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="block text-[11px] text-muted-foreground">Tire</label>
          <SegmentedControl<"open" | "controlled">
            ariaLabel="Event tire — open or controlled"
            size="sm"
            value={tireControlled ? "controlled" : "open"}
            onChange={(v) => {
              const on = v === "controlled";
              setTireControlled(on);
              if (!on) setControlledTireTypeId("");
            }}
            options={[
              { value: "open", label: "Open" },
              { value: "controlled", label: "Controlled" },
            ]}
          />
          {tireControlled ? (
            <TireTypeCombobox
              value={controlledTireTypeId}
              onChange={setControlledTireTypeId}
              placeholder="Select control tire type…"
              aria-label="Event control tire type"
            />
          ) : null}
        </div>
        <div className="space-y-1.5">
          <label className="block text-[11px] text-muted-foreground">Additive</label>
          <SegmentedControl<"open" | "controlled">
            ariaLabel="Event additive — open or controlled"
            size="sm"
            value={controlAdditiveEnabled ? "controlled" : "open"}
            onChange={(v) => {
              const on = v === "controlled";
              setControlAdditiveEnabled(on);
              if (!on) setControlledAdditiveTypeId("");
            }}
            options={[
              { value: "open", label: "Open" },
              { value: "controlled", label: "Controlled" },
            ]}
          />
          {controlAdditiveEnabled ? (
            <AdditiveTypeCombobox
              value={controlledAdditiveTypeId}
              onChange={setControlledAdditiveTypeId}
              placeholder="Select control additive…"
              aria-label="Event control additive type"
              allowInlineCreate={false}
            />
          ) : null}
        </div>
      </div>
      {/*
        Deliberately NOT inside the advanced block below. Everything in there is LiveRC plumbing
        that only matters when the track's own page isn't enough; this is the single field that
        decides whether a MyRCM driver's import has anywhere to send them, and a closed
        <details> labelled "advanced" is where a field goes to never be filled in.
      */}
      <div className="min-w-0 border-t border-border pt-3">
        <label
          htmlFor="event-meta-myrcm-url"
          className="mb-1 block text-[11px] text-muted-foreground"
        >
          MyRCM page (optional)
        </label>
        <input
          id="event-meta-myrcm-url"
          type="url"
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
          value={myRcmUrl}
          onChange={(e) => setMyRcmUrl(e.target.value)}
          placeholder="Your class page on MyRCM"
          autoComplete="off"
          aria-label="MyRCM page URL"
        />
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          MyRCM results come in as a file, so laps can&rsquo;t pull automatically. Saving your class
          page here is what lets &ldquo;Import PDF&rdquo; open it for you at the track.
        </p>
      </div>
      {/*
        Timing sources used to be their own "LiveRC lap detection" card on this page, debug tables
        and all. The three settings still matter — race class is the only switch that turns on
        race-result detection ([syncEventLapSources.ts](../../lib/eventLapDetection/syncEventLapSources.ts))
        and has no other home — so they live here, closed, saved by the one Save button.
      */}
      <details className="group border-t border-border pt-3">
        <summary className="cursor-pointer list-none text-[11px] font-medium text-muted-foreground transition hover:text-foreground">
          <span className="inline-block transition group-open:rotate-90">›</span> Timing sources (advanced)
        </summary>
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          Only needed when the track&rsquo;s LiveRC page isn&rsquo;t enough. Race class must match the results row, or
          race results are skipped. Separate multiple classes with a comma or semicolon.
        </p>
        <div className="mt-3 grid gap-3">
          <div className="min-w-0">
            <label className="block text-[11px] text-muted-foreground mb-1">Practice session list URL</label>
            <input
              type="url"
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
              value={practiceSourceUrl}
              onChange={(e) => setPracticeSourceUrl(e.target.value)}
              placeholder="https://…/practice?p=session_list"
              autoComplete="off"
              aria-label="Practice session list URL"
            />
          </div>
          <div className="min-w-0">
            <label className="block text-[11px] text-muted-foreground mb-1">Results URL</label>
            <input
              type="url"
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
              value={resultsSourceUrl}
              onChange={(e) => setResultsSourceUrl(e.target.value)}
              placeholder="https://…/results or …/results/?p=view_event"
              autoComplete="off"
              aria-label="Results URL"
            />
          </div>
          <div className="min-w-0">
            <label className="block text-[11px] text-muted-foreground mb-1">Race class</label>
            <input
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
              value={raceClass}
              onChange={(e) => setRaceClass(e.target.value)}
              placeholder="e.g. 17.5 Stock Buggy; Modified"
              autoComplete="off"
              aria-label="Race class"
            />
          </div>
        </div>
      </details>
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
          <span className={cn("text-xs", message === "Saved." ? "text-primary-ink" : "text-muted-foreground")}>
            {message}
          </span>
        ) : null}
      </div>
    </SurfaceCard>
  );
}
