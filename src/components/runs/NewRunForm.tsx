"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DashboardNewRunPrefill } from "@/lib/dashboardPrefillTypes";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { coerceSetupValue, normalizeSetupData, parseLapTimes, type SetupSnapshotData } from "@/lib/runSetup";
import { applyDerivedFieldsToSnapshot } from "@/lib/setup/deriveRenderValues";
import { buildSetupDiffRows } from "@/lib/setupDiff";
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
import type { LapRow } from "@/lib/lapAnalysis";
import { primaryLapRowsFromImportedPayload, sessionCompletedAtIsoFromImportedPayload } from "@/lib/lapImport/fromPayload";
import { buildImportedIngestPlanFromPayload } from "@/lib/lapImport/importedIngestPlan";
import { resolveImportedSessionDisplayTimeIso } from "@/lib/lapImport/labels";
import {
  LapTimesIngestPanel,
  defaultLapIngestValue,
  type LapIngestFormValue,
} from "@/components/runs/LapTimesIngestPanel";
import { ImportedFieldSessionCard } from "@/components/runs/ImportedFieldSessionCard";
import { HandlingAssessmentFields } from "@/components/runs/HandlingAssessmentFields";
import { TrackMetaChipGroups } from "@/components/runs/TrackMetaChipGroups";
import {
  emptyHandlingAssessmentUiState,
  isHandlingAssessmentMeaningful,
  parseHandlingAssessmentJson,
  persistedFromUiState,
  uiStateFromParsed,
  type HandlingAssessmentUiState,
} from "@/lib/runHandlingAssessment";

type CarOption = { id: string; name: string; setupSheetTemplate?: string | null };
type TrackOption = {
  id: string;
  name: string;
  location?: string | null;
  gripTags?: string[];
  layoutTags?: string[];
};
type TireSetOption = { id: string; label: string; setNumber?: number; initialRunCount?: number };
type BatteryPackOption = { id: string; label: string; packNumber?: number; initialRunCount?: number };

type EventOption = {
  id: string;
  name: string;
  trackId: string | null;
  startDate: string;
  endDate: string;
  notes?: string | null;
  /** LiveRC practice day list URL (optional). */
  practiceSourceUrl?: string | null;
  /** LiveRC results / race timing page URL (optional). */
  resultsSourceUrl?: string | null;
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
  suggestedPreRun?: string | null;
  handlingAssessmentJson?: unknown;
  /** Session race class when not only from event (e.g. practice). */
  raceClass?: string | null;
  lapTimes?: unknown;
  lapSession?: unknown;
  importedLapSets?: Array<{
    driverName: string;
    displayName: string | null;
    isPrimaryUser: boolean;
    laps: Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded: boolean }>;
  }>;
  /** Optional practice-day results URL saved with this run. */
  practiceDayUrl?: string | null;
  /**
   * Whether the user has marked this run as finished logging. Drafts
   * (`loggingComplete === false`) get amber "finish me" styling in the
   * post-run section when the form is opened to edit an existing run.
   */
  loggingComplete?: boolean;
  /** When false, mutual team members do not see this run in team Sessions / team-only Engineer lists. */
  shareWithTeam?: boolean;
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

/** Deep copy a setup snapshot so mutating `setupData` later doesn't drag the baseline along. */
function cloneSetupSnapshot(d: SetupSnapshotData): SetupSnapshotData {
  try {
    return JSON.parse(JSON.stringify(d)) as SetupSnapshotData;
  } catch {
    return { ...d };
  }
}

