"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DashboardNewRunPrefill } from "@/lib/dashboardPrefillTypes";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, LocateFixed } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow, PanelSubtitle } from "@/components/ui/panel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { coerceSetupValue, normalizeSetupData, parseLapTimes, type SetupSnapshotData } from "@/lib/runSetup";
import { applyDerivedFieldsToSnapshot } from "@/lib/setup/deriveRenderValues";
import { isRunContextSetupKey } from "@/lib/setup/runContextSetupKeys";
import { buildSetupDiffRows } from "@/lib/setupDiff";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import type { SetupSheetTemplate } from "@/lib/setupSheetTemplate";
import { getGenericSetupSheetTemplate } from "@/lib/setupSheetModels/genericSetupSheetTemplate";
import { isA800RRCar } from "@/lib/setupSheetTemplateId";
import { TrackCombobox } from "@/components/runs/TrackCombobox";
import { RunLayoutPicker } from "@/components/runs/RunLayoutPicker";
import { displayTireSelection } from "@/lib/tires/tireSelectionValue";
import type { LastRunTires } from "@/lib/tires/tireStintValue";
import { TireTypeCombobox } from "@/components/tires/TireTypeCombobox";
import { AdditiveTypeCombobox } from "@/components/additives/AdditiveTypeCombobox";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { RunTireSelectionPanel, type TireStintValue } from "@/components/runs/RunTireSelectionPanel";
import { RunAdditiveTimingPanel } from "@/components/runs/RunAdditiveTimingPanel";
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
import { RunPickerSelect } from "@/components/runs/RunPickerSelect";
import { PagedCard, type PagedCardFace } from "@/components/ui/PagedCard";
import {
  LogRunWizardBottomBar,
  type WizardSheetRow,
} from "@/components/runs/LogRunWizardBottomBar";
import {
  firstRunCoachLine,
  firstUnfinishedStep,
  type WizardStepId,
  type WizardStepStatus,
} from "@/lib/runs/wizardWalk";
import { InlineNewTrackRow } from "@/components/runs/InlineNewTrackRow";
import { deriveContinueEntry, type NewRunWizardEntry } from "@/lib/runs/wizardEntry";
import { planCarSwap, type CarSwapPlan } from "@/lib/runs/carSwap";
import type { EntryCandidate } from "@/lib/runs/entryCandidate";
import {
  WizardPrefillCard,
  WizardDraftsCard,
  type WizardDraftRow,
  type WizardPrefillRow,
} from "@/components/runs/WizardStartControls";
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
import {
  resolveImportedSessionDisplayTimeIso,
  resolveImportedSessionHasWallClockTime,
} from "@/lib/lapImport/labels";
import {
  LapTimesIngestPanel,
  defaultLapIngestValue,
  type LapIngestFormValue,
} from "@/components/runs/LapTimesIngestPanel";
import { ImportedFieldSessionCard } from "@/components/runs/ImportedFieldSessionCard";
import { HandlingAssessmentFields } from "@/components/runs/HandlingAssessmentFields";
import { CarHandlingRatingQuickPick } from "@/components/runs/CarHandlingRatingQuickPick";
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
 * v6 Session step (founder 2026-07-17, artifact round 2 "Mix 3"): in wizard
 * mode the Car / Day type / Event / Track blocks render INSIDE one Session
 * card as flattened sections (the inner SurfaceCards go `bare`); classic mode
 * keeps them as separate cards — same children, different chrome.
 */
function WizardSessionGroup({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  if (!active) return <>{children}</>;
  // No card title here: the bottom-nav step is already labelled "Session", and
  // the first real field carries its own "Car" eyebrow — a redundant top-level
  // "Session" heading read as an empty section sitting above Car (founder, phone).
  return (
    <SurfaceCard variant="panel" overflowHidden={false} contentClassName="space-y-4">
      {children}
    </SurfaceCard>
  );
}

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
  /** Chassis platform (`CHASSIS_PLATFORMS` id, resolved server-side) — drives the car-swap rule. */
  platform?: string | null;
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
  mark?: string | null;
  tireTypeId?: string | null;
  tireType?: { id: string; displayName: string; modelCode: string } | null;
};

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
  /** Dormant: legacy runs only. Tires are identified by compound + run count now. */
  tireSetId?: string | null;
  tireRunNumber: number;
  /** Stint the run belongs to — one continuous life of rubber. */
  tireStintId?: string | null;
  tireAgeKnown?: boolean | null;
  tireTypeId?: string | null;
  tireType?: { id: string; displayName: string } | null;
  additiveTypeId?: string | null;
  warmerTimingMinutes?: number | null;
  /** Ordered tire-prep applications (see src/lib/runs/tirePrep.ts); JSON on the run. */
  tirePrep?: unknown;
  additiveType?: { id: string; displayName: string; modelCode: string } | null;
  setupSnapshot: { id: string; data: unknown };
  event?: EventOption | null;
  track?: { id: string; name: string } | null;
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
  /**
   * "library" = a named setup the driver built on this car (listed first); "document" = a setup
   * sheet they imported. Same shape either way — only the label differs.
   */
  kind?: "library" | "document";
};

