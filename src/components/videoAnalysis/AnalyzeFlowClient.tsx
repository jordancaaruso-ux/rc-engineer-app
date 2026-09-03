"use client";

/**
 * The analyze flow (VIDEO_ANALYSIS_REWORK Phase B, prototype-approved 2026-07-11; reshaped for
 * the desktop 2026-09-02): Set up → Lines → Sync → Scan → Compare as a step rail, with a
 * touch transport (coarse scrub + fine wheel at 1px = 4ms + ±1-frame nudges).
 *
 * Set up is the video and the timing on one screen — they were two steps while the flow was
 * phone-first, and on a monitor that was two half-empty pages. Marking by hand is gone from the
 * rail: the detector reads every driver's quickest ten laps itself (Scan), and the dots that
 * used to be the marking queue are a folded-away check of what it found.
 *
 * Data layer is the existing manual session schema (manualJson v2) and sync
 * math — this component replaces only the UX of UnifiedVideoAnalysisClient.
 * Marks feed the same compare surface as worker results (manualCompareAdapter).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Film,
  FolderOpen,
  Loader2,
  Pause,
  Play,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { uploadVideoToLibrary } from "@/lib/videos/clientUpload";
import { DriverComparePanel } from "@/components/videoAnalysis/DriverComparePanel";
import { DrawLoupe } from "@/components/videoAnalysis/DrawLoupe";
import {
  describeVideoError,
  diagnoseMissingPicture,
} from "@/lib/videos/videoPlaybackDiagnosis";
import { cn } from "@/lib/utils";
import { chipToggleClass } from "@/components/ui/chipToggle";
import type {
  DriverRole,
  ManualDriver,
  ManualScanCandidate,
  ManualScanRow,
  ManualTimingSession,
  ManualVideoSessionV2,
} from "@/lib/manualVideoAnalysis/types";
import {
  lapSfKey,
  LAP_START_LINE_KEY,
  nextRivalRole,
  withSelectedLaps,
} from "@/lib/manualVideoAnalysis/types";
import {
  applyDefaultIsOnVideo,
  applyTop3LapSelection,
  defaultDriverKeys,
  normalizeManualSession,
  pickBestNLapNumbers,
  reconcileTimingSessions,
  seatAddedSession,
  sessionTimeClash,
  setDriverRoles,
  usedRoles,
} from "@/lib/manualVideoAnalysis/timing";
import {
  hasOwnAnchor,
  predictSfStartTime,
  visibleCrossings,
  type VisibleCrossing,
} from "@/lib/manualVideoAnalysis/sync";
import { fitLapsToCrossings } from "@/lib/manualVideoAnalysis/syncFingerprint";
import {
  CLOCK_DISAGREE_SEC,
  predictedCrossingSec,
  predictedLapOneSec,
} from "@/lib/manualVideoAnalysis/wallClock";
import type { FieldDriver } from "@/lib/videoAnalysis/findCrossings/field";
import { blobSource } from "@/lib/videoAnalysis/findCrossings/frameSource";
import { readRecordingStart } from "@/lib/videoAnalysis/findCrossings/mp4";
import {
  findTimingSession,
  hasMarkedLap,
  participants,
  primaryTimingSession,
  referenceAnchoredSession,
  removeParticipant,
  setParticipantAnchor,
  swapDriverRoles,
  updateTimingSession,
  videoTimeAtLapSf,
  type Participant,
} from "@/lib/manualVideoAnalysis/sessionModel";
import { useLocalVideoSource } from "@/lib/videos/useLocalVideoSource";
import {
  compareLaps,
  defaultLapPair,
  formatSignedDeltaSec,
} from "@/lib/videoAnalysis/lapCompare";
import { isScanAborted, type ScanProgress } from "@/lib/videoAnalysis/findCrossings/browserScan";
import { grabThumbnails } from "@/lib/videoAnalysis/findCrossings/frameGrab";
import {
  collectCarOptions,
  defaultPicks,
  foldReasonFor,
  keptStep,
  MIN_SECTOR_GAP_SEC,
  seedsFromChoices,
  type CarOption,
  type IdentifyResult,
} from "@/lib/videoAnalysis/findCrossings/identify";
import { toleranceFor } from "@/lib/videoAnalysis/findCrossings/carColour";
import { ACTIVE_RECIPE, type CrossingEvent } from "@/lib/videoAnalysis/findCrossings/types";
import { bandHalfPxFor, lineGeom } from "@/lib/videoAnalysis/findCrossings/geometry";
import {
  fastestLaps,
  realLaps,
  SF_LINE_KEY,
  type LapInput,
  type Review,
  type SessionLine,
  type SessionMark,
} from "@/lib/videoAnalysis/findCrossings/fromSession";
import {
  CLOCK_CONFIRM_LAPS,
  CLOCK_CONFIRM_SEC,
  findEveryCrossing,
  learnTheLap,
  scanLapStarts,
  sweepStartFinish,
  type FindResult,
  type LearnResult,
  type RunContext,
} from "@/lib/videoAnalysis/findCrossings/run";
import { compareCarsFromManualSession } from "@/lib/videoAnalysis/manualCompareAdapter";

/**
 * The zone drawn while placing a line is the zone the scan reads — one name for both, so a
 * picture can never quietly stop describing what the detector does.
 */
const DRAWN_RECIPE = ACTIVE_RECIPE;

const FRAME_SEC = 1 / 60;
/** Laps read per driver. Ten is a real sample for the averages, and ten chances for a rival to
 *  drift out of step when working out which car is which. */
const SCAN_LAP_COUNT = 10;
/**
 * How much footage one pass of the start-line sweep reads before trying to place people again.
 *
 * Long enough to hold five or six laps of a club track, which is a whole fingerprint; short
 * enough that finding everybody early stops the reading. The sweep costs roughly a second of
 * waiting per second of video, so this is the difference between a minute and five.
 */
const SWEEP_PASS_SEC = 100;
const FINE_SEC_PER_PX = 0.004;

type SectorLineApi = {
  lineKey: string;
  label: string;
  sortOrder: number;
  /** Normalized frame coords (0..1) — drawn guides; absent on legacy lines. */
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
};

/** Editable copy of a sector line while the in-flow editor is open. */
type DraftLine = { lineKey: string; label: string; x1: number; y1: number; x2: number; y2: number };

type JobData = {
  job: {
    id: string;
    track: { id: string; name: string };
    profile: { id: string; name: string };
    runId: string | null;
    videoAssetId?: string | null;
  };
  manual: { session: ManualVideoSessionV2 } | null;
  sectorLines: SectorLineApi[];
};

type LibraryVideo = { id: string; label: string | null; originalFilename: string; bytes: number };

type Step = 1 | 2 | 3 | 4 | 5;
/** The rail, by name — the numbers are an ordering, not something the code should say. */
const STEP = { setup: 1, lines: 2, sync: 3, scan: 4, compare: 5 } as const satisfies Record<string, Step>;
const STEP_LABELS: Record<Step, string> = {
  1: "Set up",
  2: "Lines",
  3: "Sync",
  4: "Scan",
  5: "Compare",
};

/** Tap the picture to walk these: a closer look, closer still, then back out to the whole frame. */
const ZOOM_STEPS = [1, 3.5, 8];

/** A saved set of sector lines for this track (one camera angle / one way of splitting it). */
type LineSet = {
  id: string;
  name: string;
  sectorLines: Array<{ lineKey: string }>;
  updatedAt: string;
  /** Sessions reading this set, this one included. */
  jobCount?: number;
};

type MarkTarget = { role: DriverRole; lapNumber: number; lineKey: string; label: string };

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(3).padStart(6, "0");
  return `${String(m).padStart(2, "0")}:${s}`;
}

/** 1st, 2nd, 3rd … for "which time over the line". */
function ordinal(n: number): string {
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}

/**
 * A driver's initials, for the tightest labels on the screen.
 *
 * The mark grid used to tag a rival's row "R·", which worked while there could only ever be one.
 * With three people on the video a row has to say which of them it is, in the width of a chip.
 */
