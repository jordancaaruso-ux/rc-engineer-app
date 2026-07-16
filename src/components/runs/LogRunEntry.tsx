"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";
import { chipToggleClass } from "@/components/ui/chipToggle";
import { cn } from "@/lib/utils";
import { TrackCombobox, type TrackOption } from "@/components/runs/TrackCombobox";
import { RunLayoutPicker } from "@/components/runs/RunLayoutPicker";
import { localTodayYmd, splitEventsForPicker } from "@/lib/events/splitEventsForPicker";
import { eventDateToYmd } from "@/lib/eventDateParse";
import { getCurrentPosition } from "@/lib/location/getCurrentPosition";
import { trackHasMarkedLocation } from "@/lib/location/coordinates";
import {
  DEFAULT_TRACK_PROXIMITY_RADIUS_M,
  pickTrackFromPosition,
} from "@/lib/location/trackProximity";
import type { EntryCandidate } from "@/lib/runs/entryCandidate";
import type { NewRunWizardEntry } from "@/lib/runs/wizardEntry";
import type { WizardChangeChip } from "@/lib/runs/wizardWalk";
import {
  defaultUiSession,
  uiSessionToMeeting,
  type UiSessionType,
} from "@/lib/runs/logRunSession";

/**
 * Log-run entry screen v3 (founder interview 2026-07-16). Order: ① car (the
 * first choice — the run we continue from follows it) → ② "Continue from last
 * run on this car" vs "Fresh log" (continue is the default when a prior run
 * exists and prefills the context below, with "what changed" chips) → ③ day type
 * (testing vs race meeting) → ④ event (race; track from it, inline "+ New event")
 * or track (testing; GPS auto-detect) → ⑤ session type Practice/Q/Main (race).
 * Continue prefills day type + track, re-attaching the event only when it's still
 * active; everything stays editable. Continue hands the resolved identity to the
 * wizard.
 */

type CarOption = { id: string; name: string };

/** Track rows carry GPS so the auto-detect can run at entry. */
export type EntryTrack = TrackOption & {
  latitude?: number | null;
  longitude?: number | null;
};

export type EntryDraftRow = {
  id: string;
  carName: string;
  trackName: string | null;
  eventName: string | null;
  sessionLabel: string;
  createdAt: string;
};

type EventRow = {
  id: string;
  name: string;
  trackId: string | null;
  track?: { id: string; name: string } | null;
  startDate: string;
  endDate: string;
};

const CHANGE_CHIPS: Array<{ id: WizardChangeChip; label: string }> = [
  { id: "tires", label: "Tires" },
  { id: "battery", label: "Battery" },
  { id: "setup", label: "Setup" },
  { id: "prep", label: "Tire prep" },
];

const SESSION_OPTIONS: ReadonlyArray<SegmentedOption<UiSessionType>> = [
  { value: "PRACTICE", label: "Practice" },
  { value: "QUALIFYING", label: "Qualifying" },
  { value: "MAIN", label: "Main" },
];