/** Option line for the saved-setups picker: named setups read as names, documents as filenames. */
function setupOptionLabel(d: DownloadedSetupOption): string {
  return d.kind === "library"
    ? `${d.originalFilename} · saved ${formatRunCreatedAtDateTime(d.createdAt)}`
    : `${d.originalFilename} · ${formatRunCreatedAtDateTime(d.createdAt)}`;
}

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
  tireTypeId: string;
  tireStintId: string | null;
  tireAgeKnown: boolean;
  runsCompleted: number;
  additiveTypeId: string;
  tirePrep: TirePrepStep[];
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
      s.tireTypeId ||
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
  /**
   * Log-run wizard entry payload (rework 2026-07-17 v4). When set the form
   * renders as the icon-rail wizard starting at the Session step, with every
   * tab live from the start — the host derives the payload synchronously
   * (continue pre-applied when the last run is recent, blank otherwise) and
   * every step is walked; continuing prefills instead of skipping.
   */
  wizard?: NewRunWizardEntry | null;
  /** The run the wizard's continue mode carries (labels the Session-step status card). */
  wizardCandidate?: EntryCandidate | null;
  /** Today's unfinished runs, surfaced on the Session step. */
  wizardDrafts?: WizardDraftRow[];
  /** URL `?eventId=` deep link — explicit intent, never overridden by the GPS venue swap. */
  wizardDeepLinkedEventId?: string | null;
  /** Switch continue ↔ new-log (host remounts the form with the other payload). */
  /** "Start blank instead" — the host remounts the form for a clean slate (v6). */
  onWizardRestart?: () => void;
  /**
   * This is the driver's very first run — drives the G1 coach line under the
   * recap (docs/ONBOARDING_NORTH_STAR.md, founder-locked 2026-07-22). One quiet
   * per-step line; it never appears again once they have a run.
   */
  wizardFirstRun?: boolean;
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

  // Wizard entry (page 1) seeds session + car identity; classic mode starts blank.
  const wizard = props.wizard ?? null;
  const wizardActive = wizard != null;
  const [sessionType, setSessionType] = useState<"TESTING" | "RACE_MEETING">(
    wizard?.sessionType ?? "TESTING"
  );
  const [meetingSessionType, setMeetingSessionType] = useState<MeetingSessionType>(
    wizard?.meetingSessionType ?? "PRACTICE"
  );
  /** "A Main" etc. for main-event sessions (wizard page 1 / LiveRC detection); persisted on save. */
  const [sessionLabel, setSessionLabel] = useState<string | null>(wizard?.sessionLabel ?? null);
  const [meetingSessionCustom, setMeetingSessionCustom] = useState<string>(""); // when type is OTHER
  /**
   * Legacy run field; lap import uses track LiveRC URL. Kept for edit-run hydrate only.
   */
  const [practiceDayUrl, setPracticeDayUrl] = useState<string>("");
  const [carId, setCarId] = useState<string>(
    (wizard?.carId && props.cars.some((c) => c.id === wizard.carId) ? wizard.carId : null) ??
      props.cars[0]?.id ??
      ""
  );
  const [tracksList, setTracksList] = useState<TrackOption[]>(tracks);
  const [trackId, setTrackId] = useState<string>(wizard?.trackId ?? "");
  /** Named layout ran this session (descriptive; empty = none). */
  const [trackLayoutId, setTrackLayoutId] = useState<string>(wizard?.trackLayoutId ?? "");
  /** Optional running direction for this session. */
  const [trackDirection, setTrackDirection] = useState<"" | "CW" | "CCW">(
    wizard?.trackDirection ?? ""
  );
  /** Compound on the car. Tires are identified by run count, not by a named set. */
  const [tireTypeId, setTireTypeId] = useState<string>("");
  const [tireTypeName, setTireTypeName] = useState<string>("");
  /** Stint the run belongs to; null means different rubber went on — the server mints a new one. */
  const [tireStintId, setTireStintId] = useState<string | null>(null);
  /** False when the driver said "not sure how many runs" (e.g. a set they were given). */
  const [tireAgeKnown, setTireAgeKnown] = useState<boolean>(true);
  /** Compound the picker should activate (event spec tire); never forces a selection. */
  const [preferredTireType, setPreferredTireType] = useState<{
    id: string;
    displayName: string;
  } | null>(null);
  const [runsCompleted, setRunsCompleted] = useState<number>(0);
  const [additiveTypeId, setAdditiveTypeId] = useState<string>("");
  /** Ordered tire-prep applications toward the run (see src/lib/runs/tirePrep.ts).
   *  Starts empty — the driver adds applications on demand, and an added row is
   *  pre-filled with logged-by-default values. Skipping tire prep saves nothing. */
  const [tirePrep, setTirePrep] = useState<TirePrepStep[]>([]);
  const [additiveTypesById, setAdditiveTypesById] = useState<
    Record<string, { id: string; displayName: string }>
  >({});
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventId, setEventId] = useState<string>(wizard?.eventId ?? "");
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

  // Wizard v6: the run always lands blank (`wizard.continuing` is always
  // false), so this stays false in wizard mode — the per-car load effect just
  // FETCHES lastRun (feeding the prefill manifest card) without applying it;
  // applyWizardPrefill copies on tap. Classic copy-last-run still seeds true to
  // make the per-car load effect copy track/session/event/
  // tires/setup exactly as the copy card would.
  const [replicateLast, setReplicateLast] = useState(wizard?.continuing ?? false);
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
  type RunDetailsTab = "car" | "tires" | "conditions" | "track" | "prep";
  const [runDetailsTab, setRunDetailsTab] = useState<RunDetailsTab>("car");

  // ---- Log-run wizard chrome (only when props.wizard is set) ----
  // v4: the walk starts ON the Session step — the host pre-derived the context
  // (continue pre-applied when recent), so nothing is locked and every tab is
  // live from the first render. Hosting an EXISTING run (draft resume / edit,
  // founder 2026-07-17) lands on the first unfinished step instead — for a
  // draft that's usually Laps, the fewest taps to finish; a completed run
  // falls through to Session for a top-down review.
  const [wizardStep, setWizardStep] = useState<WizardStepId>(() => {
    const r = props.editRun;
    if (!wizardActive || !r?.id) return "session";
    const setupKeyCount =
      r.setupSnapshot?.data && typeof r.setupSnapshot.data === "object"
        ? Object.keys(r.setupSnapshot.data as object).length
        : 0;
    return firstUnfinishedStep({
      session: Boolean(r.trackId ?? r.track?.id ?? r.event?.trackId),
      equipment: Boolean(r.tireTypeId ?? r.tireType?.id),
      prep:
        (Array.isArray(r.tirePrep) && r.tirePrep.length > 0) ||
        Boolean(r.additiveTypeId ?? r.additiveType?.id) ||
        r.warmerTimingMinutes != null,
      setup: setupKeyCount > 0,
      laps:
        (Array.isArray(r.lapTimes) && r.lapTimes.length > 0) ||
        (r.importedLapSets?.length ?? 0) > 0,
      feel: r.carRating != null,
    });
  });
  // Keep the details-tab state in sync with the wizard step: Session shows the
  // Car face (+ Track), Equipment the Tires face, Prep its own face. (The
  // wizard reuses the details PagedCard with per-step face filtering.)
  useEffect(() => {
    if (!wizardActive) return;
    if (wizardStep === "equipment") setRunDetailsTab("tires");
    else if (wizardStep === "prep") setRunDetailsTab("prep");
  }, [wizardActive, wizardStep]);
  /** Which Run-details faces each wizard step shows. The Session step shows
   *  NO details card (v6): Car and Track render inside the unified Session
   *  card (trackPanelJsx is shared with the classic "Track" face). */
  const wizardDetailFaceIds: Partial<Record<WizardStepId, RunDetailsTab[]>> = {
    equipment: ["tires"],
    prep: ["prep"],
  };
  const wizardShowsDetails =
    !wizardActive || wizardDetailFaceIds[wizardStep] !== undefined;
  /**
   * v5 declared completion (founder interview 2026-07-17, M3): Save always
   * just saves — completion is the driver's call, made on the Draft/Complete
   * badge in the live summary (or the "Mark run complete" row on Feedback).
   * Gate to declare = rating + track; setup-missing is still caught by the
   * existing complete-save validation. Editing an already-completed run seeds
   * true (and stays locked true — un-completing isn't a thing).
   */
  const [wizardMarkedComplete, setWizardMarkedComplete] = useState(
    props.editRun?.loggingComplete === true
  );
  /**
   * Wizard car swap (founder 2026-07-17 evening): changing the car on the
   * Session step keeps the day context (event/track/session/laps/notes) and
   * swaps only the car-bound layers per the plan — tires+prep re-derive on a
   * cross-class swap, setup reloads from the new car's last run (kept when
   * hand-edited on the same sheet). The plan is computed at select time and
   * consumed by the carId effect below in place of the full replicate copy.
   */
  const wizardCarSwapPlanRef = useRef<{ plan: CarSwapPlan; toName: string } | null>(null);
  const [wizardCarSwapNote, setWizardCarSwapNote] = useState<string | null>(null);
  /**
   * v6 (founder 2026-07-17): prefill is a TAP, never automatic. The wizard
   * lands blank; tapping the manifest card's "Prefill this run" applies the
   * car's last run in-form (applyWizardPrefill) and flips this. The applied
   * session identity is stashed so the summary's "prefilled" chips can compare
   * live values against what the tap actually set.
   */
  const [wizardPrefillApplied, setWizardPrefillApplied] = useState(false);
  const wizardAppliedPlanRef = useRef<NewRunWizardEntry | null>(null);
  // F2 (founder 2026-07-18, docs/design/log-run-navigation.md): the exit
  // prompt is owned here — the bar's "← Exit" opens it, and so does system
  // back from the Session step (same prompt, one behavior).
  const [wizardExitPromptOpen, setWizardExitPromptOpen] = useState(false);
  /** Set while an exit action is navigating away, so the popstate guard
   *  doesn't fight the departure. */
  const wizardExitingRef = useRef(false);
  const wizardStepRef = useRef<WizardStepId>(wizardStep);
  wizardStepRef.current = wizardStep;
  const goToWizardStep = (id: WizardStepId) => {
    // Step changes are history entries (F2): system back / edge-swipe walks
    // backward through the steps instead of silently abandoning the flow.
    // Same-URL pushState is officially supported by the App Router; wrapped
    // in try/catch so any history quirk degrades to tap-nav, never a wedge.
    if (wizardActive && id !== wizardStepRef.current && typeof window !== "undefined") {
      try {
        window.history.pushState({ lrWizardStep: id }, "");
      } catch {
        /* history unavailable — ticks still navigate */
      }
    }
    setWizardStep(id);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "instant" });
  };
  // History spine: mark the entry we mounted on as the wizard's base and push
  // the landing step above it. Backing onto the base means "leaving from
  // Session" — hold the line (re-push the current step) and open the exit
  // prompt instead of silently dropping the run.
  useEffect(() => {
    if (!wizardActive || typeof window === "undefined") return;
    try {
      window.history.replaceState(
        { ...(window.history.state ?? {}), lrWizardBase: true },
        ""
      );
      window.history.pushState({ lrWizardStep: wizardStepRef.current }, "");
    } catch {
      return; // no history API — plain tap-nav only
    }
    const onPop = (e: PopStateEvent) => {
      if (wizardExitingRef.current) return;
      const st = e.state as { lrWizardStep?: WizardStepId; lrWizardBase?: boolean } | null;
      if (st?.lrWizardStep) {
        setWizardStep(st.lrWizardStep);
        window.scrollTo({ top: 0, behavior: "instant" });
      } else if (st?.lrWizardBase) {
        try {
          window.history.pushState({ lrWizardStep: wizardStepRef.current }, "");
        } catch {
          /* fall through — prompt still opens */
        }
        setWizardExitPromptOpen(true);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardActive]);
  const [trackSaveWarning, setTrackSaveWarning] = useState(false);

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
    additive: boolean;
    setup: boolean;
  }>({ show: false, carRating: false, additive: false, setup: false });

  const [copyCarWarning, setCopyCarWarning] = useState<string | null>(null);
  const [copyTrackWarning, setCopyTrackWarning] = useState<string | null>(null);
  const [copyTireWarning, setCopyTireWarning] = useState<string | null>(null);
  const [pickerRuns, setPickerRuns] = useState<RunPickerRun[]>([]);
  const [loadSetupSelection, setLoadSetupSelection] = useState("");
  const [loadOtherSetupSelection, setLoadOtherSetupSelection] = useState("");
  const [setupSource, setSetupSource] = useState<"previous_runs" | "other" | "new">("previous_runs");
  const [newSetupMode, setNewSetupMode] = useState<"blank" | "upload">("blank");
  /**
   * Sheet upload only extracts values on a chassis whose sheet has been calibrated. Elsewhere the
   * upload affordances are simply absent — offering an import that would silently read nothing is
   * worse than not offering it (SETUP_UPLOAD_NORTH_STAR: trust is absolute).
   */
  const [supportsSheetUpload, setSupportsSheetUpload] = useState(false);
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
   * Draft-resume collapse flags for the two other muted sections the
   * driver already filled in when they logged the draft. Drafts open with
   * these sections rolled up to a read-only summary + "Edit" button; new-run
   * mode leaves them expanded since the driver is still filling them out.
   * Seeded from `editRun` at construction so the initial render matches the
   * final state (no flash of expanded → collapsed). Wizard-hosted edits stay
   * expanded — the steps already segment the form, so a rolled-up summary
   * with an Edit button would just make a step look empty.
   */
  const initialDraftCollapsed =
    Boolean(props.editRun?.id) &&
    props.editRun?.loggingComplete === false &&
    !wizardActive;
  const [sessionExpanded, setSessionExpanded] = useState<boolean>(!initialDraftCollapsed);
  const [runDetailsExpanded, setRunDetailsExpanded] = useState<boolean>(!initialDraftCollapsed);

  /** One-line tire identity for wizard summaries: compound plus how many runs are on it. */
  const tireSummaryLine = useMemo(() => {
    if (!tireTypeId) return "";
    return displayTireSelection({
      tireTypeId,
      displayName: tireTypeName,
      tireRunNumber: Math.max(1, runsCompleted + 1),
      tireAgeKnown,
    });
  }, [tireTypeId, tireTypeName, runsCompleted, tireAgeKnown]);

  const tireTypeIdRef = useRef(tireTypeId);
  tireTypeIdRef.current = tireTypeId;
  const tireTypeNameRef = useRef(tireTypeName);
  tireTypeNameRef.current = tireTypeName;
  const additiveTypeIdRef = useRef(additiveTypeId);
  additiveTypeIdRef.current = additiveTypeId;
  const tirePrepRef = useRef(tirePrep);
  tirePrepRef.current = tirePrep;
  const runsCompletedRef = useRef(runsCompleted);
  runsCompletedRef.current = runsCompleted;
  const tireAgeKnownRef = useRef(tireAgeKnown);
  tireAgeKnownRef.current = tireAgeKnown;
  /**
   * Adopt a stint wholesale — from the car's last run, a copy-forward, or an edit
   * hydrate. Keeps the count, its known/unknown flag and the stint id together so
   * they can never drift apart.
   */
  const applyTireStint = useCallback(
    (next: { runsCompleted: number; ageKnown: boolean; stintId: string | null }) => {
      setRunsCompleted(Math.max(0, Math.floor(next.runsCompleted)));
      setTireAgeKnown(next.ageKnown);
      setTireStintId(next.stintId);
    },
    []
  );
  /**
   * Carry a run's tires onto the next one: same compound, same stint, one run
   * older. This is the whole "still on the same tires" path — it costs the
   * driver nothing, which is the point.
   */
  const carryTiresForward = useCallback(
    (run: LastRun | null) => {
      const typeId = run?.tireTypeId ?? run?.tireType?.id ?? "";
      setTireTypeId(typeId);
      setTireTypeName(run?.tireType?.displayName ?? "");
      applyTireStint({
        runsCompleted: typeId ? (run?.tireRunNumber ?? 0) : 0,
        ageKnown: typeId ? (run?.tireAgeKnown ?? true) : true,
        stintId: typeId ? (run?.tireStintId ?? null) : null,
      });
    },
    [applyTireStint]
  );
  /**
   * The tires the panel compares a compound pick against: pick the same compound
   * as last time and its stint comes forward a run older, pick anything else and
   * it's a fresh set.
   *
   * `undefined` until `replicateLoaded` says the per-car fetch finished — `lastRun`
   * is null both for "no history" and "not fetched yet", and the panel must not
   * derive an age from the second one.
   */
  const lastRunTires = useMemo<LastRunTires | null | undefined>(() => {
    if (!replicateLoaded) return undefined;
    const typeId = lastRun?.tireTypeId ?? lastRun?.tireType?.id ?? "";
    if (!lastRun || !typeId) return null;
    return {
      tireTypeId: typeId,
      tireRunNumber: lastRun.tireRunNumber ?? 0,
      tireAgeKnown: lastRun.tireAgeKnown ?? true,
      tireStintId: lastRun.tireStintId ?? null,
    };
  }, [lastRun, replicateLoaded]);
  /**
   * True once the driver has explicitly chosen/imported/edited a setup since the
   * last copy-from-last-run or car change. Guards the `replicateLast`-armed
   * effects below from overwriting a driver-controlled setup with the last run's
   * snapshot when the async `/api/runs/last` fetch resolves late (the
   * "edits revert on blur" bug). Reset at the top of the copy/car-change effect.
   */
  const setupTouchedByUserRef = useRef(false);
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
  /**
   * Track the *auto* path filled in on mount, or null. Stored as an id (not a
   * boolean) so the "Detected from location" caption and the Detect chip key on
   * `trackId === autoDetectedTrackId` — any later change of selection restores the
   * chip and drops the caption without extra bookkeeping.
   */
  const [autoDetectedTrackId, setAutoDetectedTrackId] = useState<string | null>(null);
  /** Once-per-mount latch for the permission-gated auto-detect effect. */
  const trackAutoDetectRanRef = useRef(false);
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
  /** Run was already marked complete — edits must not flip back to draft or bump the tire run # (server enforces too). */
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
    setTireTypeId(r.tireTypeId ?? r.tireType?.id ?? "");
    setTireTypeName(r.tireType?.displayName ?? "");
    // `runsCompleted` is always the count of *prior* runs on this rubber —
    // save() sends `runsCompleted + 1`. When hydrating an existing run we want
    // that re-save to preserve the run's current tireRunNumber, not bump it,
    // so subtract one from the stored number. Before this fix, editing any
    // saved run (especially a draft being completed) added +1 to the tire
    // slot on every save, producing the "+2 per draft→complete cycle" behavior.
    applyTireStint({
      runsCompleted: Math.max(0, (r.tireRunNumber ?? 1) - 1),
      ageKnown: r.tireAgeKnown ?? true,
      stintId: r.tireStintId ?? null,
    });
    setAdditiveTypeId(r.additiveTypeId ?? r.additiveType?.id ?? "");
    {
      const steps =
        Array.isArray(r.tirePrep) && r.tirePrep.length > 0
          ? normalizeTirePrep(r.tirePrep)
          : tirePrepFromLegacy(
              r.warmerTimingMinutes,
              Boolean(r.additiveTypeId ?? r.additiveType?.id)
            );
      // Show whatever the run had; no auto-seeded blank row (add on demand).
      setTirePrep(steps);
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
    // Setup sheet collapsed so the user sees the draft-resume summary
    // with diff rows, and can hit Edit only if something needs to change.
    setSetupSectionExpanded(false);
  }, [editRun, carsList, applyTireStint]);

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
    setTireTypeId(r.tireTypeId ?? r.tireType?.id ?? "");
    setTireTypeName(r.tireType?.displayName ?? "");
    applyTireStint({
      runsCompleted: r.tireRunNumber ?? 0,
      ageKnown: r.tireAgeKnown ?? true,
      stintId: r.tireStintId ?? null,
    });
    if (typeof r.practiceDayUrl === "string") setPracticeDayUrl(r.practiceDayUrl);

    const nextSetup = setupSnapshotWithDerived(r.setupSnapshot?.data);
    setSetupData(nextSetup);
    setActiveSetupData(nextSetup, nextCarId || carId || null);
    setSetupBaselineSnapshotId(r.setupSnapshot?.id ?? null);
    setSetupBaselineData(cloneSetupSnapshot(nextSetup));
    setNotes("");
    setLapIngest(defaultLapIngestValue());
    setReplicateLast(false);
  }, [dashboardPrefill, carsList, applyTireStint]);

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
  const draftAutosaveEnabled =
    !isEditing && !dashboardPrefill && !initialEventId && !labSetupPrefill && !wizardActive;
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
        if (typeof s.tireTypeId === "string") setTireTypeId(s.tireTypeId);
        if (typeof s.runsCompleted === "number" || s.tireStintId !== undefined) {
          applyTireStint({
            runsCompleted: typeof s.runsCompleted === "number" ? s.runsCompleted : 0,
            ageKnown: s.tireAgeKnown ?? true,
            stintId: s.tireStintId ?? null,
          });
        }
        if (typeof s.additiveTypeId === "string") setAdditiveTypeId(s.additiveTypeId);
        if (Array.isArray(s.tirePrep)) {
          setTirePrep(normalizeTirePrep(s.tirePrep));
        }
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
      tireTypeId,
      tireStintId,
      tireAgeKnown,
      runsCompleted,
      additiveTypeId,
      tirePrep,
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
    tireTypeId,
    tireStintId,
    tireAgeKnown,
    runsCompleted,
    additiveTypeId,
    tirePrep,
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
    return getGenericSetupSheetTemplate();
  }, [modelTemplate, selectedCar?.setupSheetTemplate]);

  const sheetFieldKeys = useMemo(
    () => collectSetupSheetTemplateKeys(setupTemplate),
    [setupTemplate]
  );
  const applyRunContextToSetupSnapshotLocal = useCallback(
    (
      nextTireTypeId: string,
      nextRunsCompleted: number,
      nextAgeKnown: boolean,
      nextAdditiveTypeId: string,
      nextTirePrep: TirePrepStep[]
    ) => {
      const tire = nextTireTypeId
        ? {
            tireTypeId: nextTireTypeId,
            displayName: tireTypeNameRef.current,
            tireRunNumber: Math.max(1, nextRunsCompleted + 1),
            tireAgeKnown: nextAgeKnown,
          }
        : null;
      const additive =
        nextAdditiveTypeId ? additiveTypesById[nextAdditiveTypeId] ?? null : null;
      setSetupData((prev) => {
        const next = applyRunContextToSetupSnapshot({
          resolvedData: prev,
          sheetKeys: sheetFieldKeys,
          tire,
          additiveDisplayName: additive?.displayName ?? null,
          warmerTimingMinutes: derivedWarmerTimingMinutes(nextTirePrep),
        });
        if (JSON.stringify(next) === JSON.stringify(prev)) return prev;
        return applyDerivedFieldsToSnapshot(next);
      });
    },
    [additiveTypesById, sheetFieldKeys]
  );

  function applyAdditiveTimingToSetupSnapshot(nextAdditiveTypeId: string, nextTirePrep: TirePrepStep[]) {
    applyRunContextToSetupSnapshotLocal(
      tireTypeIdRef.current,
      runsCompletedRef.current,
      tireAgeKnownRef.current,
      nextAdditiveTypeId,
      nextTirePrep
    );
  }


  // Deterministic sync: snapshot tires/additive always mirror run context selections.
  useEffect(() => {
    applyRunContextToSetupSnapshotLocal(
      tireTypeId,
      runsCompleted,
      tireAgeKnown,
      additiveTypeId,
      tirePrep
    );
  }, [
    tireTypeId,
    tireTypeName,
    runsCompleted,
    tireAgeKnown,
    additiveTypeId,
    tirePrep,
    applyRunContextToSetupSnapshotLocal,
  ]);

  const loadedSetupRun = useMemo(
    () => {
      if (loadSetupSelection) return pickerRuns.find((r) => r.id === loadSetupSelection) ?? null;
      // New-run flow: the setup auto-copied from the car's last run (replicate /
      // car-swap) never sets `loadSetupSelection`, so the summary would fall back
      // to a generic "Loaded setup". The baseline snapshot points straight back at
      // that source run — resolve it so the label names the run instead. Skip in
      // edit/draft, where the baseline is the run's OWN snapshot (would self-match).
      if (!isEditing && setupBaselineSnapshotId)
        return pickerRuns.find((r) => r.setupSnapshot?.id === setupBaselineSnapshotId) ?? null;
      return null;
    },
    [loadSetupSelection, pickerRuns, setupBaselineSnapshotId, isEditing]
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
      (r) => r.changed && !isRunContextSetupKey(r.key)
    );
  }, [setupData, setupBaselineData]);
  const setupChangeCountSinceBaseline = setupChangedRowsSinceBaseline.length;

  /** Prior run on this car exists → seed a neutral "feel vs last run" on save. */
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
      const setupOk = Object.keys(setupData).length > 0;
      if (carOk && setupOk) {
        return { show: false, carRating: false, additive: false, setup: false };
      }
      return {
        show: true,
        carRating: prev.carRating && !carOk,
        additive: prev.additive,
        setup: prev.setup && !setupOk,
      };
    });
  }, [carRating, setupData]);

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
    ? setupOptionLabel(selectedDownloadedSetup)
    : "Load a saved setup";

  const needsEvent = sessionType === "RACE_MEETING";

  const eventSelectGroups = useMemo(
    () => splitEventsForPicker(events),
    [events]
  );

  const selectedEventForRun = useMemo(
    () => (needsEvent && eventId ? events.find((e) => e.id === eventId) ?? null : null),
    [needsEvent, eventId, events]
  );
  /** The run's own track row — name + timing URLs for the lap-discovery panel. */
  const selectedRunTrack = useMemo(
    () => (trackId ? tracksList.find((t) => t.id === trackId) ?? null : null),
    [trackId, tracksList]
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
  const tracksGpsFingerprint = useMemo(
    () =>
      tracksList
        .filter((t) => trackHasMarkedLocation(t))
        .map((t) => `${t.id}:${t.latitude!.toFixed(5)},${t.longitude!.toFixed(5)}`)
        .sort()
        .join("|"),
    [tracksList]
  );

  /**
   * `mode: "auto"` is the silent mount path (permission already granted) — it
   * prefills the picker and says nothing on failure, so a bad GPS fix never
   * shouts at a driver who didn't ask. `"manual"` is the Detect chip and keeps
   * the full messaging, including the Track library hints.
   */
  const runTrackAutoDetect = useCallback(
    async (mode: "auto" | "manual" = "manual") => {
      const silent = mode === "auto";
      if (isEditing || trackLockedToEvent || trackPickedManuallyRef.current) return;
      if (tracksList.filter((t) => trackHasMarkedLocation(t)).length === 0) {
        if (!silent) {
          setTrackAutoDetectMessage(
            "No tracks have GPS saved yet. Open Track library to paste coordinates from Google Maps, then try again."
          );
        }
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
          if (!silent) {
            setTrackAutoDetectMessage(
              "No tracks have GPS saved yet. Open Track library to paste coordinates from Google Maps, then try again."
            );
          }
          return;
        }
        if (pick.kind === "single") {
          if (silent) {
            // Re-check: a manual pick or event apply can land during the await.
            if (trackPickedManuallyRef.current) return;
            let applied = false;
            setTrackId((prev) => {
              if (prev.trim()) return prev;
              applied = true;
              return pick.track.id;
            });
            if (applied) {
              setCopyTrackWarning(null);
              setAutoDetectedTrackId(pick.track.id);
            }
            return;
          }
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
          // Auto path stays quiet — TrackNearbySuggestions labels itself.
          if (!silent) {
            setTrackAutoDetectMessage("Multiple tracks nearby — pick one below (favourites listed first).");
          }
          return;
        }
        if (!silent) {
          setTrackAutoDetectMessage(
            "No saved track is within 800 m. Select manually or set GPS on a track in Track library."
          );
        }
      } catch (e) {
        if (silent) return;
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
    },
    [isEditing, trackLockedToEvent, tracksList, favouriteTrackIds]
  );

  /**
   * Quiet prefill on mount (founder decision 2026-07-27): if location permission
   * is *already* granted, detect the track silently so the common case — standing
   * at the track you always run at — needs zero taps. Never prompts: an ungranted
   * or unknown permission state leaves this inert and the Detect chip owns asking.
   * Replaces the two older ungated effects (classic mount + Track-tab open), which
   * could throw the browser location prompt at a driver who never asked for it.
   * Runs in both wizard and classic mode. The 800 ms delay plus the full dep list
   * means any prefill that lands first (draft restore, event apply) wins the guard
   * and cancels the pending timer.
   */
  useEffect(() => {
    if (trackAutoDetectRanRef.current) return;
    if (isEditing || trackLockedToEvent) return;
    if (trackId.trim() || trackPickedManuallyRef.current) return;
    if (typeof navigator === "undefined" || typeof navigator.permissions?.query !== "function") {
      // Older WebKit / Capacitor shell: no permissions API — manual only.
      return;
    }
    const t = window.setTimeout(() => {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((status) => {
          if (trackAutoDetectRanRef.current) return;
          if (status.state !== "granted") return;
          if (trackPickedManuallyRef.current) return;
          trackAutoDetectRanRef.current = true;
          void runTrackAutoDetect("auto");
        })
        .catch(() => {
          // Safari < 16 throws on { name: "geolocation" } — treat as not granted.
        });
    }, 800);
    return () => window.clearTimeout(t);
  }, [isEditing, trackLockedToEvent, trackId, tracksGpsFingerprint, runTrackAutoDetect]);

  // Effortless capture: silently pull conditions for a pinned track as soon as
  // one is selected — no permission prompt, no need to open the Conditions tab.
  // (Device-location fallback stays an explicit tap in RunConditionsSection.)
  useEffect(() => {
    if (isEditing) return;
    // Wizard: conditions are captured at Run complete for the actual session
    // window (founder decision 2026-07-16) — no pre-run fetch.
    if (wizardActive) return;
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
  }, [isEditing, wizardActive, conditions, trackId, trackLockedToEvent, selectedEventForRun, tracksList, lapIngest]);

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
      setSupportsSheetUpload(false);
      return;
    }
    let alive = true;
    Promise.all([
      jsonFetch<{ runs: RunPickerRun[] }>(`/api/runs/for-picker?carId=${encodeURIComponent(carId)}`),
      jsonFetch<{ downloadedSetups: DownloadedSetupOption[]; supportsSheetUpload?: boolean }>(
        `/api/setup/options?carId=${encodeURIComponent(carId)}`
      ),
    ])
      .then(([runsRes, dlRes]) => {
        if (!alive) return;
        setPickerRuns(Array.isArray(runsRes.runs) ? runsRes.runs : []);
        setDownloadedSetups(Array.isArray(dlRes.downloadedSetups) ? dlRes.downloadedSetups : []);
        setSupportsSheetUpload(dlRes.supportsSheetUpload === true);
      })
      .catch(() => {
        if (!alive) return;
        setPickerRuns([]);
        setDownloadedSetups([]);
        setSupportsSheetUpload(false);
      });
    return () => {
      alive = false;
    };
  }, [carId]);

  function handleSetupSourceChange(next: "previous_runs" | "other" | "new") {
    if (next === setupSource) return;
    // Switching source is an explicit setup choice — protect it from the
    // last-run auto-apply the same way an edit or pick does.
    setupTouchedByUserRef.current = true;
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
    setupTouchedByUserRef.current = true;
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
    setupTouchedByUserRef.current = true;
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
        label: "Saved setups",
        shortLabel: "Saved",
        content: (
          <div className="space-y-2 pt-0.5">
            <div className="space-y-1 text-sm">
              <div className="text-sm font-medium text-muted-foreground break-words min-w-0 leading-snug">
                {loadOtherSetupLabel}
              </div>
              <SearchableSelect
                aria-label="Saved setup"
                className="max-w-2xl"
                placeholder="Choose a saved setup…"
                clearable
                clearLabel="Choose a saved setup…"
                triggerMono
                disabled={downloadedSetups.length === 0}
                value={loadOtherSetupSelection}
                onChange={(next) => applyDownloadedSetupOnly(next)}
                options={downloadedSetups.map((d) => ({
                  value: d.id,
                  label: setupOptionLabel(d),
                }))}
              />
            </div>
            {downloadedSetups.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No saved setups for this car yet. Build one on the car&apos;s page, or switch to{" "}
                <span className="font-medium">New</span>.
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
            {supportsSheetUpload ? (
              <SegmentedControl<"blank" | "upload">
                ariaLabel="New setup source"
                value={newSetupMode}
                onChange={(next) => setNewSetupMode(next)}
                options={[
                  { value: "blank", label: "Write from scratch" },
                  { value: "upload", label: "Upload sheet" },
                ]}
              />
            ) : null}
            {!supportsSheetUpload || newSetupMode === "blank" ? (
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
      setupTouchedByUserRef.current = true;
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
    // Wizard car swap in flight? Consume the plan — it decides what carries.
    const pendingSwap = wizardCarSwapPlanRef.current;
    wizardCarSwapPlanRef.current = null;
    // A car change or a fresh copy-from-last-run is a clean slate: forget any
    // prior manual setup selection so this run's last-run snapshot can apply,
    // then re-arm the guard as soon as the driver touches the setup again.
    // (A wizard swap skips this — the plan may KEEP hand edits on a same-sheet
    // swap, so the guard must survive until the plan is applied.)
    if (!pendingSwap) setupTouchedByUserRef.current = false;
    setReplicateLoaded(false);
    setStatus(null);

    (async () => {
      try {
        const { lastRun } = await jsonFetch<{ lastRun: LastRun | null }>(
          `/api/runs/last?carId=${carId}`
        );
        if (!alive) return;
        setLastRun(lastRun);

        if (pendingSwap) {
          // Mid-context car swap: the day context stays put — only the
          // car-bound layers move, per the plan.
          const { plan, toName } = pendingSwap;
          const noteParts: string[] = [];
          if (plan.rederiveTiresPrep) {
            // Cross-class: this class's wheels don't bolt on — load the new
            // car's own last tires + prep (blank when it has no history).
            carryTiresForward(lastRun);
            setAdditiveTypeId(lastRun?.additiveTypeId ?? "");
            setTirePrep(
              lastRun && Array.isArray(lastRun.tirePrep) ? normalizeTirePrep(lastRun.tirePrep) : []
            );
            noteParts.push(
              lastRun
                ? `Tires & prep from ${toName}'s last run`
                : `No runs on ${toName} yet — set tires & prep fresh`
            );
          }
          if (plan.setup === "keep") {
            noteParts.push("Setup edits kept — same sheet");
          } else {
            setupTouchedByUserRef.current = false;
            // No snapshot on the new car → genuinely blank (the derived-fields
            // pass would manufacture keys and fake out "setup attached").
            const nextSetup = lastRun?.setupSnapshot?.data
              ? setupSnapshotWithDerived(lastRun.setupSnapshot.data)
              : ({} as SetupSnapshotData);
            setSetupData(nextSetup);
            setActiveSetupData(nextSetup, carId || null);
            setSetupBaselineSnapshotId(lastRun?.setupSnapshot?.id ?? null);
            setSetupBaselineData(cloneSetupSnapshot(nextSetup));
            noteParts.push(
              lastRun?.setupSnapshot?.data
                ? `Setup from ${toName}'s last run`
                : `No setup on ${toName} yet — attach one on the Setup step`
            );
          }
          setWizardCarSwapNote(noteParts.join(" · "));
        } else if (replicateLast && lastRun) {
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
          carryTiresForward(lastRun);
          if (typeof lastRun.practiceDayUrl === "string" && lastRun.practiceDayUrl.trim()) {
            setPracticeDayUrl(lastRun.practiceDayUrl);
          }
          // Only apply the last-run setup if the driver hasn't already picked or
          // edited one since this copy/car-change — otherwise a late fetch would
          // clobber their work (the "edits revert on blur" bug).
          if (!setupTouchedByUserRef.current) {
            const nextSetup = setupSnapshotWithDerived(lastRun.setupSnapshot?.data);
            setSetupData(nextSetup);
            setActiveSetupData(nextSetup, carId || null);
            setSetupBaselineSnapshotId(lastRun.setupSnapshot?.id ?? null);
            setSetupBaselineData(cloneSetupSnapshot(nextSetup));
          }
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
  }, [carId, replicateLast, carryTiresForward]);

  // replicateLast still powers "copy from last run for this car" behavior after the initial copy decision.
  useEffect(() => {
    if (!replicateLast || !lastRun) return;
    // Wizard: the initial copy is applied by the carId effect above and the
    // payload re-assert below; re-running THIS full copy when `lastRun` changes
    // (e.g. a mid-context car swap re-fetches it) would drag the day context —
    // session/event/track — onto the new car's history. The swap plan owns
    // what carries on a car change; skip the classic re-copy entirely.
    if (wizardActive) return;
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
    carryTiresForward(lastRun);
    if (typeof lastRun.practiceDayUrl === "string" && lastRun.practiceDayUrl.trim()) {
      setPracticeDayUrl(lastRun.practiceDayUrl);
    }
    // Don't overwrite a setup the driver has already picked or edited (see the
    // guard in the load effect above).
    if (!setupTouchedByUserRef.current) {
      const nextSetup = setupSnapshotWithDerived(lastRun.setupSnapshot?.data);
      setSetupData(nextSetup);
      setActiveSetupData(nextSetup, carId || null);
      setSetupBaselineSnapshotId(lastRun.setupSnapshot?.id ?? null);
      setSetupBaselineData(cloneSetupSnapshot(nextSetup));
    }
  }, [replicateLast, lastRun, carId, carryTiresForward]);

  // Wizard page-1 identity (session, event, track) must win over the continued
  // run's values — the replicate effects above copy the last run's context, so
  // re-assert the entry payload once the copy has landed (declared after those
  // effects so it runs later in the same commit).
  const wizardSessionAppliedRef = useRef(false);
  useEffect(() => {
    if (!wizard || wizardSessionAppliedRef.current) return;
    // Hosting an existing run (draft resume / edit): the editRun hydrate above
    // is the truth — the entry payload only seeded initial state (it can't
    // carry SEEDING/OTHER meeting sessions), so re-asserting it would clobber
    // the run's real values.
    if (isEditing) {
      wizardSessionAppliedRef.current = true;
      return;
    }
    if (wizard.continuing && !replicateLoaded) return;
    wizardSessionAppliedRef.current = true;
    setSessionType(wizard.sessionType);
    if (wizard.sessionType === "RACE_MEETING") {
      setMeetingSessionType(wizard.meetingSessionType ?? "PRACTICE");
      setMeetingSessionCustom("");
    }
    setSessionLabel(wizard.sessionLabel);
    setEventId(wizard.eventId ?? "");
    if (wizard.trackId) {
      trackPickedManuallyRef.current = true;
      setTrackId(wizard.trackId);
      setTrackLayoutId(wizard.trackLayoutId ?? "");
      setTrackDirection(wizard.trackDirection ?? "");
      layoutPickedManuallyRef.current = true;
    } else if (wizard.sessionType === "RACE_MEETING") {
      // Race meeting: the run's track follows the event (trackLockedToEvent) —
      // drop any track the copy carried so a stale venue can't be submitted.
      setTrackId("");
      setTrackLayoutId("");
      setTrackDirection("");
    }
  }, [wizard, replicateLoaded, isEditing]);

  // Wizard race meetings: keep the run's track following the selected event
  // (classic mode does this in applyEventOption on manual pick; the wizard sets
  // eventId programmatically, and the events list loads async).
  useEffect(() => {
    if (!wizardActive || !needsEvent) return;
    const evTrackId = selectedEventForRun?.trackId ? String(selectedEventForRun.trackId) : null;
    if (!evTrackId || trackId === evTrackId) return;
    setTrackId(evTrackId);
    setTrackLayoutId(selectedEventForRun?.trackLayoutId ?? "");
    setTrackDirection((selectedEventForRun?.trackDirection as "" | "CW" | "CCW") ?? "");
  }, [wizardActive, needsEvent, selectedEventForRun, trackId]);

  // ---- Wizard GPS at landing (v6): location resolves once, right after
  // mount, and auto-picks the track on the blank landing. Prefilling later at
  // a different venue keeps the detected track (applyWizardPrefill's venue
  // check — the setup still carries, that's the value). Never fires over a
  // URL-deep-linked event, an edit, or anything the driver touched by hand. ----
  const wizardGpsRanRef = useRef(false);
  const wizardGpsAppliedRef = useRef(false);
  /** Set by manual session/event/track edits — GPS never overrides a human. */
  const wizardCtxTouchedRef = useRef(false);
  const [wizardDetection, setWizardDetection] = useState<{
    trackId: string;
    trackName: string;
    distanceM: number;
  } | null>(null);
  const [wizardVenueSwapNote, setWizardVenueSwapNote] = useState<string | null>(null);
  useEffect(() => {
    if (!wizardActive || isEditing || wizardGpsRanRef.current) return;
    wizardGpsRanRef.current = true;
    const t = window.setTimeout(async () => {
      try {
        if (tracksList.filter((tk) => trackHasMarkedLocation(tk)).length === 0) return;
        const position = await getCurrentPosition();
        const pick = pickTrackFromPosition(tracksList, position, {
          radiusMeters: DEFAULT_TRACK_PROXIMITY_RADIUS_M,
          favouriteTrackIds,
        });
        if (pick.kind === "single") {
          setWizardDetection({
            trackId: pick.track.id,
            trackName: pick.track.name,
            distanceM: pick.distanceM,
          });
        }
      } catch {
        /* location denied/unavailable — silent, the driver picks manually */
      }
    }, 500);
    return () => window.clearTimeout(t);
  }, [wizardActive, isEditing, tracksList, favouriteTrackIds]);
  useEffect(() => {
    if (!wizardActive || !wizard || !wizardDetection || wizardGpsAppliedRef.current) return;
    if (wizardCtxTouchedRef.current) {
      wizardGpsAppliedRef.current = true;
      return;
    }
    // v6: the wizard always lands blank (prefill is a tap) — GPS just fills
    // the venue when none is set. The carried-venue mismatch check moved to
    // tap time, inside applyWizardPrefill.
    wizardGpsAppliedRef.current = true;
    if (!trackId && !eventId) {
      trackPickedManuallyRef.current = true;
      setTrackId(wizardDetection.trackId);
      setTrackAutoDetectMessage(
        `Detected ${wizardDetection.trackName} (${Math.round(wizardDetection.distanceM)} m away).`
      );
    }
  }, [wizardActive, wizard, wizardDetection, trackId, eventId]);

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

    setCopyTireWarning(null);
    if (r.tireTypeId || r.tireType?.id) {
      carryTiresForward(r);
      highlights.tires = true;
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
      setTirePrep(steps);
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
    // Reveal the copied setup sheet — every other load path expands it, and a
    // silently-attached-but-hidden setup reads as "the setup didn't come across."
    setSetupSectionExpanded(true);
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
    sessionCompletedAtIsWallClock: boolean;
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
      sessionCompletedAtIsWallClock: boolean;
      laps: Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded: boolean }>;
    }> = [];

    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi]!;
      const sessionDrivers = block.sessionDrivers ?? [];
      if (sessionDrivers.length === 0) continue;
      const sourceUrl = block.sourceUrl ?? null;
      const blockPayloadForTime =
        block.sessionCompletedAtIso != null && block.sessionCompletedAtIso.trim()
          ? { sessionCompletedAtIso: block.sessionCompletedAtIso.trim() }
          : undefined;
      const sessionCompletedAt = resolveImportedSessionDisplayTimeIso({
        sessionCompletedAt: block.sessionCompletedAtDbIso ?? null,
        parsedPayload: blockPayloadForTime,
        createdAt: block.recordedAt,
      });
      // Tells the save API whether the time is an on-track wall clock (LiveRC/
      // MyRCM store those as-if-UTC and the server reinterprets them in the
      // user's zone) or the import-time fallback, which is already a real instant.
      const sessionCompletedAtIsWallClock = resolveImportedSessionHasWallClockTime({
        sessionCompletedAt: block.sessionCompletedAtDbIso ?? null,
        parsedPayload: blockPayloadForTime,
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
          sessionCompletedAtIsWallClock,
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
    // Track gates COMPLETING, never the walk (founder 2026-07-17): a wizard
    // draft saves trackless — the summary nudges — but a complete run needs a
    // venue. Classic mode keeps requiring it on any save (unchanged behavior).
    if (!resolvedTrackId && (!wizardActive || intent === "completed")) {
      setInlineError("Select a track — it’s used for comparisons and the Engineer.");
      setTrackSaveWarning(true);
      if (wizardActive) goToWizardStep("session");
      setRunDetailsTab("track");
      return;
    }
    if (intent === "completed") {
      const missingCarRating = carRating == null || carRating < 1 || carRating > 10;
      // A controlled additive is auto-filled (running none is allowed), so it is
      // never a save blocker.
      const missingSetup = Object.keys(setupData).length === 0;
      if (missingCarRating || missingSetup) {
        const parts: string[] = [];
        if (missingCarRating) parts.push("rate the car 1–10");
        if (missingSetup) {
          parts.push("attach a setup — copy last run, load a past setup, or upload a sheet");
        }
        setCompleteValidation({
          show: true,
          carRating: missingCarRating,
          additive: false,
          setup: missingSetup,
        });
        setInlineError(`Before Run complete: ${parts.join("; ")}.`);
        // Only the setup field lives outside the feedback card — scroll there when
        // that's the sole blocker so the amber-highlighted Setup card is in view.
        const scrollTarget: Element | null =
          missingSetup && !missingCarRating
            ? document.querySelector(".run-section--setup")
            : feedbackRequiredRef.current;
        window.requestAnimationFrame(() => {
          scrollTarget?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        return;
      }
      setCompleteValidation({ show: false, carRating: false, additive: false, setup: false });
    }
    // Setup edits ride along with the run automatically — the payload always
    // includes `setupData`, so unsaved sheet changes are stored either way. No
    // pre-save confirmation gate (removed 2026-07-10; the fixed save buttons
    // made the inline review easy to miss and it read as a dead button).
    setSaving(true);
    setSaveSuccess(false);
    // Wizard: conditions capture happens NOW, at Run complete, for the actual
    // session window (founder decision 2026-07-16). Silent and best-effort —
    // no coords or a slow fetch simply saves without weather.
    let conditionsForSave = conditions;
    if (wizardActive && intent === "completed" && isConditionsEmpty(conditionsForSave)) {
      const weatherTrack = tracksList.find((t) => t.id === resolvedTrackId);
      if (weatherTrack?.latitude != null && weatherTrack?.longitude != null) {
        const sets = buildImportedLapSetsFromIngest(lapIngest);
        const atIso = (sets.find((s) => s.isPrimaryUser) ?? sets[0])?.sessionCompletedAt ?? null;
        const params = new URLSearchParams({
          lat: String(weatherTrack.latitude),
          lon: String(weatherTrack.longitude),
        });
        if (atIso) params.set("at", atIso);
        try {
          const ctrl = new AbortController();
          const timeoutId = window.setTimeout(() => ctrl.abort(), 4000);
          const res = await fetch(`/api/weather?${params.toString()}`, { signal: ctrl.signal });
          window.clearTimeout(timeoutId);
          const d = (await res.json()) as { conditions?: RunConditions };
          if (d?.conditions) conditionsForSave = d.conditions;
        } catch {
          /* silent — weather is a bonus, never a chore */
        }
      }
    }
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
      const { run, tireStintId: savedStintId, promptMarkTrackLocation } = await jsonFetch<{
        run: { id: string; createdAt: string };
        /** The stint the run landed on — freshly minted when the client sent null. */
        tireStintId?: string | null;
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
          tireTypeId: tireTypeId || null,
          // A null stint means different rubber went on — the server mints a fresh
          // id. Carrying one forward is what makes "same tires" cost zero taps.
          tireStintId: tireStintId,
          tireAgeKnown,
          tireRunNumber: Math.max(1, runsCompleted + 1),
          additiveTypeId: additiveTypeId || null,
          tirePrep: pruneTirePrepForSave(tirePrep),
          setupData: applyDerivedFieldsToSnapshot(setupData),
          setupBaselineSnapshotId,
          // Only an imported *document* has a document id. A library setup's option id is its
          // SetupSnapshot id, which must never be sent here — it would be written to
          // Run.sourceSetupDocumentId as a dangling reference. Its lineage travels on
          // setupBaselineSnapshotId instead.
          sourceSetupDocumentId:
            setupSource === "other" && selectedDownloadedSetup?.kind !== "library"
              ? loadOtherSetupSelection || null
              : null,
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
          conditions: isConditionsEmpty(conditionsForSave) ? null : conditionsForSave,
          sessionLabel:
            sessionType === "RACE_MEETING" && sessionLabel?.trim() ? sessionLabel.trim() : null,
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

      // Adopt the server-minted stint immediately: a follow-up save must stay on the
      // same rubber rather than minting a second stint for the same tires.
      if (savedStintId) setTireStintId(savedStintId);

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

      // Every successful save leaves the log-run flow for the dashboard.
      // Completing also carries ?suggestRun so the dashboard can offer
      // Engineer suggestions for the session they just saved. Draft saves
      // (new or edit) go to `/` — navigating away discards local tire
      // counters so the double-increment-on-return bug can't recur. The
      // run is already persisted here, so refresh the today-draft banner
      // in the background (never await it — a slow /api/runs/today-draft
      // must not gate nav).
      if (intent === "completed") {
        navigateAfterRunComplete(run.id);
      } else {
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
    // The dashboard reads ?suggestRun from the URL — a hard load carries it fine.
    navigateAway(`/?suggestRun=${encodeURIComponent(runId)}`);
  }

  /**
   * Leave the log-run page after a save has already persisted the run.
   *
   * ALWAYS a hard navigation (window.location.assign) in the browser — never a
   * soft router.push. A saved run must never strand the driver on the form, and
   * the App Router's soft transition has wedged twice in the installed PWA /
   * webview: a half-committed navigation leaves the URL "changed" but the page
   * frozen and the bottom nav dead, which also defeated the previous
   * push-then-1.2s-fallback guard (the guard saw the path had "arrived" and
   * skipped the hard nav). A real document load cannot be swallowed by the
   * router or a stale service worker and lands on a fresh dashboard every time;
   * the run is already saved, so the reload cost is irrelevant.
   */
  function navigateAway(href: string) {
    if (typeof window !== "undefined") {
      // Hold the "Saved ✓" confirmation on the button for a beat so the save
      // reads as done, then hard-reload. Without this the screen jumps while
      // the button still says "Saving…", which feels like nothing happened.
      window.setTimeout(() => {
        window.location.assign(href);
      }, 600);
      return;
    }
    router.push(href);
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

  // Tire-prep panel — shared by the classic Tires face and the wizard's own
  // Prep step (declared once so both render identical wiring).
  const prepPanelJsx = (
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
  );

  // Rail badges: ✓ when the step's key data is in; amber dot when Run-complete
  // validation flagged it. Cheap heuristics — the server stays the authority.
  const wizardLapsIn = wizardActive && buildImportedLapSetsFromIngest(lapIngest).length > 0;
  const wizardPrepIn = tirePrep.length > 0 || Boolean(additiveTypeId);
  const wizardStepStatus: Partial<Record<WizardStepId, WizardStepStatus>> = {
    session: {
      done: Boolean(carId && trackId),
      attention: trackSaveWarning && !trackId,
    },
    equipment: { done: Boolean(tireTypeId) },
    prep: { done: wizardPrepIn },
    setup: {
      done: setupBaselineData != null || Object.keys(setupData).length > 0,
      attention: completeValidation.setup,
    },
    laps: { done: wizardLapsIn },
    feel: {
      done: carRating != null,
      attention: completeValidation.carRating,
    },
  };
  /** Anything worth saving? Gates the exit prompt (F2): an untouched run
   *  leaves without ceremony; editing an existing run always asks. */
  const wizardHasContent =
    isEditing ||
    Boolean(
      trackId ||
        tireTypeId ||
        tirePrep.length > 0 ||
        additiveTypeId ||
        Object.keys(setupData).length > 0 ||
        wizardLapsIn ||
        carRating != null ||
        notes.trim()
    );
  /** v5: Save's intent follows the DECLARED state, never the data. */
  const wizardSaveCompletes = wizardMarkedComplete;
  // Rating is the completion gate — clearing it un-declares. An already-
  // completed run stays declared (saves must never flip it back to draft).
  useEffect(() => {
    if (wizardMarkedComplete && carRating == null && !editingCompletedRun) {
      setWizardMarkedComplete(false);
    }
  }, [wizardMarkedComplete, carRating, editingCompletedRun]);
  // Once the rating lands, drop its complete-validation highlight (set by a
  // badge tap while unrated); the setup flag keeps the banner if still missing.
  useEffect(() => {
    if (carRating != null) {
      setCompleteValidation((v) =>
        v.carRating ? { ...v, carRating: false, show: v.setup } : v
      );
    }
  }, [carRating]);
  /**
   * Session-step car select (wizard). Car is the FIRST selection — it drives
   * what continue/copy means, so a mid-context change computes the swap plan
   * (class + sheet compare) BEFORE the carId effect fires and consumes it.
   */
  const handleWizardCarChange = (nextId: string) => {
    if (!nextId || nextId === carId) return;
    const from = carsList.find((c) => c.id === carId);
    const to = carsList.find((c) => c.id === nextId);
    // Layered swap only once a prefill has landed — before that the run is
    // blank, so a car change is a plain re-pick (the per-car fetch refreshes
    // the manifest card's offer on its own).
    if (wizardPrefillApplied && from && to) {
      wizardCarSwapPlanRef.current = {
        plan: planCarSwap(from, to, { setupHandEdited: setupTouchedByUserRef.current }),
        toName: to.name,
      };
    } else {
      wizardCarSwapPlanRef.current = null;
    }
    setWizardCarSwapNote(null);
    setCarId(nextId);
  };

  // ---- v6 prefill (founder 2026-07-17, artifact round 3): the wizard lands
  // blank and the Session step's manifest card OFFERS the selected car's last
  // run — one explicit tap applies it. `lastRun` is already fetched per-car by
  // the load effect above (fresh mode fetches without applying), so the offer
  // rows and the apply itself are synchronous. ----

  /** The per-car last run shaped as an EntryCandidate so deriveContinueEntry's
   *  session rules (active event re-attaches, else testing at the carried
   *  track) apply identically to the old continue path. */
  const wizardLastRunCandidate = useMemo<EntryCandidate | null>(() => {
    if (!wizardActive || !lastRun) return null;
    return {
      runId: lastRun.id,
      carId: lastRun.carId ?? lastRun.car?.id ?? carId ?? null,
      carName: lastRun.car?.name ?? lastRun.carNameSnapshot ?? null,
      trackId: lastRun.trackId ?? lastRun.track?.id ?? null,
      trackName: lastRun.track?.name ?? lastRun.trackNameSnapshot ?? null,
      eventId: lastRun.eventId ?? lastRun.event?.id ?? null,
      eventName: lastRun.event?.name ?? null,
      eventEndIso: lastRun.event?.endDate
        ? new Date(lastRun.event.endDate).toISOString()
        : null,
      sessionType: lastRun.sessionType ?? null,
      meetingSessionType: lastRun.meetingSessionType ?? null,
      sessionLabel: lastRun.sessionLabel ?? null,
      whenIso: lastRun.createdAt,
    };
  }, [wizardActive, lastRun, carId]);

  const wizardPrefillPlan = useMemo(
    () =>
      wizardLastRunCandidate
        ? deriveContinueEntry(wizardLastRunCandidate, props.wizardDeepLinkedEventId ?? null)
        : null,
    [wizardLastRunCandidate, props.wizardDeepLinkedEventId]
  );

  /** One tap fills exactly what the offer card listed. Mirrors the retired
   *  auto-continue copy (tires/setup) plus prep + additive (the manifest
   *  promises them, so the tap must deliver them). */
  const applyWizardPrefill = () => {
    if (!lastRun || !wizardPrefillPlan) return;
    const plan = { ...wizardPrefillPlan };
    // Venue reality check (the kept GPS venue-swap rule, now at tap time): if
    // the run already has a venue — GPS auto-pick or a manual pick — and the
    // carried venue differs, stay HERE and bring the setup over as a testing
    // baseline ("you didn't teleport").
    const carriedVenueTrackId = plan.eventId
      ? lastRun.event?.trackId
        ? String(lastRun.event.trackId)
        : null
      : plan.trackId;
    const currentTrackId = trackId.trim() || null;
    let venueNote: string | null = null;
    const venueSwapped =
      currentTrackId != null && carriedVenueTrackId != null && currentTrackId !== carriedVenueTrackId;
    if (venueSwapped) {
      const hereName = tracksList.find((t) => t.id === currentTrackId)?.name ?? "this track";
      const fromName = lastRun.track?.name ?? lastRun.trackNameSnapshot ?? "last run's track";
      plan.sessionType = "TESTING";
      plan.meetingSessionType = null;
      plan.sessionLabel = null;
      plan.eventId = null;
      plan.trackId = currentTrackId;
      venueNote = `At ${hereName} now — carries your ${fromName} setup here`;
    }
    // Session identity.
    setSessionType(plan.sessionType);
    setMeetingSessionType(plan.meetingSessionType ?? "PRACTICE");
    setMeetingSessionCustom("");
    setSessionLabel(plan.sessionLabel);
    setEventId(plan.eventId ?? "");
    if (!venueSwapped && !plan.eventId && plan.trackId) {
      trackPickedManuallyRef.current = true;
      setTrackId(plan.trackId);
      setTrackLayoutId(lastRun.trackLayoutId ?? lastRun.trackLayout?.id ?? "");
      setTrackDirection(lastRun.trackDirection ?? "");
      layoutPickedManuallyRef.current = true;
      setTrackAutoDetectMessage(null);
    }
    // Tires.
    carryTiresForward(lastRun);
    // Prep + additive (legacy warmer minutes fall back like the classic copy).
    const nextAdditiveId = lastRun.additiveTypeId ?? lastRun.additiveType?.id ?? "";
    setAdditiveTypeId(nextAdditiveId);
    if (lastRun.additiveType) {
      const at = lastRun.additiveType;
      setAdditiveTypesById((prev) => ({
        ...prev,
        [at.id]: { id: at.id, displayName: at.displayName },
      }));
    }
    setTirePrep(
      Array.isArray(lastRun.tirePrep) && lastRun.tirePrep.length > 0
        ? normalizeTirePrep(lastRun.tirePrep)
        : tirePrepFromLegacy(lastRun.warmerTimingMinutes, Boolean(nextAdditiveId))
    );
    if (typeof lastRun.practiceDayUrl === "string" && lastRun.practiceDayUrl.trim()) {
      setPracticeDayUrl(lastRun.practiceDayUrl);
    }
    // Setup — an explicit tap overrides anything picked so far (and a missing
    // snapshot stays truly blank; derived-keys manufacture would fake out
    // "setup attached").
    setupTouchedByUserRef.current = false;
    const nextSetup = lastRun.setupSnapshot?.data
      ? setupSnapshotWithDerived(lastRun.setupSnapshot.data)
      : ({} as SetupSnapshotData);
    setSetupData(nextSetup);
    setActiveSetupData(nextSetup, carId || null);
    setSetupBaselineSnapshotId(lastRun.setupSnapshot?.id ?? null);
    setSetupBaselineData(cloneSetupSnapshot(nextSetup));

    setWizardVenueSwapNote(venueNote);
    setWizardCarSwapNote(null);
    wizardAppliedPlanRef.current = plan;
    setWizardPrefillApplied(true);
  };

  // F2 (founder 2026-07-18, docs/design/log-run-navigation.md): ONE state
  // vocabulary — 6 steps = 6 ticks = 6 track sectors = 6 map-sheet rows, all
  // reading wizardStepStatus. The old 7-part meter (feedback split into
  // rating/notes + handling) is retired; notes and the handling assessment
  // are in-step enrichment, counted nowhere.
  // "Prefilled" chips (founder round 2): on a prefilled run, rows whose value
  // still equals what the tap carried in are marked; editing makes the value
  // this run's own and the chip drops. Value equality against the applied
  // plan + lastRun — no touch tracking, so programmatic copies like a
  // car-swap re-derive stay honestly marked too.
  const wizardAppliedPlan = wizardAppliedPlanRef.current;
  const wizardPrefilled: Partial<Record<string, boolean>> = (() => {
    if (!wizardActive || !wizardPrefillApplied || !wizardAppliedPlan) return {};
    const sessionUnchanged =
      sessionType === wizardAppliedPlan.sessionType &&
      (wizardAppliedPlan.sessionType !== "RACE_MEETING" ||
        meetingSessionType === (wizardAppliedPlan.meetingSessionType ?? "PRACTICE")) &&
      (sessionLabel ?? null) === wizardAppliedPlan.sessionLabel &&
      eventId === (wizardAppliedPlan.eventId ?? "") &&
      (wizardAppliedPlan.trackId
        ? trackId === wizardAppliedPlan.trackId
        : wizardAppliedPlan.sessionType === "RACE_MEETING" || trackId === "");
    return {
      session: sessionUnchanged,
      car: carId === wizardAppliedPlan.carId,
      tires:
        Boolean(tireTypeId) && tireStintId != null && tireStintId === (lastRun?.tireStintId ?? null),
      prep:
        wizardPrepIn &&
        lastRun != null &&
        additiveTypeId === (lastRun.additiveTypeId ?? "") &&
        JSON.stringify(tirePrep) ===
          JSON.stringify(
            Array.isArray(lastRun.tirePrep) ? normalizeTirePrep(lastRun.tirePrep) : []
          ),
      setup:
        setupBaselineSnapshotId != null &&
        setupBaselineSnapshotId === (lastRun?.setupSnapshot?.id ?? null) &&
        setupChangeCountSinceBaseline === 0 &&
        Object.keys(setupData).length > 0,
    };
  })();
  /** Session identity pieces — shared by the map-sheet Session row and the
   *  slim top recap line (F2: the recap is state-only, never nav). */
  const wizardSessionKind =
    sessionType === "RACE_MEETING"
      ? sessionLabel ||
        (meetingSessionType === "OTHER"
          ? meetingSessionCustom.trim() || "Race meeting"
          : meetingSessionType.charAt(0) + meetingSessionType.slice(1).toLowerCase())
      : "Testing";
  const wizardTrackName = tracksList.find((t) => t.id === trackId)?.name ?? null;
  const wizardCarName = carsList.find((c) => c.id === carId)?.name ?? null;
  const wizardSummaryRows: WizardSheetRow[] = wizardActive
    ? [
        {
          key: "session",
          label: "Session",
          // Car folds into the Session row (one row per step). Track gates
          // completing (never the walk) — a trackless run reads as unfinished
          // business here, tap → Session step.
          value: [wizardSessionKind, wizardTrackName ?? "track needed", wizardCarName]
            .filter(Boolean)
            .join(" · "),
          state: trackId && carId ? "ok" : "miss",
          prefilled: Boolean(wizardPrefilled.session && wizardPrefilled.car),
          go: "session",
        },
        {
          key: "tires",
          label: "Tires",
          value: tireSummaryLine || "not set",
          state: tireTypeId ? "ok" : "miss",
          prefilled: wizardPrefilled.tires,
          go: "equipment",
        },
        {
          key: "prep",
          label: "Prep",
          value: wizardPrepIn
            ? formatTirePrepLine(
                tirePrep,
                additiveTypeId ? additiveTypesById[additiveTypeId]?.displayName ?? null : null
              ) || "logged"
            : "none",
          state: wizardPrepIn ? "ok" : "miss",
          prefilled: wizardPrefilled.prep,
          go: "prep",
        },
        {
          key: "setup",
          label: "Setup",
          value:
            setupChangeCountSinceBaseline > 0
              ? `${setupChangeCountSinceBaseline} change${setupChangeCountSinceBaseline === 1 ? "" : "s"} from loaded`
              : Object.keys(setupData).length > 0
                ? "as loaded"
                : "not attached",
          state:
            setupChangeCountSinceBaseline > 0
              ? "chg"
              : Object.keys(setupData).length > 0
                ? "ok"
                : "miss",
          prefilled: wizardPrefilled.setup,
          go: "setup",
        },
        {
          key: "laps",
          label: "Laps",
          value: wizardLapsIn ? "imported" : "not imported",
          state: wizardLapsIn ? "ok" : "miss",
          go: "laps",
        },
        {
          key: "feel",
          label: "Feedback",
          value:
            carRating != null
              ? `${carRating} / 10${notes.trim() ? " · notes" : ""}`
              : notes.trim()
                ? "notes only — not rated"
                : "not rated",
          state: carRating != null ? "ok" : "miss",
          go: "feel",
        },
      ]
    : [];

  // v6 manifest card rows. OFFER = the promise (from the car's last run +
  // the derived plan); APPLIED = the same five rows reading LIVE state, so
  // car swaps and manual edits stay truthful. Locked round 3: the card keeps
  // all five rows in both states and only gains ✓s.
  const titleCaseSession = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
  const wizardPrefillKindLabel = lastRun
    ? lastRun.sessionLabel?.trim() ||
      (lastRun.sessionType === "TESTING" || !lastRun.meetingSessionType
        ? "Testing"
        : titleCaseSession(lastRun.meetingSessionType))
    : props.wizardCandidate?.sessionLabel?.trim() ||
      (props.wizardCandidate?.meetingSessionType &&
      props.wizardCandidate.meetingSessionType !== "TESTING"
        ? titleCaseSession(props.wizardCandidate.meetingSessionType)
        : "Testing");
  const wizardPrefillWhenIso = lastRun?.createdAt ?? props.wizardCandidate?.whenIso ?? "";
  const wizardPrefillRows: WizardPrefillRow[] = wizardActive
    ? wizardPrefillApplied
      ? [
          {
            key: "session",
            label: "Session",
            value:
              sessionType === "RACE_MEETING"
                ? `Race meeting · ${
                    sessionLabel ||
                    (meetingSessionType === "OTHER"
                      ? meetingSessionCustom.trim() || "Other"
                      : titleCaseSession(meetingSessionType))
                  }`
                : "Testing",
          },
          {
            key: "track",
            label: "Track",
            value: tracksList.find((t) => t.id === trackId)?.name ?? "track needed",
          },
          {
            key: "tires",
            label: "Tires",
            value: wizardSummaryRows.find((r) => r.key === "tires")?.value ?? "—",
            jump: "equipment",
          },
          {
            key: "prep",
            label: "Prep",
            value: wizardSummaryRows.find((r) => r.key === "prep")?.value ?? "—",
            jump: "prep",
          },
          {
            key: "setup",
            label: "Setup",
            value:
              Object.keys(setupData).length > 0
                ? `${Object.keys(setupData).length} values · ${
                    setupChangeCountSinceBaseline > 0
                      ? `${setupChangeCountSinceBaseline} changed`
                      : "as last run"
                  }`
                : "not attached",
            jump: "setup",
          },
        ]
      : [
          {
            key: "session",
            label: "Session",
            value: wizardPrefillPlan
              ? wizardPrefillPlan.sessionType === "RACE_MEETING"
                ? `Race meeting · ${
                    wizardPrefillPlan.sessionLabel ||
                    titleCaseSession(wizardPrefillPlan.meetingSessionType ?? "PRACTICE")
                  }`
                : "Testing"
              : "…",
          },
          {
            key: "track",
            label: "Track",
            value:
              lastRun?.track?.name ??
              lastRun?.trackNameSnapshot ??
              props.wizardCandidate?.trackName ??
              "—",
          },
          {
            key: "tires",
            label: "Tires",
            value: lastRun
              ? lastRun.tireTypeId || lastRun.tireType
                ? displayTireSelection({
                    tireTypeId: lastRun.tireTypeId ?? lastRun.tireType?.id ?? "",
                    displayName: lastRun.tireType?.displayName,
                    tireRunNumber: lastRun.tireRunNumber,
                    tireAgeKnown: lastRun.tireAgeKnown ?? true,
                  })
                : "—"
              : "…",
          },
          {
            key: "prep",
            label: "Prep",
            value: lastRun
              ? formatTirePrepLine(
                  Array.isArray(lastRun.tirePrep) && lastRun.tirePrep.length > 0
                    ? normalizeTirePrep(lastRun.tirePrep)
                    : tirePrepFromLegacy(
                        lastRun.warmerTimingMinutes,
                        Boolean(lastRun.additiveTypeId ?? lastRun.additiveType?.id)
                      ),
                  lastRun.additiveType?.displayName ?? null
                ) ?? "—"
              : "…",
          },
          {
            key: "setup",
            label: "Setup",
            // Count through the same derived pass the apply runs, so the
            // promise matches what actually lands (raw-key counts drift ±1).
            value: lastRun
              ? lastRun.setupSnapshot?.data &&
                typeof lastRun.setupSnapshot.data === "object" &&
                Object.keys(lastRun.setupSnapshot.data as object).length > 0
                ? `${Object.keys(setupSnapshotWithDerived(lastRun.setupSnapshot.data)).length} values · as last run`
                : "none saved"
              : "…",
          },
        ]
    : [];
  /** Card shows while there is (or will be) something to offer: the fetched
   *  last run, or the server candidate while the per-car fetch resolves. No
   *  prior run on this car → no card at all. */
  const wizardPrefillCardVisible =
    wizardActive &&
    !isEditing &&
    (lastRun != null ||
      (!replicateLoaded && props.wizardCandidate != null && props.wizardCandidate.carId === carId));

  /** True while the picker still holds what the silent auto-detect chose. */
  const trackAutoDetected = autoDetectedTrackId !== null && trackId === autoDetectedTrackId;

  /** Track picker section — the classic Run-details "Track" face; the wizard
   *  renders it inside the unified Session card instead (v6). Lifted like
   *  prepPanelJsx so both modes share one source. */
  const trackPanelJsx = (
          <div className="space-y-3 pt-1">
            <div className="space-y-1 text-sm">
              {/* Header is the label alone (2026-07-27): the Track library chip was
                  navigation competing with the two real actions, and it broke the
                  Eyebrow's hairline. The library is still linked from the detect
                  failure message below — its one genuinely useful moment. */}
              <Eyebrow dot="muted">Track</Eyebrow>
              {trackLockedToEvent ? (
                <div className="inset-panel-deep px-3 py-2 text-sm text-foreground">
                  {(() => {
                    const t = tracksList.find((x) => x.id === trackId);
                    if (!t) return "—";
                    return `${t.name}${t.location ? ` (${t.location})` : ""}`;
                  })()}
                </div>
              ) : (
                <div className={cn("space-y-2", prefillFieldClass(Boolean(prefillHighlights?.track)))}>
                  <TrackCombobox
                    tracks={tracksList}
                    value={trackId}
                    onChange={(id) => {
                      trackPickedManuallyRef.current = true;
                      wizardCtxTouchedRef.current = true;
                      setTrackId(id);
                      // Layout belongs to a track; clear it so a stale layout from the
                      // previous track can't be submitted, and re-allow event auto-fill.
                      setTrackLayoutId("");
                      setTrackDirection("");
                      layoutPickedManuallyRef.current = false;
                      setCopyTrackWarning(null);
                      setNearbyTrackSuggestions([]);
                      setTrackAutoDetectMessage(null);
                      setAutoDetectedTrackId(null);
                    }}
                    lastRunTrackId={lastRun?.trackId ?? null}
                    favouriteTrackIds={favouriteTrackIds}
                    favouriteTracks={favouriteTracks}
                    placeholder="Select track…"
                    aria-label="Track"
                  />
                  {!isEditing ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Detect earned its keep by disappearing: on a granted-permission
                          mount the auto path has already filled the picker, so the chip
                          gives way to the caption. It comes back the moment the
                          selection changes to anything the auto path didn't choose. */}
                      {trackAutoDetected ? (
                        <span className="flex min-h-8 items-center gap-1 text-[11px] text-muted-foreground">
                          <Check
                            aria-hidden
                            className="size-3.5 text-[#4FD089]"
                            strokeWidth={2.5}
                          />
                          Detected from location
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="flex min-h-8 items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 text-xs font-medium text-foreground transition hover:bg-muted disabled:opacity-60"
                          disabled={trackAutoDetectLoading}
                          onClick={() => void runTrackAutoDetect("manual")}
                        >
                          <LocateFixed aria-hidden className="size-3.5" />
                          {trackAutoDetectLoading ? "Detecting…" : "Detect from location"}
                        </button>
                      )}
                      <InlineNewTrackRow
                        onCreated={(t) => {
                          setTracksList((prev) =>
                            prev.some((x) => x.id === t.id) ? prev : [...prev, t]
                          );
                          trackPickedManuallyRef.current = true;
                          wizardCtxTouchedRef.current = true;
                          setTrackId(t.id);
                          setTrackLayoutId("");
                          setTrackDirection("");
                          layoutPickedManuallyRef.current = false;
                          setCopyTrackWarning(null);
                          setNearbyTrackSuggestions([]);
                          setTrackAutoDetectMessage(null);
                          setAutoDetectedTrackId(null);
                        }}
                      />
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
                      setAutoDetectedTrackId(null);
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
  );

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
      className={cn(
        "max-w-3xl space-y-3",
        // Wizard: clear the fixed F2 bottom bar (all breakpoints — it serves
        // desktop too now).
        wizardActive ? "pb-40" : "pb-16 md:pb-20"
      )}
      onSubmit={(e) => e.preventDefault()}
      noValidate
    >
      {wizardActive ? (
        /* F2 slim recap (founder 2026-07-18): the run's identity in one
           non-interactive line — state, never nav. The old summary card's
           meter/rows/jumps live in the bottom bar + map sheet now; the rail
           is gone on desktop too (the bar serves both). */
        <div className="flex items-center gap-2 px-0.5">
          {wizardMarkedComplete ? (
            <span
              className="shrink-0 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.09em] text-emerald-600 dark:text-emerald-300"
              title="This run is marked complete."
            >
              Complete 🏁
            </span>
          ) : null}
          <span className="min-w-0 truncate font-sans text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {wizardSessionKind}
            {" · "}
            {wizardTrackName ?? (
              <span className="text-amber-600 dark:text-amber-300">track needed</span>
            )}
            {wizardCarName ? ` · ${wizardCarName}` : null}
          </span>
        </div>
      ) : null}
      {wizardActive && props.wizardFirstRun && !isEditing ? (
        /* G1 coach line (founder 2026-07-22): one quiet per-step line for the
           driver's first run only — never a tip card, never a tour. */
        <p className="border-l-2 border-primary py-0.5 pl-3 text-[12.5px] leading-relaxed text-muted-foreground">
          {firstRunCoachLine(wizardStep)}
        </p>
      ) : null}
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

      {isEditing &&
      editRun?.id &&
      editRun.importedLapSets &&
      editRun.importedLapSets.length >= 2 &&
      // Wizard-hosted edit: the field-session recap belongs to the Laps step,
      // not floating above every other step's content.
      (!wizardActive || wizardStep === "laps") ? (
        <div className="space-y-2">
          <ImportedFieldSessionCard importedLapSets={editRun.importedLapSets} />
        </div>
      ) : null}

      {!externalCopyLastRunCard && !isDraft && !isEditing && !wizardActive && copyPreviewRun ? (
        <CopyLastRunCard
          run={copyPreviewRunToPickerRun(copyPreviewRun)}
          applied={lastRunCopyApplied}
          onApply={applyCopyFromPreview}
        />
      ) : null}

      {!wizardActive ? (
        <div className="flex items-center gap-3 pt-2">
          <div className="h-px flex-1 bg-border/60" />
          <Eyebrow dot="muted" className="shrink-0 justify-center">
            Before the run
          </Eyebrow>
          <div className="h-px flex-1 bg-border/60" />
        </div>
      ) : null}

      {/* 2. Session step. Wizard v6 (founder 2026-07-17): the run lands BLANK —
          the manifest card on top OFFERS the car's last run (one tap applies
          it via applyWizardPrefill), and Car + Day type + Event + Track render
          together inside ONE Session card (WizardSessionGroup flattens the
          classic blocks). Classic mode keeps the separate cards. */}
      <div hidden={wizardActive && wizardStep !== "session"} className="space-y-3">
      {wizard ? (
        <>
          <WizardDraftsCard drafts={props.wizardDrafts ?? []} />

          {wizardPrefillCardVisible ? (
            <WizardPrefillCard
              applied={wizardPrefillApplied}
              loading={!replicateLoaded}
              kindLabel={wizardPrefillKindLabel}
              whenIso={wizardPrefillWhenIso}
              rows={wizardPrefillRows}
              note={wizardVenueSwapNote}
              subNote={wizardCarSwapNote}
              onPrefill={applyWizardPrefill}
              onStartBlank={props.onWizardRestart}
              onJump={goToWizardStep}
            />
          ) : null}
        </>
      ) : null}
      <WizardSessionGroup active={wizardActive}>
      {wizard ? (
        <div className="space-y-2">
          {/* Car — the FIRST selection: it decides what the prefill offer
              carries. Changing it mid-context keeps the day and swaps the
              car-bound layers (see handleWizardCarChange). */}
          <Eyebrow dot="muted">Car</Eyebrow>
          <select
            value={carId}
            onChange={(e) => handleWizardCarChange(e.target.value)}
            className="w-full rounded-lg border border-border bg-secondary px-3 py-3 text-sm text-foreground"
            aria-label="Car"
          >
            {carsList.length === 0 ? <option value="">No cars yet</option> : null}
            {carsList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <SurfaceCard
        variant="panel"
        bare={wizardActive}
        overflowHidden={false}
        className={cn(
          "run-section--session",
          isDraft && "border-emerald-500/40",
          prefillFieldClass(Boolean(prefillHighlights?.session)),
          wizardActive && "border-t border-border/60 pt-4"
        )}
        contentClassName="space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {/* Wizard: the unified card is already labelled "Session", so this
                section reads as the day-type choice (artifact round 2). */}
            <Eyebrow dot={wizardActive ? "muted" : undefined}>
              {wizardActive ? "Day type" : "Session type"}
            </Eyebrow>
            <PrefillBadge show={prefillHighlights?.session} />
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
              onChange={(next) => {
                wizardCtxTouchedRef.current = true;
                setSessionType(next);
              }}
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
        <SurfaceCard
          variant="panel"
          bare={wizardActive}
          overflowHidden={false}
          className={cn(
            "run-section--event",
            prefillFieldClass(Boolean(prefillHighlights?.event)),
            wizardActive && "border-t border-border/60 pt-4"
          )}
          contentClassName="space-y-3"
        >
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
              wizardCtxTouchedRef.current = true;
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
              {!selectedEventForRun?.trackId ? null : selectedEventTrackLiveRc ? null : (
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
              {!newEventTrackId ? null : newEventTrackLiveRc ? null : (
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
      {/* Wizard: Track completes the unified Session card (the classic mode
          keeps this content as the Run-details "Track" face). */}
      {wizardActive ? (
        <div className="border-t border-border/60 pt-4">{trackPanelJsx}</div>
      ) : null}
      </WizardSessionGroup>
      </div>

      <div hidden={!wizardShowsDetails}>
      <SurfaceCard
        variant="panel"
        overflowHidden={false}
        className={cn("run-section--details", isDraft && "border-emerald-500/40")}
        contentClassName="space-y-3"
      >
        <div className={cn("flex flex-wrap items-center justify-between gap-2", wizardActive && "hidden")}>
          <div className="flex items-center gap-2">
            <Eyebrow>Run details</Eyebrow>
            <PrefillBadge
              show={
                prefillHighlights?.car ||
                prefillHighlights?.track ||
                prefillHighlights?.tires
              }
            />
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
                const base = tireSummaryLine || "—";
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
          faces={([
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
              tireTypeId={tireTypeId}
              onTireTypeChange={(nextId, displayName) => {
                setTireTypeId(nextId);
                if (displayName != null) setTireTypeName(displayName);
                // The count and the stint are the panel's call now — it derives both
                // from the compound and commits them through `onChange`. Nulling the
                // stint here as well would race that commit.
                setCopyTireWarning(null);
              }}
              preferredTireType={preferredTireType}
              specTireType={specTireType}
              value={{ runsCompleted, ageKnown: tireAgeKnown, stintId: tireStintId }}
              onChange={applyTireStint}
              carId={carId}
              // What a compound pick is measured against — same compound as the
              // last run means the same rubber, one run older.
              lastRunTires={lastRunTires}
              // Another car is another set of tires — an answer given for the old
              // one must not stand over the new car's value.
              resetSignal={carId}
              onPrefillClear={() => setPrefillHighlights((h) => (h ? { ...h, tires: false } : h))}
              copyTireWarning={copyTireWarning}
              prefillFieldClass={prefillFieldClass(Boolean(prefillHighlights?.tires))}
            />
            {wizardActive ? null : prepPanelJsx}
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
              content: trackPanelJsx,
            },
          ] as PagedCardFace[])
            .concat(
              wizardActive
                ? [
                    {
                      id: "prep",
                      label: "Prep",
                      content: <div className="space-y-3 pt-1">{prepPanelJsx}</div>,
                    },
                  ]
                : []
            )
            .filter(
              (f) =>
                !wizardActive ||
                (wizardDetailFaceIds[wizardStep] ?? []).includes(f.id as RunDetailsTab)
            )}
        />
          </>
        )}
      </SurfaceCard>
      </div>

      <div
        ref={setupSectionRef}
        hidden={wizardActive && wizardStep !== "setup"}
      >
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
          ) : !isEditing && setupBaselineData ? (
            // Collapsed via the chevron in the new-run flow. The setup is
            // already chosen, so re-showing the source picker here would be a
            // dead end (no Edit affordance outside draft/edit modes) — show a
            // compact source line with an explicit way back into the sheet.
            <div className="flex max-w-2xl flex-wrap items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs">
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                {setupSource === "previous_runs" && loadedSetupRun
                  ? loadSetupControlLabel
                  : setupSource === "other" && selectedDownloadedSetup
                    ? loadOtherSetupLabel
                    : setupSource === "new"
                      ? "New blank setup"
                      : "Loaded setup"}
              </span>
              <button
                type="button"
                onClick={() => setSetupSectionExpanded(true)}
                className="btn-surface px-2 py-1 text-[11px]"
              >
                Edit
              </button>
            </div>
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
              onChange={(next) => {
                // A hand edit takes ownership of the setup — never let the
                // last-run auto-apply overwrite it.
                setupTouchedByUserRef.current = true;
                setSetupData(applyDerivedFieldsToSnapshot(next));
              }}
              template={setupTemplate}
              enableFieldSearch
            />
            {carId &&
            supportsSheetUpload &&
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

      {!wizardActive ? (
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
      ) : null}

      <div hidden={wizardActive && wizardStep !== "laps"}>
      {wizardStep === "laps" &&
      !wizardLapsIn &&
      (!isEditing || isDraft) ? (
        <div
          role="note"
          className="mb-3 flex flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-2.5"
        >
          <div className="space-y-0.5">
            <p className="text-[13px] font-semibold text-amber-100">
              Haven&apos;t driven yet? Save your draft.
            </p>
            <p className="text-[12px] leading-snug text-amber-100/80">
              Laps come after the run. Save now and this tab is waiting for you —
              finish it trackside when you&apos;ve got your times.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => saveRun(undefined, "draft")}
              className="rounded-md bg-primary px-3 py-1.5 text-[12px] font-bold text-primary-foreground transition hover:brightness-95"
            >
              Save draft
            </button>
          </div>
        </div>
      ) : null}
      <LapTimesIngestPanel
        value={lapIngest}
        onChange={setLapIngest}
        practiceDayUrl={lapTimesLiveRcScanIndexUrl}
        lapImportEventId={sessionType === "RACE_MEETING" && eventId ? eventId : null}
        trackId={trackId.trim() || null}
        trackName={selectedRunTrack?.name ?? null}
        trackLiveRcUrl={selectedRunTrack?.liveRcUrl ?? null}
        trackSpeedhiveUrl={selectedRunTrack?.speedhiveUrl ?? null}
        onTrackTimingUrlsSaved={(next) =>
          setTracksList((prev) =>
            prev.map((t) => (t.id === trackId ? { ...t, ...next } : t))
          )
        }
        editingRunId={isEditing ? editRun?.id ?? null : null}
      />
      </div>

      <div hidden={wizardActive && wizardStep !== "feel"}>
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
        {/* Notes sit outside the paged region so the box is always fully visible
            and free to grow, regardless of which face is showing. */}
        <AutoGrowTextarea
          minRows={3}
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
      </SurfaceCard>
      </div>


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

      {hasTeams && (!wizardActive || wizardStep === "feel") ? (
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
          Saves your changes to this run only. It stays marked complete; the tire run number is not
          updated (it was set when you first clicked Run complete).
        </p>
      ) : null}

      {/* F2 wizard chrome (founder 2026-07-18, docs/design/log-run-navigation.md):
          ONE bottom surface — ‹/step-name/primary row, one-tap ticks, in-place
          progression track — plus the map sheet (rows + saves) and the
          "← Exit" prompt. Serves mobile AND desktop (the rail + pill mirror
          are gone). Portals itself to <body> and stamps the chrome attribute. */}
      {wizardActive ? (
        <LogRunWizardBottomBar
          current={wizardStep}
          statusById={wizardStepStatus}
          onSelect={goToWizardStep}
          rows={wizardSummaryRows}
          editingCompleted={editingCompletedRun}
          canSave={canSave}
          saving={saving}
          saveSuccess={saveSuccess}
          hasContent={wizardHasContent}
          exitOpen={wizardExitPromptOpen}
          onExitOpenChange={setWizardExitPromptOpen}
          onSaveDraft={() => saveRun(undefined, "draft")}
          onComplete={() => saveRun(undefined, "completed")}
          onExitSave={() => {
            // Banks the run (draft, or preserving completion) and leaves —
            // saveRun always navigates to the dashboard after a successful
            // save. The exiting ref stops the popstate guard from re-arming
            // mid-departure; a failed save re-arms it so back-guarding
            // keeps working.
            if (!canSave || saving) return;
            wizardExitingRef.current = true;
            setWizardExitPromptOpen(false);
            void Promise.resolve(
              saveRun(undefined, wizardSaveCompletes ? "completed" : "draft")
            ).finally(() => {
              wizardExitingRef.current = false;
            });
          }}
          onExitDiscard={() => {
            wizardExitingRef.current = true;
            setWizardExitPromptOpen(false);
            router.push("/");
          }}
        />
      ) : null}

      {/* Persistent save actions — pinned bottom-right so they stay reachable
          anywhere in this long form. Portaled to <body> so the app-wide reveal
          transform on `.page-body` children can't trap `fixed` (which stranded
          the bar at the form's bottom). Mobile offset clears the bottom dock
          bar (the Log-run circle is suppressed on run create/edit routes, so
          no collision): dock pad + 3.5rem bar + gap. Desktop floats at the
          viewport corner. */}
      {/* Wizard mode: the F2 bottom bar above is the only chrome — no pill
          mirror on any breakpoint. */}
      {saveBarMounted &&
        !wizardActive &&
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
              aria-busy={saving && !saveSuccess}
              title="Save changes without affecting completion or the tire run count."
            >
              {saveSuccess ? "Saved ✓" : saving ? "Saving…" : "Save edits"}
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
                aria-busy={saving && !saveSuccess}
                title="Save what you have so far and finish logging after the run."
              >
                {saveSuccess ? "Saved ✓" : saving ? "Saving…" : "Save draft"}
              </button>
              <button
                type="button"
                className={cn(
                  fabPillPrimaryClass,
                  (!canSave || saving) && "opacity-70 pointer-events-none"
                )}
                onClick={(e) => saveRun(e, "completed")}
                disabled={!canSave || saving}
                aria-busy={saving && !saveSuccess}
                title="Mark this run finished. It will stop showing up in the incomplete-runs banner."
              >
                {saveSuccess ? "Saved ✓" : saving ? "Saving…" : "Run complete"}
                {!saveSuccess && (
                  <span className="text-sm leading-none" aria-hidden>
                    🏁
                  </span>
                )}
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

