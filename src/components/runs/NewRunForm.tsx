"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DashboardNewRunPrefill } from "@/lib/dashboardPrefillTypes";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { coerceSetupValue, normalizeSetupData, parseLapTimes, type SetupSnapshotData } from "@/lib/runSetup";
import { applyDerivedFieldsToSnapshot } from "@/lib/setup/deriveRenderValues";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import { getDefaultSetupSheetTemplate } from "@/lib/setupSheetTemplate";
import { isA800RRCar } from "@/lib/setupSheetTemplateId";
import { TrackCombobox } from "@/components/runs/TrackCombobox";
import { formatEventDate, formatEventRelativeLabel, formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { type MeetingSessionType } from "@/lib/runSession";
import { setActiveSetupData, migrateLegacyLoadedSetup } from "@/lib/activeSetupContext";
import type { RunPickerRun } from "@/lib/runPickerFormat";
import { formatRunListScanLine, formatRunPickerLineRelativeWhen } from "@/lib/runPickerFormat";
import { RunPickerSelect } from "@/components/runs/RunPickerSelect";
import { isEndDateBeforeStartDateYmd } from "@/lib/eventDateValidation";
import { normalizeLapTimes } from "@/lib/runLaps";
import { primaryLapRowsFromImportedPayload, sessionCompletedAtIsoFromImportedPayload } from "@/lib/lapImport/fromPayload";
import { resolveImportedSessionLabelTimeIso } from "@/lib/lapImport/labels";
import {
  LapTimesIngestPanel,
  defaultLapIngestValue,
  type LapIngestFormValue,
} from "@/components/runs/LapTimesIngestPanel";

type CarOption = { id: string; name: string; setupSheetTemplate?: string | null };
type TrackOption = { id: string; name: string; location?: string | null };
type TireSetOption = { id: string; label: string; setNumber?: number; initialRunCount?: number };
type BatteryPackOption = { id: string; label: string; packNumber?: number; initialRunCount?: number };

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
  sessionLabel?: string | null;
  sessionType?: "TESTING" | "PRACTICE" | "RACE_MEETING";
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  carId?: string;
  car?: { id: string; name: string } | null;
  carNameSnapshot?: string | null;
  trackId: string | null;
  trackNameSnapshot?: string | null;
  eventId: string | null;
  tireSetId: string | null;
  tireRunNumber: number;
  setupSnapshot: { id: string; data: unknown };
  event?: EventOption | null;
  track?: { id: string; name: string } | null;
  tireSet?: { id: string; label: string; setNumber?: number | null } | null;
  batteryId?: string | null;
  batteryRunNumber?: number;
  battery?: { id: string; label: string; packNumber?: number | null } | null;
  notes?: string | null;
  driverNotes?: string | null;
  handlingProblems?: string | null;
  suggestedChanges?: string | null;
  lapTimes?: unknown;
  lapSession?: unknown;
};

type DownloadedSetupOption = {
  id: string;
  originalFilename: string;
  createdAt: string;
  setupData: unknown;
  baselineSetupSnapshotId?: string | null;
  /** Car this snapshot belongs to (null = legacy / unknown). */
  carId?: string | null;
};

function copyPreviewRunToPickerRun(r: LastRun): RunPickerRun {
  return {
    id: r.id,
    createdAt: r.createdAt,
    sessionLabel: r.sessionLabel ?? null,
    sessionType: r.sessionType ?? "TESTING",
    meetingSessionType: r.meetingSessionType,
    meetingSessionCode: r.meetingSessionCode,
    eventId: r.eventId,
    event: r.event ? { name: r.event.name } : null,
    car: r.car ? { name: r.car.name } : null,
    carNameSnapshot: r.carNameSnapshot ?? null,
    track: r.track ? { name: r.track.name } : null,
    trackNameSnapshot: r.trackNameSnapshot ?? null,
    lapTimes: r.lapTimes ?? [],
    setupSnapshot: r.setupSnapshot,
  };
}

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

/** Ensure Things to try behaves like a bullet list (first line starts with `• `). */
function normalizeThingsToTryFromStorage(raw: string): string {
  if (!raw) return "";
  const nl = raw.indexOf("\n");
  const first = nl === -1 ? raw : raw.slice(0, nl);
  const rest = nl === -1 ? "" : raw.slice(nl);
  if (first.startsWith("• ")) return raw;
  return "• " + first.replace(/^\s*•\s?/, "") + rest;
}

function setupSnapshotWithDerived(raw: unknown): SetupSnapshotData {
  return applyDerivedFieldsToSnapshot(normalizeSetupData(raw));
}