export function NewRunForm(props: {
  cars: CarOption[];
  tracks: TrackOption[];
  favouriteTrackIds?: string[];
  favouriteTracks?: TrackOption[];
  dashboardPrefill?: DashboardNewRunPrefill | null;
  /** Optional event to attach (e.g. from dashboard detection deep link). */
  initialEventId?: string | null;
  /** When set, the form edits an existing run (owner-only enforced by server update route). */
  editRun?: LastRun | null;
  /**
   * Deep-link hint from the dashboard "Log changes for next run" shortcut.
   * When `"setup"`, the Setup card is auto-expanded and scrolled into view on
   * mount so the driver lands directly on the setup-changes free-text box.
   */
  focusSection?: "setup" | null;
}) {
  const router = useRouter();
  const [carsList, setCarsList] = useState<CarOption[]>(props.cars);
  const tracks = props.tracks;
  const favouriteTrackIds = props.favouriteTrackIds ?? [];
  const favouriteTracks = props.favouriteTracks ?? [];
  const dashboardPrefill = props.dashboardPrefill ?? null;
  const initialEventId = props.initialEventId?.trim() || null;

  const [sessionType, setSessionType] = useState<"TESTING" | "RACE_MEETING">("TESTING");
  const [meetingSessionType, setMeetingSessionType] = useState<MeetingSessionType>("PRACTICE");
  const [meetingSessionCustom, setMeetingSessionCustom] = useState<string>(""); // when type is OTHER
  /**
   * Practice-day results URL (LiveRC session list). Hydrates from editRun →
   * copy-last-run → event `practiceSourceUrl` when empty → `currentPracticeDayUrl`
   * (testing only). Shown for both Testing and Race meeting; saved on the run.
   * Testing-only: also POSTs to Settings `currentPracticeDayUrl` on save.
   */
  const [practiceDayUrl, setPracticeDayUrl] = useState<string>("");
  const [carId, setCarId] = useState<string>(props.cars[0]?.id ?? "");
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
  const [newEventPracticeUrl, setNewEventPracticeUrl] = useState("");
  const [newEventResultsUrl, setNewEventResultsUrl] = useState("");
  /** When logging a race meeting, timing URLs (stored on the Event; edited here, PATCH on save). */
  const [eventPracticeTimingUrl, setEventPracticeTimingUrl] = useState("");
  const [eventRaceTimingUrl, setEventRaceTimingUrl] = useState("");
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [eventTrackSwitchPrompt, setEventTrackSwitchPrompt] = useState<{
    eventId: string;
    eventTrackId: string;
    eventTrackName: string;
  } | null>(null);

  const [replicateLast, setReplicateLast] = useState(false);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [replicateLoaded, setReplicateLoaded] = useState(false);

  const [copyPreviewRun, setCopyPreviewRun] = useState<LastRun | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const [setupData, setSetupData] = useState<SetupSnapshotData>({});
  /** Baseline SetupSnapshot id for server merge + audit (null = scratch / no prior snapshot). */
  const [setupBaselineSnapshotId, setSetupBaselineSnapshotId] = useState<string | null>(null);
  /** Deep-frozen copy of the setup that was loaded (past run / downloaded / replicate / edit-run hydrate /
   *  local "Save setup snapshot"). Drives the "X changes from loaded setup" badge in the collapsed view. */
  const [setupBaselineData, setSetupBaselineData] = useState<SetupSnapshotData | null>(null);
  const [setupSnapshotSaveStatus, setSetupSnapshotSaveStatus] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);
  const [setupSnapshotSaving, setSetupSnapshotSaving] = useState(false);
  const [lapIngest, setLapIngest] = useState<LapIngestFormValue>(() => defaultLapIngestValue());
  const [notes, setNotes] = useState("");
  const [raceClass, setRaceClass] = useState("");
  const [suggestedChanges, setSuggestedChanges] = useState("");
  const [suggestedPreRun, setSuggestedPreRun] = useState("");
  const [setupChangesText, setSetupChangesText] = useState("");
  const [setupChangesBusy, setSetupChangesBusy] = useState(false);
  const [setupChangesError, setSetupChangesError] = useState<string | null>(null);
  const [setupChangesProposal, setSetupChangesProposal] = useState<
    Array<{ fieldKey: string; fieldLabel: string; fromValue: string; toValue: string; confidence: "low" | "medium" | "high"; note?: string | null }>
  >([]);
  const [notesSubTab, setNotesSubTab] = useState<"notes" | "things" | "todo">("notes");
  const [handlingUi, setHandlingUi] = useState<HandlingAssessmentUiState>(() => emptyHandlingAssessmentUiState());
  const [handlingDetailExpanded, setHandlingDetailExpanded] = useState(false);
  const [runDetailsTab, setRunDetailsTab] = useState<"car" | "track" | "tires">("car");
  const [trackGripTags, setTrackGripTags] = useState<string[]>([]);
  const [trackLayoutTags, setTrackLayoutTags] = useState<string[]>([]);
  const thingsTryRef = useRef<HTMLTextAreaElement>(null);
  const thingsTryCursorRef = useRef<number | null>(null);
  const thingsDoRef = useRef<HTMLTextAreaElement>(null);
  const thingsDoCursorRef = useRef<number | null>(null);
  /** True after user edits “Things to try”; avoids syncing (or wiping) on initial API hydrate. */
  const thingsToTryDirtyRef = useRef(false);
  const thingsToDoDirtyRef = useRef(false);

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

  const [shareWithTeam, setShareWithTeam] = useState(true);
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
  const [setupSource, setSetupSource] = useState<"previous_runs" | "other" | "new">("previous_runs");
  const [otherSetupSource, setOtherSetupSource] = useState<"downloaded_setups">("downloaded_setups");
  const [downloadedSetups, setDownloadedSetups] = useState<DownloadedSetupOption[]>([]);
  const [setupSectionExpanded, setSetupSectionExpanded] = useState(false);
  /**
   * When editing a saved run (including drafts being finished), the setup the
   * run was logged with is already nailed down. Forcing the user through the
   * "choose a run" source picker makes the section feel unfinished, so we hide
   * the source controls behind an explicit opt-in ("Change source") in that
   * flow. New-run mode keeps the controls visible because the user still needs
   * to pick a baseline.
   */
  const [showSetupSourceControls, setShowSetupSourceControls] = useState(false);
  /**
   * "Saved from draft" collapse flags for the two other muted sections the
   * driver already filled in when they logged the draft. Drafts open with
   * these sections rolled up to a read-only summary + "Edit" button; new-run
   * mode leaves them expanded since the driver is still filling them out.
   * Seeded from `editRun` at construction so the initial render matches the
   * final state (no flash of expanded → collapsed).
   */
  const initialDraftCollapsed =
    Boolean(props.editRun?.id) && props.editRun?.loggingComplete === false;
  const [sessionExpanded, setSessionExpanded] = useState<boolean>(!initialDraftCollapsed);
  const [runDetailsExpanded, setRunDetailsExpanded] = useState<boolean>(!initialDraftCollapsed);

  const tireSetIdRef = useRef(tireSetId);
  tireSetIdRef.current = tireSetId;
  const batteryIdRef = useRef(batteryId);
  batteryIdRef.current = batteryId;
  const tireRunUserTouchedRef = useRef(false);
  const batteryRunUserTouchedRef = useRef(false);

  const canSave = useMemo(() => Boolean(carId), [carId]);
  const editRun = props.editRun ?? null;
  const isEditing = Boolean(editRun?.id);
  /**
   * True when we're editing a run that was saved as a draft (user hit "Save
   * draft" earlier and hasn't marked it complete yet). Drives the amber
   * highlight on the "After the run" divider + the empty Notes textarea so
   * drivers can see what's still expected before clicking "Run complete".
   */
  const isDraft = isEditing && editRun?.loggingComplete === false;
  /**
   * Two-step save confirmation when the user has edited the setup sheet but
   * never hit "Save setup snapshot". Null = no confirmation pending, otherwise
   * the intent that's waiting on the user to acknowledge the unsaved setup
   * edits before we hit the backend. The actual run payload always includes
   * `setupData`, so the backend stores the edits either way — this just gives
   * the driver a last look at what they changed before the run is written.
   */
  const [pendingSaveIntent, setPendingSaveIntent] = useState<
    "draft" | "completed" | null
  >(null);
  const focusSection = props.focusSection ?? null;
  const setupSectionRef = useRef<HTMLDivElement>(null);
  const focusAppliedRef = useRef(false);

  const dashboardPrefillAppliedRef = useRef(false);
  const editPrefillAppliedRef = useRef(false);

  useEffect(() => {
    setCarsList(props.cars);
  }, [props.cars]);

  useEffect(() => {
    if (carsList.length === 0) return;
    if (!carId || !carsList.some((c) => c.id === carId)) {
      setCarId(carsList[0]!.id);
    }
  }, [carsList, carId]);

  useEffect(() => {
    if (initialEventId) setEventId(initialEventId);
  }, [initialEventId]);

  /**
   * Dashboard "Log changes for next run" deep-link: when `focusSection === "setup"`,
   * expand the Setup card and scroll it into view so the driver lands on the
   * free-text setup-changes box without hunting for it. Runs once; the effect
   * guards itself with `focusAppliedRef` so re-renders don't re-scroll.
   */
  useEffect(() => {
    if (focusAppliedRef.current) return;
    if (focusSection !== "setup") return;
    focusAppliedRef.current = true;
    setSetupSectionExpanded(true);
    const raf = requestAnimationFrame(() => {
      setupSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(raf);
  }, [focusSection]);

  // Hydrate user-level settings (current practice day URL + LiveRC driver name)
  // on mount so the Testing session block can prefill the URL and the Lap
  // Times URL picker has the name it needs to filter candidates.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [dayRes, drvRes] = await Promise.all([
          fetch("/api/settings/current-practice-day-url"),
          fetch("/api/settings/live-rc-driver"),
        ]);
        if (!alive) return;
        if (dayRes.ok) {
          const json = (await dayRes.json().catch(() => ({}))) as { currentPracticeDayUrl?: string | null };
          if (alive && !practiceDayUrl && typeof json.currentPracticeDayUrl === "string") {
            setPracticeDayUrl(json.currentPracticeDayUrl);
          }
        }
        // Touch drvRes to keep the settings fetch warm; Settings page is source of truth.
        void drvRes.ok;
      } catch {
        // Best-effort hydrate; the Settings page is the source of truth.
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Edit-run load must run before dashboard/import prefill so opening /runs/:id/edit?importedLapTimeSessionId=…
  // does not reset lap ingest after the import block is applied.
  useEffect(() => {
    const r = editRun;
    if (!r || editPrefillAppliedRef.current) return;
    editPrefillAppliedRef.current = true;

    const nextCarId = (r.carId || r.car?.id || "").toString();
    if (nextCarId && carsList.some((c) => c.id === nextCarId)) {
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
    setRaceClass((r.raceClass ?? "").trim());
    setTireSetId(r.tireSetId ?? "");
    // `runsCompleted` is always the count of *prior* runs on this tire set —
    // save() sends `runsCompleted + 1`. When hydrating an existing run we want
    // that re-save to preserve the run's current tireRunNumber, not bump it,
    // so subtract one from the stored number. Same for battery. Before this
    // fix, editing any saved run (especially a draft being completed) added
    // +1 to the tire/battery slot on every save, producing the "+2 per
    // draft→complete cycle" behavior.
    setRunsCompleted(Math.max(0, (r.tireRunNumber ?? 1) - 1));
    setBatteryId(r.batteryId ?? "");
    setBatteryRunsCompleted(Math.max(0, (r.batteryRunNumber ?? 1) - 1));
    if (typeof r.practiceDayUrl === "string") setPracticeDayUrl(r.practiceDayUrl);

    const nextSetup = setupSnapshotWithDerived(r.setupSnapshot?.data);
    setSetupData(nextSetup);
    setActiveSetupData(nextSetup, nextCarId || carId || null);
    setSetupBaselineSnapshotId(r.setupSnapshot?.id ?? null);
    setSetupBaselineData(cloneSetupSnapshot(nextSetup));

    setNotes((r.notes ?? "").trim());
    setSuggestedChanges((r.suggestedChanges ?? "").trim());
    setSuggestedPreRun((r.suggestedPreRun ?? "").trim());
    const parsedHandling = parseHandlingAssessmentJson(r.handlingAssessmentJson);
    setHandlingUi(uiStateFromParsed(parsedHandling));
    setHandlingDetailExpanded(isHandlingAssessmentMeaningful(r.handlingAssessmentJson));

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
    setShareWithTeam(r.shareWithTeam !== false);
    // When reloading a saved run — especially a draft being completed — the
    // setup, session type, and run details are already nailed down. Keep the
    // Setup sheet collapsed so the user sees the "Saved from draft" summary
    // with diff rows, and can hit Edit only if something needs to change.
    setSetupSectionExpanded(false);
  }, [editRun, carsList]);

  useEffect(() => {
    const p = dashboardPrefill;
    if (!p || dashboardPrefillAppliedRef.current) return;
    dashboardPrefillAppliedRef.current = true;

    if (p.mode === "imported_lap_session") {
      const sess = p.importedLapTimeSession;
      const ingestMode =
        sess.eventDetectionSource === "practice"
          ? "practice_user_only"
          : sess.eventDetectionSource === "race"
            ? "race_full_field"
            : "race_full_field";
      const plan = buildImportedIngestPlanFromPayload(sess.parsedPayload, {
        mode: ingestMode,
        liveRcDriverName: sess.liveRcDriverName,
      });
      const parsed = plan
        ? null
        : primaryLapRowsFromImportedPayload(sess.parsedPayload);
      if (plan) {
        const driverLapRowsByDriverId: Record<string, LapRow[]> = {};
        for (const d of plan.sessionDrivers) {
          driverLapRowsByDriverId[d.driverId] = d.laps.map((t, i) => ({
            lapNumber: i + 1,
            lapTimeSeconds: t,
            isIncluded: true,
          }));
        }
        const primaryLaps = plan.primaryRows.map((r) => r.lapTimeSeconds);
        if (sess.linkedEventId) setEventId(sess.linkedEventId);
        if (sess.eventDetectionSource === "race") {
          setSessionType("RACE_MEETING");
          setMeetingSessionType("RACE");
        } else if (sess.eventDetectionSource === "practice") {
          setSessionType("RACE_MEETING");
          setMeetingSessionType("PRACTICE");
        }
        setLapIngest({
          ...defaultLapIngestValue(),
          manualText: primaryLaps.map((n) => n.toFixed(3)).join("\n"),
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
              recordedAt: sess.createdAt,
              sessionCompletedAtDbIso: sess.sessionCompletedAtIso,
              sessionCompletedAtIso: sessionCompletedAtIsoFromImportedPayload(sess.parsedPayload),
              sessionDrivers: plan.sessionDrivers,
              selectedDriverIds: plan.selectedDriverIds,
              driverLapRowsByDriverId,
              urlLapRows: null,
            },
          ],
        });
        setSetupSectionExpanded(true);
      } else if (parsed) {
        const laps = parsed.rows.map((r) => r.lapTimeSeconds);
        if (sess.linkedEventId) setEventId(sess.linkedEventId);
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
              recordedAt: sess.createdAt,
              sessionCompletedAtDbIso: sess.sessionCompletedAtIso,
              sessionCompletedAtIso: sessionCompletedAtIsoFromImportedPayload(sess.parsedPayload),
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
    if (nextCarId && carsList.some((c) => c.id === nextCarId)) {
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
    if (typeof r.practiceDayUrl === "string") setPracticeDayUrl(r.practiceDayUrl);

    const nextSetup = setupSnapshotWithDerived(r.setupSnapshot?.data);
    setSetupData(nextSetup);
    setActiveSetupData(nextSetup, nextCarId || carId || null);
    setSetupBaselineSnapshotId(r.setupSnapshot?.id ?? null);
    setSetupBaselineData(cloneSetupSnapshot(nextSetup));
    setNotes("");
    setLapIngest(defaultLapIngestValue());
    setReplicateLast(false);
  }, [dashboardPrefill, carsList]);

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

  const selectedCar = useMemo(() => carsList.find((c) => c.id === carId) ?? null, [carsList, carId]);
  const setupTemplate = useMemo(() => {
    if (isA800RRCar(selectedCar?.setupSheetTemplate)) return A800RR_SETUP_SHEET_V1;
    return getDefaultSetupSheetTemplate();
  }, [selectedCar?.setupSheetTemplate]);

  const loadedSetupRun = useMemo(
    () => (loadSetupSelection ? pickerRuns.find((r) => r.id === loadSetupSelection) ?? null : null),
    [loadSetupSelection, pickerRuns]
  );

  /**
   * How many parameters in `setupData` differ from `setupBaselineData` (the last-loaded /
   * last-saved snapshot). Zero when nothing has been edited since load, or when there's
   * no baseline yet (scratch setup). Drives the "X changes since loaded" badge in the
   * collapsed Setup view so drivers can see at a glance that they've touched the sheet
   * without having to re-expand it.
   */
  const setupChangedRowsSinceBaseline = useMemo(() => {
    if (!setupBaselineData) return [] as ReturnType<typeof buildSetupDiffRows>;
    return buildSetupDiffRows(setupData, setupBaselineData).filter((r) => r.changed);
  }, [setupData, setupBaselineData]);
  const setupChangeCountSinceBaseline = setupChangedRowsSinceBaseline.length;

  /** Prior run on this car exists → show “feel vs last run” (−3…+3). */
  const feelVsLastRunEligible = useMemo(() => {
    if (!carId) return false;
    if (isEditing && editRun?.id) {
      return pickerRuns.some((r) => r.id !== editRun.id);
    }
    return pickerRuns.length > 0;
  }, [carId, isEditing, editRun?.id, pickerRuns]);
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

  /** Same lists as dashboard: ActionItem rows (order matches GET /api/action-items?list=…). */
  useEffect(() => {
    if (isEditing) return;
    let alive = true;
    Promise.all([
      jsonFetch<{ items: Array<{ id: string; text: string }> }>("/api/action-items?list=try"),
      jsonFetch<{ items: Array<{ id: string; text: string }> }>("/api/action-items?list=do"),
    ])
      .then(([tryRes, doRes]) => {
        if (!alive) return;
        const tlines = (tryRes.items ?? []).map((i) => `• ${i.text.trim()}`).filter((l) => l.length > 2);
        setSuggestedChanges(tlines.length ? normalizeThingsToTryFromStorage(tlines.join("\n")) : "");
        const dlines = (doRes.items ?? []).map((i) => `• ${i.text.trim()}`).filter((l) => l.length > 2);
        setSuggestedPreRun(dlines.length ? normalizeThingsToTryFromStorage(dlines.join("\n")) : "");
      })
      .catch(() => {
        if (!alive) return;
      });
    return () => {
      alive = false;
    };
  }, [isEditing]);

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

  useEffect(() => {
    const t = tracksList.find((x) => x.id === trackId);
    if (t) {
      setTrackGripTags(Array.isArray(t.gripTags) ? [...t.gripTags] : []);
      setTrackLayoutTags(Array.isArray(t.layoutTags) ? [...t.layoutTags] : []);
    } else {
      setTrackGripTags([]);
      setTrackLayoutTags([]);
    }
  }, [trackId, tracksList]);

  /** Persist bullets to ActionItem rows while typing (dashboard uses same table). */
  useEffect(() => {
    if (!thingsToTryDirtyRef.current && !thingsToDoDirtyRef.current) return;
    const t = window.setTimeout(() => {
      if (!thingsToTryDirtyRef.current && !thingsToDoDirtyRef.current) return;
      const body: { suggestedChanges?: string | null; suggestedPreRun?: string | null } = {};
      if (thingsToTryDirtyRef.current) {
        body.suggestedChanges = suggestedChanges;
      }
      if (thingsToDoDirtyRef.current) {
        body.suggestedPreRun = suggestedPreRun;
      }
      if (Object.keys(body).length === 0) return;
      void fetch("/api/action-items/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((res) => {
          if (res.ok) {
            if ("suggestedChanges" in body) thingsToTryDirtyRef.current = false;
            if ("suggestedPreRun" in body) thingsToDoDirtyRef.current = false;
          }
        })
        .catch(() => {
          /* keep dirty for retry on next edit */
        });
    }, 900);
    return () => window.clearTimeout(t);
  }, [suggestedChanges, suggestedPreRun]);

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

  function handleSetupSourceChange(next: "previous_runs" | "other" | "new") {
    setSetupSource(next);
    if (next === "new") {
      setLoadSetupSelection("");
      setLoadOtherSetupSelection("");
      const empty = setupSnapshotWithDerived({});
      setSetupData(empty);
      setActiveSetupData(empty, carId || null);
      setSetupBaselineSnapshotId(null);
      setSetupBaselineData(cloneSetupSnapshot(empty));
      return;
    }
    if (next === "previous_runs") {
      const r = pickerRuns.find((x) => x.id === loadSetupSelection);
      setSetupBaselineSnapshotId(r?.setupSnapshot?.id ?? null);
    } else {
      const d = downloadedSetups.find((x) => x.id === loadOtherSetupSelection);
      setSetupBaselineSnapshotId(d?.baselineSetupSnapshotId ?? null);
    }
  }

  function applyPastSetupOnly(runId: string) {
    setSetupSource("previous_runs");
    if (!runId) {
      setLoadSetupSelection("");
      setSetupBaselineSnapshotId(null);
      setSetupBaselineData(null);
      return;
    }
    const picked = pickerRuns.find((r) => r.id === runId);
    if (!picked) return;
    setLoadSetupSelection(runId);
    const next = setupSnapshotWithDerived(picked.setupSnapshot?.data);
    setSetupData(next);
    setActiveSetupData(next, carId || null);
    setSetupBaselineSnapshotId(picked.setupSnapshot?.id ?? null);
    setSetupBaselineData(cloneSetupSnapshot(next));
  }

  /**
   * "Save setup snapshot to this run" handler.
   *
   *  - In edit mode (`isEditing`): PATCH `/api/runs/<id>/setup-snapshot` with the
   *    current `setupData`; server creates a new `SetupSnapshot` (delta vs existing)
   *    and re-points `Run.setupSnapshotId` at it. On success we re-baseline locally
   *    so the "X changes since loaded" badge resets, and collapse the expanded sheet.
   *  - In new-run mode: no run exists yet, so we just re-baseline the in-memory
   *    setup (locks the current values in as the new "loaded" state) and collapse.
   */
  async function handleSaveSetupSnapshot() {
    setSetupSnapshotSaveStatus(null);
    if (isEditing && editRun?.id) {
      setSetupSnapshotSaving(true);
      try {
        const res = await fetch(`/api/runs/${editRun.id}/setup-snapshot`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setupData }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          snapshot?: { id: string; data: SetupSnapshotData };
        };
        if (!res.ok || !json.ok || !json.snapshot) {
          throw new Error(json.error ?? `HTTP ${res.status}`);
        }
        const merged = setupSnapshotWithDerived(json.snapshot.data);
        setSetupData(merged);
        setActiveSetupData(merged, carId || null);
        setSetupBaselineSnapshotId(json.snapshot.id);
        setSetupBaselineData(cloneSetupSnapshot(merged));
        setSetupSectionExpanded(false);
        setSetupSnapshotSaveStatus({ kind: "ok", text: "Setup snapshot saved to this run." });
      } catch (err) {
        setSetupSnapshotSaveStatus({
          kind: "error",
          text: err instanceof Error ? err.message : "Failed to save setup snapshot.",
        });
      } finally {
        setSetupSnapshotSaving(false);
      }
      return;
    }
    // New-run mode: just re-baseline locally.
    setSetupBaselineData(cloneSetupSnapshot(setupData));
    setSetupSectionExpanded(false);
    setSetupSnapshotSaveStatus({ kind: "ok", text: "Setup locked in; will save with the run." });
  }

  function applyDownloadedSetupOnly(docId: string) {
    setSetupSource("other");
    if (!docId) {
      setLoadOtherSetupSelection("");
      setSetupBaselineSnapshotId(null);
      setSetupBaselineData(null);
      return;
    }
    const picked = downloadedSetups.find((d) => d.id === docId);
    if (!picked) return;
    setLoadOtherSetupSelection(docId);
    const next = setupSnapshotWithDerived(picked.setupData);
    setSetupData(next);
    setActiveSetupData(next, picked.carId ?? carId ?? null);
    setSetupBaselineSnapshotId(picked.baselineSetupSnapshotId ?? null);
    setSetupBaselineData(cloneSetupSnapshot(next));
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

  useLayoutEffect(() => {
    const el = thingsDoRef.current;
    const pos = thingsDoCursorRef.current;
    if (pos != null && el) {
      thingsDoCursorRef.current = null;
      try {
        el.focus();
        el.setSelectionRange(pos, pos);
      } catch {
        /* ignore */
      }
    }
  }, [suggestedPreRun]);

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

  function handleThingsToDoKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return;
    if (e.nativeEvent.isComposing) return;
    thingsToDoDirtyRef.current = true;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const v = suggestedPreRun;
    if (v.length === 0) {
      const insert = "• ";
      thingsDoCursorRef.current = insert.length;
      setSuggestedPreRun(insert);
      return;
    }
    const insert = "\n• ";
    const next = v.slice(0, start) + insert + v.slice(end);
    thingsDoCursorRef.current = start + insert.length;
    setSuggestedPreRun(next);
  }

  function handleThingsToDoChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    thingsToDoDirtyRef.current = true;
    const raw = e.target.value;
    if (raw === "") {
      setSuggestedPreRun("");
      return;
    }
    const nl = raw.indexOf("\n");
    const firstRaw = nl === -1 ? raw : raw.slice(0, nl);
    const afterFirst = nl === -1 ? "" : raw.slice(nl);
    if (firstRaw.startsWith("• ")) {
      setSuggestedPreRun(raw);
      return;
    }
    const fixedFirst = "• " + firstRaw.replace(/^\s*•\s?/, "");
    const next = fixedFirst + afterFirst;
    const delta = fixedFirst.length - firstRaw.length;
    const start = e.target.selectionStart ?? 0;
    const end = e.target.selectionEnd ?? 0;
    const adjust = (pos: number) =>
      pos <= firstRaw.length ? Math.min(pos + delta, fixedFirst.length) : pos + delta;
    thingsDoCursorRef.current = start === end ? adjust(start) : adjust(Math.max(start, end));
    setSuggestedPreRun(next);
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
          if (typeof lastRun.practiceDayUrl === "string" && lastRun.practiceDayUrl.trim()) {
            setPracticeDayUrl(lastRun.practiceDayUrl);
          }
          const nextSetup = setupSnapshotWithDerived(lastRun.setupSnapshot?.data);
          setSetupData(nextSetup);
          setActiveSetupData(nextSetup, carId || null);
          setSetupBaselineSnapshotId(lastRun.setupSnapshot?.id ?? null);
          setSetupBaselineData(cloneSetupSnapshot(nextSetup));
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
    if (typeof lastRun.practiceDayUrl === "string" && lastRun.practiceDayUrl.trim()) {
      setPracticeDayUrl(lastRun.practiceDayUrl);
    }
    const nextSetup = setupSnapshotWithDerived(lastRun.setupSnapshot?.data);
    setSetupData(nextSetup);
    setActiveSetupData(nextSetup, carId || null);
    setSetupBaselineSnapshotId(lastRun.setupSnapshot?.id ?? null);
    setSetupBaselineData(cloneSetupSnapshot(nextSetup));
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

  useEffect(() => {
    if (!needsEvent || !eventId) {
      setEventPracticeTimingUrl("");
      setEventRaceTimingUrl("");
      return;
    }
    const ev = events.find((e) => e.id === eventId);
    if (!ev) return;
    setEventPracticeTimingUrl(ev.practiceSourceUrl?.trim() ?? "");
    setEventRaceTimingUrl(ev.resultsSourceUrl?.trim() ?? "");
  }, [needsEvent, eventId, events]);

  function applyCopyFromPreview() {
    const r = copyPreviewRun;
    if (!r) return;
    const prevCarId = carId;
    const nextCarId = (r.carId || r.car?.id || "").toString();
    if (nextCarId && carsList.some((c) => c.id === nextCarId)) {
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
      setSetupBaselineData(null);
    }
    const copied = setupSnapshotWithDerived(r.setupSnapshot?.data);
    setSetupData(copied);
    setActiveSetupData(copied, nextCarId || prevCarId || null);
    setSetupBaselineSnapshotId(r.setupSnapshot?.id ?? null);
    setSetupBaselineData(cloneSetupSnapshot(copied));
    if (typeof r.practiceDayUrl === "string" && r.practiceDayUrl.trim()) {
      setPracticeDayUrl(r.practiceDayUrl);
    }
    // Session-specific text and laps are not copied — only structured fields + setup above.
    setNotes("");
    setLapIngest(defaultLapIngestValue());
    setLoadSetupSelection(r.id);
    setSetupSource("previous_runs");
    setReplicateLast(true);
  }

  useEffect(() => {
    tireRunUserTouchedRef.current = false;
  }, [tireSetId]);

  useEffect(() => {
    if (!tireSetId) return;
    const id = tireSetId;
    let alive = true;
    // When editing, exclude this run from the "most recent slot" query.
    // Otherwise, a run being re-saved would see itself as the latest,
    // adding +1 to its own tireRunNumber every time.
    const excludeParam = editRun?.id
      ? `&excludeRunId=${encodeURIComponent(editRun.id)}`
      : "";
    jsonFetch<{ lastTireRunNumber: number | null }>(
      `/api/runs/last-tire-run-number?tireSetId=${encodeURIComponent(id)}${excludeParam}`
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
  }, [tireSetId, editRun?.id]);

  useEffect(() => {
    batteryRunUserTouchedRef.current = false;
  }, [batteryId]);

  useEffect(() => {
    if (!batteryId) return;
    const id = batteryId;
    let alive = true;
    const excludeParam = editRun?.id
      ? `&excludeRunId=${encodeURIComponent(editRun.id)}`
      : "";
    jsonFetch<{ lastBatteryRunNumber: number | null }>(
      `/api/runs/last-battery-run-number?batteryId=${encodeURIComponent(id)}${excludeParam}`
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
  }, [batteryId, editRun?.id]);

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
          practiceSourceUrl: newEventPracticeUrl.trim() || null,
          resultsSourceUrl: newEventResultsUrl.trim() || null,
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
      setNewEventPracticeUrl("");
      setNewEventResultsUrl("");
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
      const sessionCompletedAt = resolveImportedSessionDisplayTimeIso({
        sessionCompletedAt: block.sessionCompletedAtDbIso ?? null,
        parsedPayload:
          block.sessionCompletedAtIso != null && block.sessionCompletedAtIso.trim()
            ? { sessionCompletedAtIso: block.sessionCompletedAtIso.trim() }
            : undefined,
        createdAt: block.recordedAt,
      });
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

  async function saveRun(
    e?: React.MouseEvent,
    intent: "draft" | "completed" = "completed",
    opts: { bypassUnsavedSetupCheck?: boolean } = {}
  ) {
    e?.preventDefault();
    setInlineError(null);
    setStatus(null);
    if (!carId) {
      setInlineError("Select a car.");
      return;
    }
    // Surface unsaved setup edits before we write — the driver gets to review
    // exactly what they changed vs. the loaded baseline. Continuing from the
    // confirmation passes `bypassUnsavedSetupCheck: true` so we don't loop.
    if (
      !opts.bypassUnsavedSetupCheck &&
      setupChangedRowsSinceBaseline.length > 0 &&
      setupBaselineData
    ) {
      setPendingSaveIntent(intent);
      return;
    }
    setPendingSaveIntent(null);
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
          loggingIntent: intent,
          fromEventDetection:
            !isEditing &&
            dashboardPrefill?.mode === "imported_lap_session" &&
            dashboardPrefill.fromEventDetection === true,
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
          practiceDayUrl: (() => {
            if (sessionType === "TESTING" && practiceDayUrl.trim()) return practiceDayUrl.trim();
            if (sessionType === "RACE_MEETING" && eventId && eventPracticeTimingUrl.trim()) {
              return eventPracticeTimingUrl.trim();
            }
            return null;
          })(),
          raceClass: raceClass.trim() || null,
          suggestedChanges: suggestedChanges.trim() || null,
          suggestedPreRun: suggestedPreRun.trim() || null,
          handlingAssessmentJson: persistedFromUiState(handlingUi),
          shareWithTeam,
          sessionLabel: null,
          importedLapSets,
          importedLapTimeSessionIds:
            lapIngest.sourceKind === "url"
              ? lapIngest.urlImportBlocks.map((b) => b.importedSessionId)
              : [],
        })
      });

      setSaveSuccess(true);
      setStatus(isEditing ? "Changes saved." : "Run saved.");

      if (sessionType === "RACE_MEETING" && needsEvent && eventId) {
        const p = eventPracticeTimingUrl.trim() || null;
        const r = eventRaceTimingUrl.trim() || null;
        void fetch(`/api/events/${encodeURIComponent(eventId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ practiceSourceUrl: p, resultsSourceUrl: r }),
        })
          .then((res) => {
            if (!res.ok) return;
            setEvents((prev) =>
              prev.map((e) =>
                e.id === eventId ? { ...e, practiceSourceUrl: p, resultsSourceUrl: r } : e
              )
            );
          })
          .catch(() => {});
      }

      if (sessionType === "TESTING" && practiceDayUrl.trim()) {
        void fetch("/api/settings/current-practice-day-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPracticeDayUrl: practiceDayUrl.trim() }),
        }).catch(() => {});
      }

      // Completing a run ships the driver over to Sessions with the newest
      // test day pre-expanded — they can scan laps/notes for the session they
      // just finished without first navigating away from a form that no
      // longer has anything to do. Drafts stay put: editing goes back to the
      // dashboard (or stays on the edit page to keep iterating).
      if (intent === "completed") {
        setTimeout(() => {
          router.push("/runs/history?expandLatest=1");
        }, 600);
      } else if (isEditing) {
        const { lastRun: refreshed } = await jsonFetch<{ lastRun: LastRun | null }>(
          `/api/runs/last?carId=${carId}`
        ).catch(() => ({ lastRun: null }));
        setLastRun(refreshed);
        if (replicateLast && refreshed) {
          setRunsCompleted(refreshed.tireRunNumber ?? 0);
          setBatteryRunsCompleted(refreshed.batteryRunNumber ?? 0);
        }
      } else {
        // New run saved as draft: send the driver back to the dashboard.
        // Prevents the tire/battery counters from re-anchoring on this
        // just-saved draft (which caused a double-increment when they
        // returned to finish it).
        setTimeout(() => {
          router.push("/");
        }, 600);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save run";
      setStatus(msg);
      setInlineError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function persistTrackPatch(overrides?: { gripTags?: string[]; layoutTags?: string[] }) {
    if (!trackId) return;
    const gripTags = overrides?.gripTags ?? trackGripTags;
    const layoutTags = overrides?.layoutTags ?? trackLayoutTags;
    try {
      const res = await fetch(`/api/tracks/${encodeURIComponent(trackId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gripTags,
          layoutTags,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { track?: TrackOption };
      if (res.ok && data.track) {
        setTracksList((prev) => prev.map((x) => (x.id === trackId ? { ...x, ...data.track } : x)));
      }
    } catch {
      /* ignore */
    }
  }

  return (
    <form
      className="max-w-3xl space-y-4"
      onSubmit={(e) => e.preventDefault()}
      noValidate
    >
      {carsList.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          <p>
            You need a car to log a run. Open{" "}
            <Link href="/cars" className="text-accent underline font-medium">
              Car Manager
            </Link>{" "}
            to add one, then return here.
          </p>
        </div>
      ) : null}

      {isEditing && editRun?.id && editRun.importedLapSets && editRun.importedLapSets.length >= 2 ? (
        <div className="space-y-2">
          <ImportedFieldSessionCard importedLapSets={editRun.importedLapSets} />
        </div>
      ) : null}

      {/* Copy last run shortcut (optional) — hidden when finishing a draft,
          since the run already has its own baseline nailed down. */}
      {!isDraft ? (
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
      ) : null}

      <div className="flex items-center gap-3 pt-2">
        <div className="h-px flex-1 bg-border/60" />
        <div className="flex flex-col items-center">
          <div className="ui-title text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Before the run
          </div>
          <div className="text-[11px] text-muted-foreground/80">
            Car, tires, battery, setup
          </div>
        </div>
        <div className="h-px flex-1 bg-border/60" />
      </div>

      {/* 2. Session type: Testing or Race Meeting only */}
      <div
        className={cn(
          "rounded-lg border p-4",
          isDraft
            ? "border-emerald-500/40 bg-emerald-500/5"
            : "border-border bg-muted/70"
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="ui-title text-sm text-muted-foreground">Session type</div>
            {isDraft ? (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
                title="This was saved when the draft was logged. Click Edit to change."
              >
                <span aria-hidden>✓</span>
                <span>Saved from draft</span>
              </span>
            ) : null}
          </div>
          {isDraft ? (
            <button
              type="button"
              onClick={() => setSessionExpanded((v) => !v)}
              className="rounded-md border border-border bg-card/60 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition"
            >
              {sessionExpanded ? "Done" : "Edit"}
            </button>
          ) : null}
        </div>
        {isDraft && !sessionExpanded ? (
          // Static summary when finishing a draft. Shows enough to confirm the
          // right session context without re-rendering the radios + URL field.
          <div className="mt-2 text-xs text-foreground/90">
            {sessionType === "TESTING" ? (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-medium">Testing</span>
                {practiceDayUrl.trim() ? (
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                    Practice day URL set
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-medium">Race Meeting</span>
                {(() => {
                  const ev = events.find((e) => e.id === eventId);
                  if (!ev) return null;
                  return (
                    <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                      {ev.name}
                    </span>
                  );
                })()}
                <span className="text-[11px] text-muted-foreground">
                  {meetingSessionType === "OTHER" && meetingSessionCustom.trim()
                    ? meetingSessionCustom.trim()
                    : meetingSessionType.charAt(0) +
                      meetingSessionType.slice(1).toLowerCase()}
                </span>
                {eventPracticeTimingUrl.trim() ? (
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                    Practice timing URL set
                  </span>
                ) : null}
                {eventRaceTimingUrl.trim() ? (
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                    Race timing URL set
                  </span>
                ) : null}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap gap-4">
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
            {sessionType === "TESTING" ? (
              <div className="mt-3 space-y-1 text-sm">
                <label
                  htmlFor="practice-day-url-input"
                  className="block text-xs font-medium text-muted-foreground"
                >
                  Practice day URL (optional)
                </label>
                <input
                  id="practice-day-url-input"
                  type="url"
                  value={practiceDayUrl}
                  onChange={(e) => setPracticeDayUrl(e.target.value)}
                  placeholder="https://example.liverc.com/…/practice/?p=session_list&d=YYYY-MM-DD"
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/50"
                  aria-label="Practice day results URL"
                />
                <p className="text-[11px] text-muted-foreground">
                  Lap Times → <span className="font-medium text-foreground">URL</span> will scan this page for your
                  driver sessions. Persists across runs (stored under Settings → current practice day URL).
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>

      {needsEvent && (sessionExpanded || !isDraft) ? (
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

          {eventId ? (
            <div className="mt-2 space-y-2 text-sm">
              <div className="space-y-1">
                <label
                  htmlFor="event-practice-timing-url"
                  className="block text-xs font-medium text-muted-foreground"
                >
                  Practice timing URL (optional)
                </label>
                <input
                  id="event-practice-timing-url"
                  type="url"
                  value={eventPracticeTimingUrl}
                  onChange={(e) => setEventPracticeTimingUrl(e.target.value)}
                  placeholder="LiveRC practice session list URL"
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs outline-none"
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="event-race-timing-url"
                  className="block text-xs font-medium text-muted-foreground"
                >
                  Race timing URL (optional)
                </label>
                <input
                  id="event-race-timing-url"
                  type="url"
                  value={eventRaceTimingUrl}
                  onChange={(e) => setEventRaceTimingUrl(e.target.value)}
                  placeholder="LiveRC results / race timing page URL"
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs outline-none"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Saved on the event when you save this run. The Lap times → URL flow uses the practice link for
                this meeting.
              </p>
            </div>
          ) : null}

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
              <div className="space-y-1">
                <label className="block text-[11px] text-muted-foreground">Practice timing URL (optional)</label>
                <input
                  type="url"
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs outline-none"
                  value={newEventPracticeUrl}
                  onChange={(e) => setNewEventPracticeUrl(e.target.value)}
                  placeholder="LiveRC practice session list URL"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[11px] text-muted-foreground">Race timing URL (optional)</label>
                <input
                  type="url"
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs outline-none"
                  value={newEventResultsUrl}
                  onChange={(e) => setNewEventResultsUrl(e.target.value)}
                  placeholder="LiveRC results / race timing page URL"
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

      <div
        className={cn(
          "rounded-lg border p-4 space-y-3",
          isDraft
            ? "border-emerald-500/40 bg-emerald-500/5"
            : "border-border bg-muted/50"
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="ui-title text-sm text-muted-foreground">Run details</div>
            {isDraft ? (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
                title="This was saved when the draft was logged. Click Edit to change."
              >
                <span aria-hidden>✓</span>
                <span>Saved from draft</span>
              </span>
            ) : null}
          </div>
          {isDraft ? (
            <button
              type="button"
              onClick={() => setRunDetailsExpanded((v) => !v)}
              className="rounded-md border border-border bg-card/60 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition"
            >
              {runDetailsExpanded ? "Done" : "Edit"}
            </button>
          ) : null}
        </div>
        {isDraft && !runDetailsExpanded ? (
          // Static run-details summary while finishing a draft. The tabs +
          // editors stay mounted only when the user hits Edit — this block
          // just shows enough for them to confirm nothing's amiss.
          <div className="grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1 text-[11px] sm:grid-cols-[5rem_1fr]">
            <span className="text-muted-foreground">Car</span>
            <span className="min-w-0 truncate font-medium text-foreground">
              {selectedCar?.name ?? "—"}
            </span>
            <span className="text-muted-foreground">Track</span>
            <span className="min-w-0 truncate text-foreground/90">
              {tracksList.find((t) => t.id === trackId)?.name ?? "—"}
            </span>
            <span className="text-muted-foreground">Tires</span>
            <span className="min-w-0 truncate text-foreground/90">
              {(() => {
                const t = tireSets.find((x) => x.id === tireSetId);
                if (!t) return "—";
                return `${t.label}${t.setNumber != null ? ` #${t.setNumber}` : ""}`;
              })()}
            </span>
            <span className="text-muted-foreground">Battery</span>
            <span className="min-w-0 truncate text-foreground/90">
              {(() => {
                const b = batteries.find((x) => x.id === batteryId);
                if (!b) return "—";
                return `${b.label}${b.packNumber != null ? ` #${b.packNumber}` : ""}`;
              })()}
            </span>
          </div>
        ) : (
          <>
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
              <div className="flex items-center justify-between gap-2">
                <div className="ui-title text-sm text-muted-foreground">Car</div>
                <Link
                  href="/cars"
                  className="rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition"
                >
                  Car Manager
                </Link>
              </div>
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
                    setSetupBaselineData(null);
                    setSetupData({});
                    setActiveSetupData({}, next);
                  }
                }}
                aria-label="Car"
              >
                {carsList.map((c) => (
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
            {/* Race class (optional) field intentionally hidden from Log Your Run.
                `raceClass` state + save payload are kept so the feature can be re-enabled later. */}
          </div>
        ) : null}

        {runDetailsTab === "track" ? (
          <div className="space-y-4 pt-1">
            <div className="space-y-1 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="ui-title text-sm text-muted-foreground">Track</div>
                <Link
                  href="/tracks"
                  className="rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition"
                >
                  Track library
                </Link>
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

            {trackId ? (
              <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3">
                <div className="ui-title text-xs uppercase tracking-wide text-muted-foreground">
                  Track details (saved on track)
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Tap chips to describe grip and layout; you can select multiple (e.g. medium + high grip).
                </p>
                <TrackMetaChipGroups
                  gripTags={trackGripTags}
                  layoutTags={trackLayoutTags}
                  onGripChange={(next) => {
                    setTrackGripTags(next);
                    void persistTrackPatch({ gripTags: next });
                  }}
                  onLayoutChange={(next) => {
                    setTrackLayoutTags(next);
                    void persistTrackPatch({ layoutTags: next });
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {runDetailsTab === "tires" ? (
          <div className="space-y-4 pt-1">
            <div className="space-y-2 text-sm">
              <p className="text-[11px] text-muted-foreground leading-snug rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
                Saved setup snapshot always stores the tire set and battery pack selected here for this run, even if the setup preview below still shows values from a loaded previous setup.
              </p>
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
          </>
        )}
      </div>

      <div
        ref={setupSectionRef}
        className={cn(
          "rounded-lg border p-4 space-y-4 transition-colors",
          // Green "Saved from draft" treatment when the user is finishing a
          // draft run and the sheet is collapsed. Non-draft edits keep the
          // default muted background.
          isDraft && !setupSectionExpanded && setupBaselineData
            ? "border-emerald-500/40 bg-emerald-500/5"
            : "border-border bg-muted/50"
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="ui-title text-sm text-muted-foreground">Setup</div>
            {isDraft && !setupSectionExpanded && setupBaselineData ? (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
                title="This was saved when the draft was logged. Click Edit to change."
              >
                <span aria-hidden>✓</span>
                <span>Saved from draft</span>
              </span>
            ) : null}
            {setupChangeCountSinceBaseline > 0 ? (
              <span
                className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
                title="Number of parameters that differ from the loaded setup."
              >
                {setupChangeCountSinceBaseline} change{setupChangeCountSinceBaseline === 1 ? "" : "s"} since loaded
              </span>
            ) : null}
          </div>
          {isDraft && !setupSectionExpanded ? (
            <button
              type="button"
              onClick={() => setSetupSectionExpanded(true)}
              className="rounded-md border border-border bg-card/60 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition"
            >
              Edit
            </button>
          ) : null}
        </div>
        {!setupSectionExpanded ? (
          isDraft ? (
            // Minimal draft view: just the diff rows vs. the loaded baseline.
            // Source picker + "Change source" button are not rendered — the
            // setup was already chosen when the draft was saved, so showing
            // "Choose a run…" here just looks unfinished.
            setupChangedRowsSinceBaseline.length > 0 ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
                <div className="mb-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  Changes from{" "}
                  {setupSource === "previous_runs" && loadedSetupRun
                    ? loadSetupControlLabel
                    : setupSource === "other" && selectedDownloadedSetup
                      ? loadOtherSetupLabel
                      : setupSource === "new"
                        ? "a new blank setup"
                        : "the loaded setup"}
                  :
                </div>
                <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
                  {setupChangedRowsSinceBaseline.map((r) => (
                    <li key={r.key} className="flex flex-wrap items-baseline gap-1">
                      <span className="truncate font-medium text-foreground">{r.label}</span>
                      {r.unit ? <span className="text-[10px] text-muted-foreground">({r.unit})</span> : null}
                      <span className="ml-auto font-mono tabular-nums text-muted-foreground">
                        <span className="line-through opacity-70">{r.previous ?? "—"}</span>
                        <span className="mx-1 text-foreground/60">→</span>
                        <span className="font-semibold text-foreground">{r.current || "—"}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground">
                No changes from the loaded setup.
              </div>
            )
          ) : (
          <div className="space-y-3">
            <div className="flex flex-col gap-3 max-w-2xl">
              {isEditing && !showSetupSourceControls ? (
                // Lean "locked in" summary: just what setup this run was built
                // from + the edit affordances. The source picker is tucked
                // behind an explicit opt-in so drivers finishing a draft aren't
                // nagged with "Choose a run…" when the answer's already known.
                <div className="space-y-1 text-sm">
                  <div className="text-sm font-medium text-muted-foreground">Setup used</div>
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-500/30 bg-card/60 px-3 py-2 text-xs">
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {setupSource === "previous_runs" && loadedSetupRun
                        ? loadSetupControlLabel
                        : setupSource === "other" && selectedDownloadedSetup
                          ? loadOtherSetupLabel
                          : setupSource === "new"
                            ? "New blank setup"
                            : "This run's saved snapshot"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowSetupSourceControls(true)}
                      className="rounded border border-border bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground transition"
                    >
                      Change source
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium text-muted-foreground">Setup source</div>
                      {isEditing ? (
                        <button
                          type="button"
                          onClick={() => setShowSetupSourceControls(false)}
                          className="text-[10px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground"
                          title="Hide the source controls and keep the current setup as-is."
                        >
                          Keep current
                        </button>
                      ) : null}
                    </div>
                    <select
                      className="w-full max-w-2xl rounded-md border border-border bg-card px-3 py-2 text-xs outline-none"
                      value={setupSource}
                      onChange={(e) =>
                        handleSetupSourceChange(
                          e.target.value as "previous_runs" | "other" | "new"
                        )
                      }
                    >
                      <option value="previous_runs">Setups from previous runs</option>
                      <option value="other">Other</option>
                      <option value="new">New</option>
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
                  ) : setupSource === "other" ? (
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
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Blank setup for this car — edit the sheet below, or lock in when you are ready.
                    </p>
                  )}
                </>
              )}
              <button
                type="button"
                onClick={() => setSetupSectionExpanded(true)}
                className="self-start rounded-md border border-border bg-muted/70 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition"
              >
                Edit setup
              </button>
            </div>
            {setupChangedRowsSinceBaseline.length > 0 ? (
              <div className="max-w-2xl rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
                <div className="mb-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  Setup is{" "}
                  {setupSource === "previous_runs" && loadedSetupRun
                    ? `from ${loadSetupControlLabel}`
                    : setupSource === "other" && selectedDownloadedSetup
                      ? `from ${loadOtherSetupLabel}`
                      : setupSource === "new"
                        ? "from a new blank setup"
                        : isEditing
                          ? "this run's saved snapshot"
                          : "the loaded baseline"}
                  {" "}with the following {setupChangedRowsSinceBaseline.length === 1 ? "change" : "changes"}:
                </div>
                <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
                  {setupChangedRowsSinceBaseline.map((r) => (
                    <li key={r.key} className="flex flex-wrap items-baseline gap-1">
                      <span className="truncate font-medium text-foreground">{r.label}</span>
                      {r.unit ? <span className="text-[10px] text-muted-foreground">({r.unit})</span> : null}
                      <span className="ml-auto font-mono tabular-nums text-muted-foreground">
                        <span className="line-through opacity-70">{r.previous ?? "—"}</span>
                        <span className="mx-1 text-foreground/60">→</span>
                        <span className="font-semibold text-foreground">{r.current || "—"}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {setupSource === "previous_runs" && pickerRuns.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No past runs yet, or list failed to load. You can choose <span className="font-medium">New</span> above
                to start from a blank sheet.
              </p>
            ) : null}
            {setupSource === "other" && downloadedSetups.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No parsed setups available for this car (or parse not run). Parse a PDF under Setup → Downloaded setups
                or bulk import, or pick a car that matches the setup’s assigned car when one is set. You can choose{" "}
                <span className="font-medium">New</span> to start blank.
              </p>
            ) : null}
          </div>
          )
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
            {setupSnapshotSaveStatus ? (
              <div
                className={`text-[11px] ${
                  setupSnapshotSaveStatus.kind === "error" ? "text-destructive" : "text-emerald-700 dark:text-emerald-300"
                }`}
              >
                {setupSnapshotSaveStatus.text}
              </div>
            ) : null}
            {/* Setup-changes free-text "Interpret changes" panel intentionally hidden from Log Your Run.
                State (setupChangesText/Busy/Error/Proposal) and handlers (interpretSetupChanges,
                applySetupChangesProposal) are kept in this file so the feature can be re-enabled
                by restoring the JSX block from git history. */}
            <div className="max-w-2xl space-y-2">
              <div className="space-y-1 text-sm">
                <div className="text-sm font-medium text-muted-foreground">Setup source</div>
                <select
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs outline-none"
                  value={setupSource}
                  onChange={(e) =>
                    handleSetupSourceChange(e.target.value as "previous_runs" | "other" | "new")
                  }
                >
                  <option value="previous_runs">Setups from previous runs</option>
                  <option value="other">Other</option>
                  <option value="new">New</option>
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
              ) : setupSource === "other" ? (
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
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Blank setup for this car — edit the sheet below, or lock in when you are ready.
                </p>
              )}
            </div>
            <SetupSheetView
              value={setupData}
              onChange={(next) => setSetupData(applyDerivedFieldsToSnapshot(next))}
              template={setupTemplate}
              enableFieldSearch
            />
            {setupSource === "previous_runs" && pickerRuns.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No past runs yet, or list failed to load. You can choose <span className="font-medium">New</span> above
                to start from a blank sheet.
              </p>
            ) : null}
            {setupSource === "other" && downloadedSetups.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No parsed setups available for this car (or parse not run). Parse a PDF under Setup → Downloaded setups
                or bulk import, or pick a car that matches the setup’s assigned car when one is set. You can choose{" "}
                <span className="font-medium">New</span> to start blank.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
              <p className="text-[11px] text-muted-foreground">
                Lock in the sheet as the new baseline so later changes show as deltas against it.
              </p>
              <button
                type="button"
                onClick={handleSaveSetupSnapshot}
                disabled={setupSnapshotSaving || setupChangeCountSinceBaseline === 0}
                className="rounded-md border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-300 transition"
                title={
                  setupChangeCountSinceBaseline === 0
                    ? "No changes to save — the setup is still identical to the loaded snapshot."
                    : isEditing
                      ? "Save the current sheet as a new snapshot attached to this run."
                      : "Lock in the current sheet so it counts as the loaded baseline."
                }
              >
                {setupSnapshotSaving
                  ? "Saving…"
                  : isEditing
                    ? "Save setup snapshot to this run"
                    : "Lock in setup changes"}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <div
          className={cn(
            "h-px flex-1",
            isDraft ? "bg-amber-500/50" : "bg-border/60"
          )}
        />
        <div className="flex flex-col items-center">
          <div
            className={cn(
              "ui-title text-[11px] uppercase tracking-[0.18em]",
              isDraft ? "text-amber-600 dark:text-amber-300" : "text-muted-foreground"
            )}
          >
            After the run
          </div>
          <div
            className={cn(
              "text-[11px]",
              isDraft
                ? "text-amber-700/90 dark:text-amber-200/80"
                : "text-muted-foreground/80"
            )}
          >
            Lap times, notes, how it felt
          </div>
        </div>
        <div
          className={cn(
            "h-px flex-1",
            isDraft ? "bg-amber-500/50" : "bg-border/60"
          )}
        />
      </div>

      {isDraft ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-snug text-foreground">
          <span className="font-medium text-amber-700 dark:text-amber-300">
            Draft run.
          </span>{" "}
          Finish logging how the session went, then hit{" "}
          <span className="font-medium">Run complete</span> below to take it off the
          unfinished list.
        </div>
      ) : null}

      <LapTimesIngestPanel
        value={lapIngest}
        onChange={setLapIngest}
        practiceDayUrl={
          sessionType === "TESTING"
            ? practiceDayUrl.trim() || null
            : sessionType === "RACE_MEETING" && eventId
              ? eventPracticeTimingUrl.trim() || null
              : null
        }
      />

      <label className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 text-xs cursor-pointer select-none">
        <input
          type="checkbox"
          checked={shareWithTeam}
          onChange={(e) => setShareWithTeam(e.target.checked)}
          className="mt-0.5 shrink-0"
        />
        <span>
          <span className="font-medium text-foreground">Share this run with my teams</span>
          <span className="block text-muted-foreground mt-1 leading-snug">
            When off, people you share a team with will not see this run in Team Sessions or team-only Engineer lists.
            One-way teammate links are unchanged.
          </span>
        </span>
      </label>

      <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-3 text-sm">
        <div className="ui-title text-sm text-muted-foreground">Feedback</div>
        <div
          className="flex flex-wrap border-b border-border gap-x-0.5"
          role="tablist"
          aria-label="Notes, things to try, and pre-run reminders"
        >
          <button
            type="button"
            role="tab"
            aria-selected={notesSubTab === "notes"}
            className={cn(
              "px-3 sm:px-4 py-2 text-xs font-medium transition border-b-2 -mb-px",
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
              "px-3 sm:px-4 py-2 text-xs font-medium transition border-b-2 -mb-px",
              notesSubTab === "things"
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setNotesSubTab("things")}
          >
            Things to try
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={notesSubTab === "todo"}
            className={cn(
              "px-3 sm:px-4 py-2 text-xs font-medium transition border-b-2 -mb-px",
              notesSubTab === "todo"
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setNotesSubTab("todo")}
          >
            Things to do
          </button>
        </div>
        {notesSubTab === "notes" ? (
          <textarea
            className={cn(
              "h-32 w-full resize-none rounded-md border bg-card px-3 py-2 text-sm outline-none",
              isDraft && notes.trim().length === 0
                ? "border-amber-500/50 ring-1 ring-amber-500/30"
                : "border-border"
            )}
            placeholder={
              isDraft && notes.trim().length === 0
                ? "How did the run feel? Grip, balance, any issues, what you'd change…"
                : "Session notes, handling, track conditions…"
            }
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-label="Session notes"
          />
        ) : notesSubTab === "things" ? (
          <textarea
            ref={thingsTryRef}
            className="h-32 w-full resize-none rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
            placeholder="First character becomes a bullet line. Enter: new • line. Shift+Enter: line break inside an item."
            value={suggestedChanges}
            onChange={handleThingsToTryChange}
            onKeyDown={handleThingsToTryKeyDown}
            aria-label="Things to try"
          />
        ) : (
          <textarea
            ref={thingsDoRef}
            className="h-32 w-full resize-none rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
            placeholder="Double-check before the next run (droop screws, balance, a bolt…). Bullets and Enter work like Things to try."
            value={suggestedPreRun}
            onChange={handleThingsToDoChange}
            onKeyDown={handleThingsToDoKeyDown}
            aria-label="Things to do before next run"
          />
        )}
        <div className="pt-1">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition hover:bg-muted/50 hover:text-foreground"
            aria-expanded={handlingDetailExpanded}
            onClick={() => setHandlingDetailExpanded((v) => !v)}
          >
            <span>Handling detail (optional)</span>
            <span className="text-[10px] opacity-70">{handlingDetailExpanded ? "Hide" : "Show"}</span>
          </button>
          {handlingDetailExpanded ? (
            <div className="mt-2">
              <HandlingAssessmentFields
                value={handlingUi}
                onChange={setHandlingUi}
                feelVsLastRunEligible={feelVsLastRunEligible}
              />
            </div>
          ) : null}
        </div>
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

      {pendingSaveIntent ? (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-xs">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            Unsaved changes to setup
          </div>
          <p className="mt-1 text-[11px] leading-snug text-foreground/90">
            You&apos;ve edited{" "}
            <span className="font-medium">
              {setupChangedRowsSinceBaseline.length} parameter
              {setupChangedRowsSinceBaseline.length === 1 ? "" : "s"}
            </span>{" "}
            but haven&apos;t locked them into a new snapshot. Saving will include these
            changes with the run — review them first:
          </p>
          <ul className="mt-2 grid max-h-40 grid-cols-1 gap-x-4 gap-y-0.5 overflow-auto sm:grid-cols-2">
            {setupChangedRowsSinceBaseline.map((r) => (
              <li key={r.key} className="flex flex-wrap items-baseline gap-1">
                <span className="truncate font-medium text-foreground">{r.label}</span>
                {r.unit ? (
                  <span className="text-[10px] text-muted-foreground">({r.unit})</span>
                ) : null}
                <span className="ml-auto font-mono tabular-nums text-muted-foreground">
                  <span className="line-through opacity-70">{r.previous ?? "—"}</span>
                  <span className="mx-1 text-foreground/60">→</span>
                  <span className="font-semibold text-foreground">{r.current || "—"}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition"
              onClick={() => setPendingSaveIntent(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md border border-amber-500/60 bg-amber-500/20 px-3 py-1.5 text-[11px] font-medium text-amber-800 hover:bg-amber-500/30 dark:text-amber-200 transition"
              onClick={(e) =>
                saveRun(e, pendingSaveIntent, { bypassUnsavedSetupCheck: true })
              }
            >
              {pendingSaveIntent === "draft"
                ? "Save changes + save draft"
                : "Save changes + run complete"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] text-muted-foreground leading-snug sm:max-w-sm">
          <span className="font-medium text-foreground">Save draft</span> to come back and finish after the run.
          <span className="mx-1 text-muted-foreground/60">·</span>
          <span className="font-medium text-foreground">Run complete</span> when nothing else is left to add.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className={cn(
              "inline-flex items-center justify-center rounded-lg border border-border bg-card px-4 py-2 text-xs font-medium text-foreground shadow-sm transition hover:bg-muted/60",
              (!canSave || saving) && "opacity-70 pointer-events-none"
            )}
            onClick={(e) => saveRun(e, "draft")}
            disabled={!canSave || saving}
            aria-busy={saving}
            title="Save what you have so far and finish logging after the run."
          >
            {saving ? "Saving…" : saveSuccess ? "Saved" : "Save draft"}
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-glow-sm hover:brightness-105 transition",
              (!canSave || saving) && "opacity-70 pointer-events-none"
            )}
            onClick={(e) => saveRun(e, "completed")}
            disabled={!canSave || saving}
            aria-busy={saving}
            title="Mark this run finished. It will stop showing up in the incomplete-runs banner."
          >
            {saving ? "Saving…" : saveSuccess ? "Saved" : "Run complete"}
            <span className="text-sm leading-none" aria-hidden>
              🏁
            </span>
          </button>
        </div>
      </div>
    </form>
  );
}

