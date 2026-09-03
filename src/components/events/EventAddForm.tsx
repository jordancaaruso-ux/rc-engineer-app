"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { TrackCombobox } from "@/components/runs/TrackCombobox";
import {
  InlineNewTrackRow,
  type InlineCreatedTrack,
  type InlineNewTrackRowHandle,
} from "@/components/runs/InlineNewTrackRow";
import { TireTypeCombobox } from "@/components/tires/TireTypeCombobox";
import { AdditiveTypeCombobox } from "@/components/additives/AdditiveTypeCombobox";
import { EventDateRangeField } from "@/components/events/EventDateRangeField";

export type TrackOption = {
  id: string;
  name: string;
  location?: string | null;
  /** LiveRC track root URL. Set = the meeting's timing pages are discoverable without pasting them. */
  liveRcUrl?: string | null;
  /** MYLAPS Speedhive organisation URL — same story, other provider. */
  speedhiveUrl?: string | null;
  /** Searchable in the picker without being on screen — "carpet", "high grip". */
  gripTags?: string[];
  layoutTags?: string[];
};

/**
 * The create-an-event form, lifted out of `EventList` unchanged so the desktop page can
 * mount the same one behind its "New event" button.
 *
 * Extraction only — every field, validation rule and request body is as it was. The
 * desktop redesign deliberately did not redesign this form (open question 4 in the
 * handoff); duplicating it would have been the only other way to give desktop an add
 * path, and two copies of a nine-field form drift within a week.
 *
 * `suggestedStartYmd` is the one addition: the nothing-booked card reads a cadence out of
 * logged events ("five of the last six Saturdays") and can therefore open this form on the
 * date that cadence implies.
 */
