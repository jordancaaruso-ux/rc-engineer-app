"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
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
import { RunLayoutPicker } from "@/components/runs/RunLayoutPicker";
import { tireSetDisplayLine } from "@/lib/tires/tireSelectionFromSet";
import { TireTypeCombobox } from "@/components/tires/TireTypeCombobox";
import { AdditiveTypeCombobox } from "@/components/additives/AdditiveTypeCombobox";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { RunTireSelectionPanel, type NewTireSetIntent } from "@/components/runs/RunTireSelectionPanel";
import { RunAdditiveTimingPanel } from "@/components/runs/RunAdditiveTimingPanel";
import { QuickAddBatteryPanel } from "@/components/assets/QuickAddBatteryPanel";
import { collectSetupSheetTemplateKeys } from "@/lib/setupSheetModels/collectTemplateKeys";
import { applyRunContextToSetupSnapshot } from "@/lib/runs/applyRunContextToSetupSnapshot";
import { formatTirePrepSummaryFromSnapshot } from "@/lib/runs/runTireContextDisplay";
import {
  normalizeTirePrep,
  tirePrepFromLegacy,
  derivedWarmerTimingMinutes,
  pruneTirePrepForSave,
  tirePrepHasContent,
  formatTirePrepLine,
  emptyTirePrepStep,
  type TirePrepStep,
} from "@/lib/runs/tirePrep";
import { formatEventDate, formatEventRelativeLabel, formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { type MeetingSessionType } from "@/lib/runSession";
import { setActiveSetupData, migrateLegacyLoadedSetup } from "@/lib/activeSetupContext";
import type { RunPickerRun } from "@/lib/runPickerFormat";
import { formatRunPickerLineRelativeWhen } from "@/lib/runPickerFormat";
import { CopyLastRunCard } from "@/components/runs/CopyLastRunCard";
import { useCopyLastRunFormOptional } from "@/components/runs/CopyLastRunFormContext";
import { useTodayDraftRunOptional } from "@/components/layout/TodayDraftRunProvider";
import type { CopyPreviewRunRecord } from "@/lib/runs/copyPreviewRunTypes";
import { RunLogQuickSetupUpload } from "@/components/runs/RunLogQuickSetupUpload";
import { LogRunProgressRail, type RunProgressSection } from "@/components/runs/LogRunProgressRail";
import { RunPickerSelect } from "@/components/runs/RunPickerSelect";
import { PagedCard, type PagedCardFace } from "@/components/ui/PagedCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { AutoGrowTextarea } from "@/components/ui/AutoGrowTextarea";
import { Switch } from "@/components/ui/Switch";
import { isEndDateBeforeStartDateYmd } from "@/lib/eventDateValidation";
import { splitEventsForPicker } from "@/lib/events/splitEventsForPicker";
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
import { CarHandlingRatingQuickPick } from "@/components/runs/CarHandlingRatingQuickPick";
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
import { RunConditionsSection } from "@/components/runs/RunConditionsSection";
import { EMPTY_RUN_CONDITIONS, isConditionsEmpty, type RunConditions } from "@/lib/weather/conditions";
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
import { mergeUniqueById } from "@/lib/assets/mergeAssetLists";

/**
 * Floating save-action pills — same DNA as the global `LogRunFab` pill
 * (h-12 rounded-full, Sora bold, yellow glow + charcoal shadow + specular rim)
 * so the persistent actions read as one system across the app.
 */
const fabPillPrimaryClass =
  "pointer-events-auto tap-active inline-flex h-12 items-center gap-1.5 rounded-full bg-primary px-4 font-sans text-sm font-bold text-primary-foreground shadow-[0_12px_26px_-6px_rgba(255,214,10,0.35),0_10px_22px_-8px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.4)] transition-transform duration-150 hover:bg-[#E6BE00] active:scale-95 touch-manipulation";
const fabPillOutlineClass =
  "pointer-events-auto tap-active inline-flex h-12 items-center gap-1.5 rounded-full border border-white/10 bg-card px-4 font-sans text-sm font-bold text-foreground shadow-[0_10px_22px_-8px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.12)] transition-transform duration-150 hover:bg-muted active:scale-95 touch-manipulation";

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
  /** Layout the venue ran for this meeting; runs default to it. */
  trackLayoutId?: string | null;
  trackLayout?: { id: string; name: string } | null;
  trackDirection?: "CW" | "CCW" | null;
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
  controlledAdditiveTypeId?: string | null;
  controlledAdditiveType?: { id: string; displayName: string; modelCode: string } | null;
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
  trackLayoutId?: string | null;
  trackLayout?: { id: string; name: string } | null;
  trackDirection?: "CW" | "CCW" | null;
  eventId: string | null;
  tireSetId: string | null;
  tireRunNumber: number;
  additiveTypeId?: string | null;
  warmerTimingMinutes?: number | null;
  /** Ordered tire-prep applications (see src/lib/runs/tirePrep.ts); JSON on the run. */
  tirePrep?: unknown;
  additiveType?: { id: string; displayName: string; modelCode: string } | null;
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
  /** Weather / conditions captured for this session (metric); populated when editing. */
  conditions?: RunConditions | null;
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

/**
 * Run-context selections (tires, battery, additive) are mirrored into the setup
 * snapshot by the deterministic sync (`applyRunContextToSetupSnapshot`) so they
 * ride along in the saved sheet — but they are captured on their own Tires /
 * Battery tabs, not the chassis sheet. They must NOT count toward the "changes
 * since loaded" setup diff, or picking today's tires reads as a setup change.
 */
const RUN_CONTEXT_SETUP_KEYS = new Set([
  "tires",
  "tires_setup",
  "battery",
  "additive",
  "additive_time",
]);

/**
 * localStorage key for the silent autosave of an in-progress (never-saved) new-run
 * form. Only used on the plain `/runs/new` flow — edit / draft runs live in the DB.
 * Bump the version suffix if the persisted shape changes incompatibly.
 */
const NEW_RUN_DRAFT_STORAGE_KEY = "rc-engineer-new-run-draft-v2";

/** Fields we silently persist so leaving and returning to `/runs/new` doesn't lose work. */
type NewRunDraftSnapshot = {
  sessionType: "TESTING" | "RACE_MEETING";
  meetingSessionType: MeetingSessionType;
  meetingSessionCustom: string;
  carId: string;
  trackId: string;
  trackLayoutId: string;
  trackDirection: "" | "CW" | "CCW";
  eventId: string;
  tireSetId: string;
  newTireSetIntent: NewTireSetIntent | null;
  additiveTypeId: string;
  tirePrep: TirePrepStep[];
  batteryId: string;
  setupData: SetupSnapshotData;
  setupBaselineSnapshotId: string | null;
  setupBaselineData: SetupSnapshotData | null;
  lapIngest: LapIngestFormValue;
  notes: string;
  raceClass: string;
  setupChangesText: string;
  handlingUi: HandlingAssessmentUiState;
  carRating: number | null;
  shareWithTeam: boolean;
  conditions: RunConditions;
};

/**
 * True when a draft snapshot holds anything worth restoring. `carId` /
 * `shareWithTeam` carry defaults, so they don't count as "the driver logged
 * something" on their own.
 */
function newRunDraftHasContent(s: NewRunDraftSnapshot): boolean {
  return Boolean(
    s.trackId ||
      s.eventId ||
      s.tireSetId ||
      s.newTireSetIntent ||
      s.batteryId ||
      s.additiveTypeId ||
      (s.tirePrep && tirePrepHasContent(s.tirePrep)) ||
      s.notes.trim() ||
      s.raceClass.trim() ||
      s.setupChangesText.trim() ||
      s.carRating != null ||
      s.sessionType !== "TESTING" ||
      (s.setupData && Object.keys(s.setupData).length > 0) ||
      (s.lapIngest && newRunLapIngestHasContent(s.lapIngest)) ||
      (s.handlingUi && isHandlingAssessmentMeaningful(persistedFromUiState(s.handlingUi))) ||
      (s.conditions && !isConditionsEmpty(s.conditions))
  );
}

/** Any driver-entered laps (manual paste, edited rows, or a URL import block). */
function newRunLapIngestHasContent(v: LapIngestFormValue): boolean {
  return Boolean(
    v.manualText.trim() ||
      (v.manualLapRows && v.manualLapRows.length > 0) ||
      (v.urlLapRows && v.urlLapRows.length > 0) ||
      (v.urlImportBlocks && v.urlImportBlocks.length > 0)
  );
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
  /**
   * Roll Center Lab export (`/runs/new?labSetup=…`): geometry sheet-field values
   * to merge over the starting setup, so a Lab what-if becomes a loggable run
   * (docs/ROLL_CENTER_NORTH_STAR.md Phase 3).
   */
  labSetupPrefill?: Record<string, string> | null;
}) {
  const router = useRouter();
  const copyLastRunCtx = useCopyLastRunFormOptional();
  const todayDraftCtx = useTodayDraftRunOptional();
  const externalCopyLastRunCard = Boolean(copyLastRunCtx);
  const [carsList, setCarsList] = useState<CarOption[]>(props.cars);
  const tracks = props.tracks;
  const favouriteTrackIds = props.favouriteTrackIds ?? [];
  const favouriteTracks = props.favouriteTracks ?? [];
  const dashboardPrefill = props.dashboardPrefill ?? null;
  const initialEventId = props.initialEventId?.trim() || null;
  const labSetupPrefill = props.labSetupPrefill ?? null;

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
  /** Named layout ran this session (descriptive; empty = none). */
  const [trackLayoutId, setTrackLayoutId] = useState<string>("");
  /** Optional running direction for this session. */
  const [trackDirection, setTrackDirection] = useState<"" | "CW" | "CCW">("");
  const [tireSets, setTireSets] = useState<TireSetOption[]>([]);
  const [tireSetId, setTireSetId] = useState<string>("");
  /** NEW-set choice — pure form state; the set row is created when the run is saved. */
  const [newTireSetIntent, setNewTireSetIntent] = useState<NewTireSetIntent | null>(null);
  /** Compound the picker should activate (event spec tire); never forces a selection. */
  const [preferredTireType, setPreferredTireType] = useState<{
    id: string;
    displayName: string;
  } | null>(null);
  const [runsCompleted, setRunsCompleted] = useState<number>(0);
  const [additiveTypeId, setAdditiveTypeId] = useState<string>("");
  /** Ordered tire-prep applications toward the run (see src/lib/runs/tirePrep.ts).
   *  Starts with one blank row ready (most runs have at least one application);
   *  blank rows are pruned on save, so the default never persists by itself. */
  const [tirePrep, setTirePrep] = useState<TirePrepStep[]>([emptyTirePrepStep()]);
  const [additiveTypesById, setAdditiveTypesById] = useState<
    Record<string, { id: string; displayName: string }>
  >({});
  const [batteries, setBatteries] = useState<BatteryPackOption[]>([]);
  const [batteryId, setBatteryId] = useState<string>("");
  // Raw input string so the field can be cleared/edited freely (empty while
  // typing); the canonical count is derived from it.
  const [batteryRunsInput, setBatteryRunsInput] = useState<string>("0");
  const batteryRunsCompleted = Math.max(0, Math.floor(Number(batteryRunsInput) || 0));
  // Programmatic setter used by copy-last / edit / auto-fill paths — keeps the
  // string field in sync when the count is set from a number.
  const setBatteryRunsCompleted = (n: number) =>
    setBatteryRunsInput(String(Math.max(0, Math.floor(n))));

  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventId, setEventId] = useState<string>("");
  const [showNewEventPanel, setShowNewEventPanel] = useState(false);
  const [newEventName, setNewEventName] = useState("");
  const [newEventTrackId, setNewEventTrackId] = useState<string>("");
  const [newEventLayoutId, setNewEventLayoutId] = useState<string>("");
  const [newEventDirection, setNewEventDirection] = useState<"" | "CW" | "CCW">("");
  const [newEventStartDate, setNewEventStartDate] = useState("");
  const [newEventEndDate, setNewEventEndDate] = useState("");
  const [newEventPracticeUrl, setNewEventPracticeUrl] = useState("");
  const [newEventResultsUrl, setNewEventResultsUrl] = useState("");
  const [newEventTireControlled, setNewEventTireControlled] = useState(false);
  const [newEventControlledTireTypeId, setNewEventControlledTireTypeId] = useState("");
  const [newEventControlAdditiveEnabled, setNewEventControlAdditiveEnabled] = useState(false);
  const [newEventControlledAdditiveTypeId, setNewEventControlledAdditiveTypeId] = useState("");
  /** When logging a race meeting, timing URLs (stored on the Event; edited here, PATCH on save). */
  const [eventPracticeTimingUrl, setEventPracticeTimingUrl] = useState("");
  const [eventRaceTimingUrl, setEventRaceTimingUrl] = useState("");
  const [eventControlledTireTypeId, setEventControlledTireTypeId] = useState("");
  const [eventControlAdditiveEnabled, setEventControlAdditiveEnabled] = useState(false);
  const [eventControlledAdditiveTypeId, setEventControlledAdditiveTypeId] = useState("");
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsLoadError, setEventsLoadError] = useState<string | null>(null);

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
  /** Deep-frozen copy of the setup that was loaded (past run / downloaded / replicate / edit-run hydrate).
   *  Drives the "X changes from loaded setup" badge in the collapsed view. */
  const [setupBaselineData, setSetupBaselineData] = useState<SetupSnapshotData | null>(null);
  /** Per-source sheet stash so swiping between source faces is lossless (see handleSetupSourceChange). */
  const setupSourceStashRef = useRef<
    Partial<
      Record<
        "previous_runs" | "other" | "new",
        {
          setupData: SetupSnapshotData;
          baselineSnapshotId: string | null;
          baselineData: SetupSnapshotData | null;
        }
      >
    >
  >({});
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
  const [feedbackFace, setFeedbackFace] = useState<"feedback" | "handling">("feedback");
  /** Required 1-10 overall car rating; null until the driver sets one. Server enforces presence at "Run complete". */
  const [carRating, setCarRating] = useState<number | null>(null);
  type RunDetailsTab = "car" | "tires" | "battery" | "conditions" | "track";
  const [runDetailsTab, setRunDetailsTab] = useState<RunDetailsTab>("car");
  const [trackSaveWarning, setTrackSaveWarning] = useState(false);

  const [showNewBatteryPanel, setShowNewBatteryPanel] = useState(false);

  const [shareWithTeam, setShareWithTeam] = useState(true);
  // Null until the team check resolves; the share toggle only renders when the
  // driver is actually on a team (otherwise sharing is a no-op).
  const [hasTeams, setHasTeams] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [, startCopyTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [completeValidation, setCompleteValidation] = useState<{
    show: boolean;
    carRating: boolean;
    feelVsLastRun: boolean;
    additive: boolean;
    setup: boolean;
  }>({ show: false, carRating: false, feelVsLastRun: false, additive: false, setup: false });

  const [copyCarWarning, setCopyCarWarning] = useState<string | null>(null);
  const [copyTrackWarning, setCopyTrackWarning] = useState<string | null>(null);
  const [copyTireWarning, setCopyTireWarning] = useState<string | null>(null);
  const [copyBatteryWarning, setCopyBatteryWarning] = useState<string | null>(null);
  const [pickerRuns, setPickerRuns] = useState<RunPickerRun[]>([]);
  const [loadSetupSelection, setLoadSetupSelection] = useState("");
  const [loadOtherSetupSelection, setLoadOtherSetupSelection] = useState("");
  const [setupSource, setSetupSource] = useState<"previous_runs" | "other" | "new">("previous_runs");
  const [newSetupMode, setNewSetupMode] = useState<"blank" | "upload">("blank");
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
  const newTireSetIntentRef = useRef(newTireSetIntent);
  newTireSetIntentRef.current = newTireSetIntent;
  const additiveTypeIdRef = useRef(additiveTypeId);
  additiveTypeIdRef.current = additiveTypeId;
  const tirePrepRef = useRef(tirePrep);
  tirePrepRef.current = tirePrep;
  const batteryIdRef = useRef(batteryId);
  batteryIdRef.current = batteryId;
  const tireRunUserTouchedRef = useRef(false);
  const batteryRunUserTouchedRef = useRef(false);
  /** Clear NEW-set intent (ref synced immediately so snapshot writes in the same tick see it). */
  const clearNewTireSetIntent = useCallback(() => {
    setNewTireSetIntent(null);
    newTireSetIntentRef.current = null;
  }, []);
  /** After a successful "Run complete", block duplicate POST/PUT until navigation away. */
  const pendingCompleteNavigationRef = useRef(false);
  const pendingDraftNavigationRef = useRef(false);
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
  /** True once the user has hand-picked a layout/direction; suppresses event auto-fill. */
  const layoutPickedManuallyRef = useRef(false);
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
  const [conditions, setConditions] = useState<RunConditions>(
    () => editRun?.conditions ?? { ...EMPTY_RUN_CONDITIONS }
  );
  const conditionsAutoFetchKeyRef = useRef<string | null>(null);
  /**
   * True when we're editing a run that was saved as a draft (user hit "Save
   * draft" earlier and hasn't marked it complete yet). Drives the amber
   * highlight on the "After the run" divider + the empty Notes textarea so
   * drivers can see what's still expected before clicking "Run complete".
   */
  const isDraft = isEditing && editRun?.loggingComplete === false;
  /** Run was already marked complete — edits must not flip back to draft or bump tire/battery run # (server enforces too). */
  const editingCompletedRun = isEditing && editRun?.loggingComplete === true;
  const focusSection = props.focusSection ?? null;
  const setupSectionRef = useRef<HTMLDivElement>(null);
  const feedbackRequiredRef = useRef<HTMLDivElement>(null);
  const focusAppliedRef = useRef(false);

  const dashboardPrefillAppliedRef = useRef(false);
  const editPrefillAppliedRef = useRef(false);

  /**
   * Gate the portaled save bar until after mount so `createPortal(document.body)`
   * never runs during SSR. The bar is portaled out of the form (and thus out of
   * `.page-body`) because the app-wide reveal animation puts a transform on every
   * `.page-body` child, and a transformed ancestor traps `position: fixed` — which
   * pinned the bar to the form's bottom instead of the viewport. Same reason
   * AppShell renders BottomNav / LogRunFab outside `.app-shell`.
   */
  const [saveBarMounted, setSaveBarMounted] = useState(false);
  useEffect(() => {
    setSaveBarMounted(true);
  }, []);

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
    setTrackLayoutId(r.trackLayoutId ?? r.trackLayout?.id ?? "");
    setTrackDirection(r.trackDirection ?? "");
    layoutPickedManuallyRef.current = true;

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
    clearNewTireSetIntent();
    // `runsCompleted` is always the count of *prior* runs on this tire set —
    // save() sends `runsCompleted + 1`. When hydrating an existing run we want
    // that re-save to preserve the run's current tireRunNumber, not bump it,
    // so subtract one from the stored number. Same for battery. Before this
    // fix, editing any saved run (especially a draft being completed) added
    // +1 to the tire/battery slot on every save, producing the "+2 per
    // draft→complete cycle" behavior.
    setRunsCompleted(Math.max(0, (r.tireRunNumber ?? 1) - 1));
    setAdditiveTypeId(r.additiveTypeId ?? r.additiveType?.id ?? "");
    {
      const steps =
        Array.isArray(r.tirePrep) && r.tirePrep.length > 0
          ? normalizeTirePrep(r.tirePrep)
          : tirePrepFromLegacy(
              r.warmerTimingMinutes,
              Boolean(r.additiveTypeId ?? r.additiveType?.id)
            );
      // Always keep one row ready — blank rows are pruned on save.
      setTirePrep(steps.length > 0 ? steps : [emptyTirePrepStep()]);
    }
    if (r.additiveType) {
      setAdditiveTypesById((prev) => ({
        ...prev,
        [r.additiveType!.id]: {
          id: r.additiveType!.id,
          displayName: r.additiveType!.displayName,
        },
      }));
    }
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
    // Feedback face stays the landing view even when the run has handling
    // detail — required rating fields live there; detail is one swipe away.
    setFeedbackFace("feedback");
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
  }, [editRun, carsList, clearNewTireSetIntent]);

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
    setTrackLayoutId(r.trackLayoutId ?? r.trackLayout?.id ?? "");
    setTrackDirection(r.trackDirection ?? "");
    layoutPickedManuallyRef.current = true;

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
    clearNewTireSetIntent();
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
  }, [dashboardPrefill, carsList, clearNewTireSetIntent]);

  /**
   * Roll Center Lab export: merge the Lab's geometry field values over whatever
   * setup the form starts with (and re-apply after "copy last run", so the
   * what-if — the reason the driver came here — survives the copy).
   */
  const labSetupAppliedRef = useRef(false);
  useEffect(() => {
    if (!labSetupPrefill || labSetupAppliedRef.current) return;
    labSetupAppliedRef.current = true;
    setSetupData((prev) => setupSnapshotWithDerived({ ...prev, ...labSetupPrefill }));
    setSetupSectionExpanded(true);
  }, [labSetupPrefill]);
  useEffect(() => {
    if (!labSetupPrefill || !lastRunCopyApplied) return;
    setSetupData((prev) => setupSnapshotWithDerived({ ...prev, ...labSetupPrefill }));
  }, [labSetupPrefill, lastRunCopyApplied]);

  /**
   * Silent draft autosave (issue: leaving `/runs/new` mid-log lost everything).
   * Only the plain new-run flow — edit/draft runs and deep-linked prefills own
   * their own state and must not be clobbered by a stale local snapshot.
   */
  const draftAutosaveEnabled = !isEditing && !dashboardPrefill && !initialEventId && !labSetupPrefill;
  const draftHydratedRef = useRef(false);

  // Restore once on mount. Runs after the default/prefill effects above so the
  // saved snapshot wins over the empty starting form.
  useEffect(() => {
    if (draftHydratedRef.current) return;
    if (!draftAutosaveEnabled) {
      draftHydratedRef.current = true;
      return;
    }
    try {
      const raw = window.localStorage.getItem(NEW_RUN_DRAFT_STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<NewRunDraftSnapshot>;
        if (s.sessionType === "TESTING" || s.sessionType === "RACE_MEETING")
          setSessionType(s.sessionType);
        if (s.meetingSessionType) setMeetingSessionType(s.meetingSessionType);
        if (typeof s.meetingSessionCustom === "string")
          setMeetingSessionCustom(s.meetingSessionCustom);
        if (s.carId) setCarId(s.carId);
        if (typeof s.trackId === "string") setTrackId(s.trackId);
        if (typeof s.trackLayoutId === "string") setTrackLayoutId(s.trackLayoutId);
        if (s.trackDirection === "" || s.trackDirection === "CW" || s.trackDirection === "CCW")
          setTrackDirection(s.trackDirection);
        if (typeof s.eventId === "string") setEventId(s.eventId);
        if (typeof s.tireSetId === "string") setTireSetId(s.tireSetId);
        if (s.newTireSetIntent !== undefined) setNewTireSetIntent(s.newTireSetIntent);
        if (typeof s.additiveTypeId === "string") setAdditiveTypeId(s.additiveTypeId);
        if (Array.isArray(s.tirePrep)) {
          const steps = normalizeTirePrep(s.tirePrep);
          setTirePrep(steps.length > 0 ? steps : [emptyTirePrepStep()]);
        }
        if (typeof s.batteryId === "string") setBatteryId(s.batteryId);
        if (s.setupData) setSetupData(s.setupData);
        if (s.setupBaselineSnapshotId !== undefined)
          setSetupBaselineSnapshotId(s.setupBaselineSnapshotId);
        if (s.setupBaselineData !== undefined) setSetupBaselineData(s.setupBaselineData);
        if (s.lapIngest) setLapIngest(s.lapIngest);
        if (typeof s.notes === "string") setNotes(s.notes);
        if (typeof s.raceClass === "string") setRaceClass(s.raceClass);
        if (typeof s.setupChangesText === "string") setSetupChangesText(s.setupChangesText);
        if (s.handlingUi) setHandlingUi(s.handlingUi);
        if (s.carRating === null || typeof s.carRating === "number") setCarRating(s.carRating);
        if (typeof s.shareWithTeam === "boolean") setShareWithTeam(s.shareWithTeam);
        if (s.conditions) setConditions(s.conditions);
      }
    } catch {
      // Corrupt/unavailable storage — start fresh, never block the form.
    }
    draftHydratedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftAutosaveEnabled]);

  // Debounced persist. Guarded on hydration so the initial empty render can't
  // overwrite a saved snapshot before restore runs.
  useEffect(() => {
    if (!draftAutosaveEnabled || !draftHydratedRef.current) return;
    const snapshot: NewRunDraftSnapshot = {
      sessionType,
      meetingSessionType,
      meetingSessionCustom,
      carId,
      trackId,
      trackLayoutId,
      trackDirection,
      eventId,
      tireSetId,
      newTireSetIntent,
      additiveTypeId,
      tirePrep,
      batteryId,
      setupData,
      setupBaselineSnapshotId,
      setupBaselineData,
      lapIngest,
      notes,
      raceClass,
      setupChangesText,
      handlingUi,
      carRating,
      shareWithTeam,
      conditions,
    };
    if (!newRunDraftHasContent(snapshot)) {
      try {
        window.localStorage.removeItem(NEW_RUN_DRAFT_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(NEW_RUN_DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
      } catch {
        /* quota / unavailable — best effort only */
      }
    }, 700);
    return () => clearTimeout(t);
  }, [
    draftAutosaveEnabled,
    sessionType,
    meetingSessionType,
    meetingSessionCustom,
    carId,
    trackId,
    trackLayoutId,
    trackDirection,
    eventId,
    tireSetId,
    newTireSetIntent,
    additiveTypeId,
    tirePrep,
    batteryId,
    setupData,
    setupBaselineSnapshotId,
    setupBaselineData,
    lapIngest,
    notes,
    raceClass,
    setupChangesText,
    handlingUi,
    carRating,
    shareWithTeam,
    conditions,
  ]);

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

  const sheetFieldKeys = useMemo(
    () => collectSetupSheetTemplateKeys(setupTemplate),
    [setupTemplate]
  );
  const applyRunContextToSetupSnapshotLocal = useCallback(
    (
      nextTireSetId: string,
      nextBatteryId: string,
      nextAdditiveTypeId: string,
      nextTirePrep: TirePrepStep[]
    ) => {
      // NEW-set intent has no row yet — a synthetic set keeps the sheet's tire line honest.
      const intent = newTireSetIntentRef.current;
      const tire = nextTireSetId
        ? tireSets.find((t) => t.id === nextTireSetId) ?? null
        : intent
          ? {
              label: intent.displayName,
              tireType: { id: intent.tireTypeId, displayName: intent.displayName, modelCode: "" },
            }
          : null;
      const bat = nextBatteryId ? batteries.find((b) => b.id === nextBatteryId) ?? null : null;
      const additive =
        nextAdditiveTypeId ? additiveTypesById[nextAdditiveTypeId] ?? null : null;
      setSetupData((prev) => {
        const next = applyRunContextToSetupSnapshot({
          resolvedData: prev,
          sheetKeys: sheetFieldKeys,
          tireSet: tire,
          batteryLabel: bat ? `${bat.label}${bat.packNumber != null ? ` #${bat.packNumber}` : ""}` : "",
          additiveDisplayName: additive?.displayName ?? null,
          warmerTimingMinutes: derivedWarmerTimingMinutes(nextTirePrep),
        });
        if (JSON.stringify(next) === JSON.stringify(prev)) return prev;
        return applyDerivedFieldsToSnapshot(next);
      });
    },
    [tireSets, batteries, additiveTypesById, sheetFieldKeys]
  );

  function applyTireBatteryToSetupSnapshot(nextTireSetId: string, nextBatteryId: string) {
    applyRunContextToSetupSnapshotLocal(
      nextTireSetId,
      nextBatteryId,
      additiveTypeIdRef.current,
      tirePrepRef.current
    );
  }

  function applyAdditiveTimingToSetupSnapshot(nextAdditiveTypeId: string, nextTirePrep: TirePrepStep[]) {
    applyRunContextToSetupSnapshotLocal(
      tireSetIdRef.current,
      batteryIdRef.current,
      nextAdditiveTypeId,
      nextTirePrep
    );
  }


  // Deterministic sync: snapshot tires/battery/additive always mirror run context selections.
  // `newTireSetIntent` is read via ref inside the callback; it's a dep so intent toggles re-sync.
  useEffect(() => {
    applyRunContextToSetupSnapshotLocal(
      tireSetId,
      batteryId,
      additiveTypeId,
      tirePrep
    );
  }, [
    tireSetId,
    newTireSetIntent,
    batteryId,
    additiveTypeId,
    tirePrep,
    applyRunContextToSetupSnapshotLocal,
  ]);

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
    return buildSetupDiffRows(setupData, setupBaselineData).filter(
      (r) => r.changed && !RUN_CONTEXT_SETUP_KEYS.has(r.key)
    );
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
      const setupOk = Object.keys(setupData).length > 0;
      if (carOk && feelOk && setupOk) {
        return { show: false, carRating: false, feelVsLastRun: false, additive: false, setup: false };
      }
      return {
        show: true,
        carRating: prev.carRating && !carOk,
        feelVsLastRun: prev.feelVsLastRun && !feelOk,
        additive: prev.additive,
        setup: prev.setup && !setupOk,
      };
    });
  }, [carRating, handlingUi.feelVsLastRun, feelVsLastRunEligible, setupData]);

  useEffect(() => {
    if (completeValidation.show) return;
    setInlineError((err) => (err?.startsWith("Before Run complete:") ? null : err));
  }, [completeValidation.show]);

  useEffect(() => {
    // Required rating fields live on the "feedback" face — flip back to it when
    // Run complete validation fires while the user is on Handling detail.
    if (completeValidation.show) setFeedbackFace("feedback");
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

  const eventSelectGroups = useMemo(
    () => splitEventsForPicker(events),
    [events]
  );

  const selectedEventForRun = useMemo(
    () => (needsEvent && eventId ? events.find((e) => e.id === eventId) ?? null : null),
    [needsEvent, eventId, events]
  );
  /**
   * LiveRC root URL of the selected/new event's track, if any. When present, the
   * timing pages are discoverable from the track root, so the manual practice /
   * race timing URL inputs are redundant and hidden.
   */
  const selectedEventTrackLiveRc = useMemo(() => {
    const ev = eventId ? events.find((e) => e.id === eventId) : null;
    const tid = ev?.trackId ?? null;
    return tid ? tracksList.find((t) => t.id === tid)?.liveRcUrl?.trim() || null : null;
  }, [eventId, events, tracksList]);
  const newEventTrackLiveRc = useMemo(
    () =>
      newEventTrackId
        ? tracksList.find((t) => t.id === newEventTrackId)?.liveRcUrl?.trim() || null
        : null,
    [newEventTrackId, tracksList]
  );
  /** Race meeting + event with a track: run track follows the event (picker disabled). */
  const trackLockedToEvent = Boolean(selectedEventForRun?.trackId);

  // Event-mandated controlled tire / additive. When set, the run's Tires step is
  // locked to them (chosen at the event, not overridable in a run). Both derive
  // purely from the selected event's config.
  const specTireType = useMemo(
    () =>
      needsEvent && eventId && eventControlledTireTypeId.trim() && preferredTireType
        ? preferredTireType
        : null,
    [needsEvent, eventId, eventControlledTireTypeId, preferredTireType]
  );
  const controlAdditive = useMemo(() => {
    const id = eventControlledAdditiveTypeId.trim();
    if (!(needsEvent && eventId && eventControlAdditiveEnabled && id)) return null;
    return { id, displayName: additiveTypesById[id]?.displayName ?? "Control additive" };
  }, [
    needsEvent,
    eventId,
    eventControlAdditiveEnabled,
    eventControlledAdditiveTypeId,
    additiveTypesById,
  ]);

  /**
   * Per-card completion for the floating progress rail. Required = the exact
   * "Run complete" bar the save gate enforces (car · track · rating · feel-when-
   * eligible · a setup snapshot). Tires are the one recommended-but-optional
   * nudge; a controlled additive is auto-filled (running none is allowed) so it
   * is never a blocker. Session + Event carry no gate, so they always read
   * complete — they stay in the rail as scroll anchors / a full map of the form.
   */
  const railSections = useMemo<RunProgressSection[]>(() => {
    const hasTrack = Boolean(
      trackId.trim() || (trackLockedToEvent && selectedEventForRun?.trackId)
    );
    const detailsRequired = (carId ? 0 : 1) + (hasTrack ? 0 : 1);
    const hasTires = Boolean(tireSetId || newTireSetIntent);
    const hasSetup = Object.keys(setupData).length > 0;
    const ratingMissing = carRating == null || carRating < 1 || carRating > 10;
    const feelMissing = feelVsLastRunEligible && handlingUi.feelVsLastRun == null;
    return [
      { id: "session", label: "Session", requiredMissing: 0, recommendedMissing: 0 },
      { id: "event", label: "Event", requiredMissing: 0, recommendedMissing: 0 },
      {
        id: "details",
        label: "Details",
        requiredMissing: detailsRequired,
        recommendedMissing: hasTires ? 0 : 1,
      },
      { id: "setup", label: "Setup", requiredMissing: hasSetup ? 0 : 1, recommendedMissing: 0 },
      {
        id: "feedback",
        label: "Feel",
        requiredMissing: (ratingMissing ? 1 : 0) + (feelMissing ? 1 : 0),
        recommendedMissing: 0,
      },
    ];
  }, [
    carId,
    trackId,
    trackLockedToEvent,
    selectedEventForRun,
    needsEvent,
    eventId,
    eventControlAdditiveEnabled,
    eventControlledAdditiveTypeId,
    additiveTypeId,
    tireSetId,
    newTireSetIntent,
    setupData,
    carRating,
    handlingUi.feelVsLastRun,
    feelVsLastRunEligible,
  ]);

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

  // Effortless capture: silently pull conditions for a pinned track as soon as
  // one is selected — no permission prompt, no need to open the Conditions tab.
  // (Device-location fallback stays an explicit tap in RunConditionsSection.)
  useEffect(() => {
    if (isEditing) return;
    if (!isConditionsEmpty(conditions)) return;
    const resolvedId =
      trackId.trim() ||
      (trackLockedToEvent && selectedEventForRun?.trackId ? String(selectedEventForRun.trackId) : "");
    if (!resolvedId) return;
    const t = tracksList.find((x) => x.id === resolvedId);
    if (!t || !trackHasMarkedLocation(t) || t.latitude == null || t.longitude == null) return;
    const sets = buildImportedLapSetsFromIngest(lapIngest);
    const primary = sets.find((s) => s.isPrimaryUser) ?? sets[0];
    const atIso = primary?.sessionCompletedAt ?? null;
    const key = `${t.id}:${t.latitude.toFixed(3)},${t.longitude.toFixed(3)}:${atIso ?? "now"}`;
    if (conditionsAutoFetchKeyRef.current === key) return;
    conditionsAutoFetchKeyRef.current = key;
    const params = new URLSearchParams({ lat: String(t.latitude), lon: String(t.longitude) });
    if (atIso) params.set("at", atIso);
    let cancelled = false;
    fetch(`/api/weather?${params.toString()}`)
      .then((r) => r.json())
      .then((d: { conditions?: RunConditions }) => {
        if (cancelled || !d?.conditions) return;
        setConditions((prev) => (isConditionsEmpty(prev) ? d.conditions! : prev));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isEditing, conditions, trackId, trackLockedToEvent, selectedEventForRun, tracksList, lapIngest]);

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
    const nextControlledAdditiveId =
      ev.controlledAdditiveTypeId?.trim() ?? ev.controlledAdditiveType?.id ?? "";
    setEventControlAdditiveEnabled(Boolean(nextControlledAdditiveId));
    setEventControlledAdditiveTypeId(nextControlledAdditiveId);
    if (sessionType === "RACE_MEETING" && ev.controlledTireTypeId) {
      // Spec-tire event: steer the picker to that compound. Never forces NEW — the
      // driver's most recent set of the spec compound is usually the right pick.
      setTireSetId("");
      clearNewTireSetIntent();
      const display = ev.controlledTireType?.displayName ?? ev.controlledTireLabel ?? "";
      if (display) {
        setPreferredTireType({ id: ev.controlledTireTypeId, displayName: display });
      }
    }
    if (sessionType === "RACE_MEETING" && nextControlledAdditiveId) {
      setAdditiveTypeId(nextControlledAdditiveId);
      if (ev.controlledAdditiveType) {
        setAdditiveTypesById((prev) => ({
          ...prev,
          [ev.controlledAdditiveType!.id]: {
            id: ev.controlledAdditiveType!.id,
            displayName: ev.controlledAdditiveType!.displayName,
          },
        }));
      }
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
      controlledAdditiveTypeId: (raw.controlledAdditiveTypeId as string | null) ?? null,
      controlledAdditiveType: (raw.controlledAdditiveType as EventOption["controlledAdditiveType"]) ?? null,
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
    if (next === setupSource) return;
    // Lossless source switching: the source control is a swipeable face now, so
    // passing through a face (including "New") must not destroy anything. Leaving
    // a source stashes its sheet + baseline; returning restores it exactly.
    setupSourceStashRef.current[setupSource] = {
      setupData,
      baselineSnapshotId: setupBaselineSnapshotId,
      baselineData: setupBaselineData,
    };
    setSetupSource(next);
    // "New" has no selection step to trigger the reveal, so open the sheet on
    // arrival — the driver came here to build/upload a setup.
    if (next === "new") setSetupSectionExpanded(true);
    const stash = setupSourceStashRef.current[next];
    if (stash) {
      setSetupData(stash.setupData);
      setActiveSetupData(stash.setupData, carId || null);
      setSetupBaselineSnapshotId(stash.baselineSnapshotId);
      setSetupBaselineData(stash.baselineData);
      return;
    }
    if (next === "new") {
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
    // Reveal the loaded sheet so it's obvious the setup is now part of the run.
    setSetupSectionExpanded(true);
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
    // Reveal the loaded sheet so it's obvious the setup is now part of the run.
    setSetupSectionExpanded(true);
  }

  /** Faces for the setup-source PagedCard — the segment IS the source choice;
   *  swiping to a face selects it (losslessly, via setupSourceStashRef). */
  function setupSourceFaces(): PagedCardFace[] {
    return [
      {
        id: "previous_runs",
        label: "Setups from previous runs",
        shortLabel: "Previous runs",
        content: (
          <div className="space-y-2 pt-0.5">
            <RunPickerSelect
              runs={pickerRuns}
              value={loadSetupSelection}
              onChange={applyPastSetupOnly}
              placeholder="Choose a run…"
              disabled={pickerRuns.length === 0}
              formatLine={formatRunPickerLineRelativeWhen}
            />
            {pickerRuns.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No past runs yet, or list failed to load. Switch to{" "}
                <span className="font-medium">New</span> to start from a blank sheet.
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: "other",
        label: "Downloaded setups",
        shortLabel: "Downloaded",
        content: (
          <div className="space-y-2 pt-0.5">
            <div className="space-y-1 text-sm">
              <div className="text-sm font-medium text-muted-foreground break-words min-w-0 leading-snug">
                {loadOtherSetupLabel}
              </div>
              <SearchableSelect
                aria-label="Downloaded setup"
                className="max-w-2xl"
                placeholder="Choose a downloaded setup…"
                clearable
                clearLabel="Choose a downloaded setup…"
                triggerMono
                disabled={downloadedSetups.length === 0}
                value={loadOtherSetupSelection}
                onChange={(next) => applyDownloadedSetupOnly(next)}
                options={downloadedSetups.map((d) => ({
                  value: d.id,
                  label: `${d.originalFilename} · ${formatRunCreatedAtDateTime(d.createdAt)}`,
                }))}
              />
            </div>
            {downloadedSetups.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No downloaded setups for this car yet. Switch to{" "}
                <span className="font-medium">New</span> to upload a setup sheet.
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: "new",
        label: "New setup",
        shortLabel: "New",
        content: (
          <div className="space-y-2 pt-0.5">
            <SegmentedControl<"blank" | "upload">
              ariaLabel="New setup source"
              value={newSetupMode}
              onChange={(next) => setNewSetupMode(next)}
              options={[
                { value: "blank", label: "Write from scratch" },
                { value: "upload", label: "Upload sheet" },
              ]}
            />
            {newSetupMode === "blank" ? (
              <p className="text-[11px] text-muted-foreground">
                Blank setup for this car — edit the sheet below, or lock in when you are ready.
              </p>
            ) : carId ? (
              <RunLogQuickSetupUpload
                carId={carId}
                onImported={handleQuickSetupImported}
                onRefetchList={() => void refreshDownloadedSetups()}
                variant="inline"
              />
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Choose a car first to upload a setup sheet.
              </p>
            )}
          </div>
        ),
      },
    ];
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

  // All user-owned tire sets / batteries (includes assets with zero runs — not car-scoped).
  useEffect(() => {
    let alive = true;
    Promise.all([
      jsonFetch<{ tireSets: TireSetOption[] }>(`/api/tire-sets`),
      jsonFetch<{ batteries: BatteryPackOption[] }>(`/api/batteries`),
    ])
      .then(([{ tireSets }, { batteries }]) => {
        if (!alive) return;
        setTireSets((prev) => mergeUniqueById(prev, tireSets ?? []));
        setBatteries((prev) => mergeUniqueById(prev, batteries ?? []));
      })
      .catch(() => {
        /* keep in-session additions */
      });
    return () => {
      alive = false;
    };
  }, []);

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
        setTireSets((prev) => mergeUniqueById(prev, tireSets ?? []));
        setBatteries((prev) => mergeUniqueById(prev, batteries ?? []));
        setLastRun(lastRun);

        if (replicateLast && lastRun) {
          setTrackId(lastRun.trackId ?? "");
          setTrackLayoutId(lastRun.trackLayoutId ?? lastRun.trackLayout?.id ?? "");
          setTrackDirection(lastRun.trackDirection ?? "");
          layoutPickedManuallyRef.current = true;
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
          clearNewTireSetIntent();
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
  }, [carId, replicateLast, clearNewTireSetIntent]);

  // replicateLast still powers "copy from last run for this car" behavior after the initial copy decision.
  useEffect(() => {
    if (!replicateLast || !lastRun) return;
    setTrackId(lastRun.trackId ?? "");
    setTrackLayoutId(lastRun.trackLayoutId ?? lastRun.trackLayout?.id ?? "");
    setTrackDirection(lastRun.trackDirection ?? "");
    layoutPickedManuallyRef.current = true;
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
    clearNewTireSetIntent();
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
  }, [replicateLast, lastRun, carId, clearNewTireSetIntent]);

  useEffect(() => {
    if (!needsEvent) return;
    let alive = true;
    setEventsLoading(true);
    setEventsLoadError(null);
    jsonFetch<{ events: EventOption[] }>("/api/events", { cache: "no-store" })
      .then(({ events: list }) => {
        if (!alive) return;
        const all = list ?? [];
        setEvents(all);
        const { upcoming } = splitEventsForPicker(all);
        setEventId((current) => {
          if (current) return current;
          if (upcoming.length > 0) return upcoming[0].id;
          return "";
        });
      })
      .catch((err) => {
        if (!alive) return;
        setEvents([]);
        setEventsLoadError(
          err instanceof Error ? err.message : "Could not load events — try again."
        );
      })
      .finally(() => {
        if (alive) setEventsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [needsEvent]);

  // Team membership gates the share toggle — sharing does nothing with no team.
  useEffect(() => {
    let alive = true;
    fetch("/api/teams", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { teams: [] }))
      .then((d: { teams?: unknown[] }) => {
        if (alive) setHasTeams(Array.isArray(d.teams) && d.teams.length > 0);
      })
      .catch(() => {
        if (alive) setHasTeams(false);
      });
    return () => {
      alive = false;
    };
  }, []);

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
    // Runs in an event default to the event's layout + direction. Rare that a
    // session differs, so we auto-fill but leave it editable — once the user
    // hand-picks a layout/direction we stop overriding.
    if (!layoutPickedManuallyRef.current) {
      setTrackLayoutId(selected.trackLayoutId ?? "");
      setTrackDirection(selected.trackDirection ?? "");
    }
  }, [eventId, events, needsEvent, trackId]);

  useEffect(() => {
    if (!needsEvent || !eventId) {
      setEventPracticeTimingUrl("");
      setEventRaceTimingUrl("");
      setEventControlledTireTypeId("");
      setEventControlAdditiveEnabled(false);
      setEventControlledAdditiveTypeId("");
      setPreferredTireType(null);
      return;
    }
    const ev = events.find((e) => e.id === eventId);
    if (!ev) return;
    setEventPracticeTimingUrl(ev.practiceSourceUrl?.trim() ?? "");
    setEventRaceTimingUrl(ev.resultsSourceUrl?.trim() ?? "");
    const nextControlledTireId = ev.controlledTireTypeId?.trim() ?? ev.controlledTireType?.id ?? "";
    setEventControlledTireTypeId(nextControlledTireId);
    // Steer the tire picker to the spec compound and power the Spec/Open pill.
    // (Manual event selection never ran applyEventOption, so this was the missing
    // hydration that kept the pill from showing.)
    if (nextControlledTireId) {
      const display =
        ev.controlledTireType?.displayName ?? ev.controlledTireLabel ?? "Spec tire";
      setPreferredTireType({ id: nextControlledTireId, displayName: display });
    } else {
      setPreferredTireType(null);
    }
    const nextControlledAdditiveId =
      ev.controlledAdditiveTypeId?.trim() ?? ev.controlledAdditiveType?.id ?? "";
    setEventControlAdditiveEnabled(Boolean(nextControlledAdditiveId));
    setEventControlledAdditiveTypeId(nextControlledAdditiveId);
    // Cache the control additive's name so the Control/Open pill reads it.
    if (nextControlledAdditiveId && ev.controlledAdditiveType) {
      setAdditiveTypesById((prev) => ({
        ...prev,
        [ev.controlledAdditiveType!.id]: {
          id: ev.controlledAdditiveType!.id,
          displayName: ev.controlledAdditiveType!.displayName,
        },
      }));
    }
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
      clearNewTireSetIntent();
      setRunsCompleted(r.tireRunNumber ?? 0);
      setCopyTireWarning(null);
      highlights.tires = true;
    } else if (r.tireSet?.label) {
      setCopyTireWarning(`Last run used tire set that no longer exists: ${r.tireSet.label}. You can select a current set.`);
    } else {
      setCopyTireWarning(null);
    }

    const nextAdditiveId = r.additiveTypeId ?? r.additiveType?.id ?? "";
    if (nextAdditiveId) {
      setAdditiveTypeId(nextAdditiveId);
      if (r.additiveType) {
        setAdditiveTypesById((prev) => ({
          ...prev,
          [r.additiveType!.id]: {
            id: r.additiveType!.id,
            displayName: r.additiveType!.displayName,
          },
        }));
      }
    } else {
      setAdditiveTypeId("");
    }
    {
      const steps =
        Array.isArray(r.tirePrep) && r.tirePrep.length > 0
          ? normalizeTirePrep(r.tirePrep)
          : tirePrepFromLegacy(r.warmerTimingMinutes, Boolean(nextAdditiveId));
      setTirePrep(steps.length > 0 ? steps : [emptyTirePrepStep()]);
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
          trackLayoutId: newEventLayoutId || null,
          trackDirection: newEventDirection || null,
          startDate: start,
          endDate: end,
          practiceSourceUrl: newEventPracticeUrl.trim() || null,
          resultsSourceUrl: newEventResultsUrl.trim() || null,
          controlledTireTypeId: newEventControlledTireTypeId.trim() || null,
          controlledAdditiveTypeId: newEventControlAdditiveEnabled
            ? newEventControlledAdditiveTypeId.trim() || null
            : null,
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
      setNewEventTireControlled(false);
      setNewEventControlledTireTypeId("");
      setNewEventControlAdditiveEnabled(false);
      setNewEventControlledAdditiveTypeId("");
      setShowNewEventPanel(false);
      setStatus("Event created — selected.");
    } catch (err) {
      setEventError(err instanceof Error ? err.message : "Failed to create event");
    } finally {
      setCreatingEvent(false);
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
    intent: "draft" | "completed" = "completed"
  ) {
    e?.preventDefault();
    if (pendingCompleteNavigationRef.current || pendingDraftNavigationRef.current) return;
    if (saving) return;
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
      // A controlled additive is auto-filled (running none is allowed), so it is
      // never a save blocker.
      const missingSetup = Object.keys(setupData).length === 0;
      if (missingCarRating || missingFeelVsLastRun || missingSetup) {
        const parts: string[] = [];
        if (missingCarRating) parts.push("rate the car 1–10");
        if (missingFeelVsLastRun) {
          parts.push("pick how this run felt vs your last run on this car");
        }
        if (missingSetup) {
          parts.push("attach a setup — copy last run, load a past setup, or upload a sheet");
        }
        setCompleteValidation({
          show: true,
          carRating: missingCarRating,
          feelVsLastRun: missingFeelVsLastRun,
          additive: false,
          setup: missingSetup,
        });
        setInlineError(`Before Run complete: ${parts.join("; ")}.`);
        // Only the setup field lives outside the feedback card — scroll there when
        // that's the sole blocker so the amber-highlighted Setup card is in view.
        const scrollTarget: Element | null =
          missingSetup && !missingCarRating && !missingFeelVsLastRun
            ? document.querySelector(".run-section--setup")
            : feedbackRequiredRef.current;
        window.requestAnimationFrame(() => {
          scrollTarget?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        return;
      }
      setCompleteValidation({ show: false, carRating: false, feelVsLastRun: false, additive: false, setup: false });
    }
    // Setup edits ride along with the run automatically — the payload always
    // includes `setupData`, so unsaved sheet changes are stored either way. No
    // pre-save confirmation gate (removed 2026-07-10; the fixed save buttons
    // made the inline review easy to miss and it read as a dead button).
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
          setInlineError("Select at least one driver in your imported session.");
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
      const { run, tireSet: createdTireSet, promptMarkTrackLocation } = await jsonFetch<{
        run: { id: string; createdAt: string };
        /** Present when the server minted a NEW set for this run (create-on-save). */
        tireSet?: TireSetOption | null;
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
          trackLayoutId: trackLayoutId || null,
          trackDirection: trackDirection || null,
          tireSetId: tireSetId || null,
          // v2 create-on-save: a NEW-set choice materializes only when the run persists;
          // nudged prior runs land as the set's initialRunCount so derived counts stay right.
          newTireSet:
            !tireSetId && newTireSetIntent
              ? {
                  tireTypeId: newTireSetIntent.tireTypeId,
                  initialRunCount: Math.max(0, Math.floor(runsCompleted)),
                }
              : undefined,
          tireRunNumber: Math.max(1, runsCompleted + 1),
          additiveTypeId: additiveTypeId || null,
          tirePrep: pruneTirePrepForSave(tirePrep),
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
          conditions: isConditionsEmpty(conditions) ? null : conditions,
          sessionLabel: null,
          importedLapSets,
          importedLapTimeSessionIds:
            lapIngest.sourceKind === "url"
              ? lapIngest.urlImportBlocks
                  .map((b) => b.importedSessionId.trim())
                  .filter(Boolean)
                  .slice(0, 1)
              : [],
        })
      });

      // Adopt the server-minted set immediately: any follow-up save must link the same
      // set, never create a second one.
      if (createdTireSet?.id) {
        const minted = createdTireSet;
        setTireSets((prev) => (prev.some((t) => t.id === minted.id) ? prev : [minted, ...prev]));
        setTireSetId(minted.id);
        clearNewTireSetIntent();
      }

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
        const a = eventControlAdditiveEnabled ? eventControlledAdditiveTypeId.trim() || null : null;
        void fetch(`/api/events/${encodeURIComponent(eventId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            practiceSourceUrl: p,
            resultsSourceUrl: r,
            controlledTireTypeId: c,
            controlledAdditiveTypeId: a,
          }),
        })
          .then((res) => {
            if (!res.ok) return;
            setEvents((prev) =>
              prev.map((e) =>
                e.id === eventId
                  ? {
                      ...e,
                      practiceSourceUrl: p,
                      resultsSourceUrl: r,
                      controlledTireTypeId: c,
                      controlledAdditiveTypeId: a,
                    }
                  : e
              )
            );
          })
          .catch(() => {});
      }

      // The run is persisted (draft or complete) — drop the local autosave so
      // returning to /runs/new starts clean instead of restoring this run.
      try {
        window.localStorage.removeItem(NEW_RUN_DRAFT_STORAGE_KEY);
      } catch {
        /* ignore */
      }

      // Completing a run sends the driver to the dashboard with a one-time
      // prompt to generate Engineer suggestions for the session they just saved.
      if (intent === "completed") {
        navigateAfterRunComplete(run.id);
      } else if (isEditing) {
        await todayDraftCtx?.refreshDraft();
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
        // Navigating away discards the local tire/battery counters, so the
        // double-increment-on-return bug can't recur. The run is ALREADY
        // persisted here, so refresh the today-draft banner in the background
        // (never await it — a slow /api/runs/today-draft must not gate nav)
        // and hand off to navigateAway, which falls back to a hard navigation
        // if the client-side push is ever swallowed.
        pendingDraftNavigationRef.current = true;
        void todayDraftCtx?.refreshDraft();
        navigateAway("/");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save run";
      setStatus(msg);
      setInlineError(msg);
    } finally {
      if (!(intent === "completed" && pendingCompleteNavigationRef.current)) {
        if (!(intent === "draft" && pendingDraftNavigationRef.current)) {
          setSaving(false);
        }
      }
    }
  }

  function navigateAfterRunComplete(runId: string) {
    pendingCompleteNavigationRef.current = true;
    // The dashboard reads ?suggestRun from the URL, so a soft push is enough.
    navigateAway(`/?suggestRun=${encodeURIComponent(runId)}`);
  }

  /**
   * Leave the log-run page after a save has already persisted the run. Tries a
   * client-side push first (fast, no full reload), then GUARANTEES departure
   * with a hard navigation if the push hasn't committed shortly.
   *
   * Why the hard fallback exists: a saved run must never strand the driver on
   * the form. router.push() can silently no-op — an aborted transition (a
   * router.refresh() racing it, which we no longer do), a wedged app-router, or
   * an iOS standalone PWA / Capacitor webview where soft nav behaves oddly.
   * window.location.assign() cannot be swallowed by any of those. Guard on the
   * current path so a successful soft nav doesn't trigger a wasteful reload.
   */
  function navigateAway(href: string) {
    router.push(href);
    if (typeof window === "undefined") return;
    const targetPath = href.split("?")[0]?.split("#")[0] || "/";
    window.setTimeout(() => {
      if (window.location.pathname !== targetPath) {
        window.location.assign(href);
      }
    }, 1200);
  }

  // Track (with coords) + session time feeding the Conditions tab's weather fetch.
  const conditionsTrack = (() => {
    const resolvedId =
      trackId.trim() ||
      (trackLockedToEvent && selectedEventForRun?.trackId ? String(selectedEventForRun.trackId) : "");
    if (!resolvedId) return null;
    const t = tracksList.find((x) => x.id === resolvedId);
    return t
      ? { id: t.id, name: t.name, latitude: t.latitude ?? null, longitude: t.longitude ?? null }
      : null;
  })();
  const conditionsSessionAtIso = (() => {
    const sets = buildImportedLapSetsFromIngest(lapIngest);
    const primary = sets.find((s) => s.isPrimaryUser) ?? sets[0];
    return primary?.sessionCompletedAt ?? null;
  })();
  async function handleSaveTrackPin(coords: { latitude: number; longitude: number }) {
    if (!conditionsTrack) return;
    const res = await fetch(`/api/tracks/${conditionsTrack.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        latitude: coords.latitude,
        longitude: coords.longitude,
        locationSource: "device",
      }),
    });
    if (!res.ok) throw new Error("Failed to save track location");
    setTracksList((prev) =>
      prev.map((t) =>
        t.id === conditionsTrack.id
          ? { ...t, latitude: coords.latitude, longitude: coords.longitude }
          : t
      )
    );
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
      className="max-w-3xl space-y-3 pb-16 md:pb-20"
      onSubmit={(e) => e.preventDefault()}
      noValidate
    >
      <LogRunProgressRail sections={railSections} />
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
        className={cn("run-section--session", isDraft && "border-emerald-500/40", prefillFieldClass(Boolean(prefillHighlights?.session)))}
        contentClassName="space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Eyebrow>Session type</Eyebrow>
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
                {eventControlAdditiveEnabled && eventControlledAdditiveTypeId.trim() ? (
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground">Spec additive set</span>
                ) : null}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-2">
            <SegmentedControl<"TESTING" | "RACE_MEETING">
              ariaLabel="Session type"
              value={sessionType}
              onChange={(next) => setSessionType(next)}
              options={[
                { value: "TESTING", label: "Testing" },
                { value: "RACE_MEETING", label: "Race meeting" },
              ]}
            />
          </div>
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
        <SurfaceCard variant="panel" overflowHidden={false} className={cn("run-section--event", prefillFieldClass(Boolean(prefillHighlights?.event)))} contentClassName="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Eyebrow>Event / Race meeting</Eyebrow>
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

          <SearchableSelect
            aria-label="Event"
            placeholder="— Select event"
            clearable
            clearLabel="— Select event"
            value={eventId}
            onChange={(next) => {
              setEventId(next);
              setEventError(null);
            }}
            groups={[
              ...(eventSelectGroups.upcoming.length > 0
                ? [
                    {
                      label: "Upcoming",
                      options: eventSelectGroups.upcoming.map((ev) => ({
                        value: ev.id,
                        label: `${ev.name} · ${formatEventDate(ev.startDate)} · ${formatEventRelativeLabel(ev)}`,
                      })),
                    },
                  ]
                : []),
              ...(eventSelectGroups.past.length > 0
                ? [
                    {
                      label: "Past",
                      options: eventSelectGroups.past.map((ev) => ({
                        value: ev.id,
                        label: `${ev.name} · ${formatEventDate(ev.startDate)} · ${formatEventRelativeLabel(ev)}`,
                      })),
                    },
                  ]
                : []),
            ]}
          />

          {eventsLoading ? (
            <p className="text-[11px] text-muted-foreground">Loading events…</p>
          ) : null}
          {eventsLoadError ? (
            <p className="text-[11px] text-destructive">{eventsLoadError}</p>
          ) : null}
          {!eventsLoading && !eventsLoadError && events.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No events yet — use <span className="font-medium">New event</span> above or create one on the{" "}
              <Link href="/events" className="underline underline-offset-2">
                Events
              </Link>{" "}
              page. Planned meetings work without a LiveRC link; you can log a draft days ahead.
            </p>
          ) : null}

          {eventId ? (
            <div className="mt-2 space-y-2 text-sm">
              {!selectedEventForRun?.trackId ? null : selectedEventTrackLiveRc ? (
                <p className="text-[11px] text-muted-foreground">
                  Lap times are pulled from this track&apos;s LiveRC link automatically.
                </p>
              ) : (
                <>
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
                </>
              )}
              {/* Open vs Controlled is event config — set when the event is created
                  (New event panel or the Events page). Read-only here; a controlled
                  event locks the run's Tires step to it. */}
              <div className="rounded-md border border-border bg-secondary/60 px-3 py-2 text-[11px] text-muted-foreground space-y-0.5">
                <div>
                  Tire:{" "}
                  {eventControlledTireTypeId.trim() ? (
                    <span className="font-medium text-foreground">
                      Controlled ·{" "}
                      {preferredTireType?.displayName ??
                        selectedEventForRun?.controlledTireType?.displayName ??
                        selectedEventForRun?.controlledTireLabel ??
                        "set"}
                    </span>
                  ) : (
                    <span className="font-medium text-foreground">Open</span>
                  )}
                </div>
                <div>
                  Additive:{" "}
                  {controlAdditive ? (
                    <span className="font-medium text-foreground">
                      Controlled · {controlAdditive.displayName}
                    </span>
                  ) : (
                    <span className="font-medium text-foreground">Open</span>
                  )}
                </div>
              </div>
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
                <SearchableSelect
                  aria-label="Event track"
                  placeholder="— Select track"
                  clearable
                  clearLabel="— Select track"
                  value={newEventTrackId}
                  onChange={(next) => {
                    setNewEventTrackId(next);
                    // Layout belongs to a track; reset when the track changes.
                    setNewEventLayoutId("");
                    setNewEventDirection("");
                    setEventError(null);
                  }}
                  options={tracksList.map((t) => ({
                    value: t.id,
                    label: `${t.name}${t.location ? ` (${t.location})` : ""}`,
                  }))}
                />
                {newEventTrackId ? (
                  <div className="mt-2">
                    <RunLayoutPicker
                      trackId={newEventTrackId}
                      layoutId={newEventLayoutId}
                      direction={newEventDirection}
                      onLayoutChange={setNewEventLayoutId}
                      onDirectionChange={setNewEventDirection}
                    />
                  </div>
                ) : null}
              </div>
              <input
                className="form-control w-full px-3 py-2 text-sm"
                placeholder="Event name (e.g. TITC 2026)"
                value={newEventName}
                onChange={(e) => setNewEventName(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="block ui-label-meta">Start date</label>
                  <input
                    type="date"
                    aria-label="Event start date"
                    className="form-control w-full px-3 py-2 text-sm"
                    value={newEventStartDate}
                    onChange={(e) => {
                      setNewEventStartDate(e.target.value);
                      setEventError(null);
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="block ui-label-meta">End date</label>
                  <input
                    type="date"
                    aria-label="Event end date"
                    className="form-control w-full px-3 py-2 text-sm"
                    value={newEventEndDate}
                    onChange={(e) => {
                      setNewEventEndDate(e.target.value);
                      setEventError(null);
                    }}
                  />
                </div>
              </div>
              {/* Timing URLs are only relevant once a track without a LiveRC link
                  is chosen — otherwise laps auto-pull (or the track is unknown). */}
              {!newEventTrackId ? null : newEventTrackLiveRc ? (
                <p className="text-[11px] text-muted-foreground">
                  Lap times are pulled from this track&apos;s LiveRC link automatically.
                </p>
              ) : (
                <>
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
                </>
              )}
              <div className="space-y-1.5">
                <label className="block ui-label-meta">Tire</label>
                <SegmentedControl<"open" | "controlled">
                  ariaLabel="Event tire — open or controlled"
                  size="sm"
                  value={newEventTireControlled ? "controlled" : "open"}
                  onChange={(v) => {
                    const on = v === "controlled";
                    setNewEventTireControlled(on);
                    if (!on) setNewEventControlledTireTypeId("");
                  }}
                  options={[
                    { value: "open", label: "Open" },
                    { value: "controlled", label: "Controlled" },
                  ]}
                />
                {newEventTireControlled ? (
                  <TireTypeCombobox
                    value={newEventControlledTireTypeId}
                    onChange={setNewEventControlledTireTypeId}
                    placeholder="Select control tire type…"
                    aria-label="Event control tire type"
                  />
                ) : null}
              </div>
              <div className="space-y-1.5">
                <label className="block ui-label-meta">Additive</label>
                <SegmentedControl<"open" | "controlled">
                  ariaLabel="Event additive — open or controlled"
                  size="sm"
                  value={newEventControlAdditiveEnabled ? "controlled" : "open"}
                  onChange={(v) => {
                    const on = v === "controlled";
                    setNewEventControlAdditiveEnabled(on);
                    if (!on) setNewEventControlledAdditiveTypeId("");
                  }}
                  options={[
                    { value: "open", label: "Open" },
                    { value: "controlled", label: "Controlled" },
                  ]}
                />
                {newEventControlAdditiveEnabled ? (
                  <AdditiveTypeCombobox
                    value={newEventControlledAdditiveTypeId}
                    onChange={setNewEventControlledAdditiveTypeId}
                    placeholder="Select control additive…"
                    aria-label="Event control additive type"
                    allowInlineCreate={false}
                  />
                ) : null}
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

          <div className="space-y-2 border-t border-border pt-3">
            <Eyebrow dot="muted">Session</Eyebrow>
            <SegmentedControl<MeetingSessionType>
              ariaLabel="Meeting session type"
              size="sm"
              value={meetingSessionType === "OTHER" ? "PRACTICE" : meetingSessionType}
              onChange={(next) => {
                setMeetingSessionType(next);
                setMeetingSessionCustom("");
              }}
              options={[
                { value: "PRACTICE", label: "Practice" },
                { value: "SEEDING", label: "Seeding" },
                { value: "QUALIFYING", label: "Qualifying" },
                { value: "RACE", label: "Race" },
              ]}
            />
          </div>
        </SurfaceCard>
      ) : null}

      <SurfaceCard
        variant="panel"
        overflowHidden={false}
        className={cn("run-section--details", isDraft && "border-emerald-500/40")}
        contentClassName="space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Eyebrow>Run details</Eyebrow>
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
                const base = t
                  ? tireSetDisplayLine(t)
                  : newTireSetIntent
                    ? `${newTireSetIntent.displayName} · new set`
                    : "—";
                const extras: string[] = [];
                const additive = formatTirePrepLine(
                  tirePrep,
                  additiveTypeId ? additiveTypesById[additiveTypeId]?.displayName ?? null : null
                );
                if (additive) extras.push(additive);
                const prep = formatTirePrepSummaryFromSnapshot(setupData);
                if (prep) extras.push(prep);
                if (extras.length === 0) return base;
                return `${base}${base !== "—" ? " · " : ""}${extras.join(" · ")}`;
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
        <PagedCard
          storageKey="run-form:run-details"
          controlPosition="above"
          heightMode="adaptive"
          activeId={runDetailsTab}
          onActiveIdChange={(id) => setRunDetailsTab(id as RunDetailsTab)}
          faces={[
            {
              id: "car",
              label: "Car",
              content: (
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
              <SearchableSelect
                aria-label="Car"
                className={prefillFieldClass(Boolean(prefillHighlights?.car || copyCarWarning))}
                placeholder="Select car"
                value={carId}
                onChange={(next) => {
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
                options={carsList.map((c) => ({ value: c.id, label: c.name }))}
              />
              {copyCarWarning && (
                <div className="text-[11px] text-destructive mt-1">{copyCarWarning}</div>
              )}
            </div>
            {/* Race class (optional) field intentionally hidden from Log Your Run.
                `raceClass` state + save payload are kept so the feature can be re-enabled later. */}
          </div>
              ),
            },
            {
              id: "tires",
              label: "Tires",
              content: (
          <div className="space-y-3 pt-1">
            <RunTireSelectionPanel
              tireSets={tireSets}
              tireSetId={tireSetId}
              onSelectExistingSet={(nextId, ts) => {
                setTireSetId(nextId);
                clearNewTireSetIntent();
                // Sets known only to the picker must land in the catalog so snapshot
                // lookups (tires line on the sheet) resolve them.
                if (ts) {
                  setTireSets((prev) =>
                    prev.some((t) => t.id === ts.id) ? prev : [ts, ...prev]
                  );
                }
                applyTireBatteryToSetupSnapshot(nextId, batteryIdRef.current);
                setCopyTireWarning(null);
              }}
              newSetIntent={newTireSetIntent}
              onNewSetIntentChange={(intent) => {
                setNewTireSetIntent(intent);
                newTireSetIntentRef.current = intent;
                if (intent) {
                  setTireSetId("");
                  tireRunUserTouchedRef.current = false;
                  setRunsCompleted(0);
                  setCopyTireWarning(null);
                }
                applyTireBatteryToSetupSnapshot(intent ? "" : tireSetIdRef.current, batteryIdRef.current);
              }}
              preferredTireType={preferredTireType}
              specTireType={specTireType}
              runsCompleted={runsCompleted}
              onRunsCompletedChange={setRunsCompleted}
              onRunsCompletedUserTouched={() => {
                tireRunUserTouchedRef.current = true;
              }}
              onPrefillClear={() => setPrefillHighlights((h) => (h ? { ...h, tires: false } : h))}
              copyTireWarning={copyTireWarning}
              prefillFieldClass={prefillFieldClass(Boolean(prefillHighlights?.tires))}
            />
            <RunAdditiveTimingPanel
              additiveTypeId={additiveTypeId}
              onAdditiveTypeIdChange={(id) => {
                setAdditiveTypeId(id);
                if (id && !additiveTypesById[id]) {
                  void fetch("/api/additive-types?limit=200", { cache: "no-store" })
                    .then((r) => r.json())
                    .then((data: { additiveTypes?: Array<{ id: string; displayName: string }> }) => {
                      const hit = (data.additiveTypes ?? []).find((t) => t.id === id);
                      if (hit) {
                        setAdditiveTypesById((prev) => ({ ...prev, [id]: hit }));
                      }
                    })
                    .catch(() => {});
                }
                applyAdditiveTimingToSetupSnapshot(id, tirePrepRef.current);
              }}
              tirePrep={tirePrep}
              onTirePrepChange={setTirePrep}
              highlightMissing={completeValidation.additive}
              controlAdditive={controlAdditive}
            />
          </div>
              ),
            },
            {
              id: "battery",
              label: "Battery",
              content: (
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
              <SearchableSelect
                aria-label="Battery pack"
                className={prefillFieldClass(Boolean(prefillHighlights?.battery))}
                placeholder="—"
                clearable
                value={batteryId}
                onChange={(nextId) => {
                  setBatteryId(nextId);
                  applyTireBatteryToSetupSnapshot(tireSetIdRef.current, nextId);
                  setCopyBatteryWarning(null);
                  setPrefillHighlights((h) => (h ? { ...h, battery: false } : h));
                }}
                options={batteries.map((b) => ({
                  value: b.id,
                  label: `${b.label}${b.packNumber != null ? ` #${b.packNumber}` : ""}`,
                }))}
              />
              {copyBatteryWarning && (
                <div className="text-[11px] text-muted-foreground mt-1">{copyBatteryWarning}</div>
              )}
            </div>

            {showNewBatteryPanel && (
              <QuickAddBatteryPanel
                onCreated={(battery) => {
                  setBatteries((prev) => [battery, ...prev]);
                  setBatteryId(battery.id);
                  batteryRunUserTouchedRef.current = true;
                  setBatteryRunsCompleted(battery.initialRunCount ?? 0);
                  applyTireBatteryToSetupSnapshot(tireSetIdRef.current, battery.id);
                  setShowNewBatteryPanel(false);
                  setCopyBatteryWarning(null);
                  setStatus("Battery pack created — selected.");
                }}
                onCancel={() => {
                  setShowNewBatteryPanel(false);
                  setInlineError(null);
                }}
              />
            )}

            {!showNewBatteryPanel && batteryId ? (
              <div className="space-y-1 text-sm">
                <Eyebrow dot="muted">Prior runs on this pack (before this log)</Eyebrow>
                <input
                  type="number"
                  min={0}
                  className="w-full max-w-md form-control px-3 py-2 text-sm"
                  inputMode="numeric"
                  value={batteryRunsInput}
                  onChange={(e) => {
                    batteryRunUserTouchedRef.current = true;
                    // Keep the raw string (allow empty/partial) so the field can
                    // be cleared and retyped; the count is derived on read.
                    setBatteryRunsInput(e.target.value);
                  }}
                  onBlur={() => setBatteryRunsInput(String(batteryRunsCompleted))}
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
              ),
            },
            {
              id: "conditions",
              label: "Conditions",
              shortLabel: "Cond.",
              content: (
          <RunConditionsSection
            value={conditions}
            onChange={setConditions}
            track={conditionsTrack}
            sessionAtIso={conditionsSessionAtIso}
            onSaveTrackPin={handleSaveTrackPin}
          />
              ),
            },
            {
              id: "track",
              label: "Track",
              controlClassName:
                trackSaveWarning && runDetailsTab !== "track"
                  ? "ring-2 ring-inset ring-amber-500/55"
                  : undefined,
              content: (
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
                      // Layout belongs to a track; clear it so a stale layout from the
                      // previous track can't be submitted, and re-allow event auto-fill.
                      setTrackLayoutId("");
                      setTrackDirection("");
                      layoutPickedManuallyRef.current = false;
                      setCopyTrackWarning(null);
                      setNearbyTrackSuggestions([]);
                      setTrackAutoDetectMessage(null);
                    }}
                    lastRunTrackId={lastRun?.trackId ?? null}
                    favouriteTrackIds={favouriteTrackIds}
                    favouriteTracks={favouriteTracks}
                    placeholder="Select track…"
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
                      setTrackLayoutId("");
                      setTrackDirection("");
                      layoutPickedManuallyRef.current = false;
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
            {trackId.trim() ? (
              <RunLayoutPicker
                trackId={trackId}
                layoutId={trackLayoutId}
                direction={trackDirection}
                onLayoutChange={(id) => {
                  layoutPickedManuallyRef.current = true;
                  setTrackLayoutId(id);
                }}
                onDirectionChange={(dir) => {
                  layoutPickedManuallyRef.current = true;
                  setTrackDirection(dir);
                }}
                inheritedFromEvent={Boolean(
                  selectedEventForRun?.trackLayoutId &&
                    trackLayoutId === selectedEventForRun.trackLayoutId
                )}
              />
            ) : null}
          </div>
              ),
            },
          ]}
        />
          </>
        )}
      </SurfaceCard>

      <div ref={setupSectionRef}>
      <SurfaceCard
        variant="panel"
        overflowHidden={false}
        className={cn(
          "run-section--setup transition-colors",
          completeValidation.setup && "border-amber-500/60 ring-1 ring-amber-500/30",
          isDraft && !setupSectionExpanded && setupBaselineData && "border-emerald-500/40",
          prefillFieldClass(Boolean(prefillHighlights?.setup))
        )}
        contentClassName="space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Eyebrow>Setup</Eyebrow>
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
                className="type-data-label inline-flex items-center rounded-md border border-border bg-muted/50 px-2 py-0.5 text-muted-foreground"
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
                <div className="type-data-label mb-1">
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
                  {isEditing ? (
                    <div className="flex items-center justify-end text-sm">
                      <button
                        type="button"
                        onClick={() => setShowSetupSourceControls(false)}
                        className="text-[10px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground"
                        title="Hide the source controls and keep the current setup as-is."
                      >
                        Keep current
                      </button>
                    </div>
                  ) : null}
                  <PagedCard
                    storageKey="run-form:setup-source"
                    className="max-w-2xl"
                    controlPosition="above"
                    heightMode="adaptive"
                    activeId={setupSource}
                    onActiveIdChange={(id) =>
                      handleSetupSourceChange(id as "previous_runs" | "other" | "new")
                    }
                    faces={setupSourceFaces()}
                  />
                </>
              )}
              {isEditing ? (
                // New-run flow reveals the sheet automatically on selection (see
                // applyPastSetupOnly / applyDownloadedSetupOnly / the "new" source),
                // so this manual opener is only needed for the edit-run "Setup used"
                // summary, where no re-selection happens.
                <button
                  type="button"
                  onClick={() => setSetupSectionExpanded(true)}
                  className="btn-surface self-start px-3 py-2 text-xs font-medium"
                >
                  Edit setup
                </button>
              ) : null}
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
          </div>
          )
        ) : (
          <>
            {/* Setup-changes free-text "Interpret changes" panel intentionally hidden from Log Your Run.
                State (setupChangesText/Busy/Error/Proposal) and handlers (interpretSetupChanges,
                applySetupChangesProposal) are kept in this file so the feature can be re-enabled
                by restoring the JSX block from git history. */}
            <div className="max-w-2xl space-y-2">
              <PagedCard
                storageKey="run-form:setup-source-expanded"
                controlPosition="above"
                heightMode="adaptive"
                activeId={setupSource}
                onActiveIdChange={(id) =>
                  handleSetupSourceChange(id as "previous_runs" | "other" | "new")
                }
                faces={setupSourceFaces()}
              />
              <button
                type="button"
                onClick={() => setSetupSectionExpanded(false)}
                aria-label="Collapse setup"
                title="Collapse setup"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <svg
                  aria-hidden
                  viewBox="0 0 20 20"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                >
                  <path d="M5 7l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            <SetupSheetView
              value={setupData}
              onChange={(next) => setSetupData(applyDerivedFieldsToSnapshot(next))}
              template={setupTemplate}
              enableFieldSearch
            />
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

      <SurfaceCard variant="panel" overflowHidden={false} className="run-section--feedback" contentClassName="space-y-3 text-sm">
        <Eyebrow>Feedback</Eyebrow>
        <PagedCard
          storageKey="run-form:feedback"
          controlPosition="above"
          heightMode="adaptive"
          activeId={feedbackFace}
          onActiveIdChange={(id) => setFeedbackFace(id as "feedback" | "handling")}
          faces={[
            {
              id: "feedback",
              label: "Feedback",
              content: (
                <div className="space-y-3">
                  <div ref={feedbackRequiredRef} className="space-y-3">
                    {completeValidation.show ? (
                      <div
                        role="alert"
                        className="rounded-md border border-amber-500/50 bg-amber-500/15 px-2.5 py-2 text-[11px] leading-snug text-amber-950 dark:text-amber-100"
                      >
                        {inlineError ?? "Complete the highlighted fields below before Run complete."}
                      </div>
                    ) : null}
                    <CarHandlingRatingQuickPick
                      value={carRating}
                      onChange={(n) => setCarRating((cur) => (cur === n ? null : n))}
                      highlightMissing={completeValidation.carRating}
                    />
                    <FeelVsLastRunQuickPick
                      value={handlingUi.feelVsLastRun}
                      onChange={(feelVsLastRun) =>
                        setHandlingUi((cur) => ({ ...cur, feelVsLastRun }))
                      }
                      eligible={feelVsLastRunEligible}
                      highlightMissing={completeValidation.feelVsLastRun}
                    />
                  </div>
                  <AutoGrowTextarea
                    minRows={2}
                    className={cn(
                      "form-control w-full px-3 py-2 text-sm",
                      isDraft && notes.trim().length === 0
                        ? "border-amber-500/50 ring-1 ring-amber-500/30"
                        : "border-border"
                    )}
                    placeholder={
                      isDraft && notes.trim().length === 0
                        ? "How did the run feel? Grip, balance, any issues, what you'd change…"
                        : "Notes…"
                    }
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    aria-label="Session notes"
                  />
                </div>
              ),
            },
            {
              id: "handling",
              label: "Handling detail",
              shortLabel: "Handling",
              content: (
                <HandlingAssessmentFields value={handlingUi} onChange={setHandlingUi} />
              ),
            },
          ]}
        />
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

      {hasTeams ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/40 px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm text-foreground">Share this run with my teams</div>
            <div className="text-[11px] text-muted-foreground leading-snug">
              Teammates can see this run and its setup.
            </div>
          </div>
          <Switch
            checked={shareWithTeam}
            onChange={setShareWithTeam}
            ariaLabel="Share this run with my teams"
          />
        </div>
      ) : null}

      {editingCompletedRun ? (
        <p className="text-[11px] text-muted-foreground leading-snug sm:max-w-md">
          Saves your changes to this run only. It stays marked complete; tire and battery run numbers are not
          updated (they were set when you first clicked Run complete).
        </p>
      ) : null}

      {/* Persistent save actions — pinned bottom-right so they stay reachable
          anywhere in this long form. Portaled to <body> so the app-wide reveal
          transform on `.page-body` children can't trap `fixed` (which stranded
          the bar at the form's bottom). Mobile offset clears the bottom dock
          bar (the Log-run circle is suppressed on run create/edit routes, so
          no collision): dock pad + 3.5rem bar + gap. Desktop floats at the
          viewport corner. */}
      {saveBarMounted &&
        createPortal(
          <div
            className={cn(
              "pointer-events-none fixed inset-x-0 z-40 px-4",
              "bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)]",
              "md:inset-x-auto md:right-8 md:bottom-8 md:px-0"
            )}
          >
            <div className="mx-auto flex max-w-md flex-wrap justify-end gap-2 md:mx-0 md:max-w-none">
          {editingCompletedRun ? (
            <button
              type="button"
              className={cn(
                fabPillPrimaryClass,
                (!canSave || saving) && "opacity-70 pointer-events-none"
              )}
              onClick={(e) => saveRun(e, "completed")}
              disabled={!canSave || saving}
              aria-busy={saving}
              title="Save changes without affecting completion or tire/battery run counts."
            >
              {saving ? "Saving…" : saveSuccess ? "Saved" : "Save edits"}
            </button>
          ) : (
            <>
              <button
                type="button"
                className={cn(
                  fabPillOutlineClass,
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
                  fabPillPrimaryClass,
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
            </>
          )}
            </div>
          </div>,
          document.body
        )}
    </form>
    </>
  );
}