export function NewRunForm(props: {
  cars: CarOption[];
  tracks: TrackOption[];
  favouriteTrackIds?: string[];
  favouriteTracks?: TrackOption[];
  dashboardPrefill?: DashboardNewRunPrefill | null;
  /** When set, the form edits an existing run (owner-only enforced by server update route). */
  editRun?: LastRun | null;
}) {
  const router = useRouter();
  const cars = props.cars;
  const tracks = props.tracks;
  const favouriteTrackIds = props.favouriteTrackIds ?? [];
  const favouriteTracks = props.favouriteTracks ?? [];
  const dashboardPrefill = props.dashboardPrefill ?? null;

  const [sessionType, setSessionType] = useState<"TESTING" | "RACE_MEETING">("TESTING");
  const [meetingSessionType, setMeetingSessionType] = useState<MeetingSessionType>("PRACTICE");
  const [meetingSessionCustom, setMeetingSessionCustom] = useState<string>(""); // when type is OTHER
  const [carId, setCarId] = useState<string>(cars[0]?.id ?? "");
  const [tracksList, setTracksList] = useState<TrackOption[]>(tracks);
  const [trackId, setTrackId] = useState<string>("");
  const [tireSets, setTireSets] = useState<TireSetOption[]>([]);
  const [tireSetId, setTireSetId] = useState<string>("");
  const [runsCompleted, setRunsCompleted] = useState<number>(0);
  const [batteries, setBatteries] = useState<BatteryPackOption[]>([]);
  const [batteryId, setBatteryId] = useState<string>("");
  const [batteryRunsCompleted, setBatteryRunsCompleted] = useState<number>(0);

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
  /** Baseline SetupSnapshot id for server merge + audit (null = scratch / no prior snapshot). */
  const [setupBaselineSnapshotId, setSetupBaselineSnapshotId] = useState<string | null>(null);
  const [lapIngest, setLapIngest] = useState<LapIngestFormValue>(() => defaultLapIngestValue());
  const [notes, setNotes] = useState("");
  const [suggestedChanges, setSuggestedChanges] = useState("");
  const [setupChangesText, setSetupChangesText] = useState("");
  const [setupChangesBusy, setSetupChangesBusy] = useState(false);
  const [setupChangesError, setSetupChangesError] = useState<string | null>(null);
  const [setupChangesProposal, setSetupChangesProposal] = useState<
    Array<{ fieldKey: string; fieldLabel: string; fromValue: string; toValue: string; confidence: "low" | "medium" | "high"; note?: string | null }>
  >([]);
  const [notesSubTab, setNotesSubTab] = useState<"notes" | "things">("notes");
  const [runDetailsTab, setRunDetailsTab] = useState<"car" | "track" | "tires">("car");
  const thingsTryRef = useRef<HTMLTextAreaElement>(null);
  const thingsTryCursorRef = useRef<number | null>(null);
  /** True after user edits “Things to try”; avoids syncing (or wiping) on initial API hydrate. */
  const thingsToTryDirtyRef = useRef(false);

  const [showNewTireSetPanel, setShowNewTireSetPanel] = useState(false);
  const [creatingTireSet, setCreatingTireSet] = useState(false);
  const [newTireLabel, setNewTireLabel] = useState("");
  const [newTireSetNumber, setNewTireSetNumber] = useState<number>(1);
  const [newTireInitialRunCount, setNewTireInitialRunCount] = useState<number>(0);

  const [showNewBatteryPanel, setShowNewBatteryPanel] = useState(false);
  const [creatingBattery, setCreatingBattery] = useState(false);
  const [newBatteryLabel, setNewBatteryLabel] = useState("");
  const [newBatteryPackNumber, setNewBatteryPackNumber] = useState<number>(1);
  const [newBatteryInitialRunCount, setNewBatteryInitialRunCount] = useState<number>(0);

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const [copyCarWarning, setCopyCarWarning] = useState<string | null>(null);
  const [copyTrackWarning, setCopyTrackWarning] = useState<string | null>(null);
  const [copyTireWarning, setCopyTireWarning] = useState<string | null>(null);
  const [copyBatteryWarning, setCopyBatteryWarning] = useState<string | null>(null);
  const [pickerRuns, setPickerRuns] = useState<RunPickerRun[]>([]);
  const [loadSetupSelection, setLoadSetupSelection] = useState("");
  const [loadOtherSetupSelection, setLoadOtherSetupSelection] = useState("");
  const [setupSource, setSetupSource] = useState<"previous_runs" | "other">("previous_runs");
  const [otherSetupSource, setOtherSetupSource] = useState<"downloaded_setups">("downloaded_setups");
  const [downloadedSetups, setDownloadedSetups] = useState<DownloadedSetupOption[]>([]);
  const [setupSectionExpanded, setSetupSectionExpanded] = useState(false);

  const tireSetIdRef = useRef(tireSetId);
  tireSetIdRef.current = tireSetId;
  const batteryIdRef = useRef(batteryId);
  batteryIdRef.current = batteryId;
  const tireRunUserTouchedRef = useRef(false);
  const batteryRunUserTouchedRef = useRef(false);

  const canSave = useMemo(() => Boolean(carId), [carId]);
  const editRun = props.editRun ?? null;
  const isEditing = Boolean(editRun?.id);

  const dashboardPrefillAppliedRef = useRef(false);
  const editPrefillAppliedRef = useRef(false);

  useEffect(() => {
    const p = dashboardPrefill;
    if (!p || dashboardPrefillAppliedRef.current) return;
    dashboardPrefillAppliedRef.current = true;

    if (p.mode === "imported_lap_session") {
      const sess = p.importedLapTimeSession;
      const parsed = primaryLapRowsFromImportedPayload(sess.parsedPayload);
      if (parsed) {
        const laps = parsed.rows.map((r) => r.lapTimeSeconds);
        const whenIso = resolveImportedSessionLabelTimeIso(
          sess.sessionCompletedAtIso ?? null,
          sessionCompletedAtIsoFromImportedPayload(sess.parsedPayload),
          new Date().toISOString()
        );
        setLapIngest({
          ...defaultLapIngestValue(),
          manualText: laps.map((n) => n.toFixed(3)).join("\n"),
          sourceKind: "url",
          sourceDetail: sess.sourceUrl,
          parserId: sess.parserId,
          urlLapRows: null,
          urlImportBlocks: [
            {
              blockId: crypto.randomUUID(),
              importedSessionId: sess.id,
              sourceUrl: sess.sourceUrl,
              parserId: sess.parserId,
              recordedAt: new Date().toISOString(),
              sessionCompletedAtIso: whenIso,
              sessionDrivers: [
                {
                  id: "prefill",
                  driverId: "prefill",
                  driverName: parsed.driverName,
                  normalizedName: parsed.driverName.toLowerCase(),
                  laps,
                  lapCount: laps.length,
                },
              ],
              selectedDriverIds: ["prefill"],
              driverLapRowsByDriverId: {
                prefill: parsed.rows,
              },
              urlLapRows: null,
            },
          ],
        });
        setSetupSectionExpanded(true);
      }
      return;
    }

    if (p.mode === "first") {
      setSessionType("RACE_MEETING");
      setEventId(p.eventId);
      if (p.trackId) setTrackId(p.trackId);
      return;
    }

    const r = p.run;
    const nextCarId = (r.carId || r.car?.id || "").toString();
    if (nextCarId && cars.some((c) => c.id === nextCarId)) {
      setCarId(nextCarId);
    }

    setTrackId(r.trackId ?? "");

    if (r.sessionType === "RACE_MEETING" || r.sessionType === "PRACTICE") {
      setSessionType("RACE_MEETING");
      const sub = r.meetingSessionType as MeetingSessionType | undefined;
      if (sub === "SEEDING" || sub === "QUALIFYING" || sub === "RACE" || sub === "OTHER") {
        setMeetingSessionType(sub);
      } else {
        setMeetingSessionType("PRACTICE");
      }
      setMeetingSessionCustom(sub === "OTHER" ? (r.meetingSessionCode?.trim() ?? "") : "");
    } else {
      setSessionType("TESTING");
      setMeetingSessionCustom("");
    }

    setEventId(r.eventId ?? "");
    setTireSetId(r.tireSetId ?? "");
    setRunsCompleted(r.tireRunNumber ?? 0);
    setBatteryId(r.batteryId ?? "");
    setBatteryRunsCompleted(r.batteryRunNumber ?? 0);

    const nextSetup = setupSnapshotWithDerived(r.setupSnapshot?.data);
    setSetupData(nextSetup);
    setActiveSetupData(nextSetup, nextCarId || carId || null);
    setSetupBaselineSnapshotId(r.setupSnapshot?.id ?? null);
    setNotes("");
    setLapIngest(defaultLapIngestValue());
    setReplicateLast(false);
  }, [dashboardPrefill, cars]);

  function applyTireBatteryToSetupSnapshot(nextTireSetId: string, nextBatteryId: string) {
    const tire = nextTireSetId ? tireSets.find((t) => t.id === nextTireSetId) ?? null : null;
    const bat = nextBatteryId ? batteries.find((b) => b.id === nextBatteryId) ?? null : null;
    const tireLabel = tire ? `${tire.label}${tire.setNumber != null ? ` #${tire.setNumber}` : ""}` : "";
    const batLabel = bat ? `${bat.label}${bat.packNumber != null ? ` #${bat.packNumber}` : ""}` : "";
    setSetupData((prev) =>
      prev.tires === (tireLabel || undefined) && prev.battery === (batLabel || undefined)
        ? prev
        : applyDerivedFieldsToSnapshot({
            ...prev,
            tires: tireLabel || undefined,
            battery: batLabel || undefined,
          })
    );
  }

  // Deterministic sync: snapshot tires/battery always mirror the run context selections,
  // including on initial load and when option lists arrive async.
  useEffect(() => {
    applyTireBatteryToSetupSnapshot(tireSetId, batteryId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tireSetId, batteryId, tireSets, batteries]);

  useEffect(() => {
    const r = editRun;
    if (!r || editPrefillAppliedRef.current) return;
    editPrefillAppliedRef.current = true;

    const nextCarId = (r.carId || r.car?.id || "").toString();
    if (nextCarId && cars.some((c) => c.id === nextCarId)) {
      setCarId(nextCarId);
    }
    setTrackId(r.trackId ?? "");

    if (r.sessionType === "RACE_MEETING" || r.sessionType === "PRACTICE") {
      setSessionType("RACE_MEETING");
      const sub = r.meetingSessionType as MeetingSessionType | undefined;
      if (sub === "SEEDING" || sub === "QUALIFYING" || sub === "RACE" || sub === "OTHER") {
        setMeetingSessionType(sub);
      } else {
        setMeetingSessionType("PRACTICE");
      }
      setMeetingSessionCustom(sub === "OTHER" ? (r.meetingSessionCode?.trim() ?? "") : "");
    } else {
      setSessionType("TESTING");
      setMeetingSessionCustom("");
    }

    setEventId(r.eventId ?? "");
    setTireSetId(r.tireSetId ?? "");
    setRunsCompleted(r.tireRunNumber ?? 0);
    setBatteryId(r.batteryId ?? "");
    setBatteryRunsCompleted(r.batteryRunNumber ?? 0);

    const nextSetup = setupSnapshotWithDerived(r.setupSnapshot?.data);
    setSetupData(nextSetup);
    setActiveSetupData(nextSetup, nextCarId || carId || null);
    setSetupBaselineSnapshotId(r.setupSnapshot?.id ?? null);

    setNotes((r.notes ?? "").trim());
    setSuggestedChanges((r.suggestedChanges ?? "").trim());

    const existingLaps = normalizeLapTimes(r.lapTimes ?? []);
    const existingText = existingLaps.length ? existingLaps.map((n) => n.toFixed(3)).join("\n") : "";
    setLapIngest({
      ...defaultLapIngestValue(),
      manualText: existingText,
      sourceKind: existingText ? "manual" : "manual",
      sourceDetail: r.lapSession ? "Existing laps loaded (edit)" : null,
      parserId: null,
      urlLapRows: null,
      urlImportBlocks: [],
    });

    setReplicateLast(false);
    setSetupSectionExpanded(true);
  }, [editRun, cars]);

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
  const selectedDownloadedSetup = useMemo(
    () => (loadOtherSetupSelection ? downloadedSetups.find((d) => d.id === loadOtherSetupSelection) ?? null : null),
    [loadOtherSetupSelection, downloadedSetups]
  );
  const loadOtherSetupLabel = selectedDownloadedSetup
    ? `${selectedDownloadedSetup.originalFilename} · ${formatRunCreatedAtDateTime(selectedDownloadedSetup.createdAt)}`
    : "Load from downloaded setup";

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

  /** Same list as dashboard: ActionItem rows → textarea (order matches GET /api/action-items). */
  useEffect(() => {
    let alive = true;
    jsonFetch<{ items: Array<{ id: string; text: string }> }>("/api/action-items")
      .then(({ items }) => {
        if (!alive) return;
        if (isEditing && suggestedChanges.trim().length > 0) return;
        const lines = (items ?? []).map((i) => `• ${i.text.trim()}`).filter((l) => l.length > 2);
        setSuggestedChanges(lines.length ? normalizeThingsToTryFromStorage(lines.join("\n")) : "");
      })
      .catch(() => {
        if (!alive) return;
      });
    return () => {
      alive = false;
    };
  }, []);

  /** Authoritative list for run + event track pickers (matches /events and DB; avoids stale RSC-only props). */
  const tracksFingerprint = useMemo(() => tracks.map((t) => t.id).sort().join(","), [tracks]);
  useEffect(() => {
    let alive = true;
    jsonFetch<{ tracks: TrackOption[] }>("/api/tracks")
      .then(({ tracks: list }) => {
        if (!alive || !Array.isArray(list)) return;
        setTracksList(list);
      })
      .catch(() => {
        if (!alive) return;
      });
    return () => {
      alive = false;
    };
  }, [tracksFingerprint]);

  /** Persist bullets to ActionItem rows while typing (dashboard uses same table). */
  useEffect(() => {
    if (!thingsToTryDirtyRef.current) return;
    const t = window.setTimeout(() => {
      if (!thingsToTryDirtyRef.current) return;
      void fetch("/api/action-items/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestedChanges }),
      })
        .then((res) => {
          if (res.ok) thingsToTryDirtyRef.current = false;
        })
        .catch(() => {
          /* keep dirty for retry on next edit */
        });
    }, 900);
    return () => window.clearTimeout(t);
  }, [suggestedChanges]);

  /** Past-run + downloaded setup lists scoped to the selected car. */
  useEffect(() => {
    if (!carId) {
      setPickerRuns([]);
      setDownloadedSetups([]);
      return;
    }
    let alive = true;
    Promise.all([
      jsonFetch<{ runs: RunPickerRun[] }>(`/api/runs/for-picker?carId=${encodeURIComponent(carId)}`),
      jsonFetch<{ downloadedSetups: DownloadedSetupOption[] }>(
        `/api/setup/options?carId=${encodeURIComponent(carId)}`
      ),
    ])
      .then(([runsRes, dlRes]) => {
        if (!alive) return;
        setPickerRuns(Array.isArray(runsRes.runs) ? runsRes.runs : []);
        setDownloadedSetups(Array.isArray(dlRes.downloadedSetups) ? dlRes.downloadedSetups : []);
      })
      .catch(() => {
        if (!alive) return;
        setPickerRuns([]);
        setDownloadedSetups([]);
      });
    return () => {
      alive = false;
    };
  }, [carId]);

  function handleSetupSourceChange(next: "previous_runs" | "other") {
    setSetupSource(next);
    if (next === "previous_runs") {
      const r = pickerRuns.find((x) => x.id === loadSetupSelection);
      setSetupBaselineSnapshotId(r?.setupSnapshot?.id ?? null);
    } else {
      const d = downloadedSetups.find((x) => x.id === loadOtherSetupSelection);
      setSetupBaselineSnapshotId(d?.baselineSetupSnapshotId ?? null);
    }
  }

  function applyPastSetupOnly(runId: string) {
    if (!runId) {
      setLoadSetupSelection("");
      setSetupBaselineSnapshotId(null);
      return;
    }
    const picked = pickerRuns.find((r) => r.id === runId);
    if (!picked) return;
    setLoadSetupSelection(runId);
    const next = setupSnapshotWithDerived(picked.setupSnapshot?.data);
    setSetupData(next);
    setActiveSetupData(next, carId || null);
    setSetupBaselineSnapshotId(picked.setupSnapshot?.id ?? null);
  }

  function applyDownloadedSetupOnly(docId: string) {
    if (!docId) {
      setLoadOtherSetupSelection("");
      setSetupBaselineSnapshotId(null);
      return;
    }
    const picked = downloadedSetups.find((d) => d.id === docId);
    if (!picked) return;
    setLoadOtherSetupSelection(docId);
    const next = setupSnapshotWithDerived(picked.setupData);
    setSetupData(next);
    setActiveSetupData(next, picked.carId ?? carId ?? null);
    setSetupBaselineSnapshotId(picked.baselineSetupSnapshotId ?? null);
  }

  useEffect(() => {
    const t = window.setTimeout(() => {
      setActiveSetupData(setupData, carId || null);
    }, 400);
    return () => window.clearTimeout(t);
  }, [setupData, carId]);

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
    thingsToTryDirtyRef.current = true;
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
    thingsToTryDirtyRef.current = true;
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
        const [{ tireSets }, { batteries }, { lastRun }] = await Promise.all([
          jsonFetch<{ tireSets: TireSetOption[] }>(`/api/tire-sets`),
          jsonFetch<{ batteries: BatteryPackOption[] }>(`/api/batteries`),
          jsonFetch<{ lastRun: LastRun | null }>(`/api/runs/last?carId=${carId}`),
        ]);
        if (!alive) return;
        setTireSets(tireSets);
        setBatteries(batteries);
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
          const prevBatId = lastRun.batteryId ?? "";
          const validBatId = prevBatId && batteries.some((b) => b.id === prevBatId) ? prevBatId : "";
          setBatteryId(validBatId);
          setBatteryRunsCompleted(validBatId ? (lastRun.batteryRunNumber ?? 0) : 0);
          const nextSetup = setupSnapshotWithDerived(lastRun.setupSnapshot?.data);
          setSetupData(nextSetup);
          setActiveSetupData(nextSetup, carId || null);
          setSetupBaselineSnapshotId(lastRun.setupSnapshot?.id ?? null);
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
    const prevBatId = lastRun.batteryId ?? "";
    setBatteryId(prevBatId);
    setBatteryRunsCompleted(prevBatId ? (lastRun.batteryRunNumber ?? 0) : 0);
    const nextSetup = setupSnapshotWithDerived(lastRun.setupSnapshot?.data);
    setSetupData(nextSetup);
    setActiveSetupData(nextSetup, carId || null);
    setSetupBaselineSnapshotId(lastRun.setupSnapshot?.id ?? null);
  }, [replicateLast, lastRun, carId]);

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
    if (!evTrackId || !selected) {
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
    const prevCarId = carId;
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

    const nextBatId = r.batteryId || r.battery?.id || "";
    if (nextBatId && batteries.some((b) => b.id === nextBatId)) {
      setBatteryId(nextBatId);
      setBatteryRunsCompleted(r.batteryRunNumber ?? 0);
      setCopyBatteryWarning(null);
    } else if (r.battery?.label) {
      setCopyBatteryWarning(
        `Last run used a battery pack that no longer exists: ${r.battery.label}. You can select a current pack.`
      );
    } else {
      setCopyBatteryWarning(null);
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
    if (nextCarId && nextCarId !== prevCarId) {
      setLoadSetupSelection("");
      setLoadOtherSetupSelection("");
      setSetupBaselineSnapshotId(null);
    }
    const copied = setupSnapshotWithDerived(r.setupSnapshot?.data);
    setSetupData(copied);
    setActiveSetupData(copied, nextCarId || prevCarId || null);
    setSetupBaselineSnapshotId(r.setupSnapshot?.id ?? null);
    // Session-specific text and laps are not copied — only structured fields + setup above.
    setNotes("");
    setLapIngest(defaultLapIngestValue());
    setLoadSetupSelection(r.id);
    setReplicateLast(true);
  }

  useEffect(() => {
    tireRunUserTouchedRef.current = false;
  }, [tireSetId]);

  useEffect(() => {
    if (!tireSetId) return;
    const id = tireSetId;
    let alive = true;
    jsonFetch<{ lastTireRunNumber: number | null }>(
      `/api/runs/last-tire-run-number?tireSetId=${encodeURIComponent(id)}`
    )
      .then(({ lastTireRunNumber }) => {
        if (!alive || tireSetIdRef.current !== id) return;
        if (tireRunUserTouchedRef.current) return;
        setRunsCompleted(lastTireRunNumber ?? 0);
      })
      .catch(() => {
        if (!alive || tireSetIdRef.current !== id) return;
        if (tireRunUserTouchedRef.current) return;
        setRunsCompleted(0);
      });
    return () => {
      alive = false;
    };
  }, [tireSetId]);

  useEffect(() => {
    batteryRunUserTouchedRef.current = false;
  }, [batteryId]);

  useEffect(() => {
    if (!batteryId) return;
    const id = batteryId;
    let alive = true;
    jsonFetch<{ lastBatteryRunNumber: number | null }>(
      `/api/runs/last-battery-run-number?batteryId=${encodeURIComponent(id)}`
    )
      .then(({ lastBatteryRunNumber }) => {
        if (!alive || batteryIdRef.current !== id) return;
        if (batteryRunUserTouchedRef.current) return;
        setBatteryRunsCompleted(lastBatteryRunNumber ?? 0);
      })
      .catch(() => {
        if (!alive || batteryIdRef.current !== id) return;
        if (batteryRunUserTouchedRef.current) return;
        setBatteryRunsCompleted(0);
      });
    return () => {
      alive = false;
    };
  }, [batteryId]);

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
      tireRunUserTouchedRef.current = true;
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

  async function createBattery(e?: React.MouseEvent) {
    e?.preventDefault();
    const label = newBatteryLabel.trim();
    if (!label) {
      setInlineError("Enter a battery label (e.g. LCG 6000mAh).");
      return;
    }
    setInlineError(null);
    setStatus(null);
    setCreatingBattery(true);

    const packNumber = newBatteryPackNumber >= 1 ? Math.floor(newBatteryPackNumber) : 1;
    const initialRunCount = newBatteryInitialRunCount >= 0 ? Math.floor(newBatteryInitialRunCount) : 0;

    const runCreate = async (): Promise<{ battery: BatteryPackOption }> => {
      const res = await fetch("/api/batteries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          packNumber,
          initialRunCount,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data as { error?: string })?.error || `Server error (${res.status})`;
        throw new Error(msg);
      }
      const battery = (data as { battery?: BatteryPackOption })?.battery;
      if (!battery?.id) {
        throw new Error("Invalid response: battery not returned.");
      }
      return { battery };
    };

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out (15s). Try again.")), 15000)
    );

    try {
      const { battery } = await Promise.race([runCreate(), timeout]);
      setBatteries((prev) => [battery, ...prev]);
      setBatteryId(battery.id);
      batteryRunUserTouchedRef.current = true;
      setBatteryRunsCompleted(initialRunCount);
      setNewBatteryLabel("");
      setNewBatteryPackNumber(1);
      setNewBatteryInitialRunCount(0);
      setShowNewBatteryPanel(false);
      setStatus("Battery pack created — selected.");
      setInlineError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create battery";
      setStatus(msg);
      setInlineError(msg);
    } finally {
      setCreatingBattery(false);
    }
  }

  function buildImportedLapSetsFromIngest(current: LapIngestFormValue): Array<{
    sourceUrl: string | null;
    driverId: string | null;
    driverName: string;
    normalizedName: string;
    isPrimaryUser: boolean;
    sessionCompletedAt: string | null;
    laps: Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded: boolean }>;
  }> {
    if (current.sourceKind !== "url") return [];
    const blocks = current.urlImportBlocks ?? [];
    if (blocks.length === 0) return [];

    const out: Array<{
      sourceUrl: string | null;
      driverId: string | null;
      driverName: string;
      normalizedName: string;
      isPrimaryUser: boolean;
      sessionCompletedAt: string | null;
      laps: Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded: boolean }>;
    }> = [];

    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi]!;
      const sessionDrivers = block.sessionDrivers ?? [];
      if (sessionDrivers.length === 0) continue;
      const sourceUrl = block.sourceUrl ?? null;
      const sessionCompletedAt =
        typeof block.sessionCompletedAtIso === "string" && block.sessionCompletedAtIso.trim()
          ? block.sessionCompletedAtIso.trim()
          : null;
      const selected = new Set(block.selectedDriverIds ?? []);
      const selectedOrdered = sessionDrivers.filter((d) => selected.has(d.driverId));
      const primary = selectedOrdered[0] ?? null;

      function structuredLapsForDriver(d: (typeof sessionDrivers)[number]) {
        const rows = block.driverLapRowsByDriverId?.[d.driverId];
        if (rows && rows.length > 0) {
          return rows.map((r) => ({
            lapNumber: r.lapNumber,
            lapTimeSeconds: r.lapTimeSeconds,
            isIncluded: r.isIncluded,
          }));
        }
        return d.laps.map((t, i) => ({
          lapNumber: i + 1,
          lapTimeSeconds: t,
          isIncluded: true,
        }));
      }

      if (primary && primary.laps.length > 0) {
        out.push({
          sourceUrl,
          driverId: primary.driverId,
          driverName: primary.driverName,
          normalizedName: primary.normalizedName,
          isPrimaryUser: bi === 0,
          sessionCompletedAt,
          laps: structuredLapsForDriver(primary),
        });
      }

      for (const d of selectedOrdered) {
        if (primary && d.driverId === primary.driverId) continue;
        if (d.laps.length === 0) continue;
        out.push({
          sourceUrl,
          driverId: d.driverId,
          driverName: d.driverName,
          normalizedName: d.normalizedName,
          isPrimaryUser: false,
          sessionCompletedAt,
          laps: structuredLapsForDriver(d),
        });
      }
    }

    return out;
  }

  async function interpretSetupChanges() {
    const text = setupChangesText.trim();
    if (!text) {
      setSetupChangesError("Type your setup changes first.");
      return;
    }
    if (!carId) {
      setSetupChangesError("Select a car first.");
      return;
    }
    setSetupChangesBusy(true);
    setSetupChangesError(null);
    try {
      const res = await fetch("/api/setup/interpret-changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carId,
          setupData,
          changesText: text,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSetupChangesError((data as { error?: string })?.error ?? "Could not interpret setup changes.");
        setSetupChangesProposal([]);
        return;
      }
      const edits = Array.isArray((data as { edits?: unknown }).edits) ? ((data as { edits: unknown[] }).edits as unknown[]) : [];
      const mapped: Array<{ fieldKey: string; fieldLabel: string; fromValue: string; toValue: string; confidence: "low" | "medium" | "high"; note?: string | null }> =
        edits
          .map((e) => (e && typeof e === "object" ? (e as Record<string, unknown>) : null))
          .filter(Boolean)
          .map((e) => ({
            fieldKey: typeof e!.fieldKey === "string" ? e!.fieldKey : "",
            fieldLabel: typeof e!.fieldLabel === "string" ? e!.fieldLabel : "",
            fromValue: typeof e!.fromValue === "string" ? e!.fromValue : "",
            toValue: typeof e!.toValue === "string" ? e!.toValue : "",
            confidence: (e!.confidence === "high" || e!.confidence === "medium" || e!.confidence === "low"
              ? (e!.confidence as "low" | "medium" | "high")
              : "low"),
            note: typeof e!.note === "string" ? e!.note : null,
          }))
          .filter((x) => x.fieldKey && x.toValue);
      setSetupChangesProposal(mapped);
      if (mapped.length === 0) {
        setSetupChangesError("No safe changes could be proposed from that text. Try being more specific (field + direction + amount).");
      }
    } catch (e) {
      setSetupChangesError(e instanceof Error ? e.message : "Could not interpret setup changes.");
      setSetupChangesProposal([]);
    } finally {
      setSetupChangesBusy(false);
    }
  }

  function applySetupChangesProposal() {
    if (setupChangesProposal.length === 0) return;
    const next: SetupSnapshotData = { ...setupData };
    for (const p of setupChangesProposal) {
      next[p.fieldKey] = coerceSetupValue(p.toValue);
    }
    setSetupData(applyDerivedFieldsToSnapshot(next));
    setSetupChangesProposal([]);
    setSetupChangesError(null);
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
      let lapTimes: number[];
      if (lapIngest.sourceKind === "url") {
        const blocks = lapIngest.urlImportBlocks ?? [];
        const firstBlock = blocks[0];
        const sessionDrivers = firstBlock?.sessionDrivers ?? [];
        const selectedIds = firstBlock?.selectedDriverIds ?? [];
        const selectedSet = new Set(selectedIds);
        const selectedOrdered = sessionDrivers.filter((d) => selectedSet.has(d.driverId));
        const primary = selectedOrdered[0] ?? null;

        if (!primary) {
          setInlineError("Select at least one driver in your first imported session.");
          setSaving(false);
          return;
        }
        const primaryRows = firstBlock?.driverLapRowsByDriverId?.[primary.driverId];
        lapTimes =
          primaryRows && primaryRows.length > 0
            ? primaryRows.map((r) => r.lapTimeSeconds)
            : primary.laps;
      } else {
        lapTimes = parseLapTimes(lapIngest.manualText);
      }
      const importedLapSets = buildImportedLapSetsFromIngest(lapIngest);
      const { run } = await jsonFetch<{ run: { id: string; createdAt: string } }>("/api/runs", {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: isEditing ? editRun?.id : undefined,
          carId,
          sessionType: sessionType === "RACE_MEETING" ? "RACE_MEETING" : "TESTING",
          meetingSessionType: needsEvent ? meetingSessionType : null,
          meetingSessionCode: needsEvent && meetingSessionType === "OTHER" && meetingSessionCustom ? meetingSessionCustom.trim() : null,
          eventId: needsEvent ? (eventId || null) : null,
          trackId: trackId || null,
          tireSetId: tireSetId || null,
          tireRunNumber: Math.max(1, runsCompleted + 1),
          batteryId: batteryId || null,
          batteryRunNumber: Math.max(1, batteryRunsCompleted + 1),
          setupData: applyDerivedFieldsToSnapshot(setupData),
          setupBaselineSnapshotId,
          sourceSetupDocumentId:
            setupSource === "other" && loadOtherSetupSelection ? loadOtherSetupSelection : null,
          lapTimes,
          lapIngestMeta: {
            sourceKind: lapIngest.sourceKind,
            sourceDetail: lapIngest.sourceDetail,
            parserId: lapIngest.parserId,
            perLap: (() => {
              if (lapIngest.sourceKind === "url") {
                const firstBlock = lapIngest.urlImportBlocks?.[0];
                const sessionDrivers = firstBlock?.sessionDrivers ?? [];
                const selectedIds = firstBlock?.selectedDriverIds ?? [];
                const selectedOrdered = sessionDrivers.filter((d) => selectedIds.includes(d.driverId));
                const primary = selectedOrdered[0] ?? null;
                const primaryRows = primary ? firstBlock?.driverLapRowsByDriverId?.[primary.driverId] : null;
                if (primaryRows && primaryRows.length === lapTimes.length) {
                  return primaryRows.map((row, i) => ({
                    isOutlierWarning: lapIngest.urlLapRows?.[i]?.isOutlierWarning,
                    warningReason: lapIngest.urlLapRows?.[i]?.warningReason ?? null,
                    isFlagged: Boolean(lapIngest.urlLapRows?.[i]?.isFlagged),
                    flagReason: lapIngest.urlLapRows?.[i]?.flagReason ?? null,
                    isIncluded: row.isIncluded,
                  }));
                }
              }
              if (
                lapIngest.urlLapRows &&
                lapIngest.urlLapRows.length > 0 &&
                lapIngest.urlLapRows.length === lapTimes.length
              ) {
                return lapIngest.urlLapRows.map((r) => ({
                  isOutlierWarning: r.isOutlierWarning,
                  warningReason: r.warningReason ?? null,
                  isFlagged: Boolean(r.isFlagged),
                  flagReason: r.flagReason ?? null,
                  isIncluded: true,
                }));
              }
              return undefined;
            })(),
          },
          notes: notes.trim() || null,
          suggestedChanges: suggestedChanges.trim() || null,
          sessionLabel: null,
          importedLapSets,
          importedLapTimeSessionIds:
            lapIngest.sourceKind === "url"
              ? lapIngest.urlImportBlocks.map((b) => b.importedSessionId)
              : [],
        })
      });

      setSaveSuccess(true);
      setStatus(isEditing ? "Changes saved." : "Run saved. Redirecting to Analysis…");

      const { lastRun: refreshed } = await jsonFetch<{ lastRun: LastRun | null }>(
        `/api/runs/last?carId=${carId}`
      ).catch(() => ({ lastRun: null }));
      setLastRun(refreshed);
      if (replicateLast && refreshed) {
        setRunsCompleted(refreshed.tireRunNumber ?? 0);
        setBatteryRunsCompleted(refreshed.batteryRunNumber ?? 0);
      }

      if (!isEditing) {
        setTimeout(() => {
          router.push("/runs/history");
        }, 1000);
      }
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
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          You need at least one car to log a run. Go to <a href="/cars" className="text-accent underline">Car Manager</a> to create one.
        </div>
      ) : null}

      {/* Copy last run shortcut (optional) */}
      <div className="rounded-lg border border-border bg-muted/50 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="ui-title text-sm text-muted-foreground">Shortcut</div>
          <button
            type="button"
            className={cn(
              "rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted transition",
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
            <div className="text-foreground/90 break-words">
              {formatRunListScanLine(copyPreviewRunToPickerRun(copyPreviewRun))}
              {copyPreviewRun.tireSet ? (
                <>
                  <span className="text-muted-foreground"> · </span>
                  <span>
                    {copyPreviewRun.tireSet.label}
                    {copyPreviewRun.tireSet.setNumber != null ? ` #${copyPreviewRun.tireSet.setNumber}` : ""}
                  </span>
                </>
              ) : null}
              {copyPreviewRun.battery ? (
                <>
                  <span className="text-muted-foreground"> · </span>
                  <span>
                    {copyPreviewRun.battery.label}
                    {copyPreviewRun.battery.packNumber != null ? ` #${copyPreviewRun.battery.packNumber}` : ""}
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
      <div className="rounded-lg border border-border bg-muted/70 p-4">
        <div className="ui-title text-sm text-muted-foreground mb-2">Session type</div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="sessionType"
              value="TESTING"
              checked={sessionType === "TESTING"}
              onChange={() => setSessionType("TESTING")}
              className="h-4 w-4 shrink-0 accent-primary"
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
              className="h-4 w-4 shrink-0 accent-primary"
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
        <div className="rounded-lg border border-border bg-muted/70 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="ui-title text-sm text-muted-foreground">Event / Race meeting</div>
            <button
              type="button"
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted transition"
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
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
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
                className="rounded border border-border bg-card px-2 py-1 hover:bg-muted"
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
            <div className="rounded-md border border-border bg-muted/60 p-3 space-y-2">
              <div className="rounded-md border border-border bg-muted/50 p-2">
                <div className="ui-title text-sm text-muted-foreground mb-1">Track (required)</div>
                <select
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
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
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                placeholder="Event name (e.g. TITC 2026)"
                value={newEventName}
                onChange={(e) => setNewEventName(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                  value={newEventStartDate}
                  onChange={(e) => {
                    setNewEventStartDate(e.target.value);
                    setEventError(null);
                  }}
                  placeholder="Start date"
                />
                <input
                  type="date"
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
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
                  "rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-glow-sm hover:brightness-105 transition",
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

          <div className="rounded-lg border border-border bg-muted/60 p-3 space-y-3">
            <div className="ui-title text-sm text-muted-foreground">Session</div>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1">
                <label className="block text-[11px] text-muted-foreground">Type</label>
                <select
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
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
                    className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none min-w-[140px]"
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

      <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-3">
        <div className="ui-title text-sm text-muted-foreground">Run details</div>
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
            Tires & batteries
          </button>
        </div>

        {runDetailsTab === "car" ? (
          <div className="space-y-3 pt-1">
            <div className="space-y-1 text-sm">
              <div className="ui-title text-sm text-muted-foreground">Car</div>
              <select
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                value={carId}
                onChange={(e) => {
                  const next = e.target.value;
                  const prev = carId;
                  setCarId(next);
                  setCopyCarWarning(null);
                  if (next && prev && next !== prev) {
                    setLoadSetupSelection("");
                    setLoadOtherSetupSelection("");
                    setSetupBaselineSnapshotId(null);
                    setSetupData({});
                    setActiveSetupData({}, next);
                  }
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
                <div className="ui-title text-sm text-muted-foreground">Track</div>
                <button
                  type="button"
                  className="rounded-md border border-border bg-card px-2 py-1 text-[11px] hover:bg-muted transition"
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
              <div className="rounded-md border border-border bg-muted/60 p-3 space-y-2">
                <input
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                  placeholder="Track name"
                  value={newTrackName}
                  onChange={(e) => setNewTrackName(e.target.value)}
                />
                <input
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                  placeholder="Location (optional)"
                  value={newTrackLocation}
                  onChange={(e) => setNewTrackLocation(e.target.value)}
                />
                <button
                  type="button"
                  disabled={addingTrack || !newTrackName.trim()}
                  className={cn(
                    "rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-glow-sm hover:brightness-105 transition",
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
                  <div className="ui-title text-sm text-muted-foreground">Tire set</div>
                  <div className="text-[11px] text-muted-foreground">Optional.</div>
                </div>
                <button
                  type="button"
                  className="rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted transition"
                  onClick={() => {
                    setShowNewTireSetPanel((v) => !v);
                    setInlineError(null);
                  }}
                >
                  {showNewTireSetPanel ? "Cancel" : "New tire set"}
                </button>
              </div>
              <select
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                value={tireSetId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setTireSetId(nextId);
                  applyTireBatteryToSetupSnapshot(nextId, batteryIdRef.current);
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
              <div className="rounded-md border border-border bg-muted/60 p-3 space-y-3">
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                    placeholder="Label (brand + compound, e.g. Sweep 32)"
                    value={newTireLabel}
                    onChange={(e) => setNewTireLabel(e.target.value)}
                    aria-label="Tire set label"
                  />
                  <input
                    type="number"
                    min={1}
                    className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
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
                  <div className="ui-title text-sm text-muted-foreground">Prior runs on this set (before first log)</div>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                    inputMode="numeric"
                    value={newTireInitialRunCount}
                    onChange={(e) =>
                      setNewTireInitialRunCount(Math.max(0, Math.floor(Number(e.target.value) || 0)))
                    }
                    aria-label="Prior runs on this tire set before first log"
                  />
                  <div className="text-[11px] text-muted-foreground">
                    First log on this set will be <span className="font-medium text-foreground">tire run #{newTireInitialRunCount + 1}</span>
                    {newTireInitialRunCount === 0
                      ? " (no prior runs)."
                      : newTireInitialRunCount === 1
                        ? " (1 prior run)."
                        : ` (${newTireInitialRunCount} prior runs).`}
                  </div>
                </div>
                <button
                  type="button"
                  className={cn(
                    "rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-glow-sm hover:brightness-105 transition",
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
                <div className="ui-title text-sm text-muted-foreground">Prior runs on this set (before this log)</div>
                <input
                  type="number"
                  min={0}
                  className="w-full max-w-md rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                  inputMode="numeric"
                  value={runsCompleted}
                  onChange={(e) => {
                    tireRunUserTouchedRef.current = true;
                    setRunsCompleted(Math.max(0, Math.floor(Number(e.target.value) || 0)));
                  }}
                  aria-label="Prior runs on this tire set before this log"
                />
                <div className="text-[11px] text-muted-foreground">
                  This log saves as{" "}
                  <span className="font-medium text-foreground">tire run #{runsCompleted + 1}</span>
                  {runsCompleted === 0
                    ? " (first run on this set)."
                    : runsCompleted === 1
                      ? " (after 1 prior run on this set)."
                      : ` (after ${runsCompleted} prior runs on this set).`}
                </div>
              </div>
            ) : null}

            <div className="border-t border-border pt-4 space-y-2 text-sm">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="ui-title text-sm text-muted-foreground">Battery pack</div>
                  <div className="text-[11px] text-muted-foreground">Optional.</div>
                </div>
                <button
                  type="button"
                  className="rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted transition"
                  onClick={() => {
                    setShowNewBatteryPanel((v) => !v);
                    setInlineError(null);
                  }}
                >
                  {showNewBatteryPanel ? "Cancel" : "New battery"}
                </button>
              </div>
              <select
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                value={batteryId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setBatteryId(nextId);
                  applyTireBatteryToSetupSnapshot(tireSetIdRef.current, nextId);
                  setCopyBatteryWarning(null);
                }}
                aria-label="Battery pack"
              >
                <option value="">—</option>
                {batteries.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                    {b.packNumber != null ? ` #${b.packNumber}` : ""}
                  </option>
                ))}
              </select>
              {copyBatteryWarning && (
                <div className="text-[11px] text-muted-foreground mt-1">{copyBatteryWarning}</div>
              )}
            </div>

            {showNewBatteryPanel && (
              <div className="rounded-md border border-border bg-muted/60 p-3 space-y-3">
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                    placeholder="Label (e.g. LCG 6000mAh)"
                    value={newBatteryLabel}
                    onChange={(e) => setNewBatteryLabel(e.target.value)}
                    aria-label="Battery label"
                  />
                  <input
                    type="number"
                    min={1}
                    className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                    placeholder="Pack number"
                    value={newBatteryPackNumber}
                    onChange={(e) => setNewBatteryPackNumber(Number(e.target.value) || 1)}
                    aria-label="Pack number"
                  />
                </div>
                <div className="space-y-1 text-sm">
                  <div className="ui-title text-sm text-muted-foreground">Prior runs on this pack (before first log)</div>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                    inputMode="numeric"
                    value={newBatteryInitialRunCount}
                    onChange={(e) =>
                      setNewBatteryInitialRunCount(Math.max(0, Math.floor(Number(e.target.value) || 0)))
                    }
                    aria-label="Prior runs on this battery pack before first log"
                  />
                  <div className="text-[11px] text-muted-foreground">
                    First log on this pack will be{" "}
                    <span className="font-medium text-foreground">battery run #{newBatteryInitialRunCount + 1}</span>.
                  </div>
                </div>
                <button
                  type="button"
                  className={cn(
                    "rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-glow-sm hover:brightness-105 transition",
                    (!newBatteryLabel.trim() || creatingBattery) && "opacity-60 pointer-events-none"
                  )}
                  onClick={(e) => createBattery(e)}
                  disabled={!newBatteryLabel.trim() || creatingBattery}
                >
                  {creatingBattery ? "Adding…" : "Add battery pack"}
                </button>
              </div>
            )}

            {!showNewBatteryPanel && batteryId ? (
              <div className="space-y-1 text-sm">
                <div className="ui-title text-sm text-muted-foreground">Prior runs on this pack (before this log)</div>
                <input
                  type="number"
                  min={0}
                  className="w-full max-w-md rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                  inputMode="numeric"
                  value={batteryRunsCompleted}
                  onChange={(e) => {
                    batteryRunUserTouchedRef.current = true;
                    setBatteryRunsCompleted(Math.max(0, Math.floor(Number(e.target.value) || 0)));
                  }}
                  aria-label="Prior runs on this battery pack before this log"
                />
                <div className="text-[11px] text-muted-foreground">
                  This log saves as{" "}
                  <span className="font-medium text-foreground">battery run #{batteryRunsCompleted + 1}</span>
                  {batteryRunsCompleted === 0
                    ? " (first run on this pack)."
                    : batteryRunsCompleted === 1
                      ? " (after 1 prior run on this pack)."
                      : ` (after ${batteryRunsCompleted} prior runs on this pack).`}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <LapTimesIngestPanel value={lapIngest} onChange={setLapIngest} />

      <div className="space-y-2 text-sm">
        <div className="ui-title text-sm text-muted-foreground">Notes</div>
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
            className="h-32 w-full resize-none rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
            placeholder="Session notes, handling, track conditions…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-label="Session notes"
          />
        ) : (
          <textarea
            ref={thingsTryRef}
            className="h-32 w-full resize-none rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
            placeholder="First character becomes a bullet line. Enter: new • line. Shift+Enter: line break inside an item."
            value={suggestedChanges}
            onChange={handleThingsToTryChange}
            onKeyDown={handleThingsToTryKeyDown}
            aria-label="Things to try"
          />
        )}
      </div>

      <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-4">
        <div className="ui-title text-sm text-muted-foreground">Setup</div>
        {!setupSectionExpanded ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-3 max-w-2xl">
              <div className="space-y-1 text-sm">
                <div className="text-sm font-medium text-muted-foreground">Setup source</div>
                <select
                  className="w-full max-w-2xl rounded-md border border-border bg-card px-3 py-2 text-xs outline-none"
                  value={setupSource}
                  onChange={(e) =>
                    handleSetupSourceChange(e.target.value as "previous_runs" | "other")
                  }
                >
                  <option value="previous_runs">Setups from previous runs</option>
                  <option value="other">Other</option>
                </select>
              </div>
              {setupSource === "previous_runs" ? (
                <RunPickerSelect
                  label={loadSetupControlLabel}
                  runs={pickerRuns}
                  value={loadSetupSelection}
                  onChange={applyPastSetupOnly}
                  placeholder="Choose a run…"
                  disabled={pickerRuns.length === 0}
                  formatLine={formatRunPickerLineRelativeWhen}
                />
              ) : (
                <div className="space-y-2">
                  <div className="space-y-1 text-sm">
                    <div className="text-sm font-medium text-muted-foreground">Other source</div>
                    <select
                      className="w-full max-w-2xl rounded-md border border-border bg-card px-3 py-2 text-xs outline-none"
                      value={otherSetupSource}
                      onChange={(e) => setOtherSetupSource(e.target.value as "downloaded_setups")}
                    >
                      <option value="downloaded_setups">Downloaded setups</option>
                    </select>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="text-sm font-medium text-muted-foreground break-words min-w-0 leading-snug">
                      {loadOtherSetupLabel}
                    </div>
                    <select
                      className="w-full max-w-2xl rounded-md border border-border bg-card px-3 py-2 text-xs outline-none font-mono"
                      value={loadOtherSetupSelection}
                      onChange={(e) => applyDownloadedSetupOnly(e.target.value)}
                      disabled={downloadedSetups.length === 0}
                    >
                      <option value="">Choose a downloaded setup…</option>
                      {downloadedSetups.map((d) => (
                        <option key={d.id} value={d.id}>
                          {`${d.originalFilename} · ${formatRunCreatedAtDateTime(d.createdAt)}`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => setSetupSectionExpanded(true)}
                className="self-start rounded-md border border-border bg-muted/70 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition"
              >
                Edit setup
              </button>
            </div>
            {setupSource === "previous_runs" && pickerRuns.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No past runs yet, or list failed to load.</p>
            ) : null}
            {setupSource === "other" && downloadedSetups.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No parsed setups available for this car (or parse not run). Parse a PDF under Setup → Downloaded setups
                or bulk import, or pick a car that matches the setup’s assigned car when one is set.
              </p>
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
                className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground transition"
              >
                Collapse
              </button>
            </div>
            <div className="max-w-2xl rounded-md border border-border bg-muted/40 p-3 space-y-2">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Setup changes (free text)
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Type natural language changes. The engineer will propose structured edits, and nothing is applied until you confirm.
              </p>
              <textarea
                className="h-20 w-full resize-none rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                placeholder={'Examples:\n“+0.5 rear camber, softer rear spring”\n“remove 0.5 upper inner shim rear”'}
                value={setupChangesText}
                onChange={(e) => setSetupChangesText(e.target.value)}
                aria-label="Setup changes free text"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void interpretSetupChanges()}
                  disabled={setupChangesBusy}
                  className={cn(
                    "rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground shadow-glow-sm transition hover:brightness-105",
                    setupChangesBusy && "opacity-60 pointer-events-none"
                  )}
                >
                  {setupChangesBusy ? "Interpreting…" : "Interpret changes"}
                </button>
                {setupChangesProposal.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => applySetupChangesProposal()}
                    className="rounded-md border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted/60 transition"
                  >
                    Apply changes
                  </button>
                ) : null}
                {setupChangesProposal.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSetupChangesProposal([]);
                      setSetupChangesError(null);
                    }}
                    className="rounded-md border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/60 transition"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
              {setupChangesError ? (
                <div className="text-[11px] text-destructive">{setupChangesError}</div>
              ) : null}
              {setupChangesProposal.length > 0 ? (
                <div className="rounded-md border border-border bg-card/70 p-2 space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Proposed edits (review)
                  </div>
                  <ul className="space-y-1 text-[11px]">
                    {setupChangesProposal.map((p) => (
                      <li key={`${p.fieldKey}-${p.toValue}`} className="flex flex-col gap-0.5">
                        <div className="text-foreground">
                          <span className="font-medium">{p.fieldLabel || p.fieldKey}</span>{" "}
                          <span className="text-muted-foreground">
                            ({p.confidence})
                          </span>
                        </div>
                        <div className="font-mono text-muted-foreground">
                          {p.fromValue || "—"} → <span className="text-foreground">{p.toValue}</span>
                        </div>
                        {p.note ? <div className="text-muted-foreground">{p.note}</div> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            <div className="max-w-2xl space-y-2">
              <div className="space-y-1 text-sm">
                <div className="text-sm font-medium text-muted-foreground">Setup source</div>
                <select
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs outline-none"
                  value={setupSource}
                  onChange={(e) =>
                    handleSetupSourceChange(e.target.value as "previous_runs" | "other")
                  }
                >
                  <option value="previous_runs">Setups from previous runs</option>
                  <option value="other">Other</option>
                </select>
              </div>
              {setupSource === "previous_runs" ? (
                <RunPickerSelect
                  label={loadSetupControlLabel}
                  runs={pickerRuns}
                  value={loadSetupSelection}
                  onChange={applyPastSetupOnly}
                  placeholder="Choose a run…"
                  disabled={pickerRuns.length === 0}
                  formatLine={formatRunPickerLineRelativeWhen}
                />
              ) : (
                <div className="space-y-2">
                  <div className="space-y-1 text-sm">
                    <div className="text-sm font-medium text-muted-foreground">Other source</div>
                    <select
                      className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs outline-none"
                      value={otherSetupSource}
                      onChange={(e) => setOtherSetupSource(e.target.value as "downloaded_setups")}
                    >
                      <option value="downloaded_setups">Downloaded setups</option>
                    </select>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="text-sm font-medium text-muted-foreground break-words min-w-0 leading-snug">
                      {loadOtherSetupLabel}
                    </div>
                    <select
                      className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs outline-none font-mono"
                      value={loadOtherSetupSelection}
                      onChange={(e) => applyDownloadedSetupOnly(e.target.value)}
                      disabled={downloadedSetups.length === 0}
                    >
                      <option value="">Choose a downloaded setup…</option>
                      {downloadedSetups.map((d) => (
                        <option key={d.id} value={d.id}>
                          {`${d.originalFilename} · ${formatRunCreatedAtDateTime(d.createdAt)}`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
            <SetupSheetView
              value={setupData}
              onChange={(next) => setSetupData(applyDerivedFieldsToSnapshot(next))}
              template={setupTemplate}
              enableFieldSearch
            />
            {setupSource === "previous_runs" && pickerRuns.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No past runs yet, or list failed to load.</p>
            ) : null}
            {setupSource === "other" && downloadedSetups.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No parsed setups available for this car (or parse not run). Parse a PDF under Setup → Downloaded setups
                or bulk import, or pick a car that matches the setup’s assigned car when one is set.
              </p>
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
            "inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-glow-sm hover:brightness-105 transition",
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

