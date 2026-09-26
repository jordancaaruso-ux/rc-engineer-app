"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { TrackCombobox } from "@/components/runs/TrackCombobox";
import {
  InlineNewTrackRow,
  type InlineCreatedTrack,
  type InlineNewTrackRowHandle,
} from "@/components/runs/InlineNewTrackRow";
import { EventDateRangeField } from "@/components/events/EventDateRangeField";
import { localTodayYmd } from "@/components/ui/DayRangeCalendar";
import type { TrackListLiveRcMeeting } from "@/lib/events/trackEventGroups";

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

/** LiveRC's meetings at a track on some days (`GET /api/events/at-track`). Never links anything. */
async function fetchLiveRcOnDays(
  trackId: string,
  startYmd: string,
  endYmd: string
): Promise<TrackListLiveRcMeeting[]> {
  const q = new URLSearchParams({ trackId, start: startYmd, end: endYmd });
  const res = await fetch(`/api/events/at-track?${q}`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { meetings?: TrackListLiveRcMeeting[] };
  return Array.isArray(data.meetings) ? data.meetings : [];
}

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
  open,
  onCreated,
}: {
  tracks: TrackOption[];
  /** Ordered by the catalog, grouped first in the picker — same list Log your run uses. */
  favouriteTrackIds?: string[];
  suggestedStartYmd?: string | null;
  /**
   * The panel holding the form is open. The form stays mounted while it is closed, so without
   * this a message from last time sat beside the empty form when New event opened again.
   */
  open?: boolean;
  /**
   * The meeting made, joined or found, and the words for it. The parent closes the panel on this,
   * so the parent says them where they can be seen (test drive 2026-09-26: "You already have this
   * meeting." was set in the form as it closed, and nobody saw it).
   */
  onCreated?: (event: unknown, message: string) => void;
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
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // A suggested date arriving after mount (the card computes it) should fill an untouched
  // field, but must never overwrite a date the driver has already typed.
  useEffect(() => {
    if (suggestedStartYmd) setStartDate((prev) => prev || suggestedStartYmd);
  }, [suggestedStartYmd]);

  // Opened again: last time's message describes nothing on screen any more.
  useEffect(() => {
    if (open) setMessage(null);
  }, [open]);

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

  /**
   * The days the meeting will be made for. Untouched dates mean today on the device's own
   * calendar, never `toISOString()`'s, which is still yesterday at 8 am in Australia.
   */
  const daysStart = startDate || localTodayYmd();
  const daysEnd = endDate || daysStart;

  /**
   * LiveRC's meetings at the picked track on the picked days (test drive 2026-09-26, W1-10: a
   * driver made their own "EMCC Cup" beside LiveRC's and nothing pointed them to it). While there
   * is one, the form offers it first, the way an add-track form offers the club already here, and
   * "No, make my own" brings Create back for those days. Asked only for a track with a LiveRC page.
   */
  const liveRcKey = selectedTrack?.liveRcUrl?.trim() ? `${trackId}|${daysStart}|${daysEnd}` : "";
  const [liveRcAnswer, setLiveRcAnswer] = useState<{ key: string; meetings: TrackListLiveRcMeeting[] }>({
    key: "",
    meetings: [],
  });
  const [ownMeetingKey, setOwnMeetingKey] = useState<string | null>(null);
  const liveRcOffer =
    liveRcKey && liveRcAnswer.key === liveRcKey && ownMeetingKey !== liveRcKey ? liveRcAnswer.meetings : [];

  useEffect(() => {
    if (!liveRcKey || liveRcAnswer.key === liveRcKey) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      fetchLiveRcOnDays(trackId, daysStart, daysEnd)
        .then((meetings) => {
          if (alive) setLiveRcAnswer({ key: liveRcKey, meetings });
        })
        .catch(() => {});
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [liveRcKey, liveRcAnswer.key, trackId, daysStart, daysEnd]);

  function resetForm() {
    setName("");
    setTrackId("");
    setStartDate("");
    setEndDate("");
    setNotes("");
    setPracticeSourceUrl("");
    setResultsSourceUrl("");
  }

  /** "Use that one": join LiveRC's meeting, or make its event if nobody has picked it yet. */
  async function joinLiveRcMeeting(meeting: TrackListLiveRcMeeting) {
    setMessage(null);
    setAdding(true);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: meeting.name,
          trackId,
          startDate: meeting.startYmd,
          endDate: meeting.endYmd,
          resultsSourceUrl: meeting.hubUrl,
          notes: notes.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { event?: unknown; error?: string };
      // 409 is the usual answer: another driver already picked LiveRC's meeting, and this joined it.
      if (!(res.ok || res.status === 409) || !data.event) {
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      onCreated?.(data.event, "Joined LiveRC’s meeting.");
      resetForm();
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Couldn’t join that meeting");
    } finally {
      setAdding(false);
    }
  }

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
      // Never make a copy of LiveRC's meeting blind: a fast Create first shows the one there.
      if (liveRcKey && ownMeetingKey !== liveRcKey) {
        const meetings =
          liveRcAnswer.key === liveRcKey
            ? liveRcAnswer.meetings
            : await fetchLiveRcOnDays(trackId, daysStart, daysEnd).catch(() => []);
        setLiveRcAnswer({ key: liveRcKey, meetings });
        if (meetings.length > 0) return;
      }
      const start = daysStart;
      const end = daysEnd;
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
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        event?: unknown;
        error?: string;
        existingEventId?: string;
        reused?: boolean;
      };
      // 409 with an event: someone's meeting already carries that LiveRC link, and this joined it.
      if (res.status === 409 && data.event) {
        onCreated?.(data.event, "Joined LiveRC’s meeting.");
        resetForm();
        router.refresh();
        return;
      }
      if (!res.ok) {
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      // The server hands back the one you already made with this name, track and days (W2-14).
      onCreated?.(
        (data as { event: unknown }).event,
        data.reused ? "You already have this meeting." : "Event created."
      );
      resetForm();
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
      {liveRcOffer.length > 0 ? (
        <div className="inset-panel-deep space-y-2 px-3 py-2.5">
          {liveRcOffer.map((meeting) => (
            <div key={meeting.hubUrl} className="space-y-1.5">
              <p className="text-sm text-foreground">
                LiveRC already has “{meeting.name}” on these days.
              </p>
              <button
                type="button"
                disabled={adding}
                onClick={() => void joinLiveRcMeeting(meeting)}
                className="max-w-full truncate rounded-lg primary-face bg-primary px-2.5 py-1.5 text-[11.5px] font-semibold text-primary-foreground transition hover:brightness-105 disabled:opacity-50"
              >
                {adding ? "Joining…" : "Use that one"}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setOwnMeetingKey(liveRcKey)}
            className="px-1 py-1.5 text-[11.5px] font-semibold text-foreground underline underline-offset-2"
          >
            No, make my own
          </button>
        </div>
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
      <div className="flex items-center gap-2">
        {/* While LiveRC's meeting is offered above, a new one takes "No, make my own" first. */}
        {liveRcOffer.length > 0 ? null : (
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
        )}
        {/* Only what went wrong is said here; what worked is said by the parent, as it closes. */}
        {message && <span className="text-xs text-muted-foreground">{message}</span>}
      </div>
    </form>
  );
}