export function LogRunEntry({
  cars,
  tracks,
  favouriteTrackIds,
  favouriteTracks,
  initialCandidate,
  currentEventId,
  drafts,
  onContinue,
}: {
  cars: CarOption[];
  tracks: EntryTrack[];
  favouriteTrackIds: string[];
  favouriteTracks: TrackOption[];
  initialCandidate: EntryCandidate | null;
  currentEventId: string | null;
  drafts: EntryDraftRow[];
  onContinue: (entry: NewRunWizardEntry) => void;
}) {
  const router = useRouter();

  // ① Session context — the top fork. `?eventId=` deep links straight to race mode.
  const [sessionKind, setSessionKind] = useState<"TESTING" | "RACE_MEETING">(
    currentEventId ? "RACE_MEETING" : "TESTING"
  );

  // ② Race: events (client-fetched; picker defaults to the first upcoming).
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventId, setEventId] = useState<string>(currentEventId ?? "");
  const eventsLoadedRef = useRef(false);
  useEffect(() => {
    if (sessionKind !== "RACE_MEETING" || eventsLoadedRef.current) return;
    eventsLoadedRef.current = true;
    setEventsLoading(true);
    fetch("/api/events", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d: { events?: EventRow[] }) => {
        const list = d.events ?? [];
        setEvents(list);
        setEventId((cur) => {
          if (cur) return cur;
          const { upcoming } = splitEventsForPicker(list);
          return upcoming[0]?.id ?? "";
        });
      })
      .catch(() => setEvents([]))
      .finally(() => setEventsLoading(false));
  }, [sessionKind]);
  const selectedEvent = events.find((e) => e.id === eventId) ?? null;

  // Inline "+ New event" (name + track + date — the fields that matter trackside).
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [newEventName, setNewEventName] = useState("");
  const [newEventTrackId, setNewEventTrackId] = useState("");
  const [newEventDate, setNewEventDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const createEvent = useCallback(async () => {
    const name = newEventName.trim();
    if (!name) return setEventError("Event name is required.");
    if (!newEventTrackId) return setEventError("Pick the event's track.");
    setEventError(null);
    setCreatingEvent(true);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          trackId: newEventTrackId,
          startDate: newEventDate,
          endDate: newEventDate,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { event?: EventRow; error?: string };
      if (!res.ok || !data.event?.id) {
        setEventError(data.error || `Could not create the event (${res.status}).`);
        return;
      }
      setEvents((prev) => [data.event!, ...prev]);
      setEventId(data.event.id);
      setShowNewEvent(false);
      setNewEventName("");
    } catch (err) {
      setEventError(err instanceof Error ? err.message : "Could not create the event.");
    } finally {
      setCreatingEvent(false);
    }
  }, [newEventName, newEventTrackId, newEventDate]);

  // ② Testing: track (required) — GPS auto-detect once, editable.
  const [trackId, setTrackId] = useState("");
  const [trackLayoutId, setTrackLayoutId] = useState("");
  const [trackDirection, setTrackDirection] = useState<"" | "CW" | "CCW">("");
  const [detectMessage, setDetectMessage] = useState<string | null>(null);
  const trackPickedRef = useRef(false);
  const detectRanRef = useRef(false);
  const detectTrack = useCallback(async () => {
    if (tracks.filter((t) => trackHasMarkedLocation(t)).length === 0) return;
    try {
      const position = await getCurrentPosition();
      const pick = pickTrackFromPosition(tracks, position, {
        radiusMeters: DEFAULT_TRACK_PROXIMITY_RADIUS_M,
        favouriteTrackIds,
      });
      if (trackPickedRef.current) return; // driver picked while we were detecting
      if (pick.kind === "single") {
        setTrackId(pick.track.id);
        setDetectMessage(`Detected ${pick.track.name} (${Math.round(pick.distanceM)} m away).`);
      } else if (pick.kind === "multiple") {
        setDetectMessage("Multiple tracks nearby — pick the right one.");
      }
    } catch {
      /* location denied/unavailable — silent, driver picks manually */
    }
  }, [tracks, favouriteTrackIds]);
  useEffect(() => {
    if (sessionKind !== "TESTING" || detectRanRef.current || trackId) return;
    detectRanRef.current = true;
    const t = window.setTimeout(() => void detectTrack(), 400);
    return () => window.clearTimeout(t);
  }, [sessionKind, trackId, detectTrack]);

  // ③ Race session sub-type (testing = implicit).
  const [sessionType, setSessionType] = useState<UiSessionType>("PRACTICE");

  // ④ Car — defaults to the last-used car; candidate follows the pick.
  const [carId, setCarId] = useState<string>(
    initialCandidate?.carId && cars.some((c) => c.id === initialCandidate.carId)
      ? initialCandidate.carId
      : cars[0]?.id ?? ""
  );
  const [candidate, setCandidate] = useState<EntryCandidate | null>(
    initialCandidate && initialCandidate.carId === carId ? initialCandidate : null
  );
  useEffect(() => {
    let cancelled = false;
    if (!carId) return;
    if (initialCandidate && initialCandidate.carId === carId) {
      setCandidate(initialCandidate);
      return;
    }
    fetch(`/api/runs/last-for-car?carId=${encodeURIComponent(carId)}`)
      .then((r) => (r.ok ? r.json() : { candidate: null }))
      .then((d) => {
        if (!cancelled) setCandidate((d?.candidate as EntryCandidate | null) ?? null);
      })
      .catch(() => {
        if (!cancelled) setCandidate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [carId, initialCandidate]);

  // ② Continue-from-last-run vs fresh (founder rework 2026-07-16). Continue is the
  // default when the picked car has a prior run; choosing it prefills the day type
  // / event / track / session type below (all still editable).
  const [start, setStart] = useState<"copy" | "fresh" | null>(null);
  const [changed, setChanged] = useState<Set<WizardChangeChip>>(new Set());
  const startResolved: "copy" | "fresh" = start ?? (candidate ? "copy" : "fresh");

  // Prefill the session context from the run we're continuing. Deep-linked into an
  // event → that event wins. Otherwise re-attach the candidate's event only while
  // it's still active (end date today-or-later); if not, carry just the track as a
  // testing baseline.
  const applyContinue = useCallback(
    (cand: EntryCandidate) => {
      setChanged(new Set());
      if (currentEventId) {
        setSessionKind("RACE_MEETING");
        setEventId(currentEventId);
        const d = defaultUiSession(cand, true, true);
        setSessionType(d.type === "TESTING" ? "PRACTICE" : d.type);
        setTrackId("");
        setTrackLayoutId("");
        setTrackDirection("");
        return;
      }
      const wasRace = cand.meetingSessionType != null && cand.meetingSessionType !== "TESTING";
      const eventActive =
        cand.eventId != null &&
        cand.eventEndIso != null &&
        eventDateToYmd(cand.eventEndIso) >= localTodayYmd();
      if (wasRace && cand.eventId && eventActive) {
        setSessionKind("RACE_MEETING");
        setEventId(cand.eventId);
        const d = defaultUiSession(cand, true, true);
        setSessionType(d.type === "TESTING" ? "PRACTICE" : d.type);
        setTrackId("");
        setTrackLayoutId("");
        setTrackDirection("");
      } else {
        setSessionKind("TESTING");
        if (cand.trackId) {
          trackPickedRef.current = true;
          setTrackId(cand.trackId);
        }
        setTrackLayoutId("");
        setTrackDirection("");
        setSessionType("PRACTICE");
      }
    },
    [currentEventId],
  );

  const resetToBlank = useCallback(() => {
    setChanged(new Set());
    setSessionKind(currentEventId ? "RACE_MEETING" : "TESTING");
    setEventId(currentEventId ?? "");
    setTrackId("");
    setTrackLayoutId("");
    setTrackDirection("");
    setSessionType("PRACTICE");
    trackPickedRef.current = false;
    detectRanRef.current = false;
    setDetectMessage(null);
  }, [currentEventId]);

  // Default to continuing: apply the prefill once per candidate unless the driver
  // has explicitly chosen a fresh log.
  const continueAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!candidate || start === "fresh") return;
    if (continueAppliedRef.current === candidate.runId) return;
    continueAppliedRef.current = candidate.runId;
    applyContinue(candidate);
  }, [candidate, start, applyContinue]);

  const toggleChip = useCallback((id: WizardChangeChip) => {
    setChanged((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const eventTrackName = useMemo(() => {
    if (!selectedEvent) return null;
    return (
      selectedEvent.track?.name ??
      tracks.find((t) => t.id === selectedEvent.trackId)?.name ??
      null
    );
  }, [selectedEvent, tracks]);

  const carName = cars.find((c) => c.id === carId)?.name ?? "this car";
  const isRace = sessionKind === "RACE_MEETING";
  const contextReady = isRace
    ? Boolean(eventId && (selectedEvent?.trackId || trackId))
    : Boolean(trackId);

  const continueNow = () => {
    const uiType: UiSessionType = isRace ? sessionType : "TESTING";
    const meeting = uiSessionToMeeting(uiType);
    onContinue({
      carId,
      continuing: startResolved === "copy" && Boolean(candidate),
      changed: [...changed],
      sessionType: isRace ? "RACE_MEETING" : "TESTING",
      meetingSessionType: isRace
        ? (meeting.meetingSessionType as "PRACTICE" | "QUALIFYING" | "RACE" | null)
        : null,
      sessionLabel: meeting.sessionLabel,
      eventId: isRace ? eventId || null : null,
      // Race: the event's track wins; a manual pick only rides along when the
      // event carries none. Testing: the picked track.
      trackId: isRace ? (selectedEvent?.trackId ? null : trackId || null) : trackId || null,
      trackLayoutId: !isRace && trackLayoutId ? trackLayoutId : null,
      trackDirection: !isRace && trackDirection ? trackDirection : null,
    });
  };

  return (
    // Bottom padding clears the mobile dock so Continue is always reachable.
    <div className="space-y-4 pb-24 md:pb-8">
      {/* Open drafts — finish before starting another */}
      {drafts.length > 0 ? (
        <CardPanel contentClassName="space-y-2" className="border-amber-500/40">
          <Eyebrow>Finish today&apos;s runs</Eyebrow>
          {drafts.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => router.push(`/runs/${encodeURIComponent(d.id)}/edit`)}
              className="flex w-full flex-col items-start rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-left hover:border-amber-500/60"
            >
              <span className="text-sm font-semibold text-foreground">
                {d.sessionLabel || "Run"} — {d.carName}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {[d.trackName, d.eventName, relativeWhen(d.createdAt)].filter(Boolean).join(" · ")}
              </span>
              <span className="mt-1 text-[11px] text-amber-600 dark:text-amber-300">
                finish logging — laps &amp; rating
              </span>
            </button>
          ))}
        </CardPanel>
      ) : null}

      {/* ① Car — the first choice; the run we continue from follows it */}
      <CardPanel contentClassName="space-y-2">
        <Eyebrow>Car</Eyebrow>
        <select
          value={carId}
          onChange={(e) => {
            setCarId(e.target.value);
            setStart(null);
          }}
          className="w-full rounded-lg border border-border bg-secondary px-3 py-3 text-sm text-foreground"
          aria-label="Car"
        >
          {cars.length === 0 ? <option value="">No cars yet</option> : null}
          {cars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </CardPanel>

      {/* ② Continue from last run vs fresh — sets the day type / track below */}
      <CardPanel contentClassName="space-y-3">
        <Eyebrow>Start</Eyebrow>
        <button
          type="button"
          aria-pressed={startResolved === "copy"}
          disabled={!candidate}
          onClick={() => {
            if (!candidate) return;
            setStart("copy");
            continueAppliedRef.current = candidate.runId;
            applyContinue(candidate);
          }}
          className={cn(
            "flex w-full flex-col items-start rounded-lg border px-3 py-3 text-left transition-colors",
            startResolved === "copy" && candidate
              ? "border-primary bg-primary/10"
              : "border-border bg-secondary hover:border-faint",
            !candidate && "opacity-50"
          )}
        >
          <span className="text-sm font-semibold text-foreground">
            ⟲ Continue from last run on this car
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {candidate
              ? [candidateLabel(candidate), candidate.trackName, relativeWhen(candidate.whenIso)]
                  .filter(Boolean)
                  .join(" · ")
              : `no past runs for ${carName} yet`}
          </span>
        </button>
        {startResolved === "copy" && candidate ? (
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">What changed since then?</p>
            <div className="flex flex-wrap gap-2">
              {CHANGE_CHIPS.map((chip) => {
                const on = changed.has(chip.id);
                return (
                  <button
                    key={chip.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleChip(chip.id)}
                    className={cn(chipToggleClass(on), "px-3 py-1.5 text-sm")}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <button
          type="button"
          aria-pressed={startResolved === "fresh"}
          onClick={() => {
            setStart("fresh");
            resetToBlank();
          }}
          className={cn(
            "flex w-full items-center rounded-lg border px-3 py-3 text-left text-sm font-semibold transition-colors",
            startResolved === "fresh"
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border bg-secondary text-muted-foreground hover:border-faint hover:text-foreground"
          )}
        >
          Fresh log — the full guided walk
        </button>
      </CardPanel>

      {/* ③ Day type — testing vs race meeting; prefilled when continuing */}
      <CardPanel contentClassName="space-y-3">
        <Eyebrow>Day type</Eyebrow>
        <SegmentedControl<"TESTING" | "RACE_MEETING">
          ariaLabel="Day type"
          value={sessionKind}
          onChange={setSessionKind}
          options={[
            { value: "TESTING", label: "Testing" },
            { value: "RACE_MEETING", label: "Race meeting" },
          ]}
        />

        {isRace ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Eyebrow dot="muted">Event</Eyebrow>
                <button
                  type="button"
                  className="btn-surface px-2 py-1 text-[11px]"
                  onClick={() => setShowNewEvent((v) => !v)}
                >
                  {showNewEvent ? "Cancel" : "+ New event"}
                </button>
              </div>
              {showNewEvent ? (
                <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
                  <input
                    className="form-control w-full px-3 py-2 text-sm"
                    placeholder="Event name (e.g. Winter Series Rd 3)"
                    value={newEventName}
                    onChange={(e) => setNewEventName(e.target.value)}
                    aria-label="New event name"
                  />
                  <select
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2.5 text-sm text-foreground"
                    value={newEventTrackId}
                    onChange={(e) => setNewEventTrackId(e.target.value)}
                    aria-label="New event track"
                  >
                    <option value="">Track…</option>
                    {tracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.location ? `${t.name} (${t.location})` : t.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    className="form-control w-full px-3 py-2 text-sm"
                    value={newEventDate}
                    onChange={(e) => setNewEventDate(e.target.value)}
                    aria-label="New event date"
                  />
                  {eventError ? (
                    <p className="text-[11px] text-destructive">{eventError}</p>
                  ) : null}
                  <button
                    type="button"
                    className={cn(
                      "btn-surface w-full px-3 py-2 text-xs font-semibold",
                      creatingEvent && "pointer-events-none opacity-60"
                    )}
                    onClick={() => void createEvent()}
                  >
                    {creatingEvent ? "Creating…" : "Create event"}
                  </button>
                </div>
              ) : (
                <select
                  className="w-full rounded-lg border border-border bg-secondary px-3 py-3 text-sm text-foreground"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                  aria-label="Event"
                >
                  {eventsLoading && events.length === 0 ? (
                    <option value="">Loading events…</option>
                  ) : events.length === 0 ? (
                    <option value="">No events yet — create one</option>
                  ) : null}
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name}
                    </option>
                  ))}
                </select>
              )}
              {eventTrackName ? (
                <p className="font-mono text-[11px] text-muted-foreground">
                  ↳ {eventTrackName} · from event
                </p>
              ) : selectedEvent ? (
                // Event without a saved track — rare, but the run still needs a
                // venue: fall back to an explicit pick right here.
                <div className="space-y-1 pt-1">
                  <p className="text-[11px] text-muted-foreground">
                    This event has no track set — pick where you&apos;re running:
                  </p>
                  <TrackCombobox
                    tracks={tracks}
                    value={trackId}
                    onChange={(id) => {
                      trackPickedRef.current = true;
                      setTrackId(id);
                    }}
                    favouriteTrackIds={favouriteTrackIds}
                    favouriteTracks={favouriteTracks}
                    placeholder="Select track…"
                    aria-label="Track"
                  />
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <Eyebrow dot="muted">Session type</Eyebrow>
              <SegmentedControl
                options={SESSION_OPTIONS}
                value={sessionType}
                onChange={setSessionType}
                ariaLabel="Session type"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Eyebrow dot="muted">Track (required)</Eyebrow>
            <TrackCombobox
              tracks={tracks}
              value={trackId}
              onChange={(id) => {
                trackPickedRef.current = true;
                setTrackId(id);
                setTrackLayoutId("");
                setTrackDirection("");
                setDetectMessage(null);
              }}
              favouriteTrackIds={favouriteTrackIds}
              favouriteTracks={favouriteTracks}
              placeholder="Select track…"
              aria-label="Track"
            />
            {detectMessage ? (
              <p className="text-[11px] text-muted-foreground">{detectMessage}</p>
            ) : null}
            {trackId ? (
              <RunLayoutPicker
                trackId={trackId}
                layoutId={trackLayoutId}
                direction={trackDirection}
                onLayoutChange={setTrackLayoutId}
                onDirectionChange={setTrackDirection}
              />
            ) : null}
          </div>
        )}
      </CardPanel>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={!contextReady || !carId}
          onClick={continueNow}
          className={cn(
            "tap-active inline-flex h-12 items-center gap-1.5 rounded-full bg-primary px-5 font-sans text-sm font-bold text-primary-foreground shadow-[0_12px_26px_-6px_rgba(255,214,10,0.35),inset_0_1px_0_rgba(255,255,255,0.4)] transition-transform duration-150 hover:bg-[#E6BE00] active:scale-95",
            (!contextReady || !carId) && "pointer-events-none opacity-50"
          )}
        >
          Next →
        </button>
      </div>
      {!contextReady ? (
        <p className="text-right text-[11px] text-faint">
          {isRace
            ? eventId
              ? "This event has no track — pick one above."
              : "Pick or create the event first."
            : "Pick the track first."}
        </p>
      ) : null}
    </div>
  );
}

/** Short label for the run we're continuing (session label, else session kind). */
function candidateLabel(c: EntryCandidate): string {
  if (c.sessionLabel) return c.sessionLabel;
  const t = c.meetingSessionType;
  if (!t || t === "TESTING") return "Testing";
  return t.charAt(0) + t.slice(1).toLowerCase();
}

function relativeWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}
