"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { normalizeSetupData, parseLapTimes, type SetupSnapshotData } from "@/lib/runSetup";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import { getDefaultSetupSheetTemplate } from "@/lib/setupSheetTemplate";
import { isA800RRCar } from "@/lib/setupSheetTemplateId";
import { TrackCombobox } from "@/components/runs/TrackCombobox";
import { formatEventDate, formatEventRelativeLabel } from "@/lib/formatDate";
import { formatRunSessionDisplay, type MeetingSessionType } from "@/lib/runSession";
import { setActiveSetupData, migrateLegacyLoadedSetup } from "@/lib/activeSetupContext";
import type { RunPickerRun } from "@/lib/runPickerFormat";
import { formatRunPickerLineRelativeWhen } from "@/lib/runPickerFormat";
import { RunPickerSelect } from "@/components/runs/RunPickerSelect";
import { displayRunNotes } from "@/lib/runNotes";
import { isEndDateBeforeStartDateYmd } from "@/lib/eventDateValidation";
import type { LapSourceKind } from "@/lib/lapSession/types";
import { normalizeLapTimes } from "@/lib/runLaps";
import {
  LapTimesIngestPanel,
  defaultLapIngestValue,
  type LapIngestFormValue,
} from "@/components/runs/LapTimesIngestPanel";

type CarOption = { id: string; name: string; setupSheetTemplate?: string | null };
type TrackOption = { id: string; name: string; location?: string | null };
type TireSetOption = { id: string; label: string; setNumber?: number; initialRunCount?: number };

type EventOption = {
  id: string;
  name: string;
  trackId: string | null;
  startDate: string;
  endDate: string;
  notes?: string | null;
  track?: { id: string; name: string; location?: string | null } | null;
};

type LastRun = {
  id: string;
  createdAt: string;
  sessionType?: "TESTING" | "PRACTICE" | "RACE_MEETING";
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  carId?: string;
  car?: { id: string; name: string } | null;
  trackId: string | null;
  eventId: string | null;
  tireSetId: string | null;
  tireRunNumber: number;
  setupSnapshot: { id: string; data: unknown };
  event?: EventOption | null;
  track?: { id: string; name: string } | null;
  tireSet?: { id: string; label: string; setNumber?: number | null } | null;
  notes?: string | null;
  driverNotes?: string | null;
  handlingProblems?: string | null;
  suggestedChanges?: string | null;
  lapTimes?: unknown;
  lapSession?: unknown;
};

const FETCH_TIMEOUT_MS = 12000;

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    clearTimeout(timeoutId);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as { error?: string })?.error || `Request failed (${res.status})`);
    }
    return data as T;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error) {
      if (err.name === "AbortError") throw new Error("Request timed out. Try again.");
      throw err;
    }
    throw new Error("Network error");
  }
}

function lapIngestFromRunLike(r: { lapTimes?: unknown; lapSession?: unknown }): LapIngestFormValue {
  const laps = normalizeLapTimes(r.lapTimes);
  const manualText = laps.map((n) => n.toFixed(3)).join("\n");
  const raw = r.lapSession;
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (o.version === 1 && o.source && typeof o.source === "object") {
      const src = o.source as Record<string, unknown>;
      const kind = src.kind;
      const sk: LapSourceKind =
        kind === "screenshot" || kind === "url" || kind === "csv" || kind === "manual" ? kind : "manual";
      return {
        manualText,
        sourceKind: sk,
        sourceDetail: typeof src.detail === "string" ? src.detail : null,
        parserId: typeof src.parserId === "string" ? src.parserId : null,
      };
    }
  }
  return {
    manualText,
    sourceKind: "manual",
    sourceDetail: null,
    parserId: null,
  };
}

/** Ensure Things to try behaves like a bullet list (first line starts with `• `). */
function normalizeThingsToTryFromStorage(raw: string): string {
  if (!raw) return "";
  const nl = raw.indexOf("\n");
  const first = nl === -1 ? raw : raw.slice(0, nl);
  const rest = nl === -1 ? "" : raw.slice(nl);
  if (first.startsWith("• ")) return raw;
  return "• " + first.replace(/^\s*•\s?/, "") + rest;
}