export function EventAddForm({
  tracks,
  favouriteTrackIds = [],
  suggestedStartYmd,
  onCreated,
}: {
  tracks: TrackOption[];
  /** Ordered by the catalog, grouped first in the picker — same list Log your run uses. */
  favouriteTrackIds?: string[];
  suggestedStartYmd?: string | null;
  onCreated?: (event: unknown) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [trackId, setTrackId] = useState("");
  /**
   * A track added from inside the picker exists on the server but not in `tracks`, which
   * is server-rendered on desktop and refetched only on navigation on the phone. Holding it
   * here is what makes it selectable the instant it is created, and it carries the timing
   * URLs the row was born with — so `showTimingUrlFields` below reads the truth rather than
   * offering boxes for a page the new track already points at.
   */
  const [createdTracks, setCreatedTracks] = useState<TrackOption[]>([]);
  const newTrackRowRef = useRef<InlineNewTrackRowHandle>(null);
  const [startDate, setStartDate] = useState(suggestedStartYmd ?? "");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [practiceSourceUrl, setPracticeSourceUrl] = useState("");
  const [resultsSourceUrl, setResultsSourceUrl] = useState("");
  /** Where this meeting lives on MyRCM. A destination for the driver, never a page we fetch. */
  const [myRcmUrl, setMyRcmUrl] = useState("");
  const [tireControlled, setTireControlled] = useState(false);
  const [controlledTireTypeId, setControlledTireTypeId] = useState("");
  const [controlAdditiveEnabled, setControlAdditiveEnabled] = useState(false);
  const [controlledAdditiveTypeId, setControlledAdditiveTypeId] = useState("");
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // A suggested date arriving after mount (the card computes it) should fill an untouched
  // field, but must never overwrite a date the driver has already typed.
  useEffect(() => {
    if (suggestedStartYmd) setStartDate((prev) => prev || suggestedStartYmd);
  }, [suggestedStartYmd]);

  /** Catalog plus anything added from inside the picker, first row of a name winning. */
  const allTracks = useMemo(() => {
    const byId = new Map<string, TrackOption>();
    for (const t of [...createdTracks, ...tracks]) if (!byId.has(t.id)) byId.set(t.id, t);
    return [...byId.values()];
  }, [createdTracks, tracks]);

  /**
   * A track that carries a timing link needs no per-event URLs — the importer discovers the
   * meeting from the track root. The log-run wizard has hidden these two boxes on that rule
   * for a while (NewRunForm's newEventTrackLiveRc); this form never got it, so the Events
   * page kept asking for something it already knows.
   *
   * Speedhive counts as a link even though the event URLs are LiveRC-only: syncEventLapSources
   * ignores anything that is not a LiveRC index page, so on a Speedhive track these boxes are
   * dead, not merely redundant. Hiding them removes a trap rather than tidying one away.
   *
   * Nothing is lost — the event page's "Timing sources (advanced)" row still pins a specific
   * index page for the rare meeting discovery gets wrong.
   */
  const selectedTrack = useMemo(
    () => (trackId ? allTracks.find((t) => t.id === trackId) ?? null : null),
    [trackId, allTracks]
  );
  const trackTimingLink = selectedTrack
    ? selectedTrack.liveRcUrl?.trim() || selectedTrack.speedhiveUrl?.trim() || null
    : null;
  /** No track chosen yet is also a no: a timing URL guessed before the venue is guesswork. */
  const showTimingUrlFields = Boolean(selectedTrack) && !trackTimingLink;

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
    setMessage(null);
    setAdding(true);
    try {
      const start = startDate || new Date().toISOString().slice(0, 10);
      const end = endDate || start;
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          trackId,
          startDate: start,
          endDate: end,
          notes: notes.trim() || null,
          practiceSourceUrl: showTimingUrlFields ? practiceSourceUrl.trim() || null : null,
          resultsSourceUrl: showTimingUrlFields ? resultsSourceUrl.trim() || null : null,
          // NOT gated on `showTimingUrlFields`: that switch asks whether the track already has a
          // page we can scan, and no amount of LiveRC makes a MyRCM meeting importable.
          myRcmUrl: myRcmUrl.trim() || null,
          controlledTireTypeId: tireControlled ? controlledTireTypeId.trim() || null : null,
          controlledAdditiveTypeId: controlAdditiveEnabled
            ? controlledAdditiveTypeId.trim() || null
            : null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        event?: unknown;
        error?: string;
        existingEventId?: string;
      };
      if (res.status === 409 && data.event) {
        onCreated?.(data.event);
        setMessage(data.error ?? "Joined existing event with this LiveRC URL.");
        router.refresh();
        return;
      }
      if (!res.ok) {
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      onCreated?.((data as { event: unknown }).event);
      setName("");
      setTrackId("");
      setStartDate("");
      setEndDate("");
      setNotes("");
      setPracticeSourceUrl("");
      setResultsSourceUrl("");
      setTireControlled(false);
      setControlledTireTypeId("");
      setControlAdditiveEnabled(false);
      setControlledAdditiveTypeId("");
      setMessage("Event created.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to create event");
    } finally {
      setAdding(false);
    }
  }

  return (
    <form onSubmit={handleAdd} className="space-y-3">
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
        <div className="min-w-0 space-y-2">
          <label className="block text-[11px] text-muted-foreground mb-1">Track *</label>
          {/*
            The searchable sheet, not a native `<select>`. The 2026-07-14 native sweep was
            walked back for long lists (see TrackCombobox) and every other track picker moved
            with it; this form was missed, so booking a meeting still opened the iOS wheel —
            five rows at a time, no way to type, on the one list that grows with every venue
            you ever travel to. Favourites-first and town/tag search come free with it.
          */}
          <TrackCombobox
            tracks={allTracks}
            value={trackId}
            onChange={setTrackId}
            favouriteTrackIds={favouriteTrackIds}
            placeholder="Select track…"
            aria-label="Track"
            onCreateRequest={(query) => newTrackRowRef.current?.openWith(query)}
          />
          {/*
            The "+" inside the sheet points here rather than opening a second modal over the
            first. Same component the run wizard uses, so a track born on the Events page
            arrives with its timing page and its favourite flag exactly as one born mid-run.
          */}
          <InlineNewTrackRow
            ref={newTrackRowRef}
            onCreated={(t: InlineCreatedTrack) => {
              setCreatedTracks((prev) =>
                prev.some((p) => p.id === t.id) ? prev : [...prev, t]
              );
              setTrackId(t.id);
            }}
          />
        </div>
      </div>
      <EventDateRangeField
        label="Dates"
        startYmd={startDate}
        endYmd={endDate}
        onChange={(next) => {
          setStartDate(next.startYmd);
          setEndDate(next.endYmd);
        }}
        triggerClassName="rounded-md border border-border bg-card"
      />
      <div>
        <label className="block text-[11px] text-muted-foreground mb-1">Notes (optional)</label>
        <input
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes"
        />
      </div>
      {showTimingUrlFields ? (
        <>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">
              Practice timing URL (optional)
            </label>
            <input
              type="url"
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
              value={practiceSourceUrl}
              onChange={(e) => setPracticeSourceUrl(e.target.value)}
              placeholder="LiveRC practice session list URL"
            />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">
              Race timing URL (optional)
            </label>
            <input
              type="url"
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
              value={resultsSourceUrl}
              onChange={(e) => setResultsSourceUrl(e.target.value)}
              placeholder="LiveRC results / race timing page URL"
            />
          </div>
        </>
      ) : trackTimingLink ? (
        // Say it out loud rather than showing nothing: two boxes silently disappearing on a
        // track change reads as a fault, and this is the page where you deliberately set an
        // event up.
        <p className="text-[11px] text-muted-foreground">
          Laps pull automatically from {selectedTrack?.name ?? "this track"} — no timing links
          needed.
        </p>
      ) : null}
      <div>
        <label className="block text-[11px] text-muted-foreground mb-1">
          MyRCM page (optional)
        </label>
        <input
          type="url"
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
          value={myRcmUrl}
          onChange={(e) => setMyRcmUrl(e.target.value)}
          placeholder="Your class page on MyRCM"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">Results come in as a file — this is where Import PDF sends you.</p>
      </div>
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
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={adding || !trackId.trim()}
          className={cn(
            buttonLinkClassName("primary"),
            (adding || !trackId.trim()) && "opacity-70 pointer-events-none"
          )}
        >
          {adding ? "Creating…" : "Create event"}
        </button>
        {message && (
          <span
            className={cn(
              "text-xs",
              message === "Event created." ? "text-primary-ink" : "text-muted-foreground"
            )}
          >
            {message}
          </span>
        )}
      </div>
    </form>
  );
}