function initialsOf(name: string | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function AnalyzeFlowClient({
  jobId,
  videoUrlForAsset = (id) => `/api/videos/${encodeURIComponent(id)}/file`,
}: {
  jobId: string;
  /** Debug seam — preview pages substitute a static file for asset streaming. */
  videoUrlForAsset?: (assetId: string) => string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeekRef = useRef(0);

  const [data, setData] = useState<JobData | null>(null);
  const [session, setSession] = useState<ManualVideoSessionV2 | null>(null);
  /** The session as of the latest change, for the debounced save to read when it fires. */
  const sessionRef = useRef<ManualVideoSessionV2 | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const [step, setStep] = useState<Step>(1);
  /** The step was chosen once, on the first load — a reload after switching line sets must
   *  not move the driver off the step they are on. */
  const routedRef = useRef(false);
  // The device file, offered again from the Done step: on desktop Chrome the handle is
  // remembered per job so it is one "Reopen" tap; on a phone it is the camera roll.
  const local = useLocalVideoSource(jobId);
  const doneFileInputRef = useRef<HTMLInputElement | null>(null);
  /** The same ask as the Done step's, on the video steps — see `localFileButton`. */
  const videoStepFileInputRef = useRef<HTMLInputElement | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [library, setLibrary] = useState<LibraryVideo[]>([]);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Scrub path is deliberately outside React state: on a ~1GB phone video every
  // drag event issuing a seek (and a re-render) starves the decoder — the frame
  // never updates and WebKit can kill the page under the churn. One in-flight
  // seek at a time, always retargeted to the newest position; timecode + slider
  // update imperatively.
  const seekTargetRef = useRef<{ t: number; fast: boolean } | null>(null);
  const issuedSeekRef = useRef<number | null>(null);
  const timecodeElRef = useRef<HTMLSpanElement | null>(null);
  const coarseElRef = useRef<HTMLInputElement | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [timingLoading, setTimingLoading] = useState(false);
  const [timingUrls, setTimingUrls] = useState("");
  /** Which time over the start/finish line the Sync step is looking at (1 = the first). */
  const [anchorCrossing, setAnchorCrossing] = useState<number | null>(null);
  /** Whose start/finish crossing the Sync step is currently watching. */
  const [anchorRole, setAnchorRole] = useState<DriverRole>("me");
  const [markCursor, setMarkCursor] = useState(0);
  const [uploadState, setUploadState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // In-flow sector line editor — null when closed. Lines are drawn as overlays
  // on the (fixed-camera) video frame in normalized 0..1 coords.
  const [draftLines, setDraftLines] = useState<DraftLine[] | null>(null);
  /**
   * Whether the unsaved-drawing check has run for this page load. It must run before the
   * effect below is allowed to clear the stored draft, or a fresh mount (draftLines null)
   * would wipe the very drawing it is about to restore.
   */
  const draftCheckedRef = useRef(false);
  const [savingLines, setSavingLines] = useState(false);
  /** The save is paused on "this set is shared — where should the drawing go?" */
  const [saveLinesChoice, setSaveLinesChoice] = useState(false);
  const [lineSets, setLineSets] = useState<LineSet[]>([]);
  const [switchingSet, setSwitchingSet] = useState(false);
  const [videoDims, setVideoDims] = useState<{ w: number; h: number } | null>(null);
  /** The picture's true size, from whichever event first carries it; 0×0 is "not yet", not a size. */
  const readVideoDims = useCallback((v: HTMLVideoElement) => {
    const w = v.videoWidth;
    const h = v.videoHeight;
    if (!w || !h) return;
    setVideoDims((d) => (d && d.w === w && d.h === h ? d : { w, h }));
  }, []);
  const lineDragRef = useRef<{ idx: number; end: 1 | 2 } | null>(null);
  // The ref drives the drag maths every pointer move; this mirrors it for the crosshair,
  // which only has to repaint when a drag starts or ends.
  const [activeHandle, setActiveHandle] = useState<{ idx: number; end: 1 | 2 } | null>(null);
  const overlayElRef = useRef<HTMLDivElement | null>(null);
  // Width of the painted frame on screen, so the detector's band can be drawn at the width it
  // really reads (a fraction of frame width) rather than as a hairline that hides it.
  const [overlayBox, setOverlayBox] = useState({ w: 0, h: 0 });
  const overlayPx = overlayBox.w;
  const overlayRoRef = useRef<ResizeObserver | null>(null);
  // Measured the moment the overlay is attached, not on a later effect: the overlay only exists
  // on the line-bearing steps, so an effect keyed on the video src ran while the element was
  // still null and the size stayed 0 for the whole session.
  const setOverlayEl = useCallback((el: HTMLDivElement | null) => {
    overlayElRef.current = el;
    overlayRoRef.current?.disconnect();
    overlayRoRef.current = null;
    if (!el) {
      setOverlayBox({ w: 0, h: 0 });
      return;
    }
    const read = () => {
      const r = el.getBoundingClientRect();
      setOverlayBox((b) => (b.w === r.width && b.h === r.height ? b : { w: r.width, h: r.height }));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    overlayRoRef.current = ro;
  }, []);

  /**
   * Tap-to-zoom on the picture, for the steps after the lines are drawn.
   *
   * Deciding the frame a car actually crosses a line on is pixel work at arm's length: at phone
   * size the car is a few pixels wide and the line under it thinner than that. Drawing has the
   * loupe; Sync and Mark had nothing, so the picture magnifies itself instead — tap once for a
   * closer look at the spot you tapped, twice for closer still, again to come back out. Zoomed
   * in, a drag walks the picture around.
   *
   * Held as fractions of the frame, never pixels, so a resize or a rotate keeps the same patch.
   */
  const [zoomView, setZoomView] = useState({ z: 1, tx: 0, ty: 0 });
  const zoomDragRef = useRef<{
    x: number;
    y: number;
    tx: number;
    ty: number;
    w: number;
    h: number;
    moved: boolean;
  } | null>(null);

  /** Keeps the picture covering the frame — no black margin can be dragged into view. */
  const clampZoom = (z: number, tx: number, ty: number) => ({
    z,
    tx: Math.min(0, Math.max(1 - z, tx)),
    ty: Math.min(0, Math.max(1 - z, ty)),
  });

  function cycleZoomAt(fx: number, fy: number) {
    setZoomView((v) => {
      const i = ZOOM_STEPS.indexOf(v.z);
      const next = ZOOM_STEPS[(i < 0 ? 0 : i + 1) % ZOOM_STEPS.length]!;
      if (next === 1) return { z: 1, tx: 0, ty: 0 };
      // The point under the finger, read back into picture fractions, put at the middle.
      const cx = (fx - v.tx) / v.z;
      const cy = (fy - v.ty) / v.z;
      return clampZoom(next, 0.5 - next * cx, 0.5 - next * cy);
    });
  }

  function zoomPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Play/pause and anything else with its own press keeps it.
    if ((e.target as HTMLElement).closest("button")) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width || !r.height) return;
    zoomDragRef.current = {
      x: e.clientX,
      y: e.clientY,
      tx: zoomView.tx,
      ty: zoomView.ty,
      w: r.width,
      h: r.height,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function zoomPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = zoomDragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    // A press that wandered is a drag, not a tap — 6px, so a thumb rolling on the glass while
    // it presses still counts as a tap.
    if (!d.moved && Math.hypot(dx, dy) > 6) d.moved = true;
    if (!d.moved || zoomView.z <= 1) return;
    setZoomView((v) => clampZoom(v.z, d.tx + dx / d.w, d.ty + dy / d.h));
  }

  function zoomPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = zoomDragRef.current;
    zoomDragRef.current = null;
    if (!d || d.moved) return;
    const r = e.currentTarget.getBoundingClientRect();
    cycleZoomAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }
  // Automatic crossing detection — reads the video itself and fills in the unmarked corners.
  const [autoState, setAutoState] = useState<
    "idle" | "learning" | "identifying" | "choosing" | "running" | "review"
  >("idle");
  const [autoLearned, setAutoLearned] = useState<LearnResult | null>(null);
  /** What the sweep made of each added driver — one line per person, found or not. */
  const [findState, setFindState] = useState<"idle" | "running">("idle");
  const [findOutcomes, setFindOutcomes] = useState<
    Array<{ role: DriverRole; name: string; found: boolean; note: string }> | null
  >(null);
  /** Drivers the clock has already been tried for on this recording — once each, not on every render. */
  const clockTriedRef = useRef<Set<string>>(new Set());
  /** Which of two same-rhythm candidates the driver picked, per line. */
  const [autoChoice, setAutoChoice] = useState<Record<string, number>>({});
  const [autoProgress, setAutoProgress] = useState<ScanProgress | null>(null);
  const [autoReview, setAutoReview] = useState<Review | null>(null);
  /** Every car that crossed each line on one lap, with a picture of each — see identify.ts. */
  const [identify, setIdentify] = useState<IdentifyResult | null>(null);
  const [identifyThumbs, setIdentifyThumbs] = useState<Record<string, string | null>>({});
  const [identifyPick, setIdentifyPick] = useState<Record<string, CarOption>>({});
  /** Lines where the driver asked to see the cars the timing says are somebody else's. */
  const [identifyShowAll, setIdentifyShowAll] = useState<Record<string, boolean>>({});
  /** What the screen picked on its own, by line key — a decided line shows that picture alone. */
  const [identifyAuto, setIdentifyAuto] = useState<Record<string, number>>({});
  /** Set when every line was decided and the picker was skipped — the review says so. */
  const [identifySkipped, setIdentifySkipped] = useState(false);
  const [identifyRole, setIdentifyRole] = useState<DriverRole>("me");
  /**
   * Offsets the driver settled by looking, kept per driver.
   *
   * Pooling one set across both would mean whichever car was identified last decided where the
   * other one was searched for — which is the exact mistake this screen exists to undo.
   */
  const [seenSeeds, setSeenSeeds] = useState<Partial<Record<DriverRole, Record<string, number>>>>(
    {}
  );
  /** Which way through each line is the corner, as far as a tap at the picker has said. */
  const [seenDirs, setSeenDirs] = useState<Partial<Record<string, 1 | -1>>>({});
  const [autoNotes, setAutoNotes] = useState<string[]>([]);
  const [autoError, setAutoError] = useState<string | null>(null);
  const autoAbortRef = useRef<AbortController | null>(null);

  /* ---------- load ---------- */

  const load = useCallback(async () => {
    const res = await fetch(`/api/video-analysis/jobs/${jobId}`);
    if (!res.ok) return;
    const json = (await res.json()) as JobData;
    setData(json);
    // The links already pasted live on their chips; the box stays empty for the next one. (It
    // used to be refilled with every stored link, from when the lane was a textarea — so a
    // reopened job offered "+" on a driver who was already on the video.)
    const s = json.manual?.session ? normalizeManualSession(json.manual.session) : null;
    if (s) setSession(s);
    if (json.job.videoAssetId) {
      setVideoSrc(videoUrlForAsset(json.job.videoAssetId));
    }
    if (routedRef.current) return;
    routedRef.current = true;
    // Resume at the furthest sensible step. Geometry (Lines) comes before the
    // temporal steps now: not yet anchored → Lines; anchored → Scan (its no-lines
    // fallback routes back to Lines if a resumed session somehow has no corners).
    const anchored = s ? Boolean(referenceAnchoredSession(s)) : false;
    // An analysis that already has sectors opens on its compare, video or not. The video
    // usually lives on the phone and is never uploaded, so every revisit used to land on "Pick
    // the video" and walk the driver back through timing, lines and sync for work the session
    // already holds. The numbers come from the marks; the picture is only needed to WATCH a
    // sector, and the Compare step asks for it there.
    const finished =
      anchored && s != null && hasMarkedLap(s, json.sectorLines.map((l) => l.lineKey));
    if (finished) {
      setStep(STEP.compare);
    } else if (json.job.videoAssetId && s && s.timingSessions.length > 0) {
      setStep(anchored ? STEP.scan : STEP.lines);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const loadLineSets = useCallback(async (trackId: string) => {
    const res = await fetch(`/api/tracks/${trackId}/camera-profiles`);
    if (!res.ok) return;
    const json = (await res.json()) as { profiles?: LineSet[] };
    setLineSets(json.profiles ?? []);
  }, []);

  useEffect(() => {
    if (data?.job.track.id) void loadLineSets(data.job.track.id);
  }, [data?.job.track.id, loadLineSets]);

  useEffect(() => {
    void load();
    void fetch("/api/videos")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setLibrary((d?.videos ?? []) as LibraryVideo[]))
      .catch(() => {});
    return () => {
      // The local file's object URL is NOT revoked here. This cleanup also runs on a dev-server
      // hot reload, which keeps `videoSrc` (state survives) while killing the URL it points at —
      // every <video> then fails with "source not supported" and the driver reads "can't play
      // this video file" (2026-08-28, after an afternoon of saves under him). The URL is
      // replaced in setVideoFile and dies with the document; that is enough.
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [load]);

  /* ---------- an unsaved drawing survives the page ---------- */

  // Lines being drawn live only in React state until Save. A reload — a phone tab evicted, a
  // dev-server rebuild, a mis-tap on Close — threw the whole drawing away and put the saved set
  // back on screen, which the driver met as "I just drew accurate lines and now they've
  // reverted" (three times, 2026-08-28). So the drawing is mirrored to this browser as it
  // changes and offered back once the video is on screen again. Cleared on Save and Cancel.
  useEffect(() => {
    if (!data || !videoSrc || draftCheckedRef.current) return;
    draftCheckedRef.current = true;
    try {
      const raw = window.localStorage.getItem(`rc_lines_draft_${jobId}`);
      if (!raw) return;
      const saved = JSON.parse(raw) as { lines?: DraftLine[]; profileId?: string };
      if (!Array.isArray(saved.lines) || saved.lines.length === 0) return;
      setDraftLines(saved.lines);
      setMsg(
        saved.profileId && saved.profileId !== data.job.profile.id
          ? "Restored the lines you were drawing but had not saved. They were started on a different set — check, then save or cancel."
          : "Restored the lines you were drawing but had not saved — save them, or cancel to drop them."
      );
    } catch {
      // Storage unavailable: nothing to restore, nothing lost that was ever kept.
    }
  }, [data, videoSrc, jobId]);

  useEffect(() => {
    if (!draftCheckedRef.current) return;
    try {
      if (draftLines) {
        window.localStorage.setItem(
          `rc_lines_draft_${jobId}`,
          JSON.stringify({ at: Date.now(), profileId: data?.job.profile.id, lines: draftLines })
        );
      } else {
        window.localStorage.removeItem(`rc_lines_draft_${jobId}`);
      }
    } catch {
      // Same: a browser that refuses storage just loses the safety net, not the drawing.
    }
  }, [draftLines, jobId, data?.job.profile.id]);

  /* ---------- persistence (same contract as the legacy client) ---------- */

  async function persistSession(next: ManualVideoSessionV2) {
    const normalized = normalizeManualSession(next);
    sessionRef.current = normalized;
    setSession(normalized);
    setSaving(true);
    const res = await fetch(`/api/video-analysis/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manualJson: normalized }),
    });
    setSaving(false);
    if (!res.ok) setMsg("Failed to save");
  }

  /**
   * Save soon, and save what is CURRENT when the timer fires — not the object handed in.
   *
   * Picking the video schedules a save of the session as it was at that moment. With the video
   * and the timing on one screen, "This run's laps" can be pressed inside that half-second, and
   * the timer then wrote the pre-timing snapshot over the loaded laps: the chips vanished and the
   * next link pasted became "you" (found driving the merged step, 2026-09-02). A patch form takes
   * the latest session, and the timer reads the latest again when it fires.
   */
  function schedulePersist(
    next: ManualVideoSessionV2 | ((prev: ManualVideoSessionV2) => ManualVideoSessionV2)
  ) {
    const resolved = typeof next === "function" ? (sessionRef.current ? next(sessionRef.current) : null) : next;
    if (!resolved) return;
    sessionRef.current = resolved;
    setSession(resolved);
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      const current = sessionRef.current;
      if (current) void persistSession(current);
    }, 500);
  }

  /* ---------- video + transport ---------- */

  function syncTransportUi(t: number) {
    if (timecodeElRef.current) timecodeElRef.current.textContent = fmtClock(t);
    if (coarseElRef.current && document.activeElement !== coarseElRef.current) {
      coarseElRef.current.value = String(t);
    }
  }

  /** Issue the newest pending seek — but never while one is already in flight.
   * `fast` uses fastSeek (nearest keyframe) where available: right for coarse
   * dragging, wrong for precision moves. */
  function pumpSeek() {
    const v = videoRef.current;
    const target = seekTargetRef.current;
    if (!v || !target || v.seeking || v.readyState === 0) return;
    if (Math.abs(v.currentTime - target.t) < 0.001) {
      seekTargetRef.current = null;
      return;
    }
    issuedSeekRef.current = target.t;
    const vv = v as HTMLVideoElement & { fastSeek?: (t: number) => void };
    if (target.fast && typeof vv.fastSeek === "function") vv.fastSeek(target.t);
    else v.currentTime = target.t;
  }

  function onVideoSeeked() {
    const target = seekTargetRef.current;
    if (!target) return;
    if (issuedSeekRef.current !== target.t) {
      // A newer position arrived while the last seek decoded — chase it.
      pumpSeek();
      return;
    }
    if (target.fast) {
      // Keyframe accuracy is the point while dragging; don't re-seek exactly.
      seekTargetRef.current = null;
      return;
    }
    pumpSeek();
  }

  function requestSeek(sec: number, opts?: { fast?: boolean }) {
    const v = videoRef.current;
    const max = v?.duration || duration || Number.MAX_SAFE_INTEGER;
    const t = Math.max(0, Math.min(max, sec));
    lastSeekRef.current = t;
    seekTargetRef.current = { t, fast: opts?.fast ?? false };
    syncTransportUi(t);
    if (v && !v.paused) v.pause();
    if (playing) setPlaying(false);
    pumpSeek();
  }

  function seekTo(sec: number) {
    requestSeek(sec, { fast: false });
  }

  /** Where the user *intends* the playhead to be: the pending seek target wins
   * over the video's (possibly still-decoding) currentTime. Anchors, pins, and
   * marks must read this, or a tap mid-seek records a stale frame. */
  function playheadTime(): number {
    return seekTargetRef.current?.t ?? videoRef.current?.currentTime ?? lastSeekRef.current;
  }

  function nudge(deltaSec: number) {
    // Base on the pending target so rapid nudges accumulate even while a seek
    // is still decoding.
    requestSeek(playheadTime() + deltaSec, { fast: false });
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      v.pause();
      setPlaying(false);
    }
  }

  function setVideoFile(file: File | null) {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPickedFile(file);
    if (!file) {
      setVideoSrc(null);
      return;
    }
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setVideoSrc(url);
    schedulePersist((prev) => ({ ...prev, localVideoName: file.name }));
    void rememberRecordingStart(file);
  }

  /**
   * When the recording began, read from the file's own header and kept with the session.
   *
   * It is the one fact that ties the video to wall-clock time, and with it a practice session's
   * LiveRC stamp says where that driver's lap 1 is on the footage before anyone taps anything —
   * `wallClock.ts`. A file with no usable date clears the field rather than leaving a stale one
   * from another video.
   */
  async function rememberRecordingStart(file: File) {
    const started = await readRecordingStart(blobSource(file));
    schedulePersist((prev) => ({
      ...prev,
      localVideoRecordedAtIso: started ? started.toISOString() : null,
    }));
  }

  async function pickLibraryAsset(asset: LibraryVideo) {
    setVideoSrc(videoUrlForAsset(asset.id));
    setPickedFile(null);
    // Durable link: re-opening this session streams the asset, no re-picking.
    await fetch(`/api/video-analysis/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoAssetId: asset.id }),
    }).catch(() => {});
    schedulePersist((prev) => ({ ...prev, localVideoName: asset.originalFilename }));
  }

  // Footage opened from the Done step — a re-pick, or Reopen of the remembered file — becomes
  // the flow's video: the sector players get it and the rail's video steps unlock again.
  useEffect(() => {
    if (!local.url) return;
    setVideoSrc(local.url);
    setPickedFile(local.file);
    const name = local.file?.name;
    if (name) schedulePersist((prev) => ({ ...prev, localVideoName: name }));
    if (local.file) void rememberRecordingStart(local.file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.url]);

  // A reopened job points the player at the UPLOADED copy (see `load`), and marking is nothing
  // but seeking: every jump on a 29-minute file is then a fresh network fetch, measured at
  // ~1.8MB and a beat of lag each, against nothing at all for a file on this device. So if the
  // browser still holds permission for the remembered handle, take the local copy back without
  // asking. When it doesn't, this is silent and `localFileButton` offers the tap that can.
  const reopenedLocalRef = useRef(false);
  useEffect(() => {
    if (reopenedLocalRef.current || !local.rememberedName || local.url) return;
    reopenedLocalRef.current = true;
    void local.reopenIfGranted();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.rememberedName, local.url]);

  /** The player is on the uploaded copy: same footage, but every scrub is a round trip. */
  const playingUploadedCopy = Boolean(videoSrc) && !videoSrc!.startsWith("blob:");

  /* ---------- timing ---------- */

  function applyTimingSessions(
    loaded: ManualTimingSession[],
    drivers: ManualDriver[],
    defaults: { meKey: string; competitorKey: string },
    source: "run" | "url",
    urls?: string[]
  ) {
    if (!session) return;
    let comp = defaults.competitorKey;
    if (defaults.meKey && defaults.meKey === comp) {
      comp = drivers.find((x) => x.key !== defaults.meKey)?.key ?? "";
    }
    // Reloading the same timing keeps its identity — the marks and the sync anchor hang off the
    // session id, and minting a new one left them pointing at a session that no longer existed.
    const reconciled = reconcileTimingSessions(
      session.timingSessions,
      loaded.map((ts) => ({ ...ts, drivers: setDriverRoles(ts.drivers, defaults.meKey, comp) }))
    );
    const timingSessions = applyDefaultIsOnVideo(reconciled.sessions);
    // Anything still keyed to a session that was genuinely replaced is stale: its lap numbers
    // mean something else now. Cleared, and said out loud — never left in the file to be found
    // by a later scan.
    const live = new Set(timingSessions.map((ts) => ts.sessionId));
    const keptMarks = session.marks.filter((m) => live.has(m.sessionId));
    const droppedMarks = session.marks.length - keptMarks.length;
    const next = normalizeManualSession(
      applyTop3LapSelection({
        ...session,
        timingSource: source,
        timingUrls: source === "url" ? urls ?? [] : session.timingUrls,
        timingSessions,
        marks: keptMarks,
        ...(droppedMarks ? { lastScan: undefined } : {}),
        compare: { ...session.compare, my: null, competitor: null, offsetNudgeSec: 0 },
      })
    );
    void persistSession(next);
    const carried = timingSessions.filter((ts) =>
      session.timingSessions.some((p) => p.sessionId === ts.sessionId)
    ).length;
    setMsg(
      droppedMarks
        ? `Different timing — ${droppedMarks} mark${droppedMarks === 1 ? "" : "s"} from the previous session cleared.`
        : carried
          ? "Same timing reloaded — your marks and sync are kept."
          : null
    );
  }

  async function loadRunTiming() {
    if (!data?.job.runId) return;
    setTimingLoading(true);
    try {
      const res = await fetch(
        `/api/video-analysis/manual/session-drivers?runId=${encodeURIComponent(data.job.runId)}`
      );
      const d = (await res.json().catch(() => ({}))) as {
        error?: string;
        sessions?: ManualTimingSession[];
        drivers?: ManualDriver[];
        defaults?: { meKey: string; competitorKey: string };
      };
      if (!res.ok) throw new Error(d.error || "Could not load run laps");
      const drivers = d.drivers ?? [];
      applyTimingSessions(
        d.sessions ?? [],
        drivers,
        d.defaults ?? defaultDriverKeys(drivers),
        "run"
      );
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not load run laps");
    } finally {
      setTimingLoading(false);
    }
  }

  /**
   * Add one link, and with it one more person on the video.
   *
   * The first link sets the analysis up: a race result brings the whole heat and the driver picks
   * a rival out of it, exactly as before. Every link after that is somebody else — a LiveRC
   * practice page holds precisely one driver's laps, so the only way to have three people off
   * practice footage is three links, and each takes the next free seat.
   */
  async function addTimingUrl() {
    const url = timingUrls.trim();
    if (!url) {
      setMsg("Paste a LiveRC link first.");
      return;
    }
    setTimingLoading(true);
    try {
      const res = await fetch("/api/video-analysis/manual/parse-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: [url] }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        error?: string;
        sessions?: ManualTimingSession[];
        drivers?: ManualDriver[];
        defaults?: { meKey: string; competitorKey: string };
        primaryDriverName?: string | null;
      };
      if (!res.ok) throw new Error(d.error || "Could not load timing");
      const loaded = d.sessions ?? [];
      if (loaded.length === 0) throw new Error("No laps found at that link");

      if (roster.length === 0) {
        const drivers = d.drivers ?? [];
        applyTimingSessions(loaded, drivers, d.defaults ?? defaultDriverKeys(drivers), "url", [url]);
      } else {
        addAnotherDriver(loaded, url, d.primaryDriverName ?? null);
      }
      setTimingUrls("");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not load timing");
    } finally {
      setTimingLoading(false);
    }
  }

  /**
   * Seat the driver a link is about beside the people already on the video.
   *
   * The first link pasted is "you" because nothing else can be — but it need not stay so. When a
   * later link is plainly the driver's own (the name on it matches the LiveRC name in Settings)
   * and the seat marked "you" is not, the two change places on the spot; the chips also carry
   * "That's me" for the case nobody's settings can decide.
   */
  function addAnotherDriver(
    loaded: ManualTimingSession[],
    url: string,
    primaryDriverName: string | null
  ) {
    if (!session) return;
    let next = session;
    const added: string[] = [];
    const notes: string[] = [];
    const wanted = primaryDriverName?.trim().toLowerCase() || null;
    const looksLikeMe = (name: string) => {
      if (!wanted) return false;
      const n = name.trim().toLowerCase();
      return n === wanted || n.includes(wanted) || wanted.includes(n);
    };

    for (const ts of loaded) {
      const seat = ts.drivers.find((d) => d.role === "me") ?? ts.drivers[0];
      if (!seat) continue;
      if (participants(next).some((p) => p.driver.normalizedName === seat.normalizedName)) {
        notes.push(`${seat.driverName} is already on this video.`);
        continue;
      }
      const role = nextRivalRole(usedRoles(next.timingSessions));
      next = {
        ...next,
        timingSessions: [...next.timingSessions, seatAddedSession(ts, role, seat.key)],
        timingUrls: [...(next.timingUrls ?? []), url],
      };
      added.push(seat.driverName);
      const meNow = participants(next).find((p) => p.role === "me");
      if (looksLikeMe(seat.driverName) && meNow && !looksLikeMe(meNow.driver.driverName)) {
        next = swapDriverRoles(next, "me", role);
        notes.push(`${seat.driverName} is you.`);
      }
      // Only a sanity check — LiveRC prints the session time to the minute, which places nobody.
      // Worth saying out loud all the same, because a link from a different part of the day is a
      // far likelier mistake than a scan that quietly finds nothing.
      const clash = sessionTimeClash(next.timingSessions, ts.sessionId);
      if (clash) notes.push(clash);
    }

    if (added.length === 0) {
      setMsg(notes.join(" ") || "Nothing to add from that link.");
      return;
    }
    void persistSession(next);
    setMsg([`${added.join(", ")} added.`, ...notes].join(" "));
  }

  function dropParticipant(role: DriverRole) {
    if (!session) return;
    const who = roster.find((p) => p.role === role)?.driver.driverName ?? "That driver";
    if (role === "me") {
      setMsg("Your own laps are what the analysis is built on — load different timing instead.");
      return;
    }
    void persistSession(removeParticipant(session, role));
    setMsg(`${who} removed.`);
  }

  /**
   * Say who the sector times are measured against.
   *
   * Nothing picks this for you any more. A heat import brings the whole field, and the app used to
   * take whoever the timing site listed first — so a comparison the driver never asked for became
   * the one every number was built on. Empty key means nobody, which is a legitimate answer: your
   * own sector times stand on their own.
   */
  function chooseRival(key: string) {
    if (!session || !primary || !meDriver) return;
    const timingSessions = session.timingSessions.map((ts) =>
      ts.sessionId === primary.sessionId
        ? { ...ts, drivers: setDriverRoles(ts.drivers, meDriver.key, key) }
        : ts
    );
    const rival = timingSessions
      .find((ts) => ts.sessionId === primary.sessionId)
      ?.drivers.find((d) => d.role === "competitor");
    void persistSession({
      ...session,
      timingSessions,
      selectedLaps: withSelectedLaps(
        session.selectedLaps,
        "competitor",
        rival ? pickBestNLapNumbers(rival.laps, 3) : []
      ),
      compare: { ...session.compare, competitor: null },
    });
  }

  /**
   * "That's me": the tapped driver takes the seat marked "you", and whoever held it takes theirs.
   *
   * Everything already filed under either seat goes with its person — see `swapDriverRoles`.
   */
  function makeMe(role: DriverRole) {
    if (!session || role === "me") return;
    const who = roster.find((p) => p.role === role)?.driver.driverName ?? "That driver";
    void persistSession(swapDriverRoles(session, "me", role));
    setMsg(`${who} is you.`);
  }

  /* ---------- sync ---------- */

  /**
   * Everyone this video is being read for, in the order they were added.
   *
   * A race link puts them all in one timing session; several practice links put each in their
   * own. Nothing below needs to know which, and that is the point of the list — the screen used
   * to reach into one session for exactly two drivers, which is why every extra link loaded and
   * then did nothing.
   */
  const roster = useMemo<Participant[]>(() => (session ? participants(session) : []), [session]);
  const primary = session ? primaryTimingSession(session) : undefined;
  const meDriver = roster.find((p) => p.role === "me")?.driver;
  const rivals = roster.filter((p) => p.role !== "me");
  const compDriver = rivals[0]?.driver;
  const anchored = session ? Boolean(referenceAnchoredSession(session)) : false;

  const anchorParticipant = roster.find((p) => p.role === anchorRole) ?? roster[0];
  const anchorDriver = anchorParticipant?.driver;

  /** Which timing session a driver's marks and sync belong to. */
  function sessionIdFor(role: DriverRole): string | undefined {
    return roster.find((p) => p.role === role)?.sessionId ?? primary?.sessionId;
  }

  /**
   * Every time this driver's car goes over the start/finish line, first time first.
   *
   * It used to offer LAPS, and called the chosen moment "L1 start" — which in a race it is not:
   * lap 1 is timed from the tone, so the car's first time over the loop is the END of lap 1. The
   * driver did the natural thing, scrubbed to the car on the line, and every lap start in the app
   * then ran 1.386s late for every driver, with the start/finish window reading whoever crossed
   * behind. A driver can see a car go over a line; nobody can see a tone. So the question is
   * which crossing this is, and the lap is worked out from the timing.
   */
  const crossings = useMemo<VisibleCrossing[]>(
    () => (anchorDriver ? visibleCrossings(anchorDriver) : []),
    [anchorDriver]
  );

  useEffect(() => {
    if (crossings.length === 0) return;
    if (anchorCrossing != null && crossings.some((c) => c.index === anchorCrossing)) return;
    setAnchorCrossing(crossings[0]!.index);
  }, [crossings, anchorCrossing]);

  function crossingVideoTime(role: DriverRole, c: VisibleCrossing): number | null {
    const sessionId = sessionIdFor(role);
    if (!session || !sessionId) return null;
    return videoTimeAtLapSf(session, sessionId, role, c.lapNumber, c.anchorKind);
  }

  function lapStartVideoTime(role: DriverRole, lapNumber: number): number | null {
    const sessionId = sessionIdFor(role);
    if (!session || !sessionId) return null;
    return videoTimeAtLapSf(session, sessionId, role, lapNumber, "sf_start");
  }

  /**
   * Tie the timing clock to the video clock at one moment.
   *
   * Your own anchor also becomes the session's shared one, because in a race everybody leaves
   * together and one point then places the whole field. A rival's anchor is stored against the
   * rival alone: it is the only way to say "that is when THEY went past" when the two of you did
   * not start together, and it beats the shared assumption for that driver wherever both exist.
   */
  function setAnchorAtPlayhead() {
    const crossing = crossings.find((c) => c.index === anchorCrossing);
    if (!session || !crossing) return;
    const t = playheadTime();
    const next = setParticipantAnchor(session, anchorRole, {
      videoTimeSec: t,
      lapNumber: crossing.lapNumber,
      driverRole: anchorRole,
      anchorKind: crossing.anchorKind,
    });
    void persistSession(next);
    const who = anchorRole === "me" ? "Your" : `${anchorDriver?.driverName ?? "The rival"}'s`;
    setMsg(`${who} ${ordinal(crossing.index)} crossing anchored @ ${t.toFixed(3)}s.`);
  }

  /**
   * Is this driver's timing on the video clock at all?
   *
   * The anchor has to be on their OWN timing session. A shared one speaks for everybody in the
   * session it sits in, because a race field leaves together — it says nothing about somebody
   * imported from a separate practice link, whose transponder clock starts whenever they pressed
   * go. Treating that as placement would hand every window a plausible-looking time pointing at
   * the wrong stretch of footage.
   */
  function isPlaced(p: Participant): boolean {
    return Boolean(p.timingSession.sync.anchor || p.timingSession.sync.anchorByRole?.[p.role]);
  }

  /** Everyone on the video whose clock has not been tied to it yet. */
  const unplaced = roster.filter((p) => p.role !== "me" && !isPlaced(p));

  /**
   * Where the wall clock puts each driver's lap 1 — `wallClock.ts`.
   *
   * A practice page stamps its start to the second and the file stamps when recording began;
   * the difference is that driver's first crossing, good to about a second, before anybody taps.
   * Only practice sessions, and only once the file's date has been read.
   */
  const clockLapOne = useMemo(() => {
    const out = new Map<DriverRole, number>();
    const recorded = session?.localVideoRecordedAtIso;
    if (!recorded) return out;
    for (const p of roster) {
      const t = predictedLapOneSec(p.timingSession, p.driver, recorded, duration || null);
      if (t != null) out.set(p.role, t);
    }
    return out;
  }, [session, roster, duration]);

  /** Everyone still to place, you included, whom the clock can place or the sweep can find. */
  const toPlace = roster.filter(
    (p) => !isPlaced(p) && (clockLapOne.has(p.role) || (anchored && p.role !== "me"))
  );

  /**
   * The selected driver's anchor, where the timing clock disagrees with it.
   *
   * Shown, never enforced: the tap stands, the line says where the clock puts that crossing,
   * and one press hands the driver to the clock. On IMG_4521 a crossing tapped 35s before the
   * driver's session had even begun cost him every sector, and the clock knew all along.
   */
  const clockDisagreement = useMemo(() => {
    const sync = anchorParticipant?.timingSession.sync;
    const a = sync?.anchorByRole?.[anchorRole] ?? (anchorRole === "me" ? sync?.anchor : undefined);
    const lapOne = clockLapOne.get(anchorRole);
    if (!a || lapOne == null || !anchorDriver) return null;
    const predicted = predictedCrossingSec(lapOne, anchorDriver, a.lapNumber, a.anchorKind);
    if (predicted == null || Math.abs(a.videoTimeSec - predicted) <= CLOCK_DISAGREE_SEC) return null;
    const index = crossings.find((c) => c.lapNumber === a.lapNumber && c.anchorKind === a.anchorKind)?.index;
    return { index, predictedSec: predicted };
  }, [anchorParticipant, anchorRole, anchorDriver, clockLapOne, crossings]);

  /** The stretch of footage worth watching for the sweep: your laps as `next` has them, plus a lap either side. */
  function lapSpanFrom(next: ManualVideoSessionV2): { fromSec: number; toSec: number } | null {
    const me = participants(next).find((p) => p.role === "me");
    if (!me) return null;
    const laps = realLaps([...me.driver.laps]);
    const times: number[] = [];
    for (const l of laps) {
      const at = videoTimeAtLapSf(next, me.sessionId, "me", l.lapNumber, "sf_start");
      if (at != null) times.push(at, at + l.lapTimeSec);
    }
    if (times.length === 0) return null;
    const pad = Math.max(...laps.map((l) => l.lapTimeSec), 20);
    return { fromSec: Math.min(...times) - pad, toSec: Math.max(...times) + pad };
  }

  // The clock's placements run themselves: the moment the Sync step has a video and somebody the
  // clock can place, the start line is checked where the clock says — once per driver per
  // recording. A hand tap is still there for anyone it cannot place or does not find.
  useEffect(() => {
    if (step !== STEP.sync || !videoSrc || !videoDims) return;
    if (findState !== "idle" || autoState !== "idle") return;
    const recorded = session?.localVideoRecordedAtIso;
    if (!recorded) return;
    const due = roster.filter(
      (p) => !isPlaced(p) && clockLapOne.has(p.role) && !clockTriedRef.current.has(`${p.role}@${recorded}`)
    );
    if (due.length === 0) return;
    for (const p of due) clockTriedRef.current.add(`${p.role}@${recorded}`);
    void findAddedDrivers();
    // findAddedDrivers and isPlaced read the same state these deps name.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, videoSrc, videoDims, findState, autoState, session, roster, clockLapOne]);

  /**
   * Work out where the added drivers are, without asking anyone to spot a stranger's car.
   *
   * Watch the start/finish line right through, keep every crossing whoever made it, then lay each
   * driver's lap times over that list and see where they fit. Their times are irregular enough to
   * only fit in one place — and where they fit in two, nothing is written and the screen says so,
   * which is the whole reason the manual sync is still on this step.
   */
  async function findAddedDrivers(people: Participant[] = toPlace) {
    if (!session || findState === "running") return;
    if (people.length === 0) return;
    setFindState("running");
    setFindOutcomes(null);
    setAutoError(null);
    autoAbortRef.current = new AbortController();
    try {
      const ctx = runContext();
      if (!ctx) throw new Error("The video is not ready yet.");

      let next = session;
      const found = new Map<DriverRole, { name: string; note: string }>();
      let starved = 0;
      const nameOf = (p: Participant) => (p.role === "me" ? "You" : p.driver.driverName);
      const place = (p: Participant, fit: NonNullable<ReturnType<typeof fitLapsToCrossings>>, how: string) => {
        next = setParticipantAnchor(next, p.role, {
          videoTimeSec: fit.anchorVideoTimeSec,
          lapNumber: fit.anchorLapNumber,
          driverRole: p.role,
          // A practice session's first crossing STARTS lap 1 — see `visibleCrossings`.
          anchorKind: "sf_start",
        });
        found.set(p.role, {
          name: nameOf(p),
          note: `${fit.matched} of ${fit.of} laps line up, to ${Math.round(fit.medianErrorSec * 1000)}ms.`,
        });
        console.debug(
          `[sync] ${p.role} ${p.driver.driverName} (${how}): lap1 @ ${fit.lapOneStartSec.toFixed(3)}s · ${fit.matched}/${fit.of} · median ${(fit.medianErrorSec * 1000).toFixed(0)}ms · margin ${fit.marginLaps.toFixed(1)}`
        );
      };

      // 1. The clock first, for everyone it can place — you included. Eight short windows on the
      //    start line where the clock says the opening laps begin, then the lap times decide
      //    whose crossings those were. No tap, and a fraction of the sweep's reading.
      for (const p of people) {
        const lapOne = clockLapOne.get(p.role);
        if (lapOne == null) continue;
        const laps = [...p.driver.laps]
          .filter((l) => l.lapTimeSec > 0)
          .sort((a, b) => a.lapNumber - b.lapNumber);
        const opening = laps.slice(0, CLOCK_CONFIRM_LAPS);
        const starts: Array<{ lapNumber: number; startSec: number }> = [];
        let t = lapOne;
        for (const l of opening) {
          starts.push({ lapNumber: l.lapNumber, startSec: t });
          t += l.lapTimeSec;
        }
        const seen = await scanLapStarts(ctx, { role: p.role, starts });
        starved += seen.starvedSegments;
        const fit = fitLapsToCrossings(opening, seen.crossingsSec);
        console.debug(
          `[sync] clock ${p.role} ${p.driver.driverName}: lap1 predicted ${lapOne.toFixed(1)}s · ${seen.crossingsSec.length} crossings in ${starts.length} windows · fit ${fit ? `${fit.lapOneStartSec.toFixed(3)}s ${fit.matched}/${fit.of}` : "none"}`
        );
        // The fingerprint may only confirm the clock, never wander off it: a lock a lap away
        // would be a different car whose times happened to fit.
        if (fit && Math.abs(fit.lapOneStartSec - lapOne) <= CLOCK_CONFIRM_SEC + 0.5) {
          place(p, fit, "clock");
        }
      }

      // 2. The rest, by the sweep — everyone still unplaced, found relative to your laps.
      const rest = people.filter((p) => p.role !== "me" && !isPlaced(p) && !found.has(p.role));
      const span = rest.length ? lapSpanFrom(next) : null;
      if (rest.length && !span) {
        setMsg("Set your own crossing first — the rest are found relative to your laps.");
      }
      if (rest.length && span) {
        const crossings: number[] = [];
        let framesRead = 0;
        // In passes, not one long read. Everybody who circulates for the whole session is placed
        // by the first couple of minutes, and reading the rest of the file to learn nothing costs
        // about a second of waiting per second of footage. Only somebody still missing extends it.
        for (
          let at = span.fromSec;
          at < span.toSec && rest.some((p) => !found.has(p.role));
          at += SWEEP_PASS_SEC
        ) {
          const pass = await sweepStartFinish(ctx, {
            fromSec: at,
            toSec: Math.min(span.toSec, at + SWEEP_PASS_SEC),
          });
          crossings.push(...pass.crossingsSec);
          framesRead += pass.framesRead;
          starved += pass.starvedSegments;
          if (pass.crossingsSec.length === 0 && pass.framesRead === 0) break;

          for (const p of rest) {
            if (found.has(p.role)) continue;
            const fit = fitLapsToCrossings(p.driver.laps, crossings);
            if (fit) place(p, fit, "sweep");
          }
          console.debug(
            `[sync] swept to ${Math.min(span.toSec, at + SWEEP_PASS_SEC).toFixed(1)}s · ${crossings.length} crossings · ${framesRead} frames · placed ${found.size}/${people.length}`
          );
        }
      }

      if (starved > 0) {
        setAutoError(
          `${starved} stretch${starved === 1 ? "" : "es"} could not be read fast enough — keep this tab in front and try again.`
        );
      }
      setFindOutcomes(
        people.map((p) => {
          const hit = found.get(p.role);
          return {
            role: p.role,
            name: nameOf(p),
            found: Boolean(hit),
            note: hit?.note ?? "Not found on this video — set a crossing by hand.",
          };
        })
      );
      if (next !== session) void persistSession(next);
    } catch (e) {
      finishWithError(e);
    } finally {
      autoAbortRef.current = null;
      setFindState("idle");
    }
  }

  function pinSelectedLapHere() {
    const crossing = crossings.find((c) => c.index === anchorCrossing);
    const ts = anchorParticipant?.timingSession;
    if (!session || !ts || !crossing) return;
    const t = playheadTime();
    const key = lapSfKey(anchorRole, crossing.lapNumber);
    const patch =
      crossing.anchorKind === "sf_finish"
        ? { perLapSfEnd: { ...ts.sync.perLapSfEnd, [key]: t } }
        : { perLapSfStart: { ...ts.sync.perLapSfStart, [key]: t } };
    const next = updateTimingSession(session, ts.sessionId, {
      sync: { ...ts.sync, ...patch },
    });
    schedulePersist(next);
    setMsg(`${ordinal(crossing.index)} crossing pinned here.`);
  }

  /* ---------- marking ---------- */

  const nonSfLines = useMemo(
    () =>
      (data?.sectorLines ?? [])
        .filter((l) => l.lineKey !== "sf")
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [data]
  );

  /**
   * The laps to read: each driver's quickest ten.
   *
   * Not laps ticked by hand — that chooser came off the Set up step on 2026-09-02. What this
   * feeds is an average — your typical time through each corner against a rival's — and an
   * average wants a real sample. Ten also makes working out which car is yours far more certain,
   * because a rival has ten chances to drift out of step rather than three.
   */
  const scanLaps = useMemo<LapInput[]>(() => {
    const out: LapInput[] = [];
    // Everyone on the video, not the first two. A driver whose clock has not been tied to the
    // video yet is left out: with no anchor there is nothing to aim a window at, and every
    // target built for them would search the wrong stretch of footage.
    for (const p of roster) {
      if (!isPlaced(p)) continue;
      for (const lapNumber of fastestLaps(p.driver.laps, SCAN_LAP_COUNT)) {
        const lap = p.driver.laps.find((l) => l.lapNumber === lapNumber);
        if (lap) out.push({ role: p.role, lapNumber, lapTimeSec: lap.lapTimeSec });
      }
    }
    return out;
    // lapStartVideoTime reads session + roster, both of which are deps here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, roster]);

  /**
   * Every crossing the scan is after: each scanned lap over each corner line, in lap order per
   * driver. The dots on the Scan step and the "jump to this crossing" taps hang off this.
   *
   * No SF targets: the scan is only reachable once anchored, and anchored sessions already know
   * every SF crossing from transponder lap times (the compare adapter derives lap end as start +
   * lapTime).
   */
  const markQueue = useMemo<MarkTarget[]>(() => {
    const targets: MarkTarget[] = [];
    const byRole = new Map<DriverRole, number[]>();
    for (const lap of scanLaps) byRole.set(lap.role, [...(byRole.get(lap.role) ?? []), lap.lapNumber]);
    for (const [role, laps] of byRole) {
      for (const lapNumber of [...laps].sort((a, b) => a - b)) {
        for (const line of nonSfLines) {
          targets.push({ role, lapNumber, lineKey: line.lineKey, label: line.label });
        }
      }
    }
    return targets;
  }, [scanLaps, nonSfLines]);

  function markFor(t: MarkTarget): number | undefined {
    return session?.marks.find(
      (m) =>
        m.sessionId === sessionIdFor(t.role) &&
        m.driverRole === t.role &&
        m.lapNumber === t.lapNumber &&
        m.lineKey === t.lineKey
    )?.videoTimeSec;
  }

  /** Best guess for where this crossing is — a marked sibling lap shifted by the
   * lap-start delta, else a fraction of the lap from its start. */
  function predictTarget(t: MarkTarget): number | null {
    if (!session || !primary) return null;
    const start = lapStartVideoTime(t.role, t.lapNumber);
    if (start == null) return null;
    const sibling = liveMarks.find(
      (m) =>
        m.lineKey === t.lineKey && (m.driverRole !== t.role || m.lapNumber !== t.lapNumber)
    );
    if (sibling) {
      const sibStart = lapStartVideoTime(sibling.driverRole, sibling.lapNumber);
      if (sibStart != null) return start + (sibling.videoTimeSec - sibStart);
    }
    const driver = roster.find((p) => p.role === t.role)?.driver;
    const lap = driver?.laps.find((l) => l.lapNumber === t.lapNumber);
    if (!lap) return start;
    if (t.lineKey === "sf") return start + lap.lapTimeSec;
    const idx = nonSfLines.findIndex((l) => l.lineKey === t.lineKey);
    return start + ((idx + 1) / (nonSfLines.length + 1)) * lap.lapTimeSec;
  }

  const jumpToTarget = useCallback(
    (idx: number) => {
      const t = markQueue[idx];
      if (!t) return;
      const existing = markFor(t);
      const dest = existing ?? predictTarget(t);
      if (dest != null) seekTo(dest);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markQueue, session]
  );

  useEffect(() => {
    if (step !== STEP.scan || !markQueue.length || draftLines) return;
    // Start at the first unmarked target — also fires when lines are first
    // saved from the in-flow editor and the queue materializes.
    const firstOpen = markQueue.findIndex((t) => markFor(t) == null);
    const idx = firstOpen === -1 ? 0 : firstOpen;
    setMarkCursor(idx);
    jumpToTarget(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, markQueue.length, draftLines == null]);

  // A zoom is aimed at one corner on one line. Changing step, or moving on to a crossing on a
  // different line, aims somewhere else — so the picture comes back out to the whole frame
  // instead of leaving the driver staring at the wrong patch of track.
  const activeLineKey = markQueue[markCursor]?.lineKey ?? null;
  useEffect(() => {
    setZoomView({ z: 1, tx: 0, ty: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, activeLineKey, draftLines == null]);

  // The overlay is measured off the screen and the zoom is a transform on it, so what comes
  // back is the magnified size. The loupe and the detector band want the laid-out size.
  useEffect(() => {
    const el = overlayElRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const z = zoomView.z || 1;
    const w = r.width / z;
    const h = r.height / z;
    setOverlayBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomView.z, draftLines == null]);

  /* ---------- automatic crossings ---------- */

  /** Lines the detector can measure against — legacy rows carry no geometry. */
  const drawnLines = useMemo<SessionLine[]>(
    () =>
      (data?.sectorLines ?? [])
        .filter((l) => l.x1 != null && l.y1 != null && l.x2 != null && l.y2 != null)
        .map((l) => ({
          lineKey: l.lineKey,
          label: l.label,
          sortOrder: l.sortOrder,
          x1: l.x1!,
          y1: l.y1!,
          x2: l.x2!,
          y2: l.y2!,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [data]
  );
  const drawnCornerLines = useMemo(
    () => drawnLines.filter((l) => l.lineKey !== SF_LINE_KEY),
    [drawnLines]
  );

  /**
   * Everyone in the race, with every lap start on the video clock — the two drivers being scanned
   * by the same walk the targets use, the rest placed from the shared tone. This is what lets a
   * crossing be given to the rival who was due there instead of to whoever it sat nearest.
   */
  const scanField = useMemo<FieldDriver[]>(() => {
    if (!session) return [];
    const out: FieldDriver[] = [];
    // Every timing session on the video, not just the driver's own. Somebody added from their own
    // practice link brings their whole clock with them, and the matcher can only give a crossing
    // to the person who was due there if it knows they were on track at all.
    for (const ts of session.timingSessions) {
      // No anchor on this session means nothing in it is on the video clock yet. Including it
      // would hand the matcher lap starts derived from a clock the video has never seen.
      if (!ts.isOnVideo || !ts.sync.anchor) continue;
      for (const d of ts.drivers) {
        const role = d.role === "other" ? undefined : d.role;
        const lapStarts: FieldDriver["lapStarts"] = [];
        for (const lap of realLaps(d.laps)) {
          const startSec = role
            ? lapStartVideoTime(role, lap.lapNumber)
            : ts.sync.anchor
              ? predictSfStartTime(d, lap.lapNumber, ts)
              : null;
          if (startSec != null) lapStarts.push({ lapNumber: lap.lapNumber, startSec });
        }
        if (lapStarts.length) out.push({ key: role ?? d.key, name: d.driverName, role, lapStarts });
      }
    }
    return out;
    // lapStartVideoTime reads session + roster, both of which are deps here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, roster]);

  /** Marks belonging to the people currently on the video — theirs may sit in their own session. */
  const liveMarks = useMemo(() => {
    const live = new Map(roster.map((p) => [p.role, p.sessionId]));
    return (session?.marks ?? []).filter((m) => live.get(m.driverRole) === m.sessionId);
  }, [session, roster]);

  const sessionMarks = useMemo<SessionMark[]>(
    () =>
      liveMarks
        .map((m) => ({
          driverRole: m.driverRole,
          lapNumber: m.lapNumber,
          lineKey: m.lineKey,
          videoTimeSec: m.videoTimeSec,
          ...(m.dir ? { dir: m.dir } : {}),
        })),
    [liveMarks]
  );

  const autoReady =
    drawnCornerLines.length > 0 && scanLaps.length > 0 && !!videoSrc && !!videoDims;

  function runContext(): RunContext | null {
    const video = videoRef.current;
    if (!video || !videoDims || !autoAbortRef.current) return null;
    return {
      video,
      // The file itself, so the frames can be decoded straight out of it rather than played.
      file: pickedFile ?? local.file ?? null,
      frameW: videoDims.w,
      frameH: videoDims.h,
      durationSec: video.duration || duration,
      lines: drawnLines,
      laps: scanLaps,
      marks: sessionMarks,
      lapStart: lapStartVideoTime,
      field: scanField,
      onProgress: setAutoProgress,
      signal: autoAbortRef.current.signal,
    };
  }

  /** A stable key for one car at one line, so a picture and a tap agree on what they mean. */
  function optionKey(lineKey: string, o: CarOption): string {
    return `${lineKey}:${o.t.toFixed(3)}`;
  }

  /**
   * Show every car that crossed each line, and let the driver point at theirs.
   *
   * The bootstrap decides this by repetition, which is exact with one car on track and demonstrably
   * wrong in a race — on the first race footage the opening three lines followed somebody else all
   * session. Repetition is a fine guess; a driver looking at a picture is not a guess at all.
   */
  async function runIdentify(role: DriverRole) {
    if (!session || !primary) return;
    if (autoState === "running" || autoState === "learning" || autoState === "identifying") return;
    setAutoError(null);
    setIdentify(null);
    setIdentifyThumbs({});
    setIdentifyPick({});
    setIdentifyShowAll({});
    setIdentifyAuto({});
    setIdentifySkipped(false);
    setIdentifyRole(role);
    setAutoState("identifying");
    setAutoProgress({ phase: "preparing", fraction: 0, note: "Reading one lap…" });
    autoAbortRef.current = new AbortController();

    try {
      const ctx = runContext();
      if (!ctx) throw new Error("The video is not ready yet.");
      const found = await collectCarOptions(ctx, { role });
      if (!found) throw new Error("Couldn't find a lap to look at — check the timing and the sync.");
      setIdentify(found);
      // Where only one car is left, or one kept step every lap, it is picked already — the
      // driver confirms rather than hunts. Anything else is theirs to tap.
      const picks = defaultPicks(found.lines);
      setIdentifyPick(picks);
      setIdentifyAuto(Object.fromEntries(Object.entries(picks).map(([k, o]) => [k, o.t])));
      // Every line with anything on it decided: nothing to ask. The pictures are still cut, so
      // the review can show what was taken as the car and offer to change it.
      const decided = found.lines.every((l) => l.options.every((o) => o.dropped) || picks[l.lineKey]);
      // What the picker was handed, one line per corner — the review's equivalent for the door.
      for (const l of found.lines) {
        console.log(
          `[scan] picker ${l.lineKey}: ${l.options
            .map(
              (o) =>
                `${o.offsetSec.toFixed(2)}${o.dir ? (o.dir > 0 ? "+" : "-") : ""}${o.movesWith ? `(${o.movesWith.mine ? "mine" : o.movesWith.name} ${o.movesWith.hits}/${o.movesWith.of})` : ""}${o.offLine ? "[off]" : ""}${o.shortLine ? "[short]" : ""}${o.hairpin ? "[hairpin]" : ""}${o.outOfOrder ? "[order]" : ""}${o.wrongWay ? "[wrong-way]" : ""}${o.offField ? "[field]" : ""}${o.dropped ? "[dropped]" : ""}${o.hint ? `[${o.hint}]` : ""}`
            )
            .join(" ")}${l.field ? ` | field ${l.field.fromSec.toFixed(1)}-${l.field.toSec.toFixed(1)} (${l.field.centres.map((c) => c.toFixed(1)).join(" ")})` : ""}${picks[l.lineKey] ? ` → picked ${picks[l.lineKey]!.offsetSec.toFixed(2)}` : ""}`
        );
      }
      // The picker's evidence, saved with the job: every picture offered and every verdict under
      // it. "S4 picked the wrong crossing" was argued from a description once; not again.
      if (session && primary) {
        schedulePersist({
          ...session,
          lastIdentify: {
            at: new Date().toISOString(),
            sessionId: sessionIdFor(role) ?? primary.sessionId,
            driverRole: role,
            lapNumber: found.lapNumber,
            lapStartSec: found.lapStartSec,
            lapTimeSec: found.lapTimeSec,
            lines: found.lines.map((l) => ({
              lineKey: l.lineKey,
              options: l.options.map((o) => ({
                t: o.t,
                offsetSec: o.offsetSec,
                quality: o.quality,
                ...(o.colour ? { colour: o.colour } : {}),
                ...(o.x != null && o.y != null ? { x: o.x, y: o.y } : {}),
                ...(o.dir ? { dir: o.dir } : {}),
                ...(o.hint ? { hint: o.hint } : {}),
                ...(o.movesWith ? { movesWith: o.movesWith } : {}),
                ...(o.offLine ? { offLine: true } : {}),
                ...(o.outOfOrder ? { outOfOrder: true } : {}),
                ...(o.offField ? { offField: true } : {}),
                ...(o.shortLine ? { shortLine: true } : {}),
                ...(o.hairpin ? { hairpin: true } : {}),
                ...(o.wrongWay ? { wrongWay: true } : {}),
                ...(o.dropped ? { dropped: true } : {}),
              })),
              ...(l.field ? { field: { fromSec: l.field.fromSec, toSec: l.field.toSec, cars: l.field.cars } } : {}),
            })),
            prePicked: Object.fromEntries(Object.entries(picks).map(([k, o]) => [k, o.t])),
            ...(decided ? { auto: true } : {}),
          },
        });
      }

      // Pictures come after the scan, not during: seeking mid-scan would starve the decoder of
      // the consecutive frames the detector depends on.
      setAutoProgress({ phase: "scanning", fraction: 0.9, note: "Cutting the pictures…" });
      const requests = found.lines.flatMap((l) =>
        l.options.map((o) => ({ key: optionKey(l.lineKey, o), t: o.t, x: o.x, y: o.y }))
      );
      const shots = await grabThumbnails(ctx.video, requests, {
        signal: autoAbortRef.current.signal,
      });
      const map: Record<string, string | null> = {};
      requests.forEach((r, i) => {
        map[r.key] = shots[i] ?? null;
      });
      setIdentifyThumbs(map);
      if (decided && Object.keys(picks).length > 0) {
        // "If it knows that's it, why is it asking me?" — it is not. Straight on to the scan.
        setIdentifySkipped(true);
        autoAbortRef.current = null;
        await scanFromIdentifiedCar(picks);
        return;
      }
      setAutoState("choosing");
      setAutoProgress(null);
    } catch (e) {
      finishWithError(e);
    } finally {
      autoAbortRef.current = null;
    }
  }

  /** Take the taps as the truth and scan the rest of the session against them. */
  async function scanFromIdentifiedCar(picksArg?: Record<string, CarOption>) {
    const picksUsed = picksArg ?? identifyPick;
    const picked = seedsFromChoices(picksUsed);
    if (Object.keys(picked).length === 0) return;
    const byRole = { ...seenSeeds, [identifyRole]: { ...seenSeeds[identifyRole], ...picked } };
    setSeenSeeds(byRole);
    // A tap at a hairpin also says which way through the line is the corner.
    const dirs: Partial<Record<string, 1 | -1>> = { ...seenDirs };
    for (const [lineKey, o] of Object.entries(picksUsed)) if (o?.dir) dirs[lineKey] = o.dir;
    setSeenDirs(dirs);
    // What actually went on to the scan, beside what the screen had picked.
    if (session?.lastIdentify && session.lastIdentify.driverRole === identifyRole) {
      schedulePersist({
        ...session,
        lastIdentify: {
          ...session.lastIdentify,
          chosen: Object.fromEntries(
            Object.entries(picksUsed).flatMap(([k, o]) => (o ? [[k, o.t]] : []))
          ),
        },
      });
    }
    setAutoState("learning");
    setAutoProgress({ phase: "preparing", fraction: 0, note: "Getting ready…" });
    autoAbortRef.current = new AbortController();
    try {
      const ctx = runContext();
      if (!ctx) throw new Error("The video is not ready yet.");
      // Start/finish still runs: it is the alignment proof and the colour sample, and the taps
      // say nothing about either.
      const learned = await learnTheLap(ctx);
      setAutoLearned(learned);
      // Your own picks also improve the shared fallback, because a corner sits at much the same
      // point of the lap for anyone driving it.
      await scanWith({ ...learned.seeds, ...(byRole.me ?? {}) }, learned, byRole, dirs);
    } catch (e) {
      finishWithError(e);
    }
  }

  /**
   * Read the footage, work out where the corners are, and find every crossing.
   *
   * Stops in the middle only when it genuinely cannot tell which car is yours — a rival followed
   * at a constant gap looks exactly as consistent as you do. That is one tap, and it beats
   * attributing a whole session to the wrong car.
   */
  async function runFindCrossings() {
    if (!session || !primary || autoState === "running" || autoState === "learning") return;
    setAutoError(null);
    setAutoReview(null);
    setAutoNotes([]);
    setAutoLearned(null);
    setAutoState("learning");
    setAutoProgress({ phase: "preparing", fraction: 0, note: "Getting ready…" });
    autoAbortRef.current = new AbortController();

    try {
      const ctx = runContext();
      if (!ctx) throw new Error("The video is not ready yet.");
      const learned = await learnTheLap(ctx);
      setAutoLearned(learned);

      if (learned.unresolved.length === drawnCornerLines.length) {
        setAutoState("idle");
        // Say WHY per line: "nothing crossed it" and "plenty crossed it but never twice in the
        // same place" are opposite problems and want opposite fixes.
        const why = learned.diagnostics
          .map((d) => {
            const label = drawnCornerLines.find((l) => l.lineKey === d.lineKey)?.label ?? d.lineKey;
            if (d.outcome === "no-candidates") return `${label}: nothing crossed it`;
            return `${label}: ${d.offers} crossing${d.offers === 1 ? "" : "s"}, best repeated on ${d.bestLaps} lap${d.bestLaps === 1 ? "" : "s"}`;
          })
          .join(" · ");
        const read = learned.read;
        setAutoError(
          learned.starvedSegments > 0
            ? "The video couldn't be read fast enough to learn the track — keep this tab in front and try again."
            : read.frames === 0
              ? `Read nothing from the video (${read.laps} laps, ${read.targets} windows) — the scan found no frames.`
              : `Couldn't find a repeating pattern for any line — mark one lap by hand and press it again. (read ${read.frames} frames over ${read.laps} laps · ${why})`
        );
        return;
      }
      if (learned.ambiguous.length) {
        // Two cars keep the same rhythm all race — usually one the driver followed. Numbers cannot
        // separate them, so show the moment instead of describing it.
        setAutoState("idle");
        await runIdentify("me");
        return;
      }
      await scanWith(learned.seeds, learned);
    } catch (e) {
      finishWithError(e);
    }
  }

  async function scanWith(
    seeds: Record<string, number>,
    learned: LearnResult,
    seedsByRole?: Partial<Record<DriverRole, Record<string, number>>>,
    lineDirections?: Partial<Record<string, 1 | -1>>
  ) {
    setAutoState("running");
    try {
      const ctx = runContext();
      if (!ctx) throw new Error("The video is not ready yet.");
      const result = await findEveryCrossing(ctx, {
        seeds,
        seedsByRole: seedsByRole ?? seenSeeds,
        car: learned.car,
        cars: learned.cars,
        lineDirections: lineDirections ?? seenDirs,
      });

      const starved = learned.starvedSegments + result.starvedSegments;
      if (starved > 0) {
        setAutoError(
          `${starved} stretch${starved === 1 ? "" : "es"} could not be read fast enough — keep this tab in front and run it again to fill those in.`
        );
      }
      setAutoNotes(describeScan(learned, result));
      // One console line per crossing, held back or not, so a driven scan can be graded on what it
      // declined to write as well as on what it wrote. The drive script prints these.
      for (const r of [...result.review.found, ...result.review.suspect]) {
        console.debug(
          `[review] ${r.suspect ? "suspect" : "found"} ${r.role} L${r.lapNumber} ${r.lineKey} ${r.videoTimeSec.toFixed(3)} ${r.source}${
            r.claimedBy ? ` claimed-by ${r.claimedBy.by} L${r.claimedBy.lapNumber}` : ""
          }`
        );
      }
      for (const t of result.review.missing) {
        console.debug(`[review] missing ${t.role} L${t.lapNumber} ${t.lineKey} centre ${t.centerSec.toFixed(3)}`);
      }
      for (const d of result.review.directions) {
        console.debug(
          `[review] direction ${d.lineKey} ${d.dir > 0 ? "+" : "-"} (${d.from}) turned ${d.turned} emptied ${d.emptied}`
        );
      }
      setAutoReview(result.review);
      setAutoState("review");
      // The whole scan — found, held back and missing, with every candidate — is saved before the
      // driver decides anything. A mark is a decision; this is the evidence, and any rule can be
      // re-run on it in seconds where a re-scan costs minutes.
      if (session && primary) {
        const review = result.review;
        const toCandidates = (cs: CrossingEvent[]): ManualScanCandidate[] =>
          cs.map((c) => ({
            t: c.t,
            quality: c.quality,
            ...(c.colour ? { colour: c.colour } : {}),
            ...(c.x != null && c.y != null ? { x: c.x, y: c.y } : {}),
            ...(c.dir ? { dir: c.dir } : {}),
            ...(c.source ? { source: c.source } : {}),
          }));
        const rows: ManualScanRow[] = [
          ...[...review.found, ...review.suspect].map((r) => ({
            driverRole: r.role,
            lapNumber: r.lapNumber,
            lineKey: r.lineKey,
            videoTimeSec: r.videoTimeSec,
            source: r.source,
            suspect: r.suspect,
            ...(r.claimedBy ? { claimedBy: r.claimedBy } : {}),
            candidates: toCandidates(r.candidates),
          })),
          ...review.missing.map((t) => ({
            driverRole: t.role,
            lapNumber: t.lapNumber,
            lineKey: t.lineKey,
            videoTimeSec: null,
            source: null,
            suspect: false,
            candidates: toCandidates(review.candidatesById[t.id] ?? []),
          })),
        ];
        // The lap boundaries the scan measured, written where every sector calculation already
        // looks for them. Without this, sector 1 is the only sector with one end on the
        // transponder's walked clock instead of on the picture — so it silently absorbs every
        // error in that walk, and the walk accumulates (see `lapClock.ts`).
        // Grouped by whose lap it is, because each driver's clock lives in the timing session
        // their laps came from — one shared session in a race, one apiece off practice links.
        const perSession = new Map<string, { start: Record<string, number>; end: Record<string, number> }>();
        for (const l of review.measuredLapStarts) {
          const sessionId = sessionIdFor(l.role);
          const ts = sessionId ? findTimingSession(session, sessionId) : undefined;
          if (!ts) continue;
          const bucket =
            perSession.get(ts.sessionId) ??
            { start: { ...ts.sync.perLapSfStart }, end: { ...ts.sync.perLapSfEnd } };
          bucket.start[lapSfKey(l.role, l.lapNumber)] = l.videoTimeSec;
          // A lap ends where the next one starts — the same crossing, named from the other side.
          const prev = review.measuredLapStarts.find(
            (p) => p.role === l.role && p.lapNumber === l.lapNumber - 1
          );
          if (prev) bucket.end[lapSfKey(l.role, l.lapNumber - 1)] = l.videoTimeSec;
          perSession.set(ts.sessionId, bucket);
        }
        let withStarts = session;
        for (const [sessionId, bucket] of perSession) {
          const ts = findTimingSession(withStarts, sessionId);
          if (!ts) continue;
          withStarts = updateTimingSession(withStarts, sessionId, {
            sync: { ...ts.sync, perLapSfStart: bucket.start, perLapSfEnd: bucket.end },
          });
        }
        schedulePersist({
          ...withStarts,
          lastScan: { at: new Date().toISOString(), sessionId: primary.sessionId, rows },
        });
        if (review.clockDisagreements.length) {
          // Not hidden inside sector 1: one of the two clocks is wrong and only the driver can
          // say which.
          console.debug(
            `[review] timing sheet vs footage: ` +
              review.clockDisagreements
                .map((d) => `${d.lapKey} filmed ${d.filmedSec.toFixed(3)} vs ${d.timedSec.toFixed(3)}`)
                .join(", ")
          );
        }
      }
    } catch (e) {
      finishWithError(e);
    } finally {
      autoAbortRef.current = null;
      jumpToTarget(markCursor);
    }
  }

  function finishWithError(e: unknown) {
    autoAbortRef.current = null;
    if (isScanAborted(e)) {
      setAutoState("idle");
      setAutoProgress(null);
      return;
    }
    setAutoError(e instanceof Error ? e.message : "The scan could not finish.");
    setAutoState("idle");
  }

  /** Plain sentences about how the scan went — the trust line, not a debug dump. */
  function describeScan(learned: LearnResult, result: FindResult): string[] {
    const out: string[] = [];
    const check = learned.lapStartError;
    if (check) {
      out.push(
        `Lap times from the video match your timing to ${check.medianMs.toFixed(0)}ms across ${check.laps} lap${check.laps === 1 ? "" : "s"}.`
      );
    }
    if (learned.from === "footage") {
      const n = Object.keys(learned.seeds).length;
      out.push(`Worked out where all ${n} corner${n === 1 ? " is" : "s are"} from the footage — nothing marked.`);
    }
    // Colour is only mentioned once it has been MEASURED to tell the cars apart on this footage:
    // the reference is learnt where the car was alone, and its distance from the other cars seen
    // beside it is the number that earns it a say. Anything less would be a promise the
    // measurement does not support. See docs/VIDEO_AUTO_SECTORS_PLAN.md.
    const mineByColour = result.review.colourLines
      .filter((l) => l.roles.includes("me"))
      .map((l) => drawnCornerLines.find((d) => d.lineKey === l.lineKey)?.label ?? l.lineKey);
    if (mineByColour.length) {
      out.push(
        `Your car's colour told it apart from the others at ${mineByColour.join(", ")} and helped decide there.`
      );
    } else if (drawnCornerLines.length) {
      out.push("Colour could not tell the cars apart here — decided on timing alone.");
    }
    if (result.bracketFilled > 0) {
      out.push(
        `${result.bracketFilled} found on the second look, between the corners either side.`
      );
    }
    const read = drawnCornerLines
      .map((l) => ({ label: l.label, cal: result.calibrations[l.lineKey] }))
      .filter((x) => x.cal != null);
    const brightness = read.filter((x) => x.cal!.mode === "luma");
    // Two different jobs share the word "colour": spotting that something moved (brightness is the
    // steadier signal for that) and telling which car it was (the sentence above). Said plainly,
    // or the two lines read as contradicting each other.
    if (brightness.length === read.length && read.length > 1) {
      out.push("Movement was spotted from brightness on every line; colour was only used to tell the cars apart.");
    } else if (brightness.length) {
      out.push(`Movement at ${brightness.map((x) => x.label).join(", ")} was spotted from brightness; colour only tells the cars apart.`);
    }
    return out;
  }

  /**
   * Write the detected crossings into the session.
   *
   * A hand mark always wins: this only ever fills empty cells, so pressing the button twice, or
   * after correcting something by hand, can never undo the driver's own work.
   */
  function applyAutoMarks(includeSuspect: boolean) {
    if (!session || !primary || !autoReview) return;
    const rows = includeSuspect
      ? [...autoReview.found, ...autoReview.suspect]
      : autoReview.found;

    const existing = new Set(
      liveMarks.map((m) => `${m.driverRole}:${m.lapNumber}:${m.lineKey}`)
    );
    const added = rows.filter(
      (r) => !existing.has(`${r.role}:${r.lapNumber}:${r.lineKey}`) && sessionIdFor(r.role)
    );

    schedulePersist({
      ...session,
      marks: [
        ...session.marks,
        ...added.map((r) => ({
          // A mark belongs to the timing session its driver's laps came from, which for anyone
          // added by their own practice link is not the driver's own session.
          sessionId: sessionIdFor(r.role)!,
          driverRole: r.role,
          lapNumber: r.lapNumber,
          lineKey: r.lineKey,
          videoTimeSec: r.videoTimeSec,
          ...(r.source ? { source: r.source } : {}),
          // Which way the car went through: the line's direction for every later scan.
          ...(r.dir ? { dir: r.dir } : {}),
          // What else the window saw, so the choice can be re-judged later without a re-scan.
          candidates: r.candidates.map((c) => ({
            t: c.t,
            quality: c.quality,
            ...(c.colour ? { colour: c.colour } : {}),
            ...(c.x != null && c.y != null ? { x: c.x, y: c.y } : {}),
            ...(c.dir ? { dir: c.dir } : {}),
            ...(c.source ? { source: c.source } : {}),
          })),
        })),
      ],
    });
    setAutoState("idle");
    setAutoReview(null);
    setAutoProgress(null);
    setMsg(`${added.length} crossing${added.length === 1 ? "" : "s"} added.`);
  }
  /* ---------- line sets ---------- */

  /** Point this session at a different saved split. Marks stay keyed by lineKey,
   * so switching sets can orphan them — the picker warns before you do it. */
  async function switchToLineSet(profileId: string) {
    if (!data || profileId === data.job.profile.id) return;
    // One tap on a row used to switch the whole session, silently. The Sync and Mark steps then
    // showed another set's lines, and "the lines look slightly off where I drew them" took an
    // evening to trace back to a tap on the wrong row.
    const name = lineSets.find((s) => s.id === profileId)?.name ?? "that set";
    const ok = window.confirm(
      `Switch this session to "${name}"?\n\nSync, Mark and every scan from here read that set's lines.`
    );
    if (!ok) return;
    setSwitchingSet(true);
    try {
      const res = await fetch(`/api/video-analysis/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      if (!res.ok) throw new Error("Could not switch line set");
      await load();
      setMsg(null);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not switch line set");
    } finally {
      setSwitchingSet(false);
    }
  }

  async function createLineSet() {
    if (!data) return;
    const name = window.prompt(
      `Name this set of lines for ${data.job.track.name}\n(e.g. "Drivers stand" or "Far bank")`,
      ""
    );
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setMsg("Give the line set a name so you can tell it apart later.");
      return;
    }
    setSwitchingSet(true);
    try {
      const res = await fetch(`/api/tracks/${data.job.track.id}/camera-profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error("Could not create line set");
      const { profile } = (await res.json()) as { profile: { id: string } };
      await fetch(`/api/video-analysis/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: profile.id }),
      });
      await load();
      await loadLineSets(data.job.track.id);
      openLineEditor([]);
      setMsg(null);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not create line set");
    } finally {
      setSwitchingSet(false);
    }
  }

  async function renameLineSet(set: LineSet) {
    const name = window.prompt("Rename this line set", set.name);
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === set.name) return;
    const res = await fetch(`/api/video-analysis/profiles/${set.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!res.ok) {
      setMsg("Rename failed");
      return;
    }
    if (data) await loadLineSets(data.job.track.id);
    if (set.id === data?.job.profile.id) await load();
  }

  async function deleteLineSet(set: LineSet) {
    if (!data) return;
    if (set.id === data.job.profile.id) {
      setMsg("That's the set this session is using — switch to another one first.");
      return;
    }
    const ok = window.confirm(
      `Delete "${set.name}"?\n\nIts lines and any other sessions using it are removed for good.`
    );
    if (!ok) return;
    const res = await fetch(`/api/video-analysis/profiles/${set.id}`, { method: "DELETE" });
    if (!res.ok) {
      setMsg("Delete failed");
      return;
    }
    await loadLineSets(data.job.track.id);
  }

  /* ---------- sector line editor ---------- */

  function clamp01(n: number): number {
    return Math.max(0, Math.min(1, n));
  }

  /** `from` is passed explicitly right after creating a set, when `data` in this
   * closure is still the previous profile's. */
  function openLineEditor(from?: SectorLineApi[]) {
    // Lines are fractions of the picture. Until the browser has told us the picture's shape the
    // box is a 16:9 guess with the clip letterboxed inside it, and anything drawn now would be
    // measured against black bars.
    if (videoSrc && !videoDims) {
      setMsg("The picture is still loading — try again in a moment.");
      return;
    }
    const existing = (from ?? data?.sectorLines ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((l) => ({
        lineKey: l.lineKey,
        label: l.label,
        x1: l.x1 ?? 0.3,
        y1: l.y1 ?? 0.35,
        x2: l.x2 ?? 0.7,
        y2: l.y2 ?? 0.35,
      }));
    // sf always exists and stays first; ensure it if a profile somehow lacks it.
    if (!existing.some((l) => l.lineKey === "sf")) {
      existing.unshift({ lineKey: "sf", label: "Start / Finish", x1: 0.3, y1: 0.8, x2: 0.7, y2: 0.8 });
    }
    setDraftLines(existing);
  }

  function addDraftLine() {
    setDraftLines((prev) => {
      if (!prev) return prev;
      const used = new Set(prev.map((l) => l.lineKey));
      let n = 1;
      while (used.has(`s${n}`)) n += 1;
      const y = 0.2 + ((prev.length - 1) % 4) * 0.18;
      return [...prev, { lineKey: `s${n}`, label: `S${n}`, x1: 0.35, y1: y, x2: 0.65, y2: y }];
    });
  }

  function beginLineDrag(idx: number, end: 1 | 2) {
    lineDragRef.current = { idx, end };
    setActiveHandle({ idx, end });
  }

  function endLineDrag() {
    lineDragRef.current = null;
    setActiveHandle(null);
  }

  /** Where the picture is painted inside the <video> box (object-contain), in viewport pixels. */
  function paintedRect(v: HTMLVideoElement | null): DOMRect | null {
    if (!v || !v.videoWidth || !v.videoHeight) return null;
    const r = v.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const va = v.videoWidth / v.videoHeight;
    const ea = r.width / r.height;
    if (va >= ea) {
      const h = r.width / va;
      return new DOMRect(r.left, r.top + (r.height - h) / 2, r.width, h);
    }
    const w = r.height * va;
    return new DOMRect(r.left + (r.width - w) / 2, r.top, w, r.height);
  }

  /**
   * The end nearest the press, wherever the press landed.
   *
   * Each end carries a thumb-sized invisible target, and two lines crossing near each other put
   * those targets on top of one another — whichever happened to be drawn last won, so grabbing
   * one line's end regularly picked up its neighbour's. Distance decides it instead.
   */
  function nearestLineEnd(clientX: number, clientY: number): { idx: number; end: 1 | 2 } | null {
    const rect = paintedRect(videoRef.current) ?? overlayElRef.current?.getBoundingClientRect();
    if (!draftLines || !rect || !rect.width || !rect.height) return null;
    let best: { idx: number; end: 1 | 2 } | null = null;
    let bestDist = Infinity;
    draftLines.forEach((l, idx) => {
      for (const end of [1, 2] as const) {
        const px = rect.left + (end === 1 ? l.x1 : l.x2) * rect.width;
        const py = rect.top + (end === 1 ? l.y1 : l.y2) * rect.height;
        const dist = Math.hypot(px - clientX, py - clientY);
        if (dist < bestDist) {
          bestDist = dist;
          best = { idx, end };
        }
      }
    });
    return best;
  }

  function dragLinePoint(clientX: number, clientY: number) {
    const d = lineDragRef.current;
    // The picture itself, measured from the element as it is painted right now — the overlay
    // box is meant to match it, but the picture is the thing the fractions describe.
    const rect = paintedRect(videoRef.current) ?? overlayElRef.current?.getBoundingClientRect();
    if (!d || !rect || !rect.width || !rect.height) return;
    const x = clamp01((clientX - rect.left) / rect.width);
    const y = clamp01((clientY - rect.top) / rect.height);
    setDraftLines(
      (prev) =>
        prev?.map((pl, i) =>
          i === d.idx ? (d.end === 1 ? { ...pl, x1: x, y1: y } : { ...pl, x2: x, y2: y }) : pl
        ) ?? prev
    );
  }

  function moveDraftLine(idx: number, dir: -1 | 1) {
    setDraftLines((prev) => {
      if (!prev) return prev;
      const to = idx + dir;
      // sf is pinned at 0 — corner lines reorder among themselves.
      if (prev[idx]?.lineKey === "sf" || to < 1 || to >= prev.length) return prev;
      const next = prev.slice();
      [next[idx], next[to]] = [next[to]!, next[idx]!];
      return next;
    });
  }

  /** Other sessions reading the set this one is on — the ones a redraw would move. */
  const otherSessionsOnSet = Math.max(
    0,
    (lineSets.find((s) => s.id === data?.job.profile.id)?.jobCount ?? 1) - 1
  );

  /**
   * Save the drawn lines — into this set, or into a fresh set for this video.
   *
   * A set's lines belong to every session on it. Redrawing them here for a clip filmed from a
   * slightly different spot moved them under the earlier clips too, and the driver met that as
   * "the lines keep moving, half a track width from where I put them" — three times before the
   * cause was found. So when other sessions read this set the save stops and asks; the safe
   * answer copies the drawing into a new set that only this session uses.
   */
  async function saveSectorLines(mode: "this-set" | "new-set" | "ask" = "ask") {
    if (!draftLines || !data) return;
    if (mode === "ask" && otherSessionsOnSet > 0) {
      setSaveLinesChoice(true);
      return;
    }
    setSaveLinesChoice(false);
    setSavingLines(true);
    try {
      let profileId = data.job.profile.id;
      let profileName = data.job.profile.name;
      if (mode === "new-set") {
        const clip = session?.localVideoName?.replace(/\.[^.]+$/, "");
        const created = await fetch(`/api/tracks/${data.job.track.id}/camera-profiles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: clip ? `${profileName} · ${clip}` : `${profileName} (copy)` }),
        });
        if (!created.ok) throw new Error("Could not create a new line set");
        const { profile } = (await created.json()) as { profile: { id: string; name: string } };
        const moved = await fetch(`/api/video-analysis/jobs/${jobId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileId: profile.id }),
        });
        if (!moved.ok) throw new Error("Could not move this session to the new set");
        profileId = profile.id;
        profileName = profile.name;
      }
      const res = await fetch(
        `/api/video-analysis/profiles/${encodeURIComponent(profileId)}/sectors`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lines: draftLines.map((l, i) => ({ ...l, label: l.label.trim() || l.lineKey.toUpperCase(), sortOrder: i })),
          }),
        }
      );
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        sectorLines?: Array<SectorLineApi>;
      };
      if (!res.ok || !payload.sectorLines) throw new Error(payload.error || `Save failed (${res.status})`);
      const lines = payload.sectorLines.map((l) => ({
        lineKey: l.lineKey,
        label: l.label,
        sortOrder: l.sortOrder,
        x1: l.x1,
        y1: l.y1,
        x2: l.x2,
        y2: l.y2,
      }));
      setData((d) =>
        d ? { ...d, sectorLines: lines, job: { ...d.job, profile: { ...d.job.profile, id: profileId, name: profileName } } } : d
      );
      setDraftLines(null);
      void loadLineSets(data.job.track.id);
      setMsg(
        lines.length > 1
          ? `Saved to ${profileName}.`
          : "Saved. Add at least one corner line to unlock sector deltas."
      );
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Saving sector lines failed.");
    } finally {
      setSavingLines(false);
    }
  }

  /* ---------- done ---------- */

  const doneReport = useMemo(() => {
    if (!session || !data) return null;
    const cars = compareCarsFromManualSession(session, data.sectorLines);
    const primaryCar = cars[0];
    if (!primaryCar) return null;
    const pair = defaultLapPair(primaryCar);
    if (!pair) return null;
    return compareLaps(
      pair.a,
      pair.b,
      data.sectorLines.map((l) => ({ id: l.lineKey, label: l.label }))
    );
  }, [session, data, step === STEP.compare ? session?.marks.length : 0]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveToLibrary() {
    if (!pickedFile) return;
    setUploadState("busy");
    setUploadError(null);
    try {
      const { id: assetId } = await uploadVideoToLibrary(pickedFile, {
        runId: data?.job.runId ?? undefined,
        onProgress: setUploadPct,
      });
      await fetch(`/api/video-analysis/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoAssetId: assetId }),
      });
      setUploadState("done");
    } catch (err) {
      setUploadState("error");
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadPct(null);
    }
  }

  /* ---------- render ---------- */

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const hasTiming = Boolean(session && session.timingSessions.length > 0);
  /** One whole lap of yours over every corner — the sector compare exists. */
  const hasAnalysis = session ? hasMarkedLap(session, data.sectorLines.map((l) => l.lineKey)) : false;

  const stepDone = (s: Step): boolean => {
    if (s === STEP.setup) return Boolean(videoSrc) && hasTiming;
    if (s === STEP.lines) return nonSfLines.length > 0;
    if (s === STEP.sync) return anchored;
    if (s === STEP.scan) return hasAnalysis;
    return false;
  };

  const canEnter = (s: Step): boolean => {
    if (s === STEP.setup) return true;
    if (s === STEP.lines || s === STEP.sync) return hasTiming && Boolean(videoSrc);
    return anchored;
  };

  const backHref = data.job.runId ? "/runs/history" : "/videos";

  const doneLibraryMatches = session?.localVideoName
    ? library.filter(
        (v) =>
          v.originalFilename.toLowerCase() === session.localVideoName!.toLowerCase() ||
          (v.label ?? "").trim().toLowerCase() === session.localVideoName!.toLowerCase()
      )
    : library;

  // Video-bearing steps go two-pane (big video + controls rail) on desktop.
  const isVideoStep =
    step === STEP.lines ||
    step === STEP.sync ||
    (step === STEP.scan && nonSfLines.length > 0) ||
    Boolean(draftLines);

  // Zoom belongs to the steps where the picture is being read, not drawn on: while an end is in
  // your hand the loupe is the magnifier, and a press there is already a grab.
  const canZoom = isVideoStep && !draftLines;

  // The frame box takes the video's own shape, so a fisheye or 4:3 clip fills it instead of
  // sitting letterboxed inside a 16:9 hole. Its width is capped by what fits on screen
  // vertically (--vchrome is everything above and below it), so on desktop the picture grows
  // into the empty page instead of staying phone-sized.
  const frameAspect =
    videoDims && videoDims.w && videoDims.h ? videoDims.w / videoDims.h : 16 / 9;
  const frameMaxWidth = `calc((100svh - var(--vchrome)) * ${frameAspect})`;

  // Drawing lines is pixel work — the overlay must cover the painted frame (line coords are
  // normalized to it), not any letterbox left over when the box and the clip disagree.
  const contentRect = (() => {
    if (!videoDims || !videoDims.w || !videoDims.h) {
      return { left: "0%", top: "0%", width: "100%", height: "100%" };
    }
    const va = videoDims.w / videoDims.h;
    const ca = frameAspect;
    if (va >= ca) {
      const h = (ca / va) * 100;
      return { left: "0%", top: `${(100 - h) / 2}%`, width: "100%", height: `${h}%` };
    }
    const w = (va / ca) * 100;
    return { left: `${(100 - w) / 2}%`, top: "0%", width: `${w}%`, height: "100%" };
  })();

  // Static guide lines. Every line the set holds is on the picture the whole way through — Sync
  // and Mark each used to show exactly one, and the driver could not see where the rest of the
  // split sat ("all the sectors should be visible on the track at all times", 2026-08-29). The
  // one being worked on is lit; the others stay quiet behind it.
  const staticGuides: DraftLine[] = (() => {
    if (draftLines || step < STEP.lines || step > STEP.scan) return [];
    return data.sectorLines
      .map((l): DraftLine | null =>
        l.x1 != null && l.y1 != null && l.x2 != null && l.y2 != null
          ? { lineKey: l.lineKey, label: l.label, x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 }
          : null
      )
      .filter((l): l is DraftLine => l != null);
  })();

  /** The guide the current step is about — lit, with the rest of the set behind it. */
  const guideActiveKey: string | null = draftLines
    ? null
    : step === STEP.sync
      ? "sf"
      : step === STEP.scan
        ? (markQueue[markCursor]?.lineKey ?? null)
        : null;

  const overlayLines = draftLines ?? staticGuides;

  // Which set of lines this session is reading — shown wherever lines are being used, because a
  // session can be switched between sets and nothing on Sync or Mark said which one was live.
  const lineSetButton = data ? (
    <button
      type="button"
      onClick={() => setStep(STEP.lines)}
      className="flex w-full items-center gap-2 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-left"
    >
      <span className="micro-caps shrink-0 text-faint">Lines</span>
      <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-foreground">
        {data.job.profile.name}
      </span>
      <span className="micro-caps shrink-0 text-muted-foreground">Change</span>
    </button>
  ) : null;

  /**
   * Half the detector's band for one line, in screen pixels.
   *
   * Worked out in the video's OWN pixels and then scaled to the picture on screen, because the
   * recipe's floor and its line-length ceiling are both measured against the real frame. Drawing
   * it from screen pixels would show a different strip on a phone than on a desktop.
   */
  function bandScreenPx(l: DraftLine): number | null {
    if (!videoDims?.w || !videoDims.h || !overlayBox.w) return null;
    const g = lineGeom(
      { lineKey: l.lineKey, label: l.label, sortOrder: 0, x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 },
      videoDims.w,
      videoDims.h
    );
    if (!g.norm) return null;
    return bandHalfPxFor(g, videoDims.w, DRAWN_RECIPE) * (overlayBox.w / videoDims.w);
  }

  const lineOverlay = overlayLines.length ? (
    <div
      ref={setOverlayEl}
      className={cn("absolute", draftLines ? "touch-none" : "pointer-events-none")}
      style={contentRect}
    >
      <svg
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        // Nothing drawn here is grabbable: the detector band is 40-odd pixels wide and would
        // otherwise swallow presses meant for the ends sitting on top of it.
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        {/* While drawing: the strip the detector actually reads. Width is bandFrac of the frame
            each side, and — round cap, not butt — it runs one band width past each end, which is
            the capsule `bandMask()` builds. Motion anywhere in here that swaps sides of the line
            counts as a crossing, so the patch is the thing worth judging when a line lands near
            a return lane (Test A3 S1, 2026-08-29). */}
        {draftLines && overlayPx > 0
          ? overlayLines.map((l) => {
              const band = bandScreenPx(l);
              if (band == null) return null;
              return (
                <line
                  key={`band-${l.lineKey}`}
                  x1={l.x1 * 1000}
                  y1={l.y1 * 1000}
                  x2={l.x2 * 1000}
                  y2={l.y2 * 1000}
                  stroke={l.lineKey === "sf" ? "#ffffff" : "rgb(var(--color-primary))"}
                  strokeOpacity={0.16}
                  strokeWidth={2 * band}
                  // Round adds exactly half a stroke width at each end, which IS the recipe's
                  // one-band cap. A recipe that stops at the drawn ends gets flat ends.
                  strokeLinecap={DRAWN_RECIPE.endCapBands === 0 ? "butt" : "round"}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })
          : null}
        {/* A thin, bright line over a dark halo. The paper ink (#8A6A00) is a text colour and
            vanished on asphalt; over a picture the line is a fill, so it runs at full yellow and
            carries its own shadow instead of leaning on the frame behind it. */}
        {overlayLines.map((l) => {
          const lit = guideActiveKey == null || l.lineKey === guideActiveKey;
          const dash = l.lineKey === "sf" || !lit ? `${6 / zoomView.z} ${4 / zoomView.z}` : undefined;
          return (
            <g key={l.lineKey}>
              <line
                x1={l.x1 * 1000}
                y1={l.y1 * 1000}
                x2={l.x2 * 1000}
                y2={l.y2 * 1000}
                stroke="rgba(0,0,0,0.6)"
                strokeWidth={3 / zoomView.z}
                strokeOpacity={lit ? 1 : 0.45}
                vectorEffect="non-scaling-stroke"
                strokeDasharray={dash}
              />
              <line
                x1={l.x1 * 1000}
                y1={l.y1 * 1000}
                x2={l.x2 * 1000}
                y2={l.y2 * 1000}
                stroke={l.lineKey === "sf" ? "#ffffff" : "rgb(var(--color-primary))"}
                strokeWidth={1.25 / zoomView.z}
                strokeOpacity={lit ? 1 : 0.5}
                vectorEffect="non-scaling-stroke"
                strokeDasharray={dash}
              />
            </g>
          );
        })}
      </svg>
      {overlayLines.map((l) => (
        <span
          key={`lbl-${l.lineKey}`}
          className={cn(
            "pointer-events-none absolute -translate-x-1/2 -translate-y-[150%] rounded bg-background/70 px-1 py-px tabular-nums text-[9px] backdrop-blur-sm",
            guideActiveKey == null || l.lineKey === guideActiveKey
              ? "text-foreground"
              : "text-foreground/45"
          )}
          style={{
            left: `${((l.x1 + l.x2) / 2) * 100}%`,
            top: `${((l.y1 + l.y2) / 2) * 100}%`,
            // A name is a name at any magnification — it labels the line, it doesn't measure it.
            scale: zoomView.z === 1 ? undefined : String(1 / zoomView.z),
          }}
        >
          {l.label}
        </span>
      ))}
      {/* Full-frame crosshair on the end being dragged — the only way to see exactly which
          bit of track the point lands on while your thumb is over it. */}
      {activeHandle
        ? (() => {
            const l = draftLines?.[activeHandle.idx];
            if (!l) return null;
            const x = activeHandle.end === 1 ? l.x1 : l.x2;
            const y = activeHandle.end === 1 ? l.y1 : l.y2;
            return (
              <>
                {/* The halo is what keeps a 1px line readable on dark asphalt; the ink keeps
                    it readable on a white kerb. Neither works alone. */}
                <span
                  className="pointer-events-none absolute inset-y-0 w-px bg-primary shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
                  style={{ left: `${x * 100}%` }}
                />
                <span
                  className="pointer-events-none absolute inset-x-0 h-px bg-primary shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
                  style={{ top: `${y * 100}%` }}
                />
                <DrawLoupe
                  videoRef={videoRef}
                  boxW={overlayBox.w}
                  boxH={overlayBox.h}
                  cx={x}
                  cy={y}
                  line={l}
                  sf={l.lineKey === "sf"}
                />
              </>
            );
          })()
        : null}
      {draftLines?.map((l, idx) =>
        ([1, 2] as const).map((end) => {
          const isActive = activeHandle?.idx === idx && activeHandle.end === end;
          return (
            <button
              key={`${l.lineKey}-${end}`}
              type="button"
              aria-label={`Move ${l.label} endpoint ${end}`}
              onPointerDown={(e) => {
                e.preventDefault();
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                // Whichever end is closest to the press wins, not whichever target happens to
                // be on top — crossing lines used to steal each other's ends.
                const pick = nearestLineEnd(e.clientX, e.clientY) ?? { idx, end };
                beginLineDrag(pick.idx, pick.end);
              }}
              onPointerMove={(e) => dragLinePoint(e.clientX, e.clientY)}
              onPointerUp={() => endLineDrag()}
              onPointerCancel={() => endLineDrag()}
              // Big invisible grab area, tiny visible mark: you need a thumb-sized target and a
              // point you can place to the pixel, and one shape can't be both.
              className="absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center bg-transparent"
              style={{
                left: `${(end === 1 ? l.x1 : l.x2) * 100}%`,
                top: `${(end === 1 ? l.y1 : l.y2) * 100}%`,
                // The end in your hand stays on top, so a neighbour's target can't take the
                // pointer back part-way through a drag.
                zIndex: isActive ? 2 : 1,
              }}
            >
              <span
                aria-hidden
                className={cn(
                  // A grab point, not a blob: it marks where the end sits and must not hide the
                  // track under it. The 44px button around it is what your thumb actually hits.
                  "block rounded-full ring-1 shadow-[0_0_0_1px_rgba(0,0,0,0.6)] transition-[height,width]",
                  isActive ? "h-2 w-2 ring-white/90" : "h-1.5 w-1.5 ring-black/50",
                  l.lineKey === "sf" ? "bg-white" : "bg-primary"
                )}
              />
            </button>
          );
        })
      )}
    </div>
  ) : null;

  const stepRail = (
    <div className="flex gap-1.5">
      {([1, 2, 3, 4, 5] as Step[]).map((s) => (
        <button
          key={s}
          type="button"
          disabled={!canEnter(s)}
          onClick={() => setStep(s)}
          className="flex flex-1 flex-col items-center gap-1.5 disabled:opacity-40"
        >
          <span
            className={cn(
              "h-[3px] w-full rounded-full",
              s === step
                ? "primary-face bg-primary shadow-[0_0_8px_rgba(255,214,10,0.4)]"
                : stepDone(s)
                  ? "bg-primary/40"
                  : "bg-border"
            )}
          />
          <span className={cn("micro-caps", s === step ? "text-foreground" : "text-faint")}>
            {STEP_LABELS[s]}
          </span>
        </button>
      ))}
    </div>
  );

  /* One tap back onto the file that is already on this device. It sits beside the step's own
     panel and NEVER inside `transport`: --vchrome there is a measured reserve, so a row added
     to it is a row taken off the picture. `!draftLines` for the same reason as `canZoom` —
     while an end is in your hand the step is drawing, not scrubbing. Shown only while the
     player is on the uploaded copy, which is where the cost is; the tap that opens the file
     also remembers it, so the next visit is "Reopen". */
  const localFileButton =
    isVideoStep && !draftLines && playingUploadedCopy ? (
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() => {
            if (local.rememberedName) void local.reopenRemembered();
            else if (local.canRemember) void local.pickWithPicker();
            else videoStepFileInputRef.current?.click();
          }}
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground"
        >
          <Film className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {local.rememberedName
            ? `Reopen ${local.rememberedName.length > 18 ? "video" : local.rememberedName}`
            : "Open from this device"}
        </button>
        {local.error ? (
          <p className="text-[11px] leading-snug text-destructive">{local.error}</p>
        ) : null}
        <input
          ref={videoStepFileInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) local.attachFile(f);
            e.target.value = "";
          }}
        />
      </div>
    ) : null;

  const transport = (
    // --vchrome: everything else on screen (app bar, page header, step rail, the controls
    // below). Measured, not guessed — see e2e/analyze-lines-layout.spec.ts.
    <div
      className="mx-auto w-full space-y-2.5 [--vchrome:21rem] lg:[--vchrome:14rem]"
      style={{ maxWidth: frameMaxWidth }}
    >
      <div
        // A ring, not a border: a 1px border on each side made the box 2px wider and 2px
        // shorter than the aspect ratio it was given, so the picture letterboxed by ~1px a side
        // and the lines — normalised to the box — landed ~2 source pixels off at the edges.
        className="relative overflow-hidden rounded-xl bg-black ring-1 ring-inset ring-border"
        style={{
          aspectRatio: String(frameAspect),
          // Only once magnified: at fit size the picture must not eat a page scroll.
          touchAction: zoomView.z > 1 ? "none" : undefined,
        }}
        onPointerDown={canZoom ? zoomPointerDown : undefined}
        onPointerMove={canZoom ? zoomPointerMove : undefined}
        onPointerUp={canZoom ? zoomPointerUp : undefined}
        onPointerCancel={canZoom ? () => (zoomDragRef.current = null) : undefined}
      >
        {/* Picture and lines magnify together. The lines are fractions of the frame, so one
            transform over both leaves every line exactly where it was drawn. */}
        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${zoomView.tx * 100}%, ${zoomView.ty * 100}%) scale(${zoomView.z})`,
            transformOrigin: "0 0",
          }}
        >
          <video
            ref={videoRef}
            src={videoSrc ?? undefined}
            muted
            playsInline
            preload="auto"
            className="absolute inset-0 h-full w-full object-contain"
            onError={(e) => {
              // Without this a file the browser can't open is just a black box on
              // a black panel — no message, nothing to act on.
              setVideoError(describeVideoError(e.currentTarget));
            }}
            // loadedmetadata is not always the moment the size is known: WebKit can report 0×0
            // there and fire `resize` when it arrives. Every event that can carry it feeds the
            // same reader, which ignores 0×0.
            onResize={(e) => readVideoDims(e.currentTarget)}
            onLoadedData={(e) => readVideoDims(e.currentTarget)}
            onLoadedMetadata={(e) => {
              // A dropped video track raises NO error and still reports readyState 4,
              // so the black-picture case has to be caught here, by size.
              setVideoError(diagnoseMissingPicture(e.currentTarget)?.message ?? null);
              setDuration(e.currentTarget.duration || 0);
              readVideoDims(e.currentTarget);
              if (coarseElRef.current) {
                coarseElRef.current.max = String(Math.max(e.currentTarget.duration || 0, 0.01));
              }
              if (lastSeekRef.current > 0) requestSeek(lastSeekRef.current);
              else syncTransportUi(0);
            }}
            onSeeked={onVideoSeeked}
            onTimeUpdate={(e) => {
              // Playback progress only — scrubbing paints through syncTransportUi.
              if (!seekTargetRef.current) syncTransportUi(e.currentTarget.currentTime);
            }}
            onClick={canZoom ? undefined : togglePlay}
          />
          {lineOverlay}
        </div>
        <span
          ref={timecodeElRef}
          className="pointer-events-none absolute bottom-2 left-2 rounded bg-background/70 px-2 py-0.5 text-[12px] tabular-nums text-foreground backdrop-blur-sm"
        >
          {fmtClock(lastSeekRef.current)}
        </span>
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-background/70 text-foreground backdrop-blur-sm"
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
        </button>
        {zoomView.z > 1 ? (
          <button
            type="button"
            onClick={() => setZoomView({ z: 1, tx: 0, ty: 0 })}
            className="absolute right-2 top-2 rounded-full bg-background/70 px-2 py-0.5 tabular-nums text-[11px] font-semibold text-foreground backdrop-blur-sm"
          >
            {zoomView.z}× · Fit
          </button>
        ) : null}
      </div>

      {videoError ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11.5px] leading-relaxed text-destructive">
          {videoError}
        </p>
      ) : null}
      <input
        ref={coarseElRef}
        type="range"
        min={0}
        max={Math.max(duration, 0.01)}
        step={0.05}
        defaultValue={lastSeekRef.current}
        onChange={(e) => requestSeek(Number(e.target.value), { fast: true })}
        onPointerUp={(e) => requestSeek(Number(e.currentTarget.value))}
        onKeyUp={(e) => requestSeek(Number(e.currentTarget.value))}
        aria-label="Coarse scrub"
        className="h-7 w-full accent-primary-ink"
      />
      {/* One row: every 40px of controls is 70px of picture gone. */}
      <div className="flex gap-2">
        <button type="button" onClick={() => nudge(-FRAME_SEC)} className="h-12 w-[5.5rem] shrink-0 rounded-lg border border-border bg-secondary tabular-nums text-[12px] text-foreground active:bg-muted">
          −1 frame
        </button>
        <FineWheel className="flex-1" onDelta={(dxPx) => nudge(dxPx * FINE_SEC_PER_PX)} />
        <button type="button" onClick={() => nudge(FRAME_SEC)} className="h-12 w-[5.5rem] shrink-0 rounded-lg border border-border bg-secondary tabular-nums text-[12px] text-foreground active:bg-muted">
          +1 frame
        </button>
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        // A phone's measure on a phone; the whole page on a desktop, on every step. Set up used
        // to keep the phone column at any width, which on a monitor was a strip down the middle
        // (founder call 2026-09-02: every page of the flow takes the whole desktop).
        "mx-auto flex w-full max-w-md flex-col lg:max-w-none",
        // On the video steps the picture is the work — tighten the chrome around it, and clamp
        // it by height instead (see `frameMaxWidth`).
        isVideoStep ? "gap-2.5 pb-4" : "gap-4 pb-10"
      )}
    >
      {/* header + step rail — one strip on desktop, two rows on a phone. The rail is rendered
          into whichever container is showing; it holds no state, so the pair is free. */}
      <div className="flex items-center gap-2 lg:gap-4">
        <span className="min-w-0 shrink truncate micro-caps text-faint">
          Analyze · {data.job.track.name}
        </span>
        <div className="hidden min-w-0 flex-1 lg:block">{stepRail}</div>
        <span className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
          {saving ? (
            <span className="micro-caps text-faint">Saving…</span>
          ) : null}
          <Link
            href={backHref}
            className="rounded-md border border-border bg-secondary px-2.5 py-1 text-[11px] font-semibold text-muted-foreground no-underline hover:text-foreground"
          >
            ✕ Close
          </Link>
        </span>
      </div>
      <div className="lg:hidden">{stepRail}</div>

      {msg ? <p className="text-[11.5px] leading-relaxed text-muted-foreground">{msg}</p> : null}

      {/* ---------- STEP 1: set up — the video and the timing, side by side ----------
          Two steps until 2026-09-02 ("Video", "Timing"), each a phone column on a monitor with
          the rest of the window empty. One screen: what is being analysed, and whose laps. */}
      {step === STEP.setup && session ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
            <section className="space-y-3 rounded-xl border border-border bg-card p-4">
              <h2 className="text-[16px] font-bold tracking-tight">Video</h2>
              {videoSrc ? (
                <div className="flex items-center gap-2.5 rounded-lg border border-border bg-secondary/60 px-3 py-2.5">
                  <Film className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                    {pickedFile?.name ?? session.localVideoName ?? "Video"}
                  </span>
                  <label className="shrink-0 cursor-pointer rounded-md border border-border bg-secondary px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
                    Change
                    <input
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) => {
                        // A cancelled dialog hands back no file; the one on screen stays.
                        const f = e.target.files?.[0] ?? null;
                        if (f) setVideoFile(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              ) : (
                <label className="flex w-full cursor-pointer flex-col items-center gap-2 rounded-2xl border-[1.5px] border-dashed border-foreground/20 bg-secondary px-4 py-7 text-[13px] font-semibold">
                  <Film className="h-6 w-6 text-muted-foreground" aria-hidden />
                  Choose from camera roll
                  {session.localVideoName ? (
                    <span className="text-[11px] font-normal text-faint">
                      {session.localVideoName} last time
                    </span>
                  ) : null}
                  <input
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              )}
              {library.length > 0 ? (
                <div className="space-y-1.5">
                  <span className="type-data-label">From library</span>
                  {library.slice(0, 5).map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => void pickLibraryAsset(v)}
                      className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-secondary/60 px-3 py-2.5 text-left"
                    >
                      <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                        {v.label?.trim() || v.originalFilename}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-primary-ink" aria-hidden />
                    </button>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="space-y-3 rounded-xl border border-border bg-card p-4">
              <h2 className="text-[16px] font-bold tracking-tight">Timing</h2>

              {data.job.runId ? (
                <button
                  type="button"
                  disabled={timingLoading}
                  onClick={() => void loadRunTiming()}
                  className="flex w-full items-center gap-3 rounded-xl border border-primary-ink/50 bg-primary/5 px-3.5 py-3 text-left disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold">This run&apos;s laps</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {timingLoading ? "Loading…" : "Imported timing from the linked run"}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-primary-ink" aria-hidden />
                </button>
              ) : null}

              {/* The lane is always open under its own heading. It used to hide behind a button
                  reading "Paste LiveRC URL", which looked like the thing to press to paste. */}
              <div className="space-y-2">
                <span className="type-data-label">
                  {data.job.runId ? "Or paste a LiveRC link" : "Paste a LiveRC link"}
                </span>
                {roster.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {roster.map((p) => (
                      <span
                        key={p.role}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary py-1 pl-2.5 pr-1 text-[11px]"
                      >
                        <span className="font-semibold">{p.driver.driverName}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {p.role === "me" ? "You" : `${realLaps([...p.driver.laps]).length} laps`}
                        </span>
                        {/* The first link pasted is "you" until somebody says otherwise. */}
                        {p.role !== "me" ? (
                          <button
                            type="button"
                            onClick={() => makeMe(p.role)}
                            className="rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                          >
                            That&apos;s me
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => dropParticipant(p.role)}
                          aria-label={`Remove ${p.driver.driverName}`}
                          className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3 w-3" aria-hidden />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="flex gap-1.5">
                  <input
                    value={timingUrls}
                    onChange={(e) => setTimingUrls(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addTimingUrl();
                      }
                    }}
                    inputMode="url"
                    placeholder={roster.length ? "Another driver's link" : "https://…liverc…"}
                    className="min-w-0 flex-1 rounded-lg border border-border bg-secondary p-2.5 text-[11px] text-foreground"
                  />
                  <button
                    type="button"
                    disabled={timingLoading || !timingUrls.trim()}
                    onClick={() => void addTimingUrl()}
                    aria-label="Add this driver"
                    className="shrink-0 rounded-lg primary-face bg-primary px-3 py-2 text-primary-foreground disabled:opacity-60"
                  >
                    {timingLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Plus className="h-4 w-4" aria-hidden />
                    )}
                  </button>
                </div>
              </div>

              {/* A race link brings the whole heat: say who the sectors are measured against. A
                  practice link is one person, so there is nothing to pick. */}
              {meDriver && (primary?.drivers.length ?? 0) > 1 ? (
                <div className="space-y-1.5 border-t border-border pt-3">
                  <span className="type-data-label">Compare against</span>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => chooseRival("")}
                      className={cn(chipToggleClass(!compDriver), "px-2.5 py-1.5 text-[11px]")}
                    >
                      Nobody
                    </button>
                    {(primary?.drivers ?? [])
                      .filter((d) => d.role !== "me")
                      .map((d) => (
                        <button
                          key={d.key}
                          type="button"
                          onClick={() => chooseRival(d.key)}
                          className={cn(
                            chipToggleClass(d.role === "competitor"),
                            "px-2.5 py-1.5 text-[11px]"
                          )}
                        >
                          {d.driverName}
                        </button>
                      ))}
                  </div>
                </div>
              ) : null}
            </section>
          </div>

          <button
            type="button"
            disabled={!videoSrc || !meDriver}
            onClick={() => setStep(STEP.lines)}
            className="w-full rounded-xl primary-face bg-primary py-3.5 text-[13px] font-semibold text-primary-foreground disabled:opacity-50 lg:w-auto lg:min-w-[16rem] lg:px-12"
          >
            Continue
          </button>
        </div>
      ) : null}
      {/* ---------- STEP 4: sync ---------- */}
      {/* ---------- one player for every video step ----------
          The player used to be rendered inside each step's own branch (Lines, the line editor,
          Sync, Mark), so React rebuilt the <video> on every step change — five elements in one
          pass, the file reloaded each time, and the frame's shape re-derived from one fresh
          loadedmetadata. On a phone that report can be 0×0: the box then falls back to 16:9, the
          overlay covers the letterbox, and lines drawn on that mount land somewhere else on the
          next one (2026-08-29, "I edited the lines and they were correct, then the next step
          they are wrong"). One position in the tree, one element, for as long as a video step
          is showing. */}
      {session && isVideoStep ? (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-4 lg:items-start">
          <div className={cn("lg:sticky lg:top-4", step === STEP.scan && !draftLines && "space-y-2.5")}>
            {step === STEP.scan && !draftLines && markQueue[markCursor] ? (
              <p className="micro-caps text-primary-ink">
                L{markQueue[markCursor]!.lapNumber} · {markQueue[markCursor]!.label} line
              </p>
            ) : null}
            {transport}
          </div>
          <div className="mt-4 space-y-3 lg:mt-0">
            {localFileButton}
      {step === STEP.sync ? (
        <>
          <h2 className="text-[16px] font-bold tracking-tight">Sync</h2>
          {lineSetButton}

          {roster.length > 1 ? (
            <div className="space-y-1.5">
              <span className="type-data-label">Whose crossing are you watching?</span>
              <div className="flex flex-wrap gap-1.5">
                {roster.map((p) => (
                  <button
                    key={p.role}
                    type="button"
                    onClick={() => setAnchorRole(p.role)}
                    className={cn(
                      chipToggleClass(anchorRole === p.role),
                      "px-3 py-2 text-[11.5px]"
                    )}
                  >
                    {p.role === "me" ? "You" : p.driver.driverName}
                    {hasOwnAnchor(p.timingSession.sync, p.role) ? (
                      <span className="ml-1.5 text-[8px] tracking-[0.12em] text-gain">SET</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Everyone still to place — placed from the timing clock and the start line where the
              file's date allows it, from their lap times otherwise; never by asking the driver
              to pick a stranger's car out of the footage. */}
          {toPlace.length > 0 ? (
            <div className="space-y-2 rounded-xl border border-border bg-secondary/40 px-3 py-2.5">
              <span className="type-data-label">
                {toPlace.map((p) => (p.role === "me" ? "You" : p.driver.driverName)).join(", ")} still to place
              </span>
              <button
                type="button"
                disabled={findState === "running" || !videoSrc}
                onClick={() => void findAddedDrivers()}
                className="w-full rounded-lg primary-face bg-primary py-2.5 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-60"
              >
                {findState === "running" ? "Watching the start line…" : "Find them on the video"}
              </button>
              {/* No percentage: the sweep runs in passes and stops the moment everyone is
                  placed, so a bar would restart and then vanish part-filled. */}
              {findState === "running" && autoProgress ? (
                <p className="text-[11px] text-muted-foreground">{autoProgress.note}</p>
              ) : null}
            </div>
          ) : null}

          {findOutcomes?.length ? (
            <ul className="space-y-1">
              {findOutcomes.map((o) => (
                <li key={o.role} className="text-[11.5px] leading-relaxed">
                  <span className="font-semibold">{o.name}</span>{" "}
                  <span className={o.found ? "text-gain" : "text-muted-foreground"}>{o.note}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="space-y-1.5">
            <span className="type-data-label">
              {anchorRole === "me"
                ? "Which time over the line is this?"
                : `Which of ${anchorDriver?.driverName ?? "their"} crossings is this?`}
            </span>
            <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
              {crossings.map((c) => (
                <button
                  key={c.index}
                  type="button"
                  onClick={() => {
                    setAnchorCrossing(c.index);
                    const t = crossingVideoTime(anchorRole, c);
                    if (t != null) seekTo(t);
                  }}
                  className={cn(
                    chipToggleClass(anchorCrossing === c.index),
                    "shrink-0 px-3 py-2 text-[11px] tabular-nums"
                  )}
                >
                  {ordinal(c.index)} ·{" "}
                  {c.endsLap != null ? `ends L${c.endsLap}` : `starts L${c.startsLap}`}
                </button>
              ))}
            </div>
          </div>
          {/* One button with one name. It used to change to "Move your anchor to this frame"
              once pressed, which read as a second, different job ("I don't understand why that
              appears after you click", 2026-09-02). Pressing it again simply sets it again; the
              line under it says what is set. */}
          {(() => {
            const sync = anchorParticipant?.timingSession.sync ?? {};
            const own = hasOwnAnchor(sync, anchorRole);
            const at = sync.anchorByRole?.[anchorRole] ?? (anchorRole === "me" ? sync.anchor : undefined);
            const atIndex = at
              ? crossings.find((c) => c.lapNumber === at.lapNumber && c.anchorKind === at.anchorKind)?.index
              : undefined;
            return (
              <>
                <button
                  type="button"
                  disabled={anchorCrossing == null || !videoSrc}
                  onClick={setAnchorAtPlayhead}
                  className={cn(
                    "w-full rounded-xl py-3.5 text-[13px] font-bold disabled:opacity-50",
                    own
                      ? "border border-border bg-secondary text-foreground"
                      : "primary-face bg-primary text-primary-foreground"
                  )}
                >
                  {anchorRole === "me"
                    ? "My car is on the line here"
                    : `${anchorDriver?.driverName ?? "Their"}'s car is on the line here`}
                </button>
                {own && at ? (
                  <p className="text-[11px] tabular-nums text-muted-foreground">
                    Set · {atIndex != null ? `${ordinal(atIndex)} crossing` : `lap ${at.lapNumber}`} at{" "}
                    {fmtClock(at.videoTimeSec)}
                  </p>
                ) : null}
                {clockDisagreement && anchorParticipant ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
                    <span className="text-[11.5px] tabular-nums">
                      Timing clock:{" "}
                      {clockDisagreement.index != null
                        ? `${ordinal(clockDisagreement.index)} crossing`
                        : "that crossing"}{" "}
                      at {fmtClock(clockDisagreement.predictedSec)}
                    </span>
                    <button
                      type="button"
                      disabled={findState === "running" || !videoSrc}
                      onClick={() => void findAddedDrivers([anchorParticipant])}
                      className="shrink-0 rounded-lg border border-border bg-secondary px-3 py-1.5 text-[11.5px] font-semibold text-foreground disabled:opacity-60"
                    >
                      {findState === "running" ? "Checking…" : "Use the clock"}
                    </button>
                  </div>
                ) : null}
              </>
            );
          })()}
          {anchored ? (
            <>
              <button
                type="button"
                onClick={() => setStep(STEP.scan)}
                className="w-full rounded-xl primary-face bg-primary py-3.5 text-[13px] font-semibold text-primary-foreground"
              >
                Continue to scan
              </button>
              <details className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
                <summary className="cursor-pointer text-[11.5px] font-semibold text-muted-foreground">
                  Fine-tune a single lap
                </summary>
                <button
                  type="button"
                  onClick={pinSelectedLapHere}
                  className="mt-2 w-full rounded-lg border border-border bg-secondary py-2 text-[12px] font-semibold text-foreground"
                >
                  Pin this crossing to the current frame
                </button>
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">
                  Optional — the anchor already maps every lap from the timing. Use this only if one
                  crossing looks off; it overrides just that one.
                </p>
              </details>
            </>
          ) : null}
        </>
      ) : null}

      {/* ---------- line editor (opens from Lines / Mark) ---------- */}
      {draftLines ? (
        <>
          <div>
            <h2 className="text-[16px] font-bold tracking-tight">Draw sector lines</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Scrub to a clear frame, then drag each line&apos;s ends onto the track where you want
              a split. Add corners in the order the car meets them after start/finish. Saved to{" "}
              <span className="font-semibold text-foreground">{data.job.profile.name}</span> — every
              future video using this set reuses them.
            </p>
          </div>
          <div className="space-y-1.5">
            {draftLines.map((l, idx) => (
              <div key={l.lineKey} className="flex items-center gap-1.5">
                <span className="w-7 shrink-0 text-center micro-caps text-faint">
                  {l.lineKey === "sf" ? "SF" : idx}
                </span>
                <input
                  value={l.label}
                  disabled={l.lineKey === "sf"}
                  onChange={(e) =>
                    setDraftLines(
                      (prev) =>
                        prev?.map((pl, i) => (i === idx ? { ...pl, label: e.target.value } : pl)) ??
                        prev
                    )
                  }
                  className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-secondary px-2.5 text-[12.5px] text-foreground disabled:opacity-60"
                  aria-label={`Line ${idx} name`}
                />
                {l.lineKey === "sf" ? (
                  <span className="shrink-0 pr-1 micro-caps text-faint">
                    synced
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => moveDraftLine(idx, -1)}
                      aria-label={`Move ${l.label} earlier`}
                      className="h-9 w-9 shrink-0 rounded-lg border border-border bg-secondary text-[13px] text-muted-foreground"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveDraftLine(idx, 1)}
                      aria-label={`Move ${l.label} later`}
                      className="h-9 w-9 shrink-0 rounded-lg border border-border bg-secondary text-[13px] text-muted-foreground"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDraftLines((prev) => prev?.filter((_, i) => i !== idx) ?? prev)
                      }
                      aria-label={`Delete ${l.label}`}
                      className="h-9 w-9 shrink-0 rounded-lg border border-border bg-secondary text-[13px] text-destructive"
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addDraftLine}
            className="w-full rounded-xl border-[1.5px] border-dashed border-foreground/20 bg-secondary py-2.5 text-[12.5px] font-semibold text-foreground"
          >
            + Add sector line
          </button>
          {saveLinesChoice ? (
            <div className="space-y-2 rounded-xl border border-border bg-secondary/60 p-3">
              <p className="text-[12px] leading-relaxed text-foreground">
                <span className="font-semibold">{data.job.profile.name}</span> is also read by{" "}
                {otherSessionsOnSet === 1 ? "1 other session" : `${otherSessionsOnSet} other sessions`}.
                Saving into it moves their lines too — right if the camera never moved, wrong if
                this clip was filmed from a slightly different spot.
              </p>
              <button
                type="button"
                disabled={savingLines}
                onClick={() => void saveSectorLines("new-set")}
                className="w-full rounded-xl primary-face bg-primary py-3 text-[13px] font-semibold text-primary-foreground disabled:opacity-60"
              >
                Save as a new set for this video
              </button>
              <button
                type="button"
                disabled={savingLines}
                onClick={() => void saveSectorLines("this-set")}
                className="w-full rounded-lg border border-border bg-secondary py-2.5 text-[12px] font-semibold text-muted-foreground disabled:opacity-60"
              >
                Update {data.job.profile.name} for every session
              </button>
            </div>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={savingLines}
              onClick={() => {
                setDraftLines(null);
                setSaveLinesChoice(false);
              }}
              className="rounded-xl border border-border bg-secondary px-4 py-3 text-[12.5px] font-semibold text-muted-foreground disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={savingLines || saveLinesChoice}
              onClick={() => void saveSectorLines()}
              className="flex-1 rounded-xl primary-face bg-primary py-3 text-[13px] font-semibold text-primary-foreground disabled:opacity-60"
            >
              {savingLines ? "Saving…" : "Save lines"}
            </button>
          </div>
        </>
      ) : null}

      {/* ---------- STEP 3: line sets ---------- */}
      {step === STEP.lines && !draftLines ? (
        <>
          <div>
            <h2 className="text-[16px] font-bold tracking-tight">Which sector lines?</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              A line set is one way of splitting {data.job.track.name} — tied to where you filmed
              from. Reuse one when the camera is in the same spot; make a new one when it moved or
              you want different corners.
            </p>
          </div>

          <div className="space-y-1.5">
            {lineSets.map((s) => {
              const corners = s.sectorLines.filter((l) => l.lineKey !== "sf").length;
              const inUse = s.id === data.job.profile.id;
              return (
                <div
                  key={s.id}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-3 py-2.5",
                    inUse ? "border-primary-ink/60 bg-primary/5" : "border-border bg-secondary/60"
                  )}
                >
                  <button
                    type="button"
                    disabled={switchingSet}
                    onClick={() => void switchToLineSet(s.id)}
                    className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left disabled:opacity-60"
                  >
                    <span className="w-full truncate text-[12.5px] font-semibold text-foreground">
                      {s.name}
                    </span>
                    <span className="micro-caps text-faint">
                      {corners === 0 ? "no corner lines" : `${corners} corner${corners === 1 ? "" : "s"}`}
                      {s.jobCount != null && s.jobCount > 0
                        ? ` · ${s.jobCount} session${s.jobCount === 1 ? "" : "s"}`
                        : ""}
                      {inUse ? " · in use" : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void renameLineSet(s)}
                    aria-label={`Rename ${s.name}`}
                    className="h-9 shrink-0 rounded-lg border border-border bg-secondary px-2.5 text-[11px] font-semibold text-muted-foreground"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteLineSet(s)}
                    aria-label={`Delete ${s.name}`}
                    className="h-9 w-9 shrink-0 rounded-lg border border-border bg-secondary text-[13px] text-destructive disabled:opacity-40"
                    disabled={inUse}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            disabled={switchingSet}
            onClick={() => void createLineSet()}
            className="w-full rounded-xl border-[1.5px] border-dashed border-foreground/20 bg-secondary py-2.5 text-[12.5px] font-semibold text-foreground disabled:opacity-60"
          >
            + New line set
          </button>

          {nonSfLines.length === 0 ? (
            <>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">{data.job.profile.name}</span> has no
                corner lines yet. Draw them once and every future video on this set reuses them.
              </p>
              <button
                type="button"
                onClick={() => openLineEditor()}
                className="w-full rounded-xl primary-face bg-primary py-3.5 text-[13px] font-semibold text-primary-foreground"
              >
                Draw sector lines
              </button>
              <button
                type="button"
                onClick={() => setStep(anchored ? STEP.compare : STEP.sync)}
                className="w-full rounded-lg border border-border bg-secondary py-2.5 text-[12px] font-semibold text-muted-foreground"
              >
                Skip — whole-lap compare only
              </button>
            </>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => openLineEditor()}
                className="rounded-xl border border-border bg-secondary px-4 py-3 text-[12.5px] font-semibold text-muted-foreground"
              >
                Edit lines
              </button>
              <button
                type="button"
                onClick={() => setStep(anchored ? STEP.scan : STEP.sync)}
                className="flex-1 rounded-xl primary-face bg-primary py-3 text-[13px] font-semibold text-primary-foreground"
              >
                {anchored ? "Continue to scan" : "Continue to sync"}
              </button>
            </div>
          )}
        </>
      ) : null}

      {/* ---------- STEP 4: scan ----------
          "Mark" until 2026-09-02, with Skip / Mark crossing buttons and a hand-marking queue at
          the top. The detector does the marking now; the one button here is the scan. */}
      {step === STEP.scan && !draftLines && nonSfLines.length > 0 ? (
        <>
          <h2 className="text-[16px] font-bold tracking-tight">Scan</h2>
          {lineSetButton}

          {/* The detector reads the video and fills in every corner. */}
          <div className="rounded-xl border border-border bg-secondary/50 p-3">
            {autoState === "running" || autoState === "learning" || autoState === "identifying" ? (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="type-data-label">Finding crossings</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {Math.round((autoProgress?.fraction ?? 0) * 100)}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    style={{ width: `${Math.max(2, (autoProgress?.fraction ?? 0) * 100)}%` }}
                  />
                </div>
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  {autoProgress?.note ?? "Reading the video…"}
                </p>
                <p className="text-[11px] leading-relaxed text-faint">
                  It plays through each corner to read it — leave this tab open.
                </p>
                <button
                  type="button"
                  onClick={() => autoAbortRef.current?.abort()}
                  className="w-full rounded-lg border border-border bg-secondary py-2 text-[12px] font-semibold text-muted-foreground"
                >
                  Stop
                </button>
              </div>
            ) : autoState === "review" && autoReview ? (
              <div className="space-y-2.5">
                <span className="type-data-label">Found</span>
                {identifySkipped && identify ? (
                  <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                    {identifyRole === "me" ? "Your" : `${compDriver?.driverName ?? "Their"}'s`} car was
                    picked on every line without asking — the timing and the rest of the field
                    agreed.{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setIdentifySkipped(false);
                        setAutoState("choosing");
                      }}
                      className="font-semibold text-foreground underline"
                    >
                      Check the pictures
                    </button>
                  </p>
                ) : null}
                <p className="text-[12.5px] leading-relaxed text-foreground">
                  <strong className="tabular-nums">{autoReview.found.length}</strong> crossing
                  {autoReview.found.length === 1 ? "" : "s"} ready to add
                  {(() => {
                    // A crossing the timing gives to another driver, with nothing else seen when
                    // this driver was due, is not a doubt — it is a settled miss, and the driver
                    // has nothing to decide about it. It counts as "not found" (Jordan, 2026-08-29:
                    // "if you know that, just fix it silently"). The row stays in the saved scan
                    // with its claim, so a replay still sees the evidence. "Odd" is the rest.
                    const other = autoReview.suspect.filter((r) => r.claimedBy && r.claimedBy.key !== r.role).length;
                    const odd = autoReview.suspect.length - other;
                    const notFound = autoReview.missing.length + other;
                    return (
                      <>
                        {odd > 0 ? (
                          <>
                            , <strong className="tabular-nums">{odd}</strong> held back as odd
                          </>
                        ) : null}
                        {notFound > 0 ? (
                          <>
                            , <strong className="tabular-nums">{notFound}</strong> not found
                          </>
                        ) : null}
                      </>
                    );
                  })()}
                  .
                </p>
                {autoReview.found.some((r) => r.source === "unconfirmed") ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {autoReview.found.filter((r) => r.source === "unconfirmed").length} of them
                    are less certain — worth a look after adding.
                  </p>
                ) : null}
                {autoReview.suspect.some((r) => !r.claimedBy || r.claimedBy.key === r.role) ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    The odd ones sit a long way off that corner&rsquo;s time on every other lap,
                    so they are probably a different car. Add them only if you want to check them
                    by eye.
                  </p>
                ) : null}
                {(() => {
                  // A driver whose rows on a line are ALL held is a car that was never followed —
                  // the one case where "held back as odd" understates it, and where the fix is
                  // upstream: the car tapped at the picker.
                  const byRoleLine = new Map<string, { role: DriverRole; lineKey: string; found: number; held: number }>();
                  for (const r of [...autoReview.found, ...autoReview.suspect]) {
                    const k = `${r.role}|${r.lineKey}`;
                    const e = byRoleLine.get(k) ?? { role: r.role, lineKey: r.lineKey, found: 0, held: 0 };
                    if (autoReview.suspect.includes(r)) e.held++;
                    else e.found++;
                    byRoleLine.set(k, e);
                  }
                  const lost = [...byRoleLine.values()].filter((e) => e.found === 0 && e.held >= 4);
                  if (lost.length === 0) return null;
                  const roles = [...new Set(lost.map((e) => e.role))];
                  return roles.map((role) => (
                    <p key={role} className="rounded-lg border border-border bg-secondary/60 px-2.5 py-2 text-[11.5px] leading-relaxed text-foreground">
                      Couldn&rsquo;t follow {role === "me" ? "your" : `${compDriver?.driverName ?? "their"}'s`} car at{" "}
                      {lost.filter((e) => e.role === role).map((e) => e.lineKey.toUpperCase()).join(", ")} — nothing
                      there repeats lap to lap against {role === "me" ? "your" : "their"} timing. That is usually the wrong car
                      tapped at the picker — run the scan again and tap {role === "me" ? "yours" : "theirs"}.
                    </p>
                  ));
                })()}
                {autoError ? (
                  <p className="text-[11.5px] leading-relaxed text-loss">{autoError}</p>
                ) : null}
                {autoNotes.length > 0 ? (
                  <ul className="space-y-0.5 text-[11px] leading-relaxed text-faint">
                    {autoNotes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAutoState("idle");
                      setAutoReview(null);
                      setAutoProgress(null);
                    }}
                    className="rounded-lg border border-border bg-secondary px-3 py-2 text-[12px] font-semibold text-muted-foreground"
                  >
                    Discard
                  </button>
                  {autoReview.suspect.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => applyAutoMarks(true)}
                      className="rounded-lg border border-border bg-secondary px-3 py-2 text-[12px] font-semibold text-muted-foreground"
                    >
                      Add all
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={autoReview.found.length === 0}
                    onClick={() => applyAutoMarks(false)}
                    className="flex-1 rounded-lg primary-face bg-primary py-2 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    Add {autoReview.found.length}
                  </button>
                </div>
              </div>
            ) : autoState === "choosing" && identify ? (
              <div className="space-y-3">
                <span className="type-data-label">
                  {identifyRole === "me"
                    ? "Which one is your car?"
                    : `Which one is ${compDriver?.driverName ?? "theirs"}?`}
                </span>
                {/* The heading is the whole instruction. Every sentence that used to sit here
                    described how the search works, which the driver never has to know to tap a
                    car — see the standing rule in CLAUDE.md. */}
                {/* Read nothing and found nothing are opposite faults with opposite fixes, and
                    without this number the screen cannot tell them apart. */}
                <p className="micro-caps text-faint">
                  {identify.framesRead} frames read over {identify.lapTimeSec.toFixed(1)}s of video
                  {identify.effectiveFps ? ` · ${identify.effectiveFps.toFixed(0)} fps` : ""}
                </p>
                {identify.starved ? (
                  <p className="rounded-lg border border-loss/40 bg-loss/5 px-2.5 py-2 text-[11.5px] leading-relaxed text-loss">
                    The video could not be read fast enough, so the cars below are whatever survived
                    — not the full picture. Keep this tab in front, close other windows, and try
                    again. On phone footage this usually means the browser is decoding in software.
                  </p>
                ) : null}
                {identify.lines.map((line) => (
                  <div key={line.lineKey} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="micro-caps text-faint">{line.label}</span>
                      {line.options.length > 0 ? (
                        <span className="grow text-[10.5px] text-faint">
                          {(() => { const n = line.options.filter((o) => !o.dropped).length; return n === 1 ? "1 car" : `${n} cars`; })()}
                        </span>
                      ) : null}
                      {identifyPick[line.lineKey] ? (
                        <button
                          type="button"
                          onClick={() =>
                            setIdentifyPick((c) => {
                              const next = { ...c };
                              delete next[line.lineKey];
                              return next;
                            })
                          }
                          className="text-[10.5px] font-semibold text-muted-foreground underline"
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                    {line.options.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">
                        {identify.starved
                          ? "Not read — too few frames arrived to see anything here."
                          : "Nothing crossed this line on that lap — it will fall back to working it out."}
                      </p>
                    ) : (
                      // A grid, never a strip: the strip hid its scrollbar, and in the 320px side
                      // column it showed two and a half pictures of six. The driver tapped what
                      // they could see — a white car — and every number downstream was built on it.
                      (() => {
                        // A car the timing puts with another driver, the colour rules out, that
                        // crossed beside the line, or that cannot be reached in track order, is
                        // folded away — still there, one tap to see — so a line offers the two or
                        // three cars it might be, not every car that passed. Never fold everything.
                        // The driver's own taps narrow it further: everything after a tapped
                        // corner must come after it, everything before must come before.
                        const idx = identify.lines.findIndex((l) => l.lineKey === line.lineKey);
                        const vsPicks = (o: CarOption): string | null => {
                          for (const [key, pick] of Object.entries(identifyPick)) {
                            const j = identify.lines.findIndex((l) => l.lineKey === key);
                            if (j < 0 || j === idx) continue;
                            const label = identify.lines[j]!.label;
                            if (j < idx && pick.offsetSec >= o.offsetSec - MIN_SECTOR_GAP_SEC)
                              return `before your ${label} tap`;
                            if (j > idx && pick.offsetSec <= o.offsetSec + MIN_SECTOR_GAP_SEC)
                              return `after your ${label} tap`;
                          }
                          return null;
                        };
                        // A picked car is never folded, whatever the rules say about it — hiding
                        // the tap behind "Show more" left the driver looking at leftovers.
                        // Ruled out twice over is not an option — not even under "show more".
                        const offered = line.options.filter((o) => !o.dropped);
                        // A line the screen decided shows its pick alone; the rest wait behind
                        // "show more" for the driver who wants to check.
                        const decidedHere =
                          identifyAuto[line.lineKey] != null && identifyPick[line.lineKey]?.t === identifyAuto[line.lineKey];
                        const isOther = (o: CarOption) =>
                          identifyPick[line.lineKey]?.t !== o.t &&
                          (decidedHere || foldReasonFor(o) != null || vsPicks(o) != null);
                        const kept = offered.filter((o) => !isOther(o));
                        const showAll = identifyShowAll[line.lineKey] || kept.length === 0;
                        const visible = showAll ? offered : kept;
                        const hidden = offered.length - visible.length;
                        return (
                      <div className="space-y-1.5">
                      <div className="grid grid-cols-3 gap-2">
                        {visible.map((o) => {
                          const key = optionKey(line.lineKey, o);
                          const picked = identifyPick[line.lineKey]?.t === o.t;
                          const shot = identifyThumbs[key];
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => {
                                setIdentifyPick((c) => ({ ...c, [line.lineKey]: o }));
                                seekTo(o.t);
                              }}
                              className={cn(
                                "min-w-0 overflow-hidden rounded-lg border text-left",
                                picked
                                  ? "border-primary-ink ring-2 ring-primary-ink/40"
                                  : "border-border"
                              )}
                            >
                              {shot ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={shot}
                                  alt={`Car crossing ${line.label} at ${o.t.toFixed(2)}s`}
                                  className="block aspect-square w-full object-cover"
                                />
                              ) : (
                                <span className="flex aspect-square w-full items-center justify-center bg-secondary text-[10px] text-faint">
                                  no picture
                                </span>
                              )}
                              <span className="block bg-secondary px-1.5 py-1 text-[10px] tabular-nums text-muted-foreground">
                                {o.offsetSec.toFixed(2)}s
                                {/* Why it is folded comes first; what speaks for it second. */}
                                {o.movesWith && !o.movesWith.mine ? (
                                  <span className="block text-faint">moves with {o.movesWith.name}</span>
                                ) : o.outOfOrder ? (
                                  <span className="block text-faint">out of track order</span>
                                ) : o.wrongWay ? (
                                  <span className="block text-faint">crosses the other way to the field</span>
                                ) : o.offField && o.movesWith?.mine ? (
                                  <span className="block text-faint">yours — later in the lap, not this corner</span>
                                ) : o.offField && line.field ? (
                                  <span className="block text-faint">
                                    field crosses at {line.field.fromSec.toFixed(1)}–{line.field.toSec.toFixed(1)}s
                                  </span>
                                ) : vsPicks(o) ? (
                                  <span className="block text-faint">{vsPicks(o)}</span>
                                ) : o.movesWith?.mine ? (
                                  <span className="block font-semibold text-foreground">
                                    on {o.movesWith.hits} of {o.movesWith.of} {identifyRole === "me" ? "your" : "their"} laps
                                    {o.offLine ? <span className="block font-normal text-faint">past the line’s end</span> : null}
                                    {o.hairpin ? (
                                      <span className="block font-normal text-faint">
                                        {o.dir === 1 ? "one way" : "the other way"} at the hairpin
                                      </span>
                                    ) : null}
                                  </span>
                                ) : o.offLine ? (
                                  <span className="block text-faint">beside the line, not across it</span>
                                ) : o.hint === "yours" ? (
                                  <span className="block font-semibold text-foreground">
                                    looks like {identifyRole === "me" ? "yours" : "theirs"}
                                  </span>
                                ) : o.hint === "other" ? (
                                  <span className="block text-faint">different colour</span>
                                ) : null}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {hidden > 0 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setIdentifyShowAll((c) => ({ ...c, [line.lineKey]: true }))
                          }
                          className="text-[10.5px] font-semibold text-muted-foreground underline"
                        >
                          {decidedHere ? `Show ${hidden} more` : `Show ${hidden} more the timing rules out`}
                        </button>
                      ) : null}
                      {/* The car that kept step every lap is past the end of the drawn line: the
                          line is short, not the car wrong. Say so once, here, rather than fold the
                          right answer away and leave the driver hunting under "Show more". */}
                      {line.options.some((o) => o.shortLine) ? (
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          {identifyRole === "me" ? "Your" : "Their"} car crosses past the end of the{" "}
                          {line.label} line on every lap read — lengthen the line in Lines so it
                          reaches the whole track there.
                        </p>
                      ) : null}
                      {/* A hairpin: the same car through the same short line twice, a moment
                          apart, opposite ways. Only one pass is the corner they drew, and a
                          stamp-sized picture is the only thing that can say which. */}
                      {line.options.some((o) => o.hairpin) && !identifyPick[line.lineKey] ? (
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          Two passes at a hairpin — {identifyRole === "me" ? "your" : "their"} car
                          crosses the {line.label} line going in and again coming back. Tap the one
                          on {identifyRole === "me" ? "your" : "the"} sector.
                        </p>
                      ) : null}
                      </div>
                        );
                      })()
                    )}
                  </div>
                ))}
                {(() => {
                  const who = identifyRole === "me" ? "your" : `${compDriver?.driverName ?? "their"}'s`;
                  const steps = identify.lines.filter((l) => {
                    const m = identifyPick[l.lineKey]?.movesWith;
                    return m != null && !m.mine;
                  });
                  const colour = identify.lines.filter(
                    (l) => identifyPick[l.lineKey]?.hint === "other" && !steps.includes(l)
                  );
                  // Taps that contradict the line order: S3 tapped at 6.6s but S2 — a later
                  // line — at 5.3s. Either a tap is wrong or the lines are numbered out of order.
                  const ordered = identify.lines
                    .map((l) => ({ label: l.label, pick: identifyPick[l.lineKey] }))
                    .filter((x) => x.pick);
                  const clash = ordered.find(
                    (x, k) => k > 0 && x.pick!.offsetSec < ordered[k - 1]!.pick!.offsetSec + MIN_SECTOR_GAP_SEC
                  );
                  if (clash) {
                    const before = ordered[ordered.indexOf(clash) - 1]!;
                    return (
                      <p className="rounded-lg border border-border bg-secondary/60 px-2.5 py-2 text-[11.5px] leading-relaxed text-foreground">
                        Your {clash.label} tap ({clash.pick!.offsetSec.toFixed(2)}s) comes before your{" "}
                        {before.label} tap ({before.pick!.offsetSec.toFixed(2)}s), but {before.label} is
                        earlier on the track. Either one tap is the wrong car, or the lines are numbered
                        out of order — fix that in Lines.
                      </p>
                    );
                  }
                  if (steps.length === 0 && colour.length === 0) return null;
                  return (
                    <p className="rounded-lg border border-border bg-secondary/60 px-2.5 py-2 text-[11.5px] leading-relaxed text-foreground">
                      {steps.length > 0
                        ? `The car you tapped at ${steps.map((l) => `${l.label} keeps step with ${identifyPick[l.lineKey]!.movesWith!.name}'s laps`).join(", ")}, not ${who} — `
                        : ""}
                      {colour.length > 0
                        ? `The car you tapped at ${colour.map((l) => l.label).join(", ")} is a different colour from the one the timing puts at the start line on ${who} laps — `
                        : ""}
                      worth a second look before going on.
                    </p>
                  );
                })()}
                {autoError ? (
                  <p className="text-[11.5px] leading-relaxed text-loss">{autoError}</p>
                ) : null}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAutoState("idle");
                      setIdentify(null);
                      setAutoProgress(null);
                    }}
                    className="rounded-lg border border-border bg-secondary px-3 py-2 text-[12px] font-semibold text-muted-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={Object.keys(identifyPick).length === 0}
                    onClick={() => void scanFromIdentifiedCar()}
                    className="flex-1 rounded-lg primary-face bg-primary px-3 py-2 text-[12px] font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    Find every crossing from {Object.keys(identifyPick).length} of{" "}
                    {identify.lines.length}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {/* The one action on the step, so it wears the yellow. The picker ("which one is
                    your car?") still opens on its own when two cars keep the same rhythm — the
                    button that asked for it up front came off with the paragraphs. */}
                <button
                  type="button"
                  disabled={!autoReady}
                  onClick={runFindCrossings}
                  className="w-full rounded-xl primary-face bg-primary py-3.5 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
                >
                  Find every crossing
                </button>
                {!videoSrc ? (
                  <p className="text-[11px] text-muted-foreground">Pick the video first.</p>
                ) : !autoReady ? (
                  <p className="text-[11px] text-muted-foreground">Draw the sector lines first.</p>
                ) : null}
                {autoError ? (
                  <p className="text-[11.5px] leading-relaxed text-loss">{autoError}</p>
                ) : null}
              </div>
            )}
          </div>

          {/* What was found, lap by lap — folded away, because it is a check rather than a
              job: every dot is a crossing the scan wrote, a tap jumps the picture to it. */}
          <details className="rounded-xl border border-border bg-secondary/50 px-2.5 py-2">
            <summary className="cursor-pointer text-[11.5px] font-semibold tabular-nums text-muted-foreground">
              Crossings · {markQueue.filter((t) => markFor(t) != null).length} of {markQueue.length}
            </summary>
            <div className="overflow-x-auto pt-2">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="table-col-header pb-1 text-left">Lap</th>
                  {nonSfLines.map((l) => (
                    <th key={l.lineKey} className="table-col-header pb-1 text-center">
                      {l.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from(new Set(markQueue.map((t) => `${t.role}:${t.lapNumber}`))).map((key) => {
                  const [role, lapStr] = key.split(":") as [DriverRole, string];
                  const lapNumber = Number(lapStr);
                  const cells = nonSfLines.map((l) => l.lineKey);
                  return (
                    <tr key={key}>
                      <td className="py-1 pr-2 tabular-nums text-[10px] text-muted-foreground">
                        {role === "me" ? "" : `${initialsOf(roster.find((p) => p.role === role)?.driver.driverName)}·`}
                        L{lapNumber}
                      </td>
                      {cells.map((lineKey) => {
                        const idx = markQueue.findIndex(
                          (t) => t.role === role && t.lapNumber === lapNumber && t.lineKey === lineKey
                        );
                        const done = idx >= 0 && markFor(markQueue[idx]!) != null;
                        const cur = idx === markCursor;
                        return (
                          <td key={lineKey} className="py-1 text-center">
                            <button
                              type="button"
                              aria-label={`Jump to ${lineKey} on lap ${lapNumber}`}
                              onClick={() => {
                                if (idx >= 0) {
                                  setMarkCursor(idx);
                                  jumpToTarget(idx);
                                }
                              }}
                              className={cn(
                                "inline-block h-3 w-3 rounded-full",
                                done
                                  ? "bg-gain shadow-[0_0_5px_rgba(79,208,137,0.5)]"
                                  : cur
                                    ? "bg-primary shadow-[0_0_6px_rgba(255,214,10,0.6)]"
                                    : "bg-border"
                              )}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </details>
          <button
            type="button"
            onClick={() => setStep(STEP.compare)}
            className={cn(
              "w-full rounded-xl py-3.5 text-[13px] font-semibold",
              hasAnalysis
                ? "primary-face bg-primary text-primary-foreground"
                : "border border-border bg-secondary text-muted-foreground"
            )}
          >
            View analysis
          </button>
        </>
      ) : null}
          </div>
        </div>
      ) : null}

      {step === STEP.scan && session && !draftLines && nonSfLines.length === 0 ? (
        <div className="space-y-3">
          <div>
            <h2 className="text-[16px] font-bold tracking-tight">No sector lines here yet</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Start/finish is already synced from timing — nothing to re-mark. Pick or draw a set of
              corner lines to get corner-by-corner deltas.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setStep(STEP.lines)}
            className="w-full rounded-xl primary-face bg-primary py-3.5 text-[13px] font-semibold text-primary-foreground"
          >
            Back to line sets
          </button>
          <button
            type="button"
            onClick={() => setStep(STEP.compare)}
            className="w-full rounded-lg border border-border bg-secondary py-2.5 text-[12px] font-semibold text-muted-foreground"
          >
            Skip — whole-lap compare only
          </button>
        </div>
      ) : null}

      {/* ---------- STEP 5: compare ----------
          No heading: the rail says COMPARE and the board is the page. The "Done — the session
          has it" line and its paragraph came off on 2026-09-02 with the rest of the blurbs. */}
      {step === STEP.compare && session && !draftLines ? (
        <div className="space-y-3">

          {/* The footage stays on the device, so a reopened session has the numbers and no
              picture. Ask for the file HERE — the compare is already on screen — never by
              sending the driver back to step one. */}
          {!videoSrc ? (
            <div className="space-y-2 rounded-lg border border-dashed border-border bg-secondary/40 px-3 py-2.5 lg:max-w-2xl">
              <div className="flex flex-wrap items-center gap-2">
                <Film className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-muted-foreground">
                  {local.error ??
                    `${session.localVideoName ?? "The video"} stays on this device — open it to watch each sector. The numbers below don't need it.`}
                </span>
                {local.rememberedName && !local.error ? (
                  <button
                    type="button"
                    onClick={() => void local.reopenRemembered()}
                    className="shrink-0 rounded-lg primary-face bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground"
                  >
                    Reopen {local.rememberedName.length > 18 ? "video" : local.rememberedName}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    if (local.canRemember) void local.pickWithPicker();
                    else doneFileInputRef.current?.click();
                  }}
                  className={cn(
                    "shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold",
                    local.rememberedName && !local.error
                      ? "border border-border bg-secondary hover:bg-muted"
                      : "primary-face bg-primary text-primary-foreground"
                  )}
                >
                  Open video
                </button>
                <input
                  ref={doneFileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) local.attachFile(f);
                    e.target.value = "";
                  }}
                />
              </div>
              {/* Only the library copy of THIS session's file: a tap here links the asset to
                  the session for good, and a list of every upload would offer the wrong race. */}
              {doneLibraryMatches.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="micro-caps text-faint">From library</span>
                  {doneLibraryMatches.slice(0, 3).map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => void pickLibraryAsset(v)}
                      className="inline-flex max-w-[14rem] items-center gap-1 rounded-md border border-border bg-secondary px-2 py-1 text-[11px] font-semibold hover:bg-muted"
                    >
                      <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="truncate">{v.label?.trim() || v.originalFilename}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {doneReport ? (
            // The compare itself, not a preview of it: tap the second lap to set it from
            // another car (Sandy's best against yours), tap a sector to watch both. Until this
            // the full compare lived only inside a run, and an analysis without a run — the
            // common case from Tools — had nowhere to be looked at.
            // The video first, then ONE table under it: you as the flat base, one driver as the
            // coloured overlay (the lap sheet's grammar). The lap-vs-lap compare used to sit
            // under this with a second player of its own — "two videos, which I don't really
            // understand" — and lives on the run's Video section instead.
            <DriverComparePanel
              key={`drivers-${session.marks.length}-${session.lastScan?.at ?? ""}`}
              session={session}
              lines={drawnLines}
              videoUrl={videoSrc}
            />
          ) : (
            <p className="rounded-lg border border-border bg-secondary/50 px-3 py-3 text-[12px] text-muted-foreground">
              No compare yet — it needs at least two laps with a synced start (anchor in the Sync
              step).
            </p>
          )}

          {/* Quiet, not yellow: the board above is the work, and leaving it is not the action.
              Page-wide on desktop it would be a 1,700px bar; it keeps a phone's measure. */}
          <div className="space-y-3 lg:max-w-md">
          <Link
            href={backHref}
            className="block w-full rounded-xl border border-border bg-secondary py-3 text-center text-[12.5px] font-semibold text-muted-foreground no-underline hover:text-foreground"
          >
            {data.job.runId ? "Open in session" : "Back to Video"}
          </Link>

          {pickedFile && uploadState !== "done" ? (
            <div className="flex items-center justify-center gap-2">
              <span className="text-[11.5px] text-muted-foreground">
                Save video to library for clips anywhere?
              </span>
              <button
                type="button"
                disabled={uploadState === "busy"}
                onClick={() => void saveToLibrary()}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-60"
              >
                <Upload className="h-3 w-3" aria-hidden />
                {uploadState === "busy"
                  ? `Uploading…${uploadPct != null ? ` ${uploadPct}%` : ""}`
                  : `Save · ${Math.max(1, Math.round(pickedFile.size / (1024 * 1024)))}MB`}
              </button>
            </div>
          ) : uploadState === "done" ? (
            <p className="text-center text-[11px] text-gain">Saved to library — clips enabled.</p>
          ) : null}
          {uploadError ? <p className="text-center text-[11px] text-destructive">{uploadError}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Fine scrub wheel — drag horizontally, 1px = 4ms, ticks give tactile feedback. */
function FineWheel({
  onDelta,
  className,
}: {
  onDelta: (dxPx: number) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ lastX: number; acc: number } | null>(null);

  return (
    <div
      ref={ref}
      className={cn(
        "relative h-12 touch-none select-none overflow-hidden rounded-xl border border-border bg-secondary",
        className
      )}
      style={{ cursor: "ew-resize" }}
      onPointerDown={(e) => {
        dragRef.current = { lastX: e.clientX, acc: 0 };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (!d) return;
        const dx = e.clientX - d.lastX;
        d.lastX = e.clientX;
        d.acc -= dx;
        const ticks = ref.current?.querySelector<HTMLElement>("[data-ticks]");
        if (ticks) ticks.style.backgroundPosition = `${-d.acc}px 0`;
        onDelta(-dx);
      }}
      onPointerUp={() => (dragRef.current = null)}
      onPointerCancel={() => (dragRef.current = null)}
      aria-label="Fine scrub — drag horizontally"
      role="slider"
    >
      <div
        data-ticks
        className="absolute inset-0"
        style={{
          background:
            "repeating-linear-gradient(90deg, transparent 0 11px, rgba(236,233,228,.14) 11px 12px)",
        }}
      />
      <div className="absolute bottom-0 left-1/2 top-0 w-[2px] bg-primary shadow-[0_0_8px_rgba(255,214,10,0.5)]" />
      <span className="absolute inset-x-0 bottom-1 text-center tabular-nums text-[8.5px] tracking-[0.18em] text-faint">
        DRAG · 1PX = 4MS
      </span>
    </div>
  );
}