export function NewRunForm(props: {
  cars: CarOption[];
  tracks: TrackOption[];
  favouriteTrackIds?: string[];
  favouriteTracks?: TrackOption[];
}) {
  const router = useRouter();
  const cars = props.cars;
  const tracks = props.tracks;
  const favouriteTrackIds = props.favouriteTrackIds ?? [];
  const favouriteTracks = props.favouriteTracks ?? [];

  const [sessionType, setSessionType] = useState<"TESTING" | "RACE_MEETING">("TESTING");
  const [meetingSessionType, setMeetingSessionType] = useState<MeetingSessionType>("PRACTICE");
  const [meetingSessionCustom, setMeetingSessionCustom] = useState<string>(""); // when type is OTHER
  const [carId, setCarId] = useState<string>(cars[0]?.id ?? "");
  const [tracksList, setTracksList] = useState<TrackOption[]>(tracks);
  const [trackId, setTrackId] = useState<string>("");
  const [tireSets, setTireSets] = useState<TireSetOption[]>([]);
  const [tireSetId, setTireSetId] = useState<string>("");
  const [runsCompleted, setRunsCompleted] = useState<number>(0);

  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventId, setEventId] = useState<string>("");
  const [showNewEventPanel, setShowNewEventPanel] = useState(false);
  const [newEventName, setNewEventName] = useState("");
  const [newEventTrackId, setNewEventTrackId] = useState<string>("");
  const [newEventStartDate, setNewEventStartDate] = useState("");
  const [newEventEndDate, setNewEventEndDate] = useState("");
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [eventTrackSwitchPrompt, setEventTrackSwitchPrompt] = useState<{
    eventId: string;
    eventTrackId: string;
    eventTrackName: string;
  } | null>(null);

  const [showAddTrack, setShowAddTrack] = useState(false);
  const [newTrackName, setNewTrackName] = useState("");
  const [newTrackLocation, setNewTrackLocation] = useState("");
  const [addingTrack, setAddingTrack] = useState(false);
  const [trackSearch, setTrackSearch] = useState("");

  const [replicateLast, setReplicateLast] = useState(false);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [replicateLoaded, setReplicateLoaded] = useState(false);

  const [copyPreviewRun, setCopyPreviewRun] = useState<LastRun | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const [setupData, setSetupData] = useState<SetupSnapshotData>({});
  const [lapIngest, setLapIngest] = useState<LapIngestFormValue>(() => defaultLapIngestValue());
  const [notes, setNotes] = useState("");
  const [suggestedChanges, setSuggestedChanges] = useState("");
  const [notesSubTab, setNotesSubTab] = useState<"notes" | "things">("notes");
  const [runDetailsTab, setRunDetailsTab] = useState<"car" | "track" | "tires">("car");
  const thingsTryRef = useRef<HTMLTextAreaElement>(null);
  const thingsTryCursorRef = useRef<number | null>(null);

  const [showNewTireSetPanel, setShowNewTireSetPanel] = useState(false);
  const [creatingTireSet, setCreatingTireSet] = useState(false);
  const [newTireLabel, setNewTireLabel] = useState("");
  const [newTireSetNumber, setNewTireSetNumber] = useState<number>(1);
  const [newTireInitialRunCount, setNewTireInitialRunCount] = useState<number>(0);

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const [copyCarWarning, setCopyCarWarning] = useState<string | null>(null);
  const [copyTrackWarning, setCopyTrackWarning] = useState<string | null>(null);
  const [copyTireWarning, setCopyTireWarning] = useState<string | null>(null);
  const [pickerRuns, setPickerRuns] = useState<RunPickerRun[]>([]);
  const [loadSetupSelection, setLoadSetupSelection] = useState("");
  const [setupSectionExpanded, setSetupSectionExpanded] = useState(false);

  const canSave = useMemo(() => Boolean(carId), [carId]);

  const selectedCar = useMemo(() => cars.find((c) => c.id === carId) ?? null, [cars, carId]);
  const setupTemplate = useMemo(() => {
    if (isA800RRCar(selectedCar?.setupSheetTemplate)) return A800RR_SETUP_SHEET_V1;
    return getDefaultSetupSheetTemplate();
  }, [selectedCar?.setupSheetTemplate]);

  const loadedSetupRun = useMemo(
    () => (loadSetupSelection ? pickerRuns.find((r) => r.id === loadSetupSelection) ?? null : null),
    [loadSetupSelection, pickerRuns]
  );
  const loadSetupControlLabel = loadedSetupRun
    ? formatRunPickerLineRelativeWhen(loadedSetupRun)
    : "Load from past run";

  const needsEvent = sessionType === "RACE_MEETING";

  useEffect(() => {
    let alive = true;
    setCopyStatus(null);
    jsonFetch<{ lastRun: LastRun | null }>("/api/runs/last-any")
      .then(({ lastRun }) => {
        if (!alive) return;
        setCopyPreviewRun(lastRun);
      })
      .catch((err) => {
        if (!alive) return;
        setCopyStatus(err instanceof Error ? err.message : "Failed to load last run");
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    migrateLegacyLoadedSetup();
  }, []);

  useEffect(() => {
    setTracksList(tracks);
  }, [tracks]);

  useEffect(() => {
    let alive = true;
    jsonFetch<{ runs: RunPickerRun[] }>("/api/runs/for-picker")
      .then(({ runs }) => {
        if (!alive) return;
        setPickerRuns(Array.isArray(runs) ? runs : []);
      })
      .catch(() => {
        if (!alive) return;
        setPickerRuns([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  function applyPastSetupOnly(runId: string) {
    if (!runId) {
      setLoadSetupSelection("");
      return;
    }
    const picked = pickerRuns.find((r) => r.id === runId);
    if (!picked) return;
    setLoadSetupSelection(runId);
    const next = normalizeSetupData(picked.setupSnapshot?.data);
    setSetupData(next);
    setActiveSetupData(next);
  }

  useEffect(() => {
    const t = window.setTimeout(() => {
      setActiveSetupData(setupData);
    }, 400);
    return () => window.clearTimeout(t);
  }, [setupData]);

  useLayoutEffect(() => {
    const el = thingsTryRef.current;
    const pos = thingsTryCursorRef.current;
    if (pos != null && el) {
      thingsTryCursorRef.current = null;
      try {
        el.focus();
        el.setSelectionRange(pos, pos);
      } catch {
        /* ignore */
      }
    }
  }, [suggestedChanges]);

  function handleThingsToTryKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return;
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const v = suggestedChanges;
    if (v.length === 0) {
      const insert = "• ";
      thingsTryCursorRef.current = insert.length;
      setSuggestedChanges(insert);
      return;
    }
    const insert = "\n• ";
    const next = v.slice(0, start) + insert + v.slice(end);
    thingsTryCursorRef.current = start + insert.length;
    setSuggestedChanges(next);
  }

  function handleThingsToTryChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const raw = e.target.value;
    if (raw === "") {
      setSuggestedChanges("");
      return;
    }
    const nl = raw.indexOf("\n");
    const firstRaw = nl === -1 ? raw : raw.slice(0, nl);
    const afterFirst = nl === -1 ? "" : raw.slice(nl);
    if (firstRaw.startsWith("• ")) {
      setSuggestedChanges(raw);
      return;
    }
    const fixedFirst = "• " + firstRaw.replace(/^\s*•\s?/, "");
    const next = fixedFirst + afterFirst;
    const delta = fixedFirst.length - firstRaw.length;
    const start = e.target.selectionStart ?? 0;
    const end = e.target.selectionEnd ?? 0;
    const adjust = (pos: number) =>
      pos <= firstRaw.length ? Math.min(pos + delta, fixedFirst.length) : pos + delta;
    thingsTryCursorRef.current = start === end ? adjust(start) : adjust(Math.max(start, end));
    setSuggestedChanges(next);
  }

  useEffect(() => {
    if (!carId) {
      setReplicateLoaded(true);
      return;
    }
    let alive = true;
    setReplicateLoaded(false);
    setStatus(null);

    (async () => {
      try {
        const [{ tireSets }, { lastRun }] = await Promise.all([
          jsonFetch<{ tireSets: TireSetOption[] }>(`/api/tire-sets`),
          jsonFetch<{ lastRun: LastRun | null }>(`/api/runs/last?carId=${carId}`)
        ]);
        if (!alive) return;
        setTireSets(tireSets);
        setLastRun(lastRun);

        if (replicateLast && lastRun) {
          setTrackId(lastRun.trackId ?? "");
          if (lastRun.sessionType === "RACE_MEETING" || lastRun.sessionType === "PRACTICE") {
            setSessionType("RACE_MEETING");
            const sub = lastRun.meetingSessionType as MeetingSessionType | undefined;
            if (sub === "SEEDING" || sub === "QUALIFYING" || sub === "RACE" || sub === "OTHER") setMeetingSessionType(sub);
            else setMeetingSessionType("PRACTICE");
            setMeetingSessionCustom(sub === "OTHER" ? (lastRun.meetingSessionCode?.trim() ?? "") : "");
          } else {
            setSessionType("TESTING");
            setMeetingSessionCustom("");
          }
          const prevEventId = lastRun.eventId ?? "";
          setEventId(prevEventId);
          const prevTireId = lastRun.tireSetId ?? "";
          const validTireId = prevTireId && tireSets.some((ts) => ts.id === prevTireId) ? prevTireId : "";
          setTireSetId(validTireId);
          setRunsCompleted(validTireId ? (lastRun.tireRunNumber ?? 0) : 0);
          const nextSetup = normalizeSetupData(lastRun.setupSnapshot?.data);
          setSetupData(nextSetup);
          setActiveSetupData(nextSetup);
        } else {
          // Keep current form state unless user explicitly copies last run.
        }
      } catch (err) {
        if (!alive) return;
        setStatus(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (alive) setReplicateLoaded(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, [carId, replicateLast]);

  // replicateLast still powers "copy from last run for this car" behavior after the initial copy decision.
  useEffect(() => {
    if (!replicateLast || !lastRun) return;
    setTrackId(lastRun.trackId ?? "");
    if (lastRun.sessionType === "RACE_MEETING" || lastRun.sessionType === "PRACTICE") {
      setSessionType("RACE_MEETING");
      const sub = lastRun.meetingSessionType as MeetingSessionType | undefined;
      if (sub === "SEEDING" || sub === "QUALIFYING" || sub === "RACE" || sub === "OTHER") setMeetingSessionType(sub);
      else setMeetingSessionType("PRACTICE");
      setMeetingSessionCustom(lastRun.meetingSessionType === "OTHER" ? (lastRun.meetingSessionCode?.trim() ?? "") : "");
    } else {
      setSessionType("TESTING");
      setMeetingSessionCustom("");
    }
    setEventId(lastRun.eventId ?? "");
    const prevTireId = lastRun.tireSetId ?? "";
    setTireSetId(prevTireId);
    setRunsCompleted(prevTireId ? (lastRun.tireRunNumber ?? 0) : 0);
    const nextSetup = normalizeSetupData(lastRun.setupSnapshot?.data);
    setSetupData(nextSetup);
    setActiveSetupData(nextSetup);
  }, [replicateLast, lastRun]);

  useEffect(() => {
    if (!needsEvent) return;
    let alive = true;
    jsonFetch<{ events: EventOption[] }>("/api/events")
      .then(({ events: list }) => {
        if (!alive) return;
        const all = list ?? [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const upcoming = all
          .filter((ev) => {
            const start = new Date(ev.startDate);
            start.setHours(0, 0, 0, 0);
            return start >= today;
          })
          .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
        const past = all
          .filter((ev) => {
            const start = new Date(ev.startDate);
            start.setHours(0, 0, 0, 0);
            return start < today;
          })
          .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
        const sorted = [...upcoming, ...past];
        setEvents(sorted);
        setEventId((current) => {
          if (current) return current;
          if (upcoming.length > 0) return upcoming[0].id;
          return "";
        });
      })
      .catch(() => {
        if (!alive) return;
        setEvents([]);
      });
    return () => { alive = false; };
  }, [needsEvent]);

  useEffect(() => {
    if (!showNewEventPanel) return;
    // Make track hard to miss: default new event track to current track selection.
    if (!newEventTrackId) setNewEventTrackId(trackId || "");
  }, [showNewEventPanel]);

  useEffect(() => {
    if (!needsEvent || !eventId) {
      setEventTrackSwitchPrompt(null);
      return;
    }
    const selected = events.find((e) => e.id === eventId) ?? null;
    const evTrackId = selected?.trackId ?? "";
    if (!evTrackId) {
      setEventTrackSwitchPrompt(null);
      return;
    }
    const eventTrackName =
      selected.track?.name ?? tracksList.find((t) => t.id === evTrackId)?.name ?? "event track";
    if (!trackId) {
      setTrackId(evTrackId);
      setEventTrackSwitchPrompt(null);
      return;
    }
    if (trackId === evTrackId) {
      setEventTrackSwitchPrompt(null);
      return;
    }
    setEventTrackSwitchPrompt({
      eventId: selected.id,
      eventTrackId: evTrackId,
      eventTrackName,
    });
  }, [eventId, events, needsEvent, trackId, tracksList]);

  function applyCopyFromPreview() {
    const r = copyPreviewRun;
    if (!r) return;
    const nextCarId = (r.carId || r.car?.id || "").toString();
    if (nextCarId && cars.some((c) => c.id === nextCarId)) {
      setCarId(nextCarId);
      setCopyCarWarning(null);
    } else if (r.car?.name) {
      setCopyCarWarning(`Last run used deleted car: ${r.car.name}. Please select a current car.`);
    } else if (r.carNameSnapshot) {
      setCopyCarWarning(`Last run used deleted car: ${r.carNameSnapshot}. Please select a current car.`);
    } else {
      setCopyCarWarning("Last run car is no longer available. Please select a current car.");
    }

    const nextTrackId = r.trackId || r.track?.id || "";
    if (nextTrackId && tracksList.some((t) => t.id === nextTrackId)) {
      setTrackId(nextTrackId);
      setCopyTrackWarning(null);
    } else if (nextTrackId) {
      setCopyTrackWarning("Track from last run is no longer in the database. You can select another.");
    } else {
      setCopyTrackWarning(null);
    }

    const nextTireId = r.tireSetId || r.tireSet?.id || "";
    if (nextTireId && tireSets.some((ts) => ts.id === nextTireId)) {
      setTireSetId(nextTireId);
      setRunsCompleted(r.tireRunNumber ?? 0);
      setCopyTireWarning(null);
    } else if (r.tireSet?.label) {
      setCopyTireWarning(`Last run used tire set that no longer exists: ${r.tireSet.label}. You can select a current set.`);
    } else {
      setCopyTireWarning(null);
    }

    if (r.sessionType === "RACE_MEETING" || r.sessionType === "PRACTICE") {
      setSessionType("RACE_MEETING");
      const sub = r.meetingSessionType as MeetingSessionType | undefined;
      if (sub === "SEEDING" || sub === "QUALIFYING" || sub === "RACE" || sub === "OTHER") setMeetingSessionType(sub);
      else setMeetingSessionType("PRACTICE");
      setMeetingSessionCustom(r.meetingSessionType === "OTHER" ? (r.meetingSessionCode?.trim() ?? "") : "");
    } else {
      setSessionType("TESTING");
      setMeetingSessionCustom("");
    }
    setEventId(r.eventId ?? "");
    const copied = normalizeSetupData(r.setupSnapshot?.data);
    setSetupData(copied);
    setActiveSetupData(copied);
    setNotes(
      displayRunNotes({
        notes: r.notes,
        driverNotes: r.driverNotes,
        handlingProblems: r.handlingProblems,
      })
    );
    setSuggestedChanges(normalizeThingsToTryFromStorage(r.suggestedChanges?.trim() ?? ""));
    setLapIngest(lapIngestFromRunLike(r));
    setLoadSetupSelection(r.id);
    setReplicateLast(true);
  }

  useEffect(() => {
    if (!tireSetId) return;
    let alive = true;
    jsonFetch<{ lastTireRunNumber: number | null }>(
      `/api/runs/last-tire-run-number?tireSetId=${tireSetId}`
    )
      .then(({ lastTireRunNumber }) => {
        if (!alive) return;
        setRunsCompleted(lastTireRunNumber ?? 0);
      })
      .catch(() => {
        if (!alive) return;
        setRunsCompleted(0);
      });
    return () => {
      alive = false;
    };
  }, [tireSetId]);

  async function createEvent(e?: React.MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    const name = newEventName.trim();
    if (!name) {
      setEventError("Event name is required.");
      return;
    }
    if (!newEventTrackId) {
      setEventError("Select the track for this event.");
      return;
    }
    if (isEndDateBeforeStartDateYmd(newEventStartDate, newEventEndDate)) {
      setEventError("End date must be on or after the start date.");
      return;
    }
    setEventError(null);
    setStatus(null);
    setCreatingEvent(true);
    try {
      const start = newEventStartDate || new Date().toISOString().slice(0, 10);
      const end = newEventEndDate || start;
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          trackId: newEventTrackId || null,
          startDate: start,
          endDate: end,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data as { error?: string })?.error || `Server error (${res.status})`;
        setEventError(msg);
        return;
      }
      const created = (data as { event?: EventOption })?.event;
      if (!created?.id) {
        setEventError("Invalid response: event not returned.");
        return;
      }
      const listRes = await fetch("/api/events");
      const listData = await listRes.json().catch(() => ({}));
      const list = (listData as { events?: EventOption[] })?.events ?? [];
      setEvents(list);
      setEventId(created.id);
      setNewEventName("");
      setNewEventTrackId("");
      setNewEventStartDate("");
      setNewEventEndDate("");
      setShowNewEventPanel(false);
      setStatus("Event created — selected.");
    } catch (err) {
      setEventError(err instanceof Error ? err.message : "Failed to create event");
    } finally {
      setCreatingEvent(false);
    }
  }

  async function createTireSet(e?: React.MouseEvent) {
    e?.preventDefault();
    const label = newTireLabel.trim();
    if (!label) {
      setInlineError("Enter a tire set label (e.g. Sweep 32).");
      return;
    }
    setInlineError(null);
    setStatus(null);
    setCreatingTireSet(true);

    const setNumber = newTireSetNumber >= 1 ? Math.floor(newTireSetNumber) : 1;
    const initialRunCount = newTireInitialRunCount >= 0 ? Math.floor(newTireInitialRunCount) : 0;

    const runCreate = async (): Promise<{ tireSet: TireSetOption }> => {
      const res = await fetch("/api/tire-sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          setNumber,
          initialRunCount,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data as { error?: string })?.error || `Server error (${res.status})`;
        throw new Error(msg);
      }
      const tireSet = (data as { tireSet?: TireSetOption })?.tireSet;
      if (!tireSet?.id) {
        throw new Error("Invalid response: tire set not returned.");
      }
      return { tireSet };
    };

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out (15s). Try again.")), 15000)
    );

    try {
      const { tireSet } = await Promise.race([runCreate(), timeout]);
      setTireSets((prev) => [tireSet, ...prev]);
      setTireSetId(tireSet.id);
      setRunsCompleted(initialRunCount);
      setNewTireLabel("");
      setNewTireSetNumber(1);
      setNewTireInitialRunCount(0);
      setShowNewTireSetPanel(false);
      setStatus("Tire set created — selected.");
      setInlineError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create tire set";
      setStatus(msg);
      setInlineError(msg);
    } finally {
      setCreatingTireSet(false);
    }
  }

  async function saveRun(e?: React.MouseEvent) {
    e?.preventDefault();
    setInlineError(null);
    setStatus(null);
    if (!carId) {
      setInlineError("Select a car.");
      return;
    }
    setSaving(true);
    try {
      const lapTimes = parseLapTimes(lapIngest.manualText);
      const { run } = await jsonFetch<{ run: { id: string; createdAt: string } }>("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carId,
          sessionType: sessionType === "RACE_MEETING" ? "RACE_MEETING" : "TESTING",
          meetingSessionType: needsEvent ? meetingSessionType : null,
          meetingSessionCode: needsEvent && meetingSessionType === "OTHER" && meetingSessionCustom ? meetingSessionCustom.trim() : null,
          eventId: needsEvent ? (eventId || null) : null,
          trackId: trackId || null,
          tireSetId: tireSetId || null,
          tireRunNumber: Math.max(1, runsCompleted + 1),
          setupData,
          lapTimes,
          lapIngestMeta: {
            sourceKind: lapIngest.sourceKind,
            sourceDetail: lapIngest.sourceDetail,
            parserId: lapIngest.parserId,
          },
          notes: notes.trim() || null,
          suggestedChanges: suggestedChanges.trim() || null,
          sessionLabel: null
        })
      });

      setSaveSuccess(true);
      setStatus("Run saved. Redirecting to Analysis…");

      const { lastRun: refreshed } = await jsonFetch<{ lastRun: LastRun | null }>(
        `/api/runs/last?carId=${carId}`
      ).catch(() => ({ lastRun: null }));
      setLastRun(refreshed);
      if (replicateLast && refreshed) {
        setRunsCompleted(refreshed.tireRunNumber ?? 0);
      }

      setTimeout(() => {
        router.push("/runs/history");
      }, 1000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save run";
      setStatus(msg);
      setInlineError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function createTrack(e?: React.MouseEvent) {
    e?.preventDefault();
    const name = newTrackName.trim();
    if (!name) {
      setStatus("Track name is required.");
      return;
    }
    setStatus(null);
    setAddingTrack(true);
    try {
      const { track } = await jsonFetch<{ track: TrackOption }>("/api/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, location: newTrackLocation.trim() || null }),
      });
      setTracksList((prev) => [track, ...prev]);
      setTrackId(track.id);
      setNewTrackName("");
      setNewTrackLocation("");
      setStatus("Track added and selected.");
      setShowAddTrack(false);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to add track");
    } finally {
      setAddingTrack(false);
    }
  }

  return (
    <form
      className="max-w-3xl space-y-4"
      onSubmit={(e) => e.preventDefault()}
      noValidate
    >
      {cars.length === 0 ? (
        <div className="rounded-lg border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
          You need at least one car to log a run. Go to <a href="/cars" className="text-accent underline">Car Manager</a> to create one.
        </div>
      ) : null}

      {/* Copy last run shortcut (optional) */}
      <div className="rounded-lg border border-border bg-secondary/10 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-mono text-muted-foreground">Shortcut</div>
          <button
            type="button"
            className={cn(
              "rounded-md border border-border bg-secondary/30 px-3 py-1.5 text-xs font-semibold hover:bg-secondary/40 transition",
              !copyPreviewRun && "opacity-60 pointer-events-none"
            )}
            onClick={() => {
              applyCopyFromPreview();
              setCopyStatus(null);
            }}
            disabled={!copyPreviewRun}
          >
            Copy last run
          </button>
        </div>
        {copyStatus ? <div className="mt-1 text-[11px] text-muted-foreground">{copyStatus}</div> : null}
        <div className="mt-2 text-[11px] text-muted-foreground">
          {copyPreviewRun ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <span className="text-foreground/90">
                {copyPreviewRun.car?.name ?? copyPreviewRun.carNameSnapshot ?? "Deleted car"}
              </span>
              <span>·</span>
              <span className="text-foreground/90">
                {copyPreviewRun.track?.name ?? copyPreviewRun.trackNameSnapshot ?? "—"}
              </span>
              <span>·</span>
              <span className="text-foreground/90">
                {formatRunSessionDisplay(copyPreviewRun)}
              </span>
              {copyPreviewRun.tireSet ? (
                <>
                  <span>·</span>
                  <span className="text-foreground/90">
                    {copyPreviewRun.tireSet.label}
                    {copyPreviewRun.tireSet.setNumber != null ? ` #${copyPreviewRun.tireSet.setNumber}` : ""}
                  </span>
                </>
              ) : null}
            </div>
          ) : (
            <span>No previous run found yet.</span>
          )}
        </div>
      </div>

      {/* 2. Session type: Testing or Race Meeting only */}
      <div className="rounded-lg border border-border bg-secondary/20 p-4">
        <div className="text-xs font-mono text-muted-foreground mb-2">Session type</div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="sessionType"
              value="TESTING"
              checked={sessionType === "TESTING"}
              onChange={() => setSessionType("TESTING")}
            />
            <span>Testing</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="sessionType"
              value="RACE_MEETING"
              checked={sessionType === "RACE_MEETING"}
              onChange={() => setSessionType("RACE_MEETING")}
            />
            <span>Race Meeting</span>
          </label>
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {sessionType === "TESTING"
            ? "Flexible run-by-run development. No event context."
            : "Tied to an event weekend. Select the event below, then choose track and session details."}
        </div>
      </div>

      {needsEvent ? (
        <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-mono text-muted-foreground">Event / Race meeting</div>
            <button
              type="button"
              className="rounded-md border border-border bg-secondary/30 px-3 py-1.5 text-xs hover:bg-secondary/40 transition"
              onClick={() => {
                setShowNewEventPanel((v) => !v);
                setStatus(null);
                setEventError(null);
              }}
            >
              {showNewEventPanel ? "Cancel" : "New event"}
            </button>
          </div>

          <select
            className="w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm outline-none"
            value={eventId}
            onChange={(e) => {
              setEventId(e.target.value);
              setEventError(null);
            }}
            aria-label="Event"
          >
            <option value="">— Select event</option>
            {(() => {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const upcoming = events
                .filter((ev) => {
                  const start = new Date(ev.startDate);
                  start.setHours(0, 0, 0, 0);
                  return start >= today;
                })
                .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
              const past = events
                .filter((ev) => {
                  const start = new Date(ev.startDate);
                  start.setHours(0, 0, 0, 0);
                  return start < today;
                })
                .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
              return (
                <>
                  {upcoming.length > 0 && (
                    <optgroup label="Upcoming">
                      {upcoming.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.name} · {formatEventDate(ev.startDate)} · {formatEventRelativeLabel(ev)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {past.length > 0 && (
                    <optgroup label="Past">
                      {past.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.name} · {formatEventDate(ev.startDate)} · {formatEventRelativeLabel(ev)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </>
              );
            })()}
          </select>

          {eventTrackSwitchPrompt && eventTrackSwitchPrompt.eventId === eventId && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
              <span className="text-foreground">
                Event is at {eventTrackSwitchPrompt.eventTrackName}. Switch track to match event?
              </span>
              <button
                type="button"
                className="rounded bg-amber-600 px-2 py-1 font-medium text-amber-950 hover:bg-amber-500"
                onClick={() => {
                  setTrackId(eventTrackSwitchPrompt.eventTrackId);
                  setEventTrackSwitchPrompt(null);
                }}
              >
                Switch
              </button>
              <button
                type="button"
                className="rounded border border-border bg-secondary/40 px-2 py-1 hover:bg-secondary/60"
                onClick={() => setEventTrackSwitchPrompt(null)}
              >
                Keep
              </button>
            </div>
          )}

          {eventError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-foreground">
              {eventError}
            </div>
          )}

          {showNewEventPanel && (
            <div className="rounded-md border border-border bg-secondary/15 p-3 space-y-2">
              <div className="rounded-md border border-border bg-secondary/10 p-2">
                <div className="text-[11px] font-mono text-muted-foreground mb-1">Track (required)</div>
                <select
                  className="w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm outline-none"
                  value={newEventTrackId}
                  onChange={(e) => {
                    setNewEventTrackId(e.target.value);
                    setEventError(null);
                  }}
                  aria-label="Event track"
                >
                  <option value="">— Select track</option>
                  {tracksList.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.location ? ` (${t.location})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <input
                className="w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm outline-none"
                placeholder="Event name (e.g. TITC 2026)"
                value={newEventName}
                onChange={(e) => setNewEventName(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm outline-none"
                  value={newEventStartDate}
                  onChange={(e) => {
                    setNewEventStartDate(e.target.value);
                    setEventError(null);
                  }}
                  placeholder="Start date"
                />
                <input
                  type="date"
                  className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm outline-none"
                  value={newEventEndDate}
                  onChange={(e) => {
                    setNewEventEndDate(e.target.value);
                    setEventError(null);
                  }}
                  placeholder="End date"
                />
              </div>
              {isEndDateBeforeStartDateYmd(newEventStartDate, newEventEndDate) ? (
                <p className="text-[11px] text-destructive">
                  End date must be on or after the start date.
                </p>
              ) : null}
              <button
                type="button"
                disabled={
                  creatingEvent ||
                  !newEventName.trim() ||
                  !newEventTrackId ||
                  isEndDateBeforeStartDateYmd(newEventStartDate, newEventEndDate)
                }
                className={cn(
                  "rounded-md bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground hover:brightness-110 transition",
                  (creatingEvent ||
                    !newEventName.trim() ||
                    !newEventTrackId ||
                    isEndDateBeforeStartDateYmd(newEventStartDate, newEventEndDate)) &&
                    "opacity-60 pointer-events-none"
                )}
                onClick={(e) => createEvent(e)}
              >
                {creatingEvent ? "Creating…" : "Create event"}
              </button>
            </div>
          )}

          <div className="rounded-lg border border-border bg-secondary/15 p-3 space-y-3">
            <div className="text-xs font-mono text-muted-foreground">Session</div>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1">
                <label className="block text-[11px] text-muted-foreground">Type</label>
                <select
                  className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm outline-none"
                  value={meetingSessionType}
                  onChange={(e) => {
                    setMeetingSessionType(e.target.value as MeetingSessionType);
                    if (e.target.value !== "OTHER") setMeetingSessionCustom("");
                  }}
                  aria-label="Meeting session type"
                >
                  <option value="PRACTICE">Practice</option>
                  <option value="SEEDING">Seeding</option>
                  <option value="QUALIFYING">Qualifying</option>
                  <option value="RACE">Race</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              {meetingSessionType === "OTHER" && (
                <div className="space-y-1">
                  <label className="block text-[11px] text-muted-foreground">Custom session type</label>
                  <input
                    type="text"
                    className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm outline-none min-w-[140px]"
                    placeholder="e.g. Warm-up"
                    value={meetingSessionCustom}
                    onChange={(e) => setMeetingSessionCustom(e.target.value)}
                    aria-label="Custom session type"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-secondary/10 p-4 space-y-3">
        <div className="text-xs font-mono text-muted-foreground">Run details</div>
        <div
          className="flex flex-wrap border-b border-border gap-x-0.5"
          role="tablist"
          aria-label="Run details sections"
        >
          <button
            type="button"
            role="tab"
            aria-selected={runDetailsTab === "car"}
            className={cn(
              "px-3 sm:px-4 py-2 text-xs font-medium transition border-b-2 -mb-px",
              runDetailsTab === "car"
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setRunDetailsTab("car")}
          >
            Car
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={runDetailsTab === "track"}
            className={cn(
              "px-3 sm:px-4 py-2 text-xs font-medium transition border-b-2 -mb-px",
              runDetailsTab === "track"
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setRunDetailsTab("track")}
          >
            Track
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={runDetailsTab === "tires"}
            className={cn(
              "px-3 sm:px-4 py-2 text-xs font-medium transition border-b-2 -mb-px",
              runDetailsTab === "tires"
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setRunDetailsTab("tires")}
          >
            Tires
          </button>
        </div>

        {runDetailsTab === "car" ? (
          <div className="space-y-3 pt-1">
            <div className="space-y-1 text-sm">
              <div className="text-xs font-mono text-muted-foreground">Car</div>
              <select
                className="w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm outline-none"
                value={carId}
                onChange={(e) => {
                  setCarId(e.target.value);
                  setCopyCarWarning(null);
                }}
                aria-label="Car"
              >
                {cars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {copyCarWarning && (
                <div className="text-[11px] text-destructive mt-1">{copyCarWarning}</div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Drives setup sheet template, tire set list, and last-run defaults for this vehicle.
            </p>
          </div>
        ) : null}

        {runDetailsTab === "track" ? (
          <div className="space-y-4 pt-1">
            <div className="space-y-1 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-mono text-muted-foreground">Track</div>
                <button
                  type="button"
                  className="rounded-md border border-border bg-secondary/30 px-2 py-1 text-[11px] hover:bg-secondary/40 transition"
                  onClick={() => {
                    setShowAddTrack((v) => !v);
                    setStatus(null);
                  }}
                >
                  {showAddTrack ? "Cancel" : "Add track"}
                </button>
              </div>
              <TrackCombobox
                tracks={tracksList}
                value={trackId}
                onChange={(id) => {
                  setTrackId(id);
                  setCopyTrackWarning(null);
                }}
                lastRunTrackId={lastRun?.trackId ?? null}
                favouriteTrackIds={favouriteTrackIds}
                favouriteTracks={favouriteTracks}
                placeholder="Search or select track"
                aria-label="Track"
              />
              {needsEvent && eventId && trackId &&
                (() => {
                  const ev = events.find((e) => e.id === eventId);
                  if (!ev?.trackId || ev.trackId === trackId) return null;
                  return (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                      Track does not match selected event.
                    </p>
                  );
                })()}
            </div>
            {copyTrackWarning && (
              <div className="text-[11px] text-muted-foreground">{copyTrackWarning}</div>
            )}

            {showAddTrack && (
              <div className="rounded-md border border-border bg-secondary/15 p-3 space-y-2">
                <input
                  className="w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm outline-none"
                  placeholder="Track name"
                  value={newTrackName}
                  onChange={(e) => setNewTrackName(e.target.value)}
                />
                <input
                  className="w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm outline-none"
                  placeholder="Location (optional)"
                  value={newTrackLocation}
                  onChange={(e) => setNewTrackLocation(e.target.value)}
                />
                <button
                  type="button"
                  disabled={addingTrack || !newTrackName.trim()}
                  className={cn(
                    "rounded-md bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground hover:brightness-110 transition",
                    (addingTrack || !newTrackName.trim()) && "opacity-60 pointer-events-none"
                  )}
                  onClick={(e) => createTrack(e)}
                >
                  {addingTrack ? "Adding…" : "Add track"}
                </button>
              </div>
            )}
          </div>
        ) : null}

        {runDetailsTab === "tires" ? (
          <div className="space-y-4 pt-1">
            <div className="space-y-2 text-sm">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-xs font-mono text-muted-foreground">Tire set</div>
                  <div className="text-[11px] text-muted-foreground">Optional.</div>
                </div>
                <button
                  type="button"
                  className="rounded-md border border-border bg-secondary/30 px-3 py-1.5 text-xs hover:bg-secondary/40 transition"
                  onClick={() => {
                    setShowNewTireSetPanel((v) => !v);
                    setInlineError(null);
                  }}
                >
                  {showNewTireSetPanel ? "Cancel" : "New tire set"}
                </button>
              </div>
              <select
                className="w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm outline-none"
                value={tireSetId}
                onChange={(e) => {
                  setTireSetId(e.target.value);
                  setCopyTireWarning(null);
                }}
                aria-label="Tire set"
              >
                <option value="">—</option>
                {tireSets.map((ts) => (
                  <option key={ts.id} value={ts.id}>
                    {ts.label}
                    {ts.setNumber != null ? ` #${ts.setNumber}` : ""}
                  </option>
                ))}
              </select>
              {copyTireWarning && (
                <div className="text-[11px] text-muted-foreground mt-1">{copyTireWarning}</div>
              )}
            </div>

            {showNewTireSetPanel && (
              <div className="rounded-md border border-border bg-secondary/15 p-3 space-y-3">
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm outline-none"
                    placeholder="Label (brand + compound, e.g. Sweep 32)"
                    value={newTireLabel}
                    onChange={(e) => setNewTireLabel(e.target.value)}
                    aria-label="Tire set label"
                  />
                  <input
                    type="number"
                    min={1}
                    className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm outline-none"
                    placeholder="Set number"
                    value={newTireSetNumber}
                    onChange={(e) => setNewTireSetNumber(Number(e.target.value) || 1)}
                    aria-label="Set number"
                  />
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="text-[11px] text-muted-foreground">
                    Label: Brand + compound (e.g. Sweep 32)
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Set number: Physical tire set number (e.g. 1, 2, 3)
                  </div>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="text-xs font-mono text-muted-foreground">How many runs have these tires done?</div>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm outline-none"
                    inputMode="numeric"
                    value={newTireInitialRunCount}
                    onChange={(e) =>
                      setNewTireInitialRunCount(Math.max(0, Math.floor(Number(e.target.value) || 0)))
                    }
                    aria-label="How many runs have these tires done"
                  />
                  <div className="text-[11px] text-muted-foreground">
                    {newTireInitialRunCount === 0
                      ? "0 runs on this set before this log."
                      : newTireInitialRunCount === 1
                        ? "1 run on this set before this log."
                        : `${newTireInitialRunCount} runs on this set before this log.`}{" "}
                    Your next save will be run #{newTireInitialRunCount + 1}.
                  </div>
                </div>
                <button
                  type="button"
                  className={cn(
                    "rounded-md bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground hover:brightness-110 transition",
                    (!newTireLabel.trim() || creatingTireSet) && "opacity-60 pointer-events-none"
                  )}
                  onClick={(e) => createTireSet(e)}
                  disabled={!newTireLabel.trim() || creatingTireSet}
                >
                  {creatingTireSet ? "Adding…" : "Add tire set"}
                </button>
              </div>
            )}

            {!showNewTireSetPanel && tireSetId ? (
              <div className="space-y-1 text-sm">
                <div className="text-xs font-mono text-muted-foreground">How many runs have these tires done?</div>
                <input
                  type="number"
                  min={0}
                  className="w-full max-w-md rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm outline-none"
                  inputMode="numeric"
                  value={runsCompleted}
                  onChange={(e) => setRunsCompleted(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                  aria-label="Runs completed on this tire set"
                />
                <div className="text-[11px] text-muted-foreground">
                  {runsCompleted === 0 ? "0 runs" : runsCompleted === 1 ? "1 run" : `${runsCompleted} runs`}{" "}
                  completed on this set. This run will be run #{runsCompleted + 1}.
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <LapTimesIngestPanel value={lapIngest} onChange={setLapIngest} />

      <div className="space-y-2 text-sm">
        <div className="text-xs font-mono text-muted-foreground">Notes</div>
        <div className="flex border-b border-border" role="tablist" aria-label="Notes and things to try">
          <button
            type="button"
            role="tab"
            aria-selected={notesSubTab === "notes"}
            className={cn(
              "px-4 py-2 text-xs font-medium transition border-b-2 -mb-px",
              notesSubTab === "notes"
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setNotesSubTab("notes")}
          >
            Notes
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={notesSubTab === "things"}
            className={cn(
              "px-4 py-2 text-xs font-medium transition border-b-2 -mb-px",
              notesSubTab === "things"
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setNotesSubTab("things")}
          >
            Things to try
          </button>
        </div>
        {notesSubTab === "notes" ? (
          <textarea
            className="h-32 w-full resize-none rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm outline-none"
            placeholder="Session notes, handling, track conditions…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-label="Session notes"
          />
        ) : (
          <textarea
            ref={thingsTryRef}
            className="h-32 w-full resize-none rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm outline-none"
            placeholder="First character becomes a bullet line. Enter: new • line. Shift+Enter: line break inside an item."
            value={suggestedChanges}
            onChange={handleThingsToTryChange}
            onKeyDown={handleThingsToTryKeyDown}
            aria-label="Things to try"
          />
        )}
      </div>

      <div className="rounded-lg border border-border bg-secondary/10 p-4 space-y-4">
        <div className="text-xs font-mono text-muted-foreground">Setup</div>
        {!setupSectionExpanded ? (
          <div className="space-y-3">
            <p className="text-sm text-foreground">Log / edit your setup?</p>
            <div className="flex flex-col gap-3 max-w-2xl">
              <RunPickerSelect
                label={loadSetupControlLabel}
                runs={pickerRuns}
                value={loadSetupSelection}
                onChange={applyPastSetupOnly}
                placeholder="Choose a run…"
                disabled={pickerRuns.length === 0}
                formatLine={formatRunPickerLineRelativeWhen}
              />
              <button
                type="button"
                onClick={() => setSetupSectionExpanded(true)}
                className="self-start rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary/40 hover:text-foreground transition"
              >
                Edit setup
              </button>
            </div>
            {pickerRuns.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No past runs yet, or list failed to load.</p>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">
                One snapshot per run. Synced with Setup page and Current setup in compare.
              </p>
              <button
                type="button"
                onClick={() => setSetupSectionExpanded(false)}
                className="rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground transition"
              >
                Collapse
              </button>
            </div>
            <div className="max-w-2xl">
              <RunPickerSelect
                label={loadSetupControlLabel}
                runs={pickerRuns}
                value={loadSetupSelection}
                onChange={applyPastSetupOnly}
                placeholder="Choose a run…"
                disabled={pickerRuns.length === 0}
                formatLine={formatRunPickerLineRelativeWhen}
              />
            </div>
            <SetupSheetView value={setupData} onChange={setSetupData} template={setupTemplate} />
            {pickerRuns.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No past runs yet, or list failed to load.</p>
            ) : null}
          </>
        )}
      </div>

      {inlineError ? (
        <div className="rounded-md border border-border bg-destructive/10 px-3 py-2 text-xs text-foreground">
          {inlineError}
        </div>
      ) : null}
      {status ? (
        <div
          className={cn(
            "text-xs",
            saveSuccess ? "text-accent font-medium" : "text-muted-foreground"
          )}
        >
          {status}
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:brightness-110 transition",
            (!canSave || saving) && "opacity-70 pointer-events-none"
          )}
          onClick={(e) => saveRun(e)}
          disabled={!canSave || saving}
          aria-busy={saving}
        >
          {saving ? "Saving…" : saveSuccess ? "Saved" : "Save run"}
        </button>
      </div>
    </form>
  );
}

