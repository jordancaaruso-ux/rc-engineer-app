"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import type { DashboardNewRunPrefill } from "@/lib/dashboardPrefillTypes";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow, PanelSubtitle } from "@/components/ui/panel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { coerceSetupValue, normalizeSetupData, parseLapTimes, type SetupSnapshotData } from "@/lib/runSetup";
import { applyDerivedFieldsToSnapshot } from "@/lib/setup/deriveRenderValues";
import { buildSetupDiffRows } from "@/lib/setupDiff";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import { getDefaultSetupSheetTemplate, type SetupSheetTemplate } from "@/lib/setupSheetTemplate";
import { isA800RRCar } from "@/lib/setupSheetTemplateId";
import { TrackCombobox } from "@/components/runs/TrackCombobox";
import { tireSelectionFromTireSet, tireSetDisplayLine } from "@/lib/tires/tireSelectionFromSet";
import { TireTypeCombobox, type TireTypeOption } from "@/components/tires/TireTypeCombobox";
import { RunTireSelectionPanel } from "@/components/runs/RunTireSelectionPanel";
import { formatEventDate, formatEventRelativeLabel, formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { type MeetingSessionType } from "@/lib/runSession";
import { setActiveSetupData, migrateLegacyLoadedSetup } from "@/lib/activeSetupContext";
import type { RunPickerRun } from "@/lib/runPickerFormat";
import { formatRunPickerLineRelativeWhen } from "@/lib/runPickerFormat";
import { CopyLastRunCard } from "@/components/runs/CopyLastRunCard";
import { useCopyLastRunFormOptional } from "@/components/runs/CopyLastRunFormContext";
import type { CopyPreviewRunRecord } from "@/lib/runs/copyPreviewRunTypes";
import { RunLogQuickSetupUpload } from "@/components/runs/RunLogQuickSetupUpload";
import { RunPickerSelect } from "@/components/runs/RunPickerSelect";
import { isEndDateBeforeStartDateYmd } from "@/lib/eventDateValidation";
import { normalizeLapTimes } from "@/lib/runLaps";
import type { LapRow } from "@/lib/lapAnalysis";
import { primaryLapRowsFromRun } from "@/lib/lapAnalysis";
import { primaryLapRowsFromImportedPayload, sessionCompletedAtIsoFromImportedPayload } from "@/lib/lapImport/fromPayload";
import { applyMedianBandAutoExclude } from "@/lib/lapImport/autoExcludeOutlierLaps";
import { buildImportedIngestPlanFromPayload } from "@/lib/lapImport/importedIngestPlan";
import { buildLapIngestFromEditRun } from "@/lib/lapImport/buildLapIngestFromEditRun";
import { resolveImportedSessionDisplayTimeIso } from "@/lib/lapImport/labels";
import {
  LapTimesIngestPanel,
  defaultLapIngestValue,
  type LapIngestFormValue,
} from "@/components/runs/LapTimesIngestPanel";
import { ImportedFieldSessionCard } from "@/components/runs/ImportedFieldSessionCard";
import { HandlingAssessmentFields } from "@/components/runs/HandlingAssessmentFields";
import { FeelVsLastRunQuickPick } from "@/components/runs/FeelVsLastRunQuickPick";
import { TrackLocationMarkDialog } from "@/components/tracks/TrackLocationMarkDialog";
import { trackHasMarkedLocation } from "@/lib/location/coordinates";
import { TrackNearbySuggestions } from "@/components/runs/TrackNearbySuggestions";
import {
  LiveRcRaceMeetingPrompt,
  type LiveRcMeetingDetection,
} from "@/components/runs/LiveRcRaceMeetingPrompt";
import { defaultEventDatesForLiveRcDetection } from "@/lib/lapWatch/liveRcMeetingDates";
import { getCurrentPosition, GeolocationRequestError } from "@/lib/location/getCurrentPosition";
import {
  DEFAULT_TRACK_PROXIMITY_RADIUS_M,
  pickTrackFromPosition,
} from "@/lib/location/trackProximity";
import {
  emptyHandlingAssessmentUiState,
  isHandlingAssessmentMeaningful,
  parseHandlingAssessmentJson,
  persistedFromUiState,
  uiStateFromParsed,
  type HandlingAssessmentUiState,
} from "@/lib/runHandlingAssessment";

type CarOption = {
  id: string;
  name: string;
  setupSheetTemplate?: string | null;
  setupSheetModelId?: string | null;
};
type TrackOption = {
  id: string;
  name: string;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  liveRcUrl?: string | null;
  speedhiveUrl?: string | null;
  gripTags?: string[];
  layoutTags?: string[];
};
type TireSetOption = {
  id: string;
  label: string;
  setNumber?: number;
  initialRunCount?: number;
  insertLabel?: string | null;
  wheelLabel?: string | null;
  specificModel?: string | null;
  tireTypeId?: string | null;
  tireType?: { id: string; displayName: string; modelCode: string } | null;
};
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
  /** Optional spec compound (same style as TireSet.label), e.g. Sweep 32. */
  controlledTireLabel?: string | null;
  controlledTireTypeId?: string | null;
  controlledTireType?: { id: string; displayName: string; modelCode: string } | null;
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
  tireSet?: {
    id: string;
    label: string;
    setNumber?: number | null;
    insertLabel?: string | null;
    wheelLabel?: string | null;
    specificModel?: string | null;
    tireTypeId?: string | null;
    tireType?: { id: string; displayName: string; modelCode: string } | null;
  } | null;
  batteryId?: string | null;
  batteryRunNumber?: number;
  battery?: { id: string; label: string; packNumber?: number | null } | null;
  notes?: string | null;
  driverNotes?: string | null;
  handlingProblems?: string | null;
  suggestedChanges?: string | null;
  suggestedPreRun?: string | null;
  handlingAssessmentJson?: unknown;
  /** Required 1-10 overall car rating captured when the run is marked complete. */
  carRating?: number | null;
  /** Session race class when not only from event (e.g. practice). */
  raceClass?: string | null;
  lapTimes?: unknown;
  lapSession?: unknown;
  importedLapSets?: Array<{
    driverName: string;
    displayName: string | null;
    isPrimaryUser: boolean;
    sourceUrl?: string | null;
    driverId?: string | null;
    sessionCompletedAt?: string | null;
    laps: Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded: boolean }>;
  }>;
  linkedImportedSessions?: Array<{
    id: string;
    sourceUrl: string;
    parserId: string;
    createdAt: string;
    sessionCompletedAt: string | null;
    parsedPayload: unknown;
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

function copyPreviewRecordToLastRun(r: CopyPreviewRunRecord): LastRun {
  return {
    ...r,
    carId: r.carId ?? undefined,
    event: r.event as LastRun["event"],
    createdAt:
      r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    sessionType: (r.sessionType ?? "TESTING") as LastRun["sessionType"],
    setupSnapshot: r.setupSnapshot ?? { id: "", data: {} },
    tireRunNumber: r.tireRunNumber ?? 0,
    batteryRunNumber: r.batteryRunNumber ?? 0,
  };
}

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

/** Which form areas were filled from copy-last-run (drives highlight until the driver touches the field). */
type LastRunPrefillHighlights = {
  session?: boolean;
  event?: boolean;
  car?: boolean;
  track?: boolean;
  tires?: boolean;
  battery?: boolean;
  setup?: boolean;
};

function prefillFieldClass(_active: boolean) {
  return "";
}

function PrefillBadge({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-accent/90">Prefilled</span>
  );
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
  /** Server-loaded last run for copy card (avoids client /api/runs/last-any round trip). */
  initialCopyPreviewRun?: CopyPreviewRunRecord | null;
}) {
  const router = useRouter();
  const copyLastRunCtx = useCopyLastRunFormOptional();
  const externalCopyLastRunCard = Boolean(copyLastRunCtx);
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
   * Legacy run field; lap import uses track LiveRC URL. Kept for edit-run hydrate only.
   */
  const [practiceDayUrl, setPracticeDayUrl] = useState<string>("");
  const [carId, setCarId] = useState<string>(props.cars[0]?.id ?? "");
  const [tracksList, setTracksList] = useState<TrackOption[]>(tracks);
  const [trackId, setTrackId] = useState<string>("");
  const [tireSets, setTireSets] = useState<TireSetOption[]>([]);
  const [tireSetId, setTireSetId] = useState<string>("");
  const [selectedTireTypeId, setSelectedTireTypeId] = useState<string>("");
  const [selectedTireType, setSelectedTireType] = useState<TireTypeOption | null>(null);
  const [tireSetNumber, setTireSetNumber] = useState<string>("");
  const [tireSpecificModel, setTireSpecificModel] = useState("");
  const [resolvingTireSet, setResolvingTireSet] = useState(false);
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
  const [newEventControlledTireTypeId, setNewEventControlledTireTypeId] = useState("");
  /** When logging a race meeting, timing URLs (stored on the Event; edited here, PATCH on save). */
  const [eventPracticeTimingUrl, setEventPracticeTimingUrl] = useState("");
  const [eventRaceTimingUrl, setEventRaceTimingUrl] = useState("");
  const [eventControlledTireTypeId, setEventControlledTireTypeId] = useState("");
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);

  const [replicateLast, setReplicateLast] = useState(false);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [replicateLoaded, setReplicateLoaded] = useState(false);

  const [copyPreviewRun, setCopyPreviewRun] = useState<LastRun | null>(() =>
    props.initialCopyPreviewRun ? copyPreviewRecordToLastRun(props.initialCopyPreviewRun) : null
  );
  const [lastRunCopyApplied, setLastRunCopyApplied] = useState(false);
  const [prefillHighlights, setPrefillHighlights] = useState<LastRunPrefillHighlights | null>(null);

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
  const [setupChangesText, setSetupChangesText] = useState("");
  const [setupChangesBusy, setSetupChangesBusy] = useState(false);
  const [setupChangesError, setSetupChangesError] = useState<string | null>(null);
  const [setupChangesProposal, setSetupChangesProposal] = useState<
    Array<{ fieldKey: string; fieldLabel: string; fromValue: string; toValue: string; confidence: "low" | "medium" | "high"; note?: string | null }>
  >([]);
  const [handlingUi, setHandlingUi] = useState<HandlingAssessmentUiState>(() => emptyHandlingAssessmentUiState());
  const [handlingDetailExpanded, setHandlingDetailExpanded] = useState(false);
  /** Required 1-10 overall car rating; null until the driver sets one. Server enforces presence at "Run complete". */
  const [carRating, setCarRating] = useState<number | null>(null);
  type RunDetailsTab = "car" | "tires" | "battery" | "conditions" | "track";
  const [runDetailsTab, setRunDetailsTab] = useState<RunDetailsTab>("car");
  const [trackSaveWarning, setTrackSaveWarning] = useState(false);

  const [showNewBatteryPanel, setShowNewBatteryPanel] = useState(false);
  const [creatingBattery, setCreatingBattery] = useState(false);
  const [newBatteryLabel, setNewBatteryLabel] = useState("");
  const [newBatteryPackNumber, setNewBatteryPackNumber] = useState<string>("1");
  const [newBatteryInitialRunCount, setNewBatteryInitialRunCount] = useState<number>(0);

  const [shareWithTeam, setShareWithTeam] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [, startCopyTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [completeValidation, setCompleteValidation] = useState<{
    show: boolean;
    carRating: boolean;
    feelVsLastRun: boolean;
  }>({ show: false, carRating: false, feelVsLastRun: false });

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
  const skipTireResolveRef = useRef(false);
  /** After a successful "Run complete", block duplicate POST/PUT until navigation away. */
  const pendingCompleteNavigationRef = useRef(false);
  const [trackLocationPrompt, setTrackLocationPrompt] = useState<{
    trackId: string;
    trackName: string;
    runId: string;
  } | null>(null);
  const [nearbyTrackSuggestions, setNearbyTrackSuggestions] = useState<
    { trackId: string; trackName: string; distanceM: number; isFavourite?: boolean }[]
  >([]);
  const [trackAutoDetectMessage, setTrackAutoDetectMessage] = useState<string | null>(null);
  const [trackAutoDetectLoading, setTrackAutoDetectLoading] = useState(false);
  const trackTabAutoDetectDoneRef = useRef(false);
  const trackPickedManuallyRef = useRef(false);
  const [liveRcMeeting, setLiveRcMeeting] = useState<LiveRcMeetingDetection | null>(null);
  const [liveRcMeetingBusy, setLiveRcMeetingBusy] = useState(false);
  const dismissedLiveRcMeetingRef = useRef<Set<string>>(new Set());

  const canSave = useMemo(() => Boolean(carId), [carId]);
  /** Race meeting only: event results/practice hub for lap scan fallback. Testing uses track LiveRC URL. */
  const lapTimesLiveRcScanIndexUrl = useMemo(() => {
    if (sessionType === "TESTING") return null;
    if (sessionType === "RACE_MEETING" && eventId) {
      const p = eventPracticeTimingUrl.trim();
      const r = eventRaceTimingUrl.trim();
      if (meetingSessionType === "PRACTICE") return p || r || null;
      return r || p || null;
    }
    return null;
  }, [
    sessionType,
    eventId,
    eventPracticeTimingUrl,
    eventRaceTimingUrl,
    meetingSessionType,
  ]);
  const editRun = props.editRun ?? null;
  const isEditing = Boolean(editRun?.id);
  /**
   * True when we're editing a run that was saved as a draft (user hit "Save
   * draft" earlier and hasn't marked it complete yet). Drives the amber
   * highlight on the "After the run" divider + the empty Notes textarea so
   * drivers can see what's still expected before clicking "Run complete".
   */
  const isDraft = isEditing && editRun?.loggingComplete === false;
  /** Run was already marked complete — edits must not flip back to draft or bump tire/battery run # (server enforces too). */
  const editingCompletedRun = isEditing && editRun?.loggingComplete === true;
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
  const feedbackRequiredRef = useRef<HTMLDivElement>(null);
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

  // Hydrate LiveRC driver settings on mount (Settings page is source of truth).
  useEffect(() => {
    void fetch("/api/settings/live-rc-driver").catch(() => {});
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
    if (r.tireSet) {
      skipTireResolveRef.current = true;
      if (r.tireSet.tireType) {
        setSelectedTireTypeId(r.tireSet.tireType.id);
        setSelectedTireType(r.tireSet.tireType);
      }
      setTireSetNumber(String(r.tireSet.setNumber ?? ""));
      setTireSpecificModel(r.tireSet.specificModel?.trim() ?? "");
    }
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
    const parsedHandling = parseHandlingAssessmentJson(r.handlingAssessmentJson);
    setHandlingUi(uiStateFromParsed(parsedHandling));
    setHandlingDetailExpanded(isHandlingAssessmentMeaningful(r.handlingAssessmentJson));
    setCarRating(
      typeof r.carRating === "number" && Number.isFinite(r.carRating) && r.carRating >= 1 && r.carRating <= 10
        ? Math.round(r.carRating)
        : null
    );

    setLapIngest(
      buildLapIngestFromEditRun({
        lapTimes: r.lapTimes ?? [],
        lapSession: r.lapSession,
        importedLapSets: r.importedLapSets,
        linkedImportedSessions: r.linkedImportedSessions,
      })
    );

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
        liveRcDriverId: sess.liveRcDriverId ?? null,
      });
      const parsed = plan
        ? null
        : primaryLapRowsFromImportedPayload(sess.parsedPayload);
      if (plan) {
        const driverLapRowsByDriverId: Record<string, LapRow[]> = {};
        for (const d of plan.sessionDrivers) {
          const raw = d.laps.map((t, i) => ({
            lapNumber: i + 1,
            lapTimeSeconds: t,
            isIncluded: true,
          }));
          driverLapRowsByDriverId[d.driverId] = applyMedianBandAutoExclude(raw);
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
                prefill: applyMedianBandAutoExclude(parsed.rows.map((r) => ({ ...r }))),
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

  function applyTireFieldsFromSet(ts: TireSetOption | null) {
    if (!ts) {
      setSelectedTireTypeId("");
      setSelectedTireType(null);
      setTireSetNumber("");
      setTireSpecificModel("");
      return;
    }
    if (ts.tireType) {
      setSelectedTireTypeId(ts.tireType.id);
      setSelectedTireType(ts.tireType);
    } else {
      setSelectedTireTypeId("");
      setSelectedTireType(null);
    }
    setTireSetNumber(ts.setNumber != null && ts.setNumber >= 1 ? String(ts.setNumber) : "");
    setTireSpecificModel(ts.specificModel?.trim() ?? "");
  }

  function applyTireBatteryToSetupSnapshot(nextTireSetId: string, nextBatteryId: string) {
    const tire = nextTireSetId ? tireSets.find((t) => t.id === nextTireSetId) ?? null : null;
    const bat = nextBatteryId ? batteries.find((b) => b.id === nextBatteryId) ?? null : null;
    const tireValue = tire ? tireSelectionFromTireSet(tire) : undefined;
    const batLabel = bat ? `${bat.label}${bat.packNumber != null ? ` #${bat.packNumber}` : ""}` : "";
    setSetupData((prev) => {
      const nextTires = tireValue || undefined;
      const nextBattery = batLabel || undefined;
      if (prev.tires === nextTires && prev.battery === nextBattery) return prev;
      return applyDerivedFieldsToSnapshot({
        ...prev,
        tires: nextTires,
        battery: nextBattery,
      });
    });
  }

  const resolveTireSet = useCallback(async () => {
    if (!selectedTireTypeId) return;
    const setParsed = parseInt(tireSetNumber.trim(), 10);
    if (!Number.isFinite(setParsed) || setParsed < 1) {
      setTireSetId("");
      return;
    }
    setResolvingTireSet(true);
    try {
      const res = await fetch("/api/tire-sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tireTypeId: selectedTireTypeId,
          setNumber: setParsed,
          specificModel: tireSpecificModel.trim() || null,
        }),
      });
      const data = (await res.json()) as { tireSet?: TireSetOption };
      if (!data.tireSet?.id) return;
      setTireSets((prev) => {
        const rest = prev.filter((t) => t.id !== data.tireSet!.id);
        return [data.tireSet!, ...rest];
      });
      setTireSetId(data.tireSet.id);
      applyTireBatteryToSetupSnapshot(data.tireSet.id, batteryIdRef.current);
    } catch {
      /* keep prior selection */
    } finally {
      setResolvingTireSet(false);
    }
  }, [selectedTireTypeId, tireSetNumber, tireSpecificModel, tireSets, batteries]);

  // Deterministic sync: snapshot tires/battery always mirror the run context selections,
  // including on initial load and when option lists arrive async.
  useEffect(() => {
    applyTireBatteryToSetupSnapshot(tireSetId, batteryId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tireSetId, batteryId, tireSets, batteries]);

  useEffect(() => {
    if (skipTireResolveRef.current) {
      skipTireResolveRef.current = false;
      return;
    }
    if (!selectedTireTypeId || !tireSetNumber.trim()) {
      setTireSetId("");
      return;
    }
    const setParsed = parseInt(tireSetNumber.trim(), 10);
    if (!Number.isFinite(setParsed) || setParsed < 1) {
      setTireSetId("");
      return;
    }
    const t = window.setTimeout(() => {
      void resolveTireSet();
    }, 400);
    return () => window.clearTimeout(t);
  }, [selectedTireTypeId, tireSetNumber, tireSpecificModel, resolveTireSet]);

  const selectedCar = useMemo(() => carsList.find((c) => c.id === carId) ?? null, [carsList, carId]);
  const [modelTemplate, setModelTemplate] = useState<SetupSheetTemplate | null>(null);

  useEffect(() => {
    if (!carId) {
      setModelTemplate(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/cars/${carId}/setup-sheet-template?view=logRun`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { template?: SetupSheetTemplate }) => {
        if (!cancelled && d.template) setModelTemplate(d.template);
      })
      .catch(() => {
        if (!cancelled) setModelTemplate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [carId, setupSectionExpanded]);

  const setupTemplate = useMemo(() => {
    if (modelTemplate) return modelTemplate;
    if (isA800RRCar(selectedCar?.setupSheetTemplate)) {
      return A800RR_SETUP_SHEET_V1;
    }
    return getDefaultSetupSheetTemplate();
  }, [modelTemplate, selectedCar?.setupSheetTemplate]);

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

  useEffect(() => {
    setCompleteValidation((prev) => {
      if (!prev.show) return prev;
      const carOk = carRating != null && carRating >= 1 && carRating <= 10;
      const feelOk = !feelVsLastRunEligible || handlingUi.feelVsLastRun != null;
      if (carOk && feelOk) {
        return { show: false, carRating: false, feelVsLastRun: false };
      }
      return {
        show: true,
        carRating: prev.carRating && !carOk,
        feelVsLastRun: prev.feelVsLastRun && !feelOk,
      };
    });
  }, [carRating, handlingUi.feelVsLastRun, feelVsLastRunEligible]);

  useEffect(() => {
    if (completeValidation.show) return;
    setInlineError((err) => (err?.startsWith("Before Run complete:") ? null : err));
  }, [completeValidation.show]);

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

  const eventSelectGroups = useMemo(() => {
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
    return { upcoming, past };
  }, [events]);

  const selectedEventForRun = useMemo(
    () => (needsEvent && eventId ? events.find((e) => e.id === eventId) ?? null : null),
    [needsEvent, eventId, events]
  );
  /** Race meeting + event with a track: run track follows the event (picker disabled). */
  const trackLockedToEvent = Boolean(selectedEventForRun?.trackId);

  const tracksGpsFingerprint = useMemo(
    () =>
      tracksList
        .filter((t) => trackHasMarkedLocation(t))
        .map((t) => `${t.id}:${t.latitude!.toFixed(5)},${t.longitude!.toFixed(5)}`)
        .sort()
        .join("|"),
    [tracksList]
  );

  const runTrackAutoDetect = useCallback(async () => {
    if (isEditing || trackLockedToEvent || trackPickedManuallyRef.current) return;
    if (tracksList.filter((t) => trackHasMarkedLocation(t)).length === 0) {
      setTrackAutoDetectMessage(
        "No tracks have GPS saved yet. Open Track library to paste coordinates from Google Maps, then try again."
      );
      return;
    }
    setTrackAutoDetectLoading(true);
    setTrackAutoDetectMessage(null);
    setNearbyTrackSuggestions([]);
    try {
      const position = await getCurrentPosition();
      const pick = pickTrackFromPosition(tracksList, position, {
        radiusMeters: DEFAULT_TRACK_PROXIMITY_RADIUS_M,
        favouriteTrackIds,
      });
      if (pick.kind === "no_marked_tracks") {
        setTrackAutoDetectMessage(
          "No tracks have GPS saved yet. Open Track library to paste coordinates from Google Maps, then try again."
        );
        return;
      }
      if (pick.kind === "single") {
        setTrackId(pick.track.id);
        setCopyTrackWarning(null);
        setTrackAutoDetectMessage(`Detected ${pick.track.name} (${Math.round(pick.distanceM)} m away).`);
        return;
      }
      if (pick.kind === "multiple") {
        const favSet = new Set(favouriteTrackIds);
        setNearbyTrackSuggestions(
          pick.nearby.map((n) => ({
            trackId: n.track.id,
            trackName: n.track.name,
            distanceM: n.distanceM,
            isFavourite: favSet.has(n.track.id),
          }))
        );
        setTrackAutoDetectMessage("Multiple tracks nearby — pick one below (favourites listed first).");
        return;
      }
      setTrackAutoDetectMessage(
        "No saved track is within 800 m. Select manually or set GPS on a track in Track library."
      );
    } catch (e) {
      if (e instanceof GeolocationRequestError) {
        const hint =
          e.code === "denied"
            ? " Enable location in browser settings, then tap Detect from location."
            : "";
        setTrackAutoDetectMessage(e.message + hint);
      } else {
        setTrackAutoDetectMessage(
          e instanceof Error ? e.message : "Could not detect track from location."
        );
      }
    } finally {
      setTrackAutoDetectLoading(false);
    }
  }, [isEditing, trackLockedToEvent, tracksList, favouriteTrackIds]);

  useEffect(() => {
    if (isEditing || trackLockedToEvent) return;
    if (trackId.trim() || trackPickedManuallyRef.current) return;
    const t = window.setTimeout(() => {
      void runTrackAutoDetect();
    }, 800);
    return () => window.clearTimeout(t);
  }, [isEditing, trackLockedToEvent, trackId, tracksGpsFingerprint, runTrackAutoDetect]);

  useEffect(() => {
    if (runDetailsTab !== "track") return;
    if (isEditing || trackLockedToEvent || trackPickedManuallyRef.current || trackId.trim()) return;
    if (trackTabAutoDetectDoneRef.current) return;
    trackTabAutoDetectDoneRef.current = true;
    void runTrackAutoDetect();
  }, [runDetailsTab, isEditing, trackLockedToEvent, trackId, runTrackAutoDetect]);

  function applyEventOption(ev: EventOption) {
    setEventId(ev.id);
    setEventError(null);
    if (ev.trackId) {
      setTrackId(ev.trackId);
      setCopyTrackWarning(null);
    }
    setEventPracticeTimingUrl(ev.practiceSourceUrl?.trim() ?? "");
    setEventRaceTimingUrl(ev.resultsSourceUrl?.trim() ?? "");
    setEventControlledTireTypeId(ev.controlledTireTypeId?.trim() ?? ev.controlledTireType?.id ?? "");
    if (sessionType === "RACE_MEETING" && ev.controlledTireTypeId) {
      skipTireResolveRef.current = true;
      setSelectedTireTypeId(ev.controlledTireTypeId);
      if (ev.controlledTireType) setSelectedTireType(ev.controlledTireType);
      setTireSetId("");
      setTireSetNumber("");
      setTireSpecificModel("");
    }
  }

  function parseEventFromApi(raw: Record<string, unknown>): EventOption {
    const start =
      typeof raw.startDate === "string"
        ? raw.startDate
        : raw.startDate instanceof Date
          ? raw.startDate.toISOString()
          : new Date(String(raw.startDate)).toISOString();
    const end =
      typeof raw.endDate === "string"
        ? raw.endDate
        : raw.endDate instanceof Date
          ? raw.endDate.toISOString()
          : new Date(String(raw.endDate)).toISOString();
    return {
      id: String(raw.id),
      name: String(raw.name),
      trackId: (raw.trackId as string | null) ?? null,
      startDate: start,
      endDate: end,
      notes: (raw.notes as string | null) ?? null,
      practiceSourceUrl: (raw.practiceSourceUrl as string | null) ?? null,
      resultsSourceUrl: (raw.resultsSourceUrl as string | null) ?? null,
      controlledTireLabel: (raw.controlledTireLabel as string | null) ?? null,
      controlledTireTypeId: (raw.controlledTireTypeId as string | null) ?? null,
      controlledTireType: (raw.controlledTireType as EventOption["controlledTireType"]) ?? null,
      track: (raw.track as EventOption["track"]) ?? null,
    };
  }

  async function confirmLiveRcMeeting() {
    if (!liveRcMeeting || !trackId.trim()) return;
    setLiveRcMeetingBusy(true);
    setEventError(null);
    try {
      const det = liveRcMeeting;
      if (det.matchedEventId) {
        let ev = events.find((e) => e.id === det.matchedEventId);
        if (!ev) {
          const listRes = await fetch("/api/events");
          const listData = (await listRes.json().catch(() => ({}))) as {
            events?: Record<string, unknown>[];
          };
          const list = (listData.events ?? []).map(parseEventFromApi);
          setEvents(list);
          ev = list.find((e) => e.id === det.matchedEventId);
        }
        if (!ev) throw new Error("Could not find the matching event.");
        applyEventOption(ev);
      } else {
        const { startYmd, endYmd } = defaultEventDatesForLiveRcDetection();
        const res = await fetch("/api/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: det.eventLabel,
            trackId: trackId.trim(),
            startDate: startYmd,
            endDate: endYmd,
            resultsSourceUrl: det.eventHubUrl,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          existingEventId?: string;
          event?: Record<string, unknown>;
        };
        if (res.status === 409 && data.existingEventId && data.event) {
          const existing = parseEventFromApi(data.event);
          setEvents((prev) => {
            if (prev.some((e) => e.id === existing.id)) return prev;
            return [existing, ...prev];
          });
          applyEventOption(existing);
        } else if (!res.ok) {
          throw new Error(data.error ?? `Could not create event (${res.status})`);
        } else if (data.event) {
          const created = parseEventFromApi(data.event);
          setEvents((prev) => [created, ...prev]);
          applyEventOption(created);
          setStatus("Event created from LiveRC — selected.");
        } else {
          throw new Error("Invalid response when creating event.");
        }
      }
      dismissedLiveRcMeetingRef.current.add(`${trackId.trim()}|${det.eventHubUrl}`);
      setLiveRcMeeting(null);
    } finally {
      setLiveRcMeetingBusy(false);
    }
  }

  useEffect(() => {
    if (editingCompletedRun || trackLockedToEvent) {
      setLiveRcMeeting(null);
      return;
    }
    const tid = trackId.trim();
    if (!tid) {
      setLiveRcMeeting(null);
      return;
    }
    const track = tracksList.find((t) => t.id === tid);
    if (!track?.liveRcUrl?.trim()) {
      setLiveRcMeeting(null);
      return;
    }
    const selected = eventId ? events.find((e) => e.id === eventId) : null;
    if (selected?.trackId === tid && selected.resultsSourceUrl?.trim()) {
      setLiveRcMeeting(null);
      return;
    }

    let alive = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/events/detect-live-rc-meeting", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ trackId: tid }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            detected?: boolean;
            eventLabel?: string;
            eventHubUrl?: string;
            matchedEventId?: string | null;
            trackName?: string;
          };
          if (!alive) return;
          if (!res.ok || !data.detected || !data.eventHubUrl) {
            setLiveRcMeeting(null);
            return;
          }
          const hubUrl = data.eventHubUrl.trim();
          const dismissKey = `${tid}|${hubUrl}`;
          if (dismissedLiveRcMeetingRef.current.has(dismissKey)) {
            setLiveRcMeeting(null);
            return;
          }
          setSessionType("RACE_MEETING");
          setLiveRcMeeting({
            eventLabel: data.eventLabel?.trim() || "Race meeting",
            eventHubUrl: hubUrl,
            matchedEventId: data.matchedEventId ?? null,
            trackName: data.trackName ?? track.name,
          });
        } catch {
          if (alive) setLiveRcMeeting(null);
        }
      })();
    }, 500);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [
    trackId,
    tracksList,
    editingCompletedRun,
    trackLockedToEvent,
    eventId,
    events,
  ]);

  useEffect(() => {
    if (trackId.trim()) {
      setNearbyTrackSuggestions([]);
    }
  }, [trackId]);

  useEffect(() => {
    if (trackId.trim() || trackLockedToEvent) setTrackSaveWarning(false);
  }, [trackId, trackLockedToEvent]);

  useEffect(() => {
    if (props.initialCopyPreviewRun !== undefined || externalCopyLastRunCard) return;
    let alive = true;
    jsonFetch<{ lastRun: LastRun | null }>("/api/runs/last-any")
      .then(({ lastRun }) => {
        if (!alive) return;
        setCopyPreviewRun(lastRun);
      })
      .catch(() => {
        if (!alive) return;
        setCopyPreviewRun(null);
      });
    return () => {
      alive = false;
    };
  }, [props.initialCopyPreviewRun, externalCopyLastRunCard]);

  useEffect(() => {
    migrateLegacyLoadedSetup();
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

  const refreshDownloadedSetups = useCallback(async () => {
    if (!carId) return [] as DownloadedSetupOption[];
    const dlRes = await jsonFetch<{ downloadedSetups: DownloadedSetupOption[] }>(
      `/api/setup/options?carId=${encodeURIComponent(carId)}`
    );
    const list = Array.isArray(dlRes.downloadedSetups) ? dlRes.downloadedSetups : [];
    setDownloadedSetups(list);
    return list;
  }, [carId]);

  const handleQuickSetupImported = useCallback(
    async (documentId: string) => {
      if (!carId) return;
      const list = await refreshDownloadedSetups();
      const picked = list.find((x) => x.id === documentId);
      if (!picked) return;
      setSetupSource("other");
      setLoadOtherSetupSelection(documentId);
      const next = setupSnapshotWithDerived(picked.setupData);
      setSetupData(next);
      setActiveSetupData(next, picked.carId ?? carId ?? null);
      setSetupBaselineSnapshotId(picked.baselineSetupSnapshotId ?? null);
      setSetupBaselineData(cloneSetupSnapshot(next));
      setSetupSectionExpanded(true);
    },
    [carId, refreshDownloadedSetups]
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      setActiveSetupData(setupData, carId || null);
    }, 400);
    return () => window.clearTimeout(t);
  }, [setupData, carId]);

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
    if (!needsEvent || !eventId) return;
    const selected = events.find((e) => e.id === eventId) ?? null;
    const evTrackId = selected?.trackId ?? "";
    if (!evTrackId || !selected) return;
    if (trackId !== evTrackId) {
      setTrackId(evTrackId);
      setCopyTrackWarning(null);
    }
  }, [eventId, events, needsEvent, trackId]);

  useEffect(() => {
    if (!needsEvent || !eventId) {
      setEventPracticeTimingUrl("");
      setEventRaceTimingUrl("");
      setEventControlledTireTypeId("");
      return;
    }
    const ev = events.find((e) => e.id === eventId);
    if (!ev) return;
    setEventPracticeTimingUrl(ev.practiceSourceUrl?.trim() ?? "");
    setEventRaceTimingUrl(ev.resultsSourceUrl?.trim() ?? "");
    setEventControlledTireTypeId(ev.controlledTireTypeId?.trim() ?? ev.controlledTireType?.id ?? "");
  }, [needsEvent, eventId, events]);

  function applyCopyFromPreview() {
    const r = copyPreviewRun;
    if (!r || lastRunCopyApplied) return;
    setLastRunCopyApplied(true);
    startCopyTransition(() => {
    const highlights: LastRunPrefillHighlights = { session: true, setup: true };
    const prevCarId = carId;
    const nextCarId = (r.carId || r.car?.id || "").toString();
    if (nextCarId && carsList.some((c) => c.id === nextCarId)) {
      setCarId(nextCarId);
      setCopyCarWarning(null);
      highlights.car = true;
    } else if (r.car?.name) {
      setCopyCarWarning(`Last run used deleted car: ${r.car.name}. Please select a current car.`);
    } else if (r.carNameSnapshot) {
      setCopyCarWarning(`Last run used deleted car: ${r.carNameSnapshot}. Please select a current car.`);
    } else if (nextCarId || r.car?.name || r.carNameSnapshot) {
      setCopyCarWarning("Last run car is no longer available. Please select a current car.");
    }

    const nextTrackId = r.trackId || r.track?.id || "";
    if (nextTrackId && tracksList.some((t) => t.id === nextTrackId)) {
      setTrackId(nextTrackId);
      setCopyTrackWarning(null);
      highlights.track = true;
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
      highlights.tires = true;
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
      highlights.battery = true;
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
    if (r.eventId) highlights.event = true;
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
    setPrefillHighlights(highlights);
    });
  }

  const applyCopyFromPreviewRef = useRef(applyCopyFromPreview);
  applyCopyFromPreviewRef.current = applyCopyFromPreview;

  const applyCopyFromPreviewStable = useCallback(() => {
    applyCopyFromPreviewRef.current();
  }, []);

  const setBridgeRef = useRef(copyLastRunCtx?.setBridge);
  setBridgeRef.current = copyLastRunCtx?.setBridge;

  useLayoutEffect(() => {
    setBridgeRef.current?.({
      apply: applyCopyFromPreviewStable,
      applied: lastRunCopyApplied,
    });
  }, [lastRunCopyApplied, applyCopyFromPreviewStable]);

  useEffect(() => {
    return () => setBridgeRef.current?.(null);
  }, []);

  useEffect(() => {
    tireRunUserTouchedRef.current = false;
  }, [tireSetId]);

  useEffect(() => {
    if (!tireSetId) return;
    const id = tireSetId;
    let alive = true;

    if (isEditing && editRun && id === (editRun.tireSetId ?? "")) {
      if (!tireRunUserTouchedRef.current) {
        setRunsCompleted(Math.max(0, (editRun.tireRunNumber ?? 1) - 1));
      }
      return;
    }

    // New run or edit with a different tire set than the saved run: next slot from completed history.
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
  }, [tireSetId, editRun?.id, isEditing, editRun?.tireSetId, editRun?.tireRunNumber]);

  useEffect(() => {
    batteryRunUserTouchedRef.current = false;
  }, [batteryId]);

  useEffect(() => {
    if (!batteryId) return;
    const id = batteryId;
    let alive = true;

    if (isEditing && editRun && id === (editRun.batteryId ?? "")) {
      if (!batteryRunUserTouchedRef.current) {
        setBatteryRunsCompleted(Math.max(0, (editRun.batteryRunNumber ?? 1) - 1));
      }
      return;
    }

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
  }, [batteryId, editRun?.id, isEditing, editRun?.batteryId, editRun?.batteryRunNumber]);

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
          controlledTireTypeId: newEventControlledTireTypeId.trim() || null,
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
      setNewEventControlledTireTypeId("");
      setShowNewEventPanel(false);
      setStatus("Event created — selected.");
    } catch (err) {
      setEventError(err instanceof Error ? err.message : "Failed to create event");
    } finally {
      setCreatingEvent(false);
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

    const packRaw = newBatteryPackNumber.trim();
    const packParsed = packRaw === "" ? NaN : parseInt(packRaw, 10);
    const packNumber = Number.isFinite(packParsed) && packParsed >= 1 ? packParsed : 1;
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
      setNewBatteryPackNumber("1");
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

      /** Persist every parsed driver so field / Engineer comparisons stay available (selection only gates primary laps). */
      for (const d of sessionDrivers) {
        if (d.laps.length === 0) continue;
        const laps = structuredLapsForDriver(d);
        if (laps.length === 0) continue;
        out.push({
          sourceUrl,
          driverId: d.driverId,
          driverName: d.driverName,
          normalizedName: d.normalizedName,
          isPrimaryUser: Boolean(primary && bi === 0 && d.driverId === primary.driverId),
          sessionCompletedAt,
          laps,
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
    if (pendingCompleteNavigationRef.current) return;
    setInlineError(null);
    setStatus(null);
    if (!carId) {
      setInlineError("Select a car.");
      return;
    }
    const resolvedTrackId =
      trackId.trim() ||
      (trackLockedToEvent && selectedEventForRun?.trackId ? String(selectedEventForRun.trackId) : "");
    if (!resolvedTrackId) {
      setInlineError("Select a track — it’s used for comparisons and the Engineer.");
      setTrackSaveWarning(true);
      setRunDetailsTab("track");
      return;
    }
    if (intent === "completed") {
      const missingCarRating = carRating == null || carRating < 1 || carRating > 10;
      const missingFeelVsLastRun =
        feelVsLastRunEligible && handlingUi.feelVsLastRun == null;
      if (missingCarRating || missingFeelVsLastRun) {
        const parts: string[] = [];
        if (missingCarRating) parts.push("rate the car 1–10");
        if (missingFeelVsLastRun) {
          parts.push("pick how this run felt vs your last run on this car");
        }
        setCompleteValidation({
          show: true,
          carRating: missingCarRating,
          feelVsLastRun: missingFeelVsLastRun,
        });
        setInlineError(`Before Run complete: ${parts.join(" and ")}.`);
        window.requestAnimationFrame(() => {
          feedbackRequiredRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        return;
      }
      setCompleteValidation({ show: false, carRating: false, feelVsLastRun: false });
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
    setSaveSuccess(false);
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
      const { run, promptMarkTrackLocation } = await jsonFetch<{
        run: { id: string; createdAt: string };
        promptMarkTrackLocation?: { trackId: string; trackName: string } | null;
      }>("/api/runs", {
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
          trackId: resolvedTrackId || null,
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
              if (lapIngest.manualLapRows && lapIngest.manualLapRows.length === lapTimes.length) {
                return lapIngest.manualLapRows.map((row) => ({
                  isIncluded: row.isIncluded,
                }));
              }
              if (lapTimes.length > 0) {
                const rows = applyMedianBandAutoExclude(
                  lapTimes.map((t, i) => ({
                    lapNumber: i + 1,
                    lapTimeSeconds: t,
                    isIncluded: true,
                  }))
                );
                return rows.map((row) => ({ isIncluded: row.isIncluded }));
              }
              return undefined;
            })(),
          },
          notes: notes.trim() || null,
          practiceDayUrl:
            sessionType === "RACE_MEETING" && eventId && eventPracticeTimingUrl.trim()
              ? eventPracticeTimingUrl.trim()
              : null,
          raceClass: raceClass.trim() || null,
          suggestedChanges: isEditing ? (editRun?.suggestedChanges?.trim() || null) : null,
          suggestedPreRun: isEditing ? (editRun?.suggestedPreRun?.trim() || null) : null,
          handlingAssessmentJson: persistedFromUiState(
            intent === "completed" && !feelVsLastRunEligible && handlingUi.feelVsLastRun == null
              ? { ...handlingUi, feelVsLastRun: 0 }
              : handlingUi
          ),
          carRating,
          shareWithTeam,
          sessionLabel: null,
          importedLapSets,
          importedLapTimeSessionIds:
            lapIngest.sourceKind === "url"
              ? lapIngest.urlImportBlocks
                  .map((b) => b.importedSessionId.trim())
                  .filter(Boolean)
              : [],
        })
      });

      if (intent === "completed" && promptMarkTrackLocation) {
        setTrackLocationPrompt({
          trackId: promptMarkTrackLocation.trackId,
          trackName: promptMarkTrackLocation.trackName,
          runId: run.id,
        });
        setSaveSuccess(true);
        setStatus("Run saved.");
        setSaving(false);
        return;
      }

      if (intent === "completed") {
        pendingCompleteNavigationRef.current = true;
      }
      setSaveSuccess(true);
      setStatus(isEditing ? "Changes saved." : "Run saved.");

      if (sessionType === "RACE_MEETING" && needsEvent && eventId) {
        const p = eventPracticeTimingUrl.trim() || null;
        const r = eventRaceTimingUrl.trim() || null;
        const c = eventControlledTireTypeId.trim() || null;
        void fetch(`/api/events/${encodeURIComponent(eventId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            practiceSourceUrl: p,
            resultsSourceUrl: r,
            controlledTireTypeId: c,
          }),
        })
          .then((res) => {
            if (!res.ok) return;
            setEvents((prev) =>
              prev.map((e) =>
                e.id === eventId
                  ? { ...e, practiceSourceUrl: p, resultsSourceUrl: r, controlledTireTypeId: c }
                  : e
              )
            );
          })
          .catch(() => {});
      }

      // Completing a run sends the driver to the dashboard with a one-time
      // prompt to generate Engineer suggestions for the session they just saved.
      if (intent === "completed") {
        navigateAfterRunComplete(run.id);
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
      if (!(intent === "completed" && pendingCompleteNavigationRef.current)) {
        setSaving(false);
      }
    }
  }

  function navigateAfterRunComplete(runId: string) {
    pendingCompleteNavigationRef.current = true;
    setTimeout(() => {
      router.push(`/?suggestRun=${encodeURIComponent(runId)}`);
    }, 600);
  }

  return (
    <>
    <TrackLocationMarkDialog
      open={trackLocationPrompt != null}
      trackId={trackLocationPrompt?.trackId ?? ""}
      trackName={trackLocationPrompt?.trackName ?? ""}
      onMarked={() => {
        const runId = trackLocationPrompt?.runId;
        setTrackLocationPrompt(null);
        if (runId) navigateAfterRunComplete(runId);
      }}
      onSkip={() => {
        const runId = trackLocationPrompt?.runId;
        setTrackLocationPrompt(null);
        if (runId) navigateAfterRunComplete(runId);
      }}
    />
    <form
      className="max-w-3xl space-y-3"
      onSubmit={(e) => e.preventDefault()}
      noValidate
    >
      {carsList.length === 0 ? (
        <CardPanel contentClassName="text-sm text-muted-foreground">
          <div className="text-sm text-muted-foreground">
            You need a car to log a run. Open{" "}
            <Link href="/cars" className="text-accent underline font-medium">
              Car Manager
            </Link>{" "}
            to add one, then return here.
          </div>
        </CardPanel>
      ) : null}

      {isEditing && editRun?.id && editRun.importedLapSets && editRun.importedLapSets.length >= 2 ? (
        <div className="space-y-2">
          <ImportedFieldSessionCard importedLapSets={editRun.importedLapSets} />
        </div>
      ) : null}

      {!externalCopyLastRunCard && !isDraft && !isEditing && copyPreviewRun ? (
        <CopyLastRunCard
          run={copyPreviewRunToPickerRun(copyPreviewRun)}
          applied={lastRunCopyApplied}
          onApply={applyCopyFromPreview}
        />
      ) : null}

      <div className="flex items-center gap-3 pt-2">
        <div className="h-px flex-1 bg-border/60" />
        <Eyebrow dot="muted" className="shrink-0 justify-center">
          Before the run
        </Eyebrow>
        <div className="h-px flex-1 bg-border/60" />
      </div>

      {/* 2. Session type: Testing or Race Meeting only */}
      <SurfaceCard
        variant="panel"
        overflowHidden={false}
        className={cn(isDraft && "border-emerald-500/40", prefillFieldClass(Boolean(prefillHighlights?.session)))}
        contentClassName="space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Eyebrow dot="accent">Session type</Eyebrow>
            <PrefillBadge show={prefillHighlights?.session} />
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
              className="btn-surface px-2 py-1 text-[11px]"
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
                {eventControlledTireTypeId.trim() ? (
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground">Spec tire set</span>
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
                  className="h-3 w-3 shrink-0 accent-primary"
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
                  className="h-3 w-3 shrink-0 accent-primary"
                />
                <span>Race Meeting</span>
              </label>
            </div>
            {sessionType === "TESTING" ? (
              <p className="mt-3 text-[11px] text-muted-foreground">
                Lap times are loaded from the track&apos;s LiveRC URL when you pick a track below.
              </p>
            ) : null}
          </>
        )}
      </SurfaceCard>

      {liveRcMeeting && !editingCompletedRun && !trackLockedToEvent ? (
        <LiveRcRaceMeetingPrompt
          detection={liveRcMeeting}
          busy={liveRcMeetingBusy}
          onConfirm={() => confirmLiveRcMeeting()}
          onDismiss={() => {
            dismissedLiveRcMeetingRef.current.add(
              `${trackId.trim()}|${liveRcMeeting.eventHubUrl}`
            );
            setLiveRcMeeting(null);
          }}
        />
      ) : null}

      {needsEvent && (sessionExpanded || !isDraft) ? (
        <SurfaceCard variant="panel" overflowHidden={false} className={prefillFieldClass(Boolean(prefillHighlights?.event))} contentClassName="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Eyebrow dot="accent">Event / Race meeting</Eyebrow>
              <PrefillBadge show={prefillHighlights?.event} />
            </div>
            <button
              type="button"
              className="btn-surface px-3 py-1.5 text-xs"
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
            className="form-control w-full px-3 py-2 text-sm"
            value={eventId}
            onChange={(e) => {
              setEventId(e.target.value);
              setEventError(null);
            }}
            aria-label="Event"
          >
            <option value="">— Select event</option>
            {eventSelectGroups.upcoming.length > 0 ? (
              <optgroup label="Upcoming">
                {eventSelectGroups.upcoming.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name} · {formatEventDate(ev.startDate)} · {formatEventRelativeLabel(ev)}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {eventSelectGroups.past.length > 0 ? (
              <optgroup label="Past">
                {eventSelectGroups.past.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name} · {formatEventDate(ev.startDate)} · {formatEventRelativeLabel(ev)}
                  </option>
                ))}
              </optgroup>
            ) : null}
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
                  className="form-control w-full px-3 py-2 text-xs"
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
                  className="form-control w-full px-3 py-2 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="event-controlled-tire-type"
                  className="block text-xs font-medium text-muted-foreground"
                >
                  Controlled / spec tire (optional)
                </label>
                <TireTypeCombobox
                  value={eventControlledTireTypeId}
                  onChange={(id) => {
                    setEventControlledTireTypeId(id);
                    if (id && sessionType === "RACE_MEETING") {
                      skipTireResolveRef.current = true;
                      setSelectedTireTypeId(id);
                      setTireSetId("");
                      setTireSetNumber("");
                      setTireSpecificModel("");
                    }
                  }}
                  placeholder="Search spec tire type"
                  aria-label="Event spec tire type"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Saved on the event when you save this run. Lap times → URL uses the practice link when your
                meeting session is Practice; otherwise it prefers the race/results link (either link can be
                scanned). Spec tire pre-selects that compound when you log tires for this event.
              </p>
            </div>
          ) : null}

          {eventError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-foreground">
              {eventError}
            </div>
          )}

          {showNewEventPanel && (
            <div className="inset-panel p-3 space-y-2">
              <div className="inset-panel-deep p-2">
                <Eyebrow dot="muted" className="mb-1">Track (required)</Eyebrow>
                <select
                  className="form-control w-full px-3 py-2 text-sm"
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
                className="form-control w-full px-3 py-2 text-sm"
                placeholder="Event name (e.g. TITC 2026)"
                value={newEventName}
                onChange={(e) => setNewEventName(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  className="form-control px-3 py-2 text-sm"
                  value={newEventStartDate}
                  onChange={(e) => {
                    setNewEventStartDate(e.target.value);
                    setEventError(null);
                  }}
                  placeholder="Start date"
                />
                <input
                  type="date"
                  className="form-control px-3 py-2 text-sm"
                  value={newEventEndDate}
                  onChange={(e) => {
                    setNewEventEndDate(e.target.value);
                    setEventError(null);
                  }}
                  placeholder="End date"
                />
              </div>
              <div className="space-y-1">
                <label className="block ui-label-meta">Practice timing URL (optional)</label>
                <input
                  type="url"
                  className="form-control w-full px-3 py-2 text-xs"
                  value={newEventPracticeUrl}
                  onChange={(e) => setNewEventPracticeUrl(e.target.value)}
                  placeholder="LiveRC practice session list URL"
                />
              </div>
              <div className="space-y-1">
                <label className="block ui-label-meta">Race timing URL (optional)</label>
                <input
                  type="url"
                  className="form-control w-full px-3 py-2 text-xs"
                  value={newEventResultsUrl}
                  onChange={(e) => setNewEventResultsUrl(e.target.value)}
                  placeholder="LiveRC results / race timing page URL"
                />
              </div>
              <div className="space-y-1">
                <label className="block ui-label-meta">Controlled / spec tire (optional)</label>
                <TireTypeCombobox
                  value={newEventControlledTireTypeId}
                  onChange={setNewEventControlledTireTypeId}
                  placeholder="Search spec tire type"
                  aria-label="Event spec tire type"
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
                  buttonLinkClassName("primary"),
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

          <div className="space-y-3 border-t border-border pt-3">
            <Eyebrow dot="muted">Session</Eyebrow>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1">
                <label className="block ui-label-meta">Type</label>
                <select
                  className="form-control px-3 py-2 text-sm"
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
                  <label className="block ui-label-meta">Custom session type</label>
                  <input
                    type="text"
                    className="form-control px-3 py-2 text-sm min-w-[140px]"
                    placeholder="e.g. Warm-up"
                    value={meetingSessionCustom}
                    onChange={(e) => setMeetingSessionCustom(e.target.value)}
                    aria-label="Custom session type"
                  />
                </div>
              )}
            </div>
          </div>
        </SurfaceCard>
      ) : null}

      <SurfaceCard
        variant="panel"
        overflowHidden={false}
        className={cn(isDraft && "border-emerald-500/40")}
        contentClassName="space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Eyebrow dot="accent">Run details</Eyebrow>
            <PrefillBadge
              show={
                prefillHighlights?.car ||
                prefillHighlights?.track ||
                prefillHighlights?.tires ||
                prefillHighlights?.battery
              }
            />
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
              className="btn-surface px-2 py-1 text-[11px]"
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
            <span className="text-muted-foreground">Tires</span>
            <span className="min-w-0 truncate text-foreground/90">
              {(() => {
                const t = tireSets.find((x) => x.id === tireSetId);
                if (!t) return "—";
                return tireSetDisplayLine(t);
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
            <span className="text-muted-foreground">Track</span>
            <span className="min-w-0 truncate text-foreground/90">
              {tracksList.find((t) => t.id === trackId)?.name ?? "—"}
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
          <button
            type="button"
            role="tab"
            aria-selected={runDetailsTab === "battery"}
            className={cn(
              "px-3 sm:px-4 py-2 text-xs font-medium transition border-b-2 -mb-px",
              runDetailsTab === "battery"
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setRunDetailsTab("battery")}
          >
            Battery
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={runDetailsTab === "conditions"}
            className={cn(
              "px-3 sm:px-4 py-2 text-xs font-medium transition border-b-2 -mb-px",
              runDetailsTab === "conditions"
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setRunDetailsTab("conditions")}
          >
            Conditions
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={runDetailsTab === "track"}
            className={cn(
              "px-3 sm:px-4 py-2 text-xs font-medium transition border-b-2 -mb-px rounded-t-md",
              runDetailsTab === "track"
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
              trackSaveWarning && runDetailsTab !== "track" && "ring-2 ring-amber-500/55 ring-offset-2 ring-offset-background"
            )}
            onClick={() => setRunDetailsTab("track")}
          >
            Track
          </button>
        </div>

        {runDetailsTab === "car" ? (
          <div className="space-y-3 pt-1">
            <div className="space-y-1 text-sm">
              <div className="flex items-center justify-between gap-2">
                <Eyebrow dot="muted">Car</Eyebrow>
                <Link
                  href="/cars"
                  className="btn-surface px-2 py-1 text-[11px]"
                >
                  Car Manager
                </Link>
              </div>
              <select
                className={cn(
                  "form-control w-full px-3 py-2 text-sm",
                  prefillFieldClass(Boolean(prefillHighlights?.car || copyCarWarning))
                )}
                value={carId}
                onChange={(e) => {
                  const next = e.target.value;
                  const prev = carId;
                  setCarId(next);
                  setCopyCarWarning(null);
                  setPrefillHighlights((h) => (h ? { ...h, car: false } : h));
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
            {/* Race class (optional) field intentionally hidden from Log Your Run.
                `raceClass` state + save payload are kept so the feature can be re-enabled later. */}
          </div>
        ) : null}

        {runDetailsTab === "track" ? (
          <div className="space-y-3 pt-1">
            <div className="space-y-1 text-sm">
              <div className="flex items-center justify-between gap-2">
                <Eyebrow dot="muted">Track</Eyebrow>
                <Link
                  href="/tracks"
                  className="btn-surface px-2 py-1 text-[11px]"
                >
                  Track library
                </Link>
              </div>
              {trackLockedToEvent ? (
                <div className="space-y-1">
                  <div className="inset-panel-deep px-3 py-2 text-sm text-foreground">
                    {(() => {
                      const t = tracksList.find((x) => x.id === trackId);
                      if (!t) return "—";
                      return `${t.name}${t.location ? ` (${t.location})` : ""}`;
                    })()}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Track is set by the selected event. Change the event (or its track in Events) to use a
                    different venue.
                  </p>
                </div>
              ) : (
                <div className={prefillFieldClass(Boolean(prefillHighlights?.track))}>
                  <TrackCombobox
                    tracks={tracksList}
                    value={trackId}
                    onChange={(id) => {
                      trackPickedManuallyRef.current = true;
                      setTrackId(id);
                      setCopyTrackWarning(null);
                      setNearbyTrackSuggestions([]);
                      setTrackAutoDetectMessage(null);
                    }}
                    lastRunTrackId={lastRun?.trackId ?? null}
                    favouriteTrackIds={favouriteTrackIds}
                    favouriteTracks={favouriteTracks}
                    placeholder="Search or select track"
                    aria-label="Track"
                  />
                  {!isEditing ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="btn-surface px-2.5 py-1 text-[11px] font-medium disabled:opacity-60"
                        disabled={trackAutoDetectLoading}
                        onClick={() => void runTrackAutoDetect()}
                      >
                        {trackAutoDetectLoading ? "Detecting…" : "Detect from location"}
                      </button>
                      {trackAutoDetectMessage ? (
                        <span className="text-[11px] text-muted-foreground leading-snug">
                          {trackAutoDetectMessage}
                          {trackAutoDetectMessage.includes("Track library") ? (
                            <>
                              {" "}
                              <Link href="/tracks" className="font-medium text-foreground underline">
                                Track library
                              </Link>
                            </>
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <TrackNearbySuggestions
                    suggestions={nearbyTrackSuggestions}
                    onSelect={(id) => {
                      trackPickedManuallyRef.current = true;
                      setTrackId(id);
                      setCopyTrackWarning(null);
                      setNearbyTrackSuggestions([]);
                      setTrackAutoDetectMessage(null);
                    }}
                  />
                </div>
              )}
            </div>
            {copyTrackWarning && (
              <div className="text-[11px] text-muted-foreground">{copyTrackWarning}</div>
            )}
          </div>
        ) : null}

        {runDetailsTab === "tires" ? (
          <div className="space-y-3 pt-1">
            <RunTireSelectionPanel
              tireSets={tireSets}
              tireSetId={tireSetId}
              onSelectExistingSet={(nextId, ts) => {
                setTireSetId(nextId);
                applyTireFieldsFromSet(ts);
                applyTireBatteryToSetupSnapshot(nextId, batteryIdRef.current);
                setCopyTireWarning(null);
              }}
              selectedTireTypeId={selectedTireTypeId}
              onTireTypeIdChange={setSelectedTireTypeId}
              onSelectedTireTypeChange={setSelectedTireType}
              tireSetNumber={tireSetNumber}
              onTireSetNumberChange={setTireSetNumber}
              tireSpecificModel={tireSpecificModel}
              onTireSpecificModelChange={setTireSpecificModel}
              resolvingTireSet={resolvingTireSet}
              runsCompleted={runsCompleted}
              onRunsCompletedChange={setRunsCompleted}
              onRunsCompletedUserTouched={() => {
                tireRunUserTouchedRef.current = true;
              }}
              skipTireResolveRef={skipTireResolveRef}
              onPrefillClear={() => setPrefillHighlights((h) => (h ? { ...h, tires: false } : h))}
              copyTireWarning={copyTireWarning}
              prefillFieldClass={prefillFieldClass(Boolean(prefillHighlights?.tires))}
            />
          </div>
        ) : null}

        {runDetailsTab === "battery" ? (
          <div className="space-y-3 pt-1 text-sm">
            <div className="space-y-2">
              <div className="flex items-end justify-between gap-3">
                <Eyebrow dot="muted">Battery pack</Eyebrow>
                <button
                  type="button"
                  className="btn-surface px-3 py-1.5 text-xs"
                  onClick={() => {
                    setShowNewBatteryPanel((v) => !v);
                    setInlineError(null);
                  }}
                >
                  {showNewBatteryPanel ? "Cancel" : "New battery"}
                </button>
              </div>
              <select
                className={cn("form-control w-full px-3 py-2 text-sm", prefillFieldClass(Boolean(prefillHighlights?.battery)))}
                value={batteryId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setBatteryId(nextId);
                  applyTireBatteryToSetupSnapshot(tireSetIdRef.current, nextId);
                  setCopyBatteryWarning(null);
                  setPrefillHighlights((h) => (h ? { ...h, battery: false } : h));
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
              <div className="inset-panel p-3 space-y-3">
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    className="form-control px-3 py-2 text-sm"
                    placeholder="Label (e.g. LCG 6000mAh)"
                    value={newBatteryLabel}
                    onChange={(e) => setNewBatteryLabel(e.target.value)}
                    aria-label="Battery label"
                  />
                  <input
                    type="number"
                    min={1}
                    className="form-control px-3 py-2 text-sm"
                    placeholder="Pack number"
                    value={newBatteryPackNumber}
                    onChange={(e) => setNewBatteryPackNumber(e.target.value)}
                    aria-label="Pack number"
                  />
                </div>
                <div className="space-y-1 text-sm">
                  <Eyebrow dot="muted">Prior runs on this pack (before first log)</Eyebrow>
                  <input
                    type="number"
                    min={0}
                    className="form-control w-full px-3 py-2 text-sm"
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
                    buttonLinkClassName("primary"),
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
                <Eyebrow dot="muted">Prior runs on this pack (before this log)</Eyebrow>
                <input
                  type="number"
                  min={0}
                  className="w-full max-w-md form-control px-3 py-2 text-sm"
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

        {runDetailsTab === "conditions" ? (
          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <Eyebrow dot="muted">Conditions</Eyebrow>
              <PanelSubtitle>
                Track conditions — weather integration coming soon.
              </PanelSubtitle>
            </div>
          </div>
        ) : null}
          </>
        )}
      </SurfaceCard>

      <div ref={setupSectionRef}>
      <SurfaceCard
        variant="panel"
        overflowHidden={false}
        className={cn(
          "transition-colors",
          isDraft && !setupSectionExpanded && setupBaselineData && "border-emerald-500/40",
          prefillFieldClass(Boolean(prefillHighlights?.setup))
        )}
        contentClassName="space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Eyebrow dot="accent">Setup</Eyebrow>
            <PrefillBadge show={prefillHighlights?.setup} />
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
                className="inline-flex items-center rounded-md border border-border bg-muted/50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
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
              className="btn-surface px-2 py-1 text-[11px]"
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
              <div className="rounded-md border border-border bg-muted/50 p-2 text-xs">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.28em] text-faint">
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
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-500/30 bg-surface-runna/60 px-3 py-2 text-xs">
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
                      className="rounded border border-border bg-surface-runna-inset px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-surface-runna hover:text-foreground transition"
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
                      className="form-control w-full max-w-2xl px-3 py-2 text-xs"
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
                          className="form-control w-full max-w-2xl px-3 py-2 text-xs"
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
                          className="form-control w-full max-w-2xl px-3 py-2 text-xs font-mono"
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
                      {carId ? (
                        <RunLogQuickSetupUpload
                          carId={carId}
                          onImported={handleQuickSetupImported}
                          onRefetchList={() => void refreshDownloadedSetups()}
                          variant={downloadedSetups.length === 0 ? "banner" : "inline"}
                        />
                      ) : null}
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
                className="btn-surface self-start px-3 py-2 text-xs font-medium"
              >
                Edit setup
              </button>
            </div>
            {setupChangedRowsSinceBaseline.length > 0 ? (
              <div className="max-w-2xl rounded-md border border-border bg-muted/50 p-2 text-xs">
                <div className="mb-1 text-[11px] font-medium text-muted-foreground">
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
                onClick={() => {
                  setSetupSectionExpanded(false);
                }}
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
                  className="form-control w-full px-3 py-2 text-xs"
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
                      className="form-control w-full px-3 py-2 text-xs"
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
                      className="form-control w-full px-3 py-2 text-xs font-mono"
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
                  {carId ? (
                    <RunLogQuickSetupUpload
                      carId={carId}
                      onImported={handleQuickSetupImported}
                      onRefetchList={() => void refreshDownloadedSetups()}
                      variant={downloadedSetups.length === 0 ? "banner" : "inline"}
                    />
                  ) : null}
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
            {carId &&
            downloadedSetups.length === 0 &&
            setupSource !== "other" &&
            (pickerRuns.length === 0 || setupSource === "new") ? (
              <RunLogQuickSetupUpload
                carId={carId}
                onImported={handleQuickSetupImported}
                onRefetchList={() => void refreshDownloadedSetups()}
                variant="banner"
              />
            ) : null}
            <div className="flex flex-col gap-2 max-w-2xl border-t border-border/70 pt-3">
              {(isEditing && editRun?.id) || setupBaselineSnapshotId ? (
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                  {isEditing && editRun?.id ? (
                    <>
                      <a
                        className="text-accent underline decoration-border underline-offset-2 hover:opacity-90"
                        href={`/api/runs/${editRun.id}/setup-pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View filled setup PDF
                      </a>
                      <a
                        className="text-accent underline decoration-border underline-offset-2 hover:opacity-90"
                        href={`/api/runs/${editRun.id}/setup-pdf?download=1`}
                        rel="noopener noreferrer"
                      >
                        Download PDF
                      </a>
                    </>
                  ) : setupBaselineSnapshotId ? (
                    <>
                      <a
                        className="text-accent underline decoration-border underline-offset-2 hover:opacity-90"
                        href={`/api/setup-snapshots/${setupBaselineSnapshotId}/setup-pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View filled setup PDF
                      </a>
                      <a
                        className="text-accent underline decoration-border underline-offset-2 hover:opacity-90"
                        href={`/api/setup-snapshots/${setupBaselineSnapshotId}/setup-pdf?download=1`}
                        rel="noopener noreferrer"
                      >
                        Download PDF
                      </a>
                    </>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
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
            </div>
          </>
        )}
      </SurfaceCard>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <div
          className={cn(
            "h-px flex-1",
            isDraft ? "bg-amber-500/50" : "bg-border/60"
          )}
        />
        <Eyebrow dot="muted" className="shrink-0 justify-center">
          After the run
        </Eyebrow>
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
        practiceDayUrl={lapTimesLiveRcScanIndexUrl}
        lapImportEventId={sessionType === "RACE_MEETING" && eventId ? eventId : null}
        trackId={trackId.trim() || null}
        trackLiveRcUrl={tracksList.find((t) => t.id === trackId)?.liveRcUrl ?? null}
        trackSpeedhiveUrl={tracksList.find((t) => t.id === trackId)?.speedhiveUrl ?? null}
        editingRunId={isEditing ? editRun?.id ?? null : null}
        isDraftResume={isDraft}
      />

      <SurfaceCard variant="panel" overflowHidden={false} contentClassName="space-y-3 text-sm">
        <Eyebrow dot="accent">Feedback</Eyebrow>
        <div ref={feedbackRequiredRef} className="space-y-3">
          {completeValidation.show ? (
            <div
              role="alert"
              className="rounded-md border border-amber-500/50 bg-amber-500/15 px-2.5 py-2 text-[11px] leading-snug text-amber-950 dark:text-amber-100"
            >
              {inlineError ?? "Complete the highlighted fields below before Run complete."}
            </div>
          ) : null}
          <div
            className={cn(
              completeValidation.carRating &&
                "rounded-md ring-2 ring-amber-500/40 ring-offset-2 ring-offset-background"
            )}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-xs font-medium text-foreground">
                Car handling rating
              </div>
              <div
                className={cn(
                  "text-[11px]",
                  completeValidation.carRating
                    ? "font-medium text-amber-700 dark:text-amber-300"
                    : "text-muted-foreground"
                )}
              >
                {carRating == null
                  ? completeValidation.carRating
                    ? "Pick a rating"
                    : "Not rated"
                  : `${carRating} / 10`}
              </div>
            </div>
            <div
              role="radiogroup"
              aria-label="Car handling rating 1 to 10"
              className="mt-2 grid grid-cols-10 gap-1"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
                const selected = carRating === n;
                return (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setCarRating((cur) => (cur === n ? null : n))}
                    className={cn(
                      "rounded-md border px-0 py-1.5 text-[11px] font-medium tabular-nums transition",
                      selected
                        ? "border-accent bg-accent text-accent-foreground shadow-sm"
                        : completeValidation.carRating
                          ? "border-amber-500/50 bg-amber-500/5 text-foreground hover:bg-amber-500/10"
                          : "border-border bg-surface-runna-inset text-foreground hover:bg-surface-runna"
                    )}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
          <FeelVsLastRunQuickPick
            value={handlingUi.feelVsLastRun}
            onChange={(feelVsLastRun) =>
              setHandlingUi((cur) => ({ ...cur, feelVsLastRun }))
            }
            eligible={feelVsLastRunEligible}
            highlightMissing={completeValidation.feelVsLastRun}
          />
        </div>
        <textarea
          className={cn(
            "form-control h-32 w-full resize-none px-3 py-2 text-sm",
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
        <div className="pt-1">
          <button
            type="button"
            className="btn-surface flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium"
            aria-expanded={handlingDetailExpanded}
            onClick={() => setHandlingDetailExpanded((v) => !v)}
          >
            <span>Handling detail (optional)</span>
            <span className="text-[10px] opacity-70">{handlingDetailExpanded ? "Hide" : "Show"}</span>
          </button>
          {handlingDetailExpanded ? (
            <div className="mt-2">
              <HandlingAssessmentFields value={handlingUi} onChange={setHandlingUi} />
            </div>
          ) : null}
        </div>
      </SurfaceCard>


      {inlineError && !completeValidation.show ? (
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
          <Eyebrow dot="muted">Unsaved changes to setup</Eyebrow>
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
              className="btn-surface px-3 py-1.5 text-[11px] font-medium"
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
                : editingCompletedRun
                  ? "Save edits"
                  : "Save changes + run complete"}
            </button>
          </div>
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer select-none">
        <input
          type="checkbox"
          checked={shareWithTeam}
          onChange={(e) => setShareWithTeam(e.target.checked)}
          className="shrink-0 rounded border-border"
        />
        Share this run with my teams
      </label>

      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        {editingCompletedRun ? (
          <>
            <p className="text-[11px] text-muted-foreground leading-snug sm:max-w-md">
              Saves your changes to this run only. It stays marked complete; tire and battery run numbers are not
              updated (they were set when you first clicked Run complete).
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className={cn(
                  buttonLinkClassName("primary"),
                  "gap-1.5",
                  (!canSave || saving) && "opacity-70 pointer-events-none"
                )}
                onClick={(e) => saveRun(e, "completed")}
                disabled={!canSave || saving}
                aria-busy={saving}
                title="Save changes without affecting completion or tire/battery run counts."
              >
                {saving ? "Saving…" : saveSuccess ? "Saved" : "Save edits"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className={cn(
                  buttonLinkClassName("outline"),
                  "gap-1.5 shadow-sm",
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
                  buttonLinkClassName("primary"),
                  "gap-1.5",
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
          </>
        )}
      </div>
    </form>
    </>
  );
}

