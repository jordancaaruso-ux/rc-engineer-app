"use client";

/**
 * Mobile-first analyze flow (VIDEO_ANALYSIS_REWORK Phase B, prototype-approved
 * 2026-07-11): Video → Timing → Sync → Mark → Done as a guided step rail, with a
 * touch transport (coarse scrub + fine wheel at 1px = 4ms + ±1-frame nudges) and
 * a guided marking queue that auto-jumps near each predicted crossing.
 *
 * Data layer is the existing manual session schema (manualJson v2) and sync
 * math — this component replaces only the UX of UnifiedVideoAnalysisClient.
 * Marks feed the same compare surface as worker results (manualCompareAdapter).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, Film, FolderOpen, Pause, Play, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { chipToggleClass } from "@/components/ui/chipToggle";
import type {
  DriverRole,
  ManualDriver,
  ManualTimingSession,
  ManualVideoSessionV2,
} from "@/lib/manualVideoAnalysis/types";
import { lapSfKey, LAP_START_LINE_KEY } from "@/lib/manualVideoAnalysis/types";
import {
  applyDefaultIsOnVideo,
  applyTop3LapSelection,
  defaultDriverKeys,
  normalizeManualSession,
  setDriverRoles,
} from "@/lib/manualVideoAnalysis/timing";
import {
  findTimingSession,
  primaryTimingSession,
  referenceAnchoredSession,
  updateTimingSession,
  videoTimeAtLapSf,
} from "@/lib/manualVideoAnalysis/sessionModel";
import {
  compareLaps,
  defaultLapPair,
  formatSignedDeltaSec,
} from "@/lib/videoAnalysis/lapCompare";
import { compareCarsFromManualSession } from "@/lib/videoAnalysis/manualCompareAdapter";

const FRAME_SEC = 1 / 60;
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

type Step = 1 | 2 | 3 | 4 | 5 | 6;
const STEP_LABELS: Record<Step, string> = {
  1: "Video",
  2: "Timing",
  3: "Lines",
  4: "Sync",
  5: "Mark",
  6: "Done",
};

/** A saved set of sector lines for this track (one camera angle / one way of splitting it). */
type LineSet = {
  id: string;
  name: string;
  sectorLines: Array<{ lineKey: string }>;
  updatedAt: string;
};

type MarkTarget = { role: DriverRole; lapNumber: number; lineKey: string; label: string };

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(3).padStart(6, "0");
  return `${String(m).padStart(2, "0")}:${s}`;
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
  const [step, setStep] = useState<Step>(1);
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
  const [urlLaneOpen, setUrlLaneOpen] = useState(false);
  const [timingUrls, setTimingUrls] = useState("");
  const [anchorLap, setAnchorLap] = useState<number | null>(null);
  const [markCursor, setMarkCursor] = useState(0);
  const [uploadState, setUploadState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  // In-flow sector line editor — null when closed. Lines are drawn as overlays
  // on the (fixed-camera) video frame in normalized 0..1 coords.
  const [draftLines, setDraftLines] = useState<DraftLine[] | null>(null);
  const [savingLines, setSavingLines] = useState(false);
  const [lineSets, setLineSets] = useState<LineSet[]>([]);
  const [switchingSet, setSwitchingSet] = useState(false);
  const [videoDims, setVideoDims] = useState<{ w: number; h: number } | null>(null);
  const lineDragRef = useRef<{ idx: number; end: 1 | 2 } | null>(null);
  const overlayElRef = useRef<HTMLDivElement | null>(null);

  /* ---------- load ---------- */

  const load = useCallback(async () => {
    const res = await fetch(`/api/video-analysis/jobs/${jobId}`);
    if (!res.ok) return;
    const json = (await res.json()) as JobData;
    setData(json);
    const s = json.manual?.session ? normalizeManualSession(json.manual.session) : null;
    if (s) {
      setSession(s);
      setTimingUrls((s.timingUrls ?? []).join("\n"));
    }
    if (json.job.videoAssetId) {
      setVideoSrc(videoUrlForAsset(json.job.videoAssetId));
    }
    // Resume at the furthest sensible step. Geometry (Lines) comes before the
    // temporal steps now: not yet anchored → Lines; anchored → Mark (its no-lines
    // fallback routes back to Lines if a resumed session somehow has no corners).
    const anchored = s ? Boolean(referenceAnchoredSession(s)) : false;
    if (json.job.videoAssetId && s && s.timingSessions.length > 0) {
      setStep(anchored ? 5 : 3);
    } else if (json.job.videoAssetId) {
      setStep(2);
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
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [load]);

  /* ---------- persistence (same contract as the legacy client) ---------- */

  async function persistSession(next: ManualVideoSessionV2) {
    const normalized = normalizeManualSession(next);
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

  function schedulePersist(next: ManualVideoSessionV2) {
    setSession(next);
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => void persistSession(next), 500);
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
    if (session) schedulePersist({ ...session, localVideoName: file.name });
    setStep(2);
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
    if (session) schedulePersist({ ...session, localVideoName: asset.originalFilename });
    setStep(2);
  }

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
    const timingSessions = applyDefaultIsOnVideo(
      loaded.map((ts) => ({
        ...ts,
        drivers: setDriverRoles(ts.drivers, defaults.meKey, comp),
      }))
    );
    const next = normalizeManualSession(
      applyTop3LapSelection({
        ...session,
        timingSource: source,
        timingUrls: source === "url" ? urls ?? [] : session.timingUrls,
        timingSessions,
        compare: { ...session.compare, my: null, competitor: null, offsetNudgeSec: 0 },
      })
    );
    void persistSession(next);
    setMsg(null);
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

  async function loadUrlTiming() {
    const urls = timingUrls.split(/\n/).map((u) => u.trim()).filter(Boolean);
    if (!urls.length) {
      setMsg("Paste one or more LiveRC / timing URLs (one per line).");
      return;
    }
    setTimingLoading(true);
    try {
      const res = await fetch("/api/video-analysis/manual/parse-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        error?: string;
        sessions?: ManualTimingSession[];
        drivers?: ManualDriver[];
        defaults?: { meKey: string; competitorKey: string };
      };
      if (!res.ok) throw new Error(d.error || "Could not load timing");
      const drivers = d.drivers ?? [];
      applyTimingSessions(
        d.sessions ?? [],
        drivers,
        d.defaults ?? defaultDriverKeys(drivers),
        "url",
        urls
      );
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not load timing");
    } finally {
      setTimingLoading(false);
    }
  }

  function toggleSelectedLap(role: DriverRole, lapNumber: number) {
    if (!session) return;
    const cur = session.selectedLaps[role === "me" ? "me" : "competitor"];
    const next = cur.includes(lapNumber)
      ? cur.filter((n) => n !== lapNumber)
      : [...cur, lapNumber].sort((a, b) => a - b);
    schedulePersist({
      ...session,
      selectedLaps: { ...session.selectedLaps, [role === "me" ? "me" : "competitor"]: next },
    });
  }

  /* ---------- sync ---------- */

  const primary = session ? primaryTimingSession(session) : undefined;
  const meDriver = primary?.drivers.find((d) => d.role === "me");
  const compDriver = primary?.drivers.find((d) => d.role === "competitor");
  const anchored = session ? Boolean(referenceAnchoredSession(session)) : false;

  const selectedMeLaps = useMemo(() => {
    if (!meDriver || !session) return [];
    return meDriver.laps
      .filter((l) => session.selectedLaps.me.includes(l.lapNumber))
      .sort((a, b) => a.lapTimeSec - b.lapTimeSec);
  }, [meDriver, session]);

  useEffect(() => {
    if (anchorLap == null && selectedMeLaps.length) setAnchorLap(selectedMeLaps[0]!.lapNumber);
  }, [selectedMeLaps, anchorLap]);

  function lapStartVideoTime(role: DriverRole, lapNumber: number): number | null {
    if (!session || !primary) return null;
    return videoTimeAtLapSf(session, primary.sessionId, role, lapNumber, "sf_start");
  }

  function setAnchorAtPlayhead() {
    if (!session || !primary || anchorLap == null) return;
    const t = playheadTime();
    const next = updateTimingSession(session, primary.sessionId, {
      isOnVideo: true,
      sync: {
        ...primary.sync,
        perLapSfStart: undefined,
        perLapSfEnd: undefined,
        anchor: {
          videoTimeSec: t,
          lapNumber: anchorLap,
          driverRole: "me",
          anchorKind: "sf_start",
        },
      },
    });
    void persistSession(next);
    setMsg(`L${anchorLap} start anchored @ ${t.toFixed(3)}s — every lap is now mapped.`);
  }

  function pinSelectedLapHere() {
    if (!session || !primary || anchorLap == null) return;
    const t = playheadTime();
    const next = updateTimingSession(session, primary.sessionId, {
      sync: {
        ...primary.sync,
        perLapSfStart: {
          ...primary.sync.perLapSfStart,
          [lapSfKey("me", anchorLap)]: t,
        },
      },
    });
    schedulePersist(next);
    setMsg(`L${anchorLap} start pinned here.`);
  }

  /* ---------- marking ---------- */

  const nonSfLines = useMemo(
    () =>
      (data?.sectorLines ?? [])
        .filter((l) => l.lineKey !== "sf")
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [data]
  );

  const markQueue = useMemo<MarkTarget[]>(() => {
    if (!session) return [];
    const targets: MarkTarget[] = [];
    const roles: DriverRole[] = ["me", "competitor"];
    for (const role of roles) {
      const laps = session.selectedLaps[role === "me" ? "me" : "competitor"];
      const driver = role === "me" ? meDriver : compDriver;
      if (!driver) continue;
      // No SF targets: Mark is only reachable once anchored, and anchored
      // sessions already know every SF crossing from transponder lap times
      // (the compare adapter derives lap end as start + lapTime).
      for (const lapNumber of laps) {
        for (const line of nonSfLines) {
          targets.push({ role, lapNumber, lineKey: line.lineKey, label: line.label });
        }
      }
    }
    return targets;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.selectedLaps, nonSfLines, meDriver, compDriver]);

  function markFor(t: MarkTarget): number | undefined {
    return session?.marks.find(
      (m) =>
        m.sessionId === primary?.sessionId &&
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
    const sibling = session.marks.find(
      (m) =>
        m.sessionId === primary.sessionId &&
        m.lineKey === t.lineKey &&
        (m.driverRole !== t.role || m.lapNumber !== t.lapNumber)
    );
    if (sibling) {
      const sibStart = lapStartVideoTime(sibling.driverRole, sibling.lapNumber);
      if (sibStart != null) return start + (sibling.videoTimeSec - sibStart);
    }
    const driver = t.role === "me" ? meDriver : compDriver;
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
    if (step !== 5 || !markQueue.length || draftLines) return;
    // Start at the first unmarked target — also fires when lines are first
    // saved from the in-flow editor and the queue materializes.
    const firstOpen = markQueue.findIndex((t) => markFor(t) == null);
    const idx = firstOpen === -1 ? 0 : firstOpen;
    setMarkCursor(idx);
    jumpToTarget(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, markQueue.length, draftLines == null]);

  function advanceCursor(from: number) {
    const nextIdx = from + 1;
    if (nextIdx >= markQueue.length) {
      setStep(6);
      return;
    }
    setMarkCursor(nextIdx);
    jumpToTarget(nextIdx);
  }

  function confirmMark() {
    if (!session || !primary) return;
    const t = markQueue[markCursor];
    if (!t) {
      setStep(6);
      return;
    }
    const videoTimeSec = playheadTime();
    const marks = session.marks.filter(
      (m) =>
        !(
          m.sessionId === primary.sessionId &&
          m.driverRole === t.role &&
          m.lapNumber === t.lapNumber &&
          m.lineKey === t.lineKey
        )
    );
    marks.push({
      sessionId: primary.sessionId,
      driverRole: t.role,
      lapNumber: t.lapNumber,
      lineKey: t.lineKey,
      videoTimeSec,
    });
    schedulePersist({ ...session, marks });
    advanceCursor(markCursor);
  }

  /* ---------- line sets ---------- */

  /** Point this session at a different saved split. Marks stay keyed by lineKey,
   * so switching sets can orphan them — the picker warns before you do it. */
  async function useLineSet(profileId: string) {
    if (!data || profileId === data.job.profile.id) return;
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
  }

  function endLineDrag() {
    lineDragRef.current = null;
  }

  function dragLinePoint(clientX: number, clientY: number, idx: number, end: 1 | 2) {
    const d = lineDragRef.current;
    const rect = overlayElRef.current?.getBoundingClientRect();
    if (!d || !rect || !rect.width || !rect.height || d.idx !== idx || d.end !== end) return;
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

  async function saveSectorLines() {
    if (!draftLines || !data) return;
    setSavingLines(true);
    try {
      const res = await fetch(
        `/api/video-analysis/profiles/${encodeURIComponent(data.job.profile.id)}/sectors`,
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
      setData((d) => (d ? { ...d, sectorLines: lines } : d));
      setDraftLines(null);
      void loadLineSets(data.job.track.id);
      setMsg(
        lines.length > 1
          ? `Saved to ${data.job.profile.name} — mark each crossing now.`
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
  }, [session, data, step === 6 ? session?.marks.length : 0]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveToLibrary() {
    if (!pickedFile) return;
    setUploadState("busy");
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", pickedFile);
      if (data?.job.runId) form.append("runId", data.job.runId);
      const res = await fetch("/api/videos", { method: "POST", body: form });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        video?: { id?: string };
        id?: string;
      };
      if (!res.ok) throw new Error(payload.error || `Upload failed (${res.status})`);
      const assetId = payload.video?.id ?? payload.id;
      if (assetId) {
        await fetch(`/api/video-analysis/jobs/${jobId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoAssetId: assetId }),
        });
      }
      setUploadState("done");
    } catch (err) {
      setUploadState("error");
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    }
  }

  /* ---------- render ---------- */

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const stepDone = (s: Step): boolean => {
    if (s === 1) return Boolean(videoSrc);
    if (s === 2) return Boolean(session && session.timingSessions.length > 0);
    if (s === 3) return nonSfLines.length > 0;
    if (s === 4) return anchored;
    if (s === 5) return markQueue.length > 0 && markQueue.every((t) => markFor(t) != null);
    return false;
  };

  const canEnter = (s: Step): boolean => {
    if (s === 1) return true;
    if (s === 2) return Boolean(videoSrc);
    if (s === 3) return stepDone(2) && Boolean(videoSrc);
    if (s === 4) return stepDone(2) && Boolean(videoSrc);
    return anchored;
  };

  const backHref = data.job.runId ? "/runs/history" : "/videos";

  // Video-bearing steps go two-pane (big video + controls rail) on desktop; the
  // rest stay a single narrow column.
  const isVideoStep =
    step === 3 || step === 4 || (step === 5 && nonSfLines.length > 0) || Boolean(draftLines);

  // The video sits object-contain in a 16:9 box — the overlay must cover the
  // painted frame (line coords are normalized to it), not the letterbox.
  const contentRect = (() => {
    if (!videoDims || !videoDims.w || !videoDims.h) {
      return { left: "0%", top: "0%", width: "100%", height: "100%" };
    }
    const va = videoDims.w / videoDims.h;
    const ca = 16 / 9;
    if (va >= ca) {
      const h = (ca / va) * 100;
      return { left: "0%", top: `${(100 - h) / 2}%`, width: "100%", height: `${h}%` };
    }
    const w = (va / ca) * 100;
    return { left: `${(100 - w) / 2}%`, top: "0%", width: `${w}%`, height: "100%" };
  })();

  // Static guide lines: SF while syncing, the current target while marking.
  const staticGuides: DraftLine[] = (() => {
    if (draftLines) return [];
    const withGeom = (l?: SectorLineApi): DraftLine | null =>
      l && l.x1 != null && l.y1 != null && l.x2 != null && l.y2 != null
        ? { lineKey: l.lineKey, label: l.label, x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 }
        : null;
    if (step === 3) {
      // Previewing a set: show every line it holds.
      return data.sectorLines.map(withGeom).filter((l): l is DraftLine => l != null);
    }
    if (step === 4) {
      const sf = withGeom(data.sectorLines.find((l) => l.lineKey === "sf"));
      return sf ? [sf] : [];
    }
    if (step === 5) {
      const target = markQueue[markCursor];
      const line = withGeom(data.sectorLines.find((l) => l.lineKey === target?.lineKey));
      return line ? [line] : [];
    }
    return [];
  })();

  const overlayLines = draftLines ?? staticGuides;

  const lineOverlay = overlayLines.length ? (
    <div
      ref={overlayElRef}
      className={cn("absolute", draftLines ? "touch-none" : "pointer-events-none")}
      style={contentRect}
    >
      <svg
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        {overlayLines.map((l) => (
          <line
            key={l.lineKey}
            x1={l.x1 * 1000}
            y1={l.y1 * 1000}
            x2={l.x2 * 1000}
            y2={l.y2 * 1000}
            stroke={l.lineKey === "sf" ? "#ECE9E4" : "#FFD60A"}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            strokeDasharray={l.lineKey === "sf" ? "6 4" : undefined}
          />
        ))}
      </svg>
      {overlayLines.map((l) => (
        <span
          key={`lbl-${l.lineKey}`}
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-[150%] rounded bg-background/70 px-1 py-px font-mono text-[9px] text-foreground backdrop-blur-sm"
          style={{ left: `${((l.x1 + l.x2) / 2) * 100}%`, top: `${((l.y1 + l.y2) / 2) * 100}%` }}
        >
          {l.label}
        </span>
      ))}
      {/* eslint-disable-next-line react-hooks/refs -- drag refs are read only inside pointer handlers, never during render */}
      {draftLines?.map((l, idx) =>
        ([1, 2] as const).map((end) => (
          <button
            key={`${l.lineKey}-${end}`}
            type="button"
            aria-label={`Move ${l.label} endpoint ${end}`}
            onPointerDown={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              beginLineDrag(idx, end);
            }}
            onPointerMove={(e) => dragLinePoint(e.clientX, e.clientY, idx, end)}
            onPointerUp={() => endLineDrag()}
            onPointerCancel={() => endLineDrag()}
            className={cn(
              "absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-background/70",
              l.lineKey === "sf" ? "border-foreground/60" : "border-primary"
            )}
            style={{
              left: `${(end === 1 ? l.x1 : l.x2) * 100}%`,
              top: `${(end === 1 ? l.y1 : l.y2) * 100}%`,
            }}
          />
        ))
      )}
    </div>
  ) : null;

  const transport = (
    <div className="space-y-2.5">
      <div className="relative overflow-hidden rounded-xl border border-border bg-black">
        <video
          ref={videoRef}
          src={videoSrc ?? undefined}
          muted
          playsInline
          preload="auto"
          className="aspect-video w-full object-contain"
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration || 0);
            setVideoDims({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight });
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
          onClick={togglePlay}
        />
        <span
          ref={timecodeElRef}
          className="pointer-events-none absolute bottom-2 left-2 rounded bg-background/70 px-2 py-0.5 font-mono text-[12px] tabular-nums text-foreground backdrop-blur-sm"
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
        {lineOverlay}
      </div>
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
        className="h-7 w-full accent-[#FFD60A]"
      />
      <FineWheel onDelta={(dxPx) => nudge(dxPx * FINE_SEC_PER_PX)} />
      <div className="flex gap-2">
        <button type="button" onClick={() => nudge(-FRAME_SEC)} className="h-11 flex-1 rounded-lg border border-border bg-secondary font-mono text-[12px] text-foreground active:bg-muted">
          −1 frame
        </button>
        <button type="button" onClick={() => nudge(FRAME_SEC)} className="h-11 flex-1 rounded-lg border border-border bg-secondary font-mono text-[12px] text-foreground active:bg-muted">
          +1 frame
        </button>
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-4 pb-10",
        isVideoStep ? "max-w-md lg:max-w-6xl" : "max-w-md"
      )}
    >
      {/* header */}
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-[10px] uppercase tracking-[0.22em] text-faint">
          Analyze · {data.job.track.name}
        </span>
        <span className="flex items-center gap-2">
          {saving ? (
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-faint">Saving…</span>
          ) : null}
          <Link
            href={backHref}
            className="rounded-md border border-border bg-secondary px-2.5 py-1 text-[11px] font-semibold text-muted-foreground no-underline hover:text-foreground"
          >
            ✕ Close
          </Link>
        </span>
      </div>

      {/* step rail */}
      <div className="flex gap-1.5">
        {([1, 2, 3, 4, 5, 6] as Step[]).map((s) => (
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
                  ? "bg-primary shadow-[0_0_8px_rgba(255,214,10,0.4)]"
                  : stepDone(s)
                    ? "bg-primary/40"
                    : "bg-border"
              )}
            />
            <span
              className={cn(
                "font-mono text-[8.5px] uppercase tracking-[0.14em]",
                s === step ? "text-foreground" : "text-faint"
              )}
            >
              {STEP_LABELS[s]}
            </span>
          </button>
        ))}
      </div>

      {msg ? <p className="text-[11.5px] leading-relaxed text-muted-foreground">{msg}</p> : null}

      {/* ---------- STEP 1: video ---------- */}
      {step === 1 ? (
        <div className="space-y-3">
          <div>
            <h2 className="text-[16px] font-bold tracking-tight">Pick the video</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Straight from your camera roll — nothing uploads unless you save it.
            </p>
          </div>
          <label className="flex w-full cursor-pointer flex-col items-center gap-2 rounded-2xl border-[1.5px] border-dashed border-foreground/20 bg-secondary px-4 py-7 text-[13px] font-semibold">
            <Film className="h-6 w-6 text-muted-foreground" aria-hidden />
            Choose from camera roll
            {session?.localVideoName ? (
              <span className="text-[11px] font-normal text-faint">
                {session.localVideoName} was used last time — pick it again to relink
              </span>
            ) : null}
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
            />
          </label>
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
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---------- STEP 2: timing ---------- */}
      {step === 2 && session ? (
        <div className="space-y-3">
          <div>
            <h2 className="text-[16px] font-bold tracking-tight">Where do lap times come from?</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Sector marks get their lap structure from real timing.
            </p>
          </div>

          {data.job.runId ? (
            <button
              type="button"
              disabled={timingLoading}
              onClick={() => void loadRunTiming()}
              className="flex w-full items-center gap-3 rounded-xl border border-primary/50 bg-primary/5 px-3.5 py-3 text-left disabled:opacity-60"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">This run&apos;s laps</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {timingLoading ? "Loading…" : "Imported timing from the linked run"}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => setUrlLaneOpen((v) => !v)}
            className="w-full rounded-xl border border-border bg-secondary px-3.5 py-3 text-left text-[13px] font-semibold"
          >
            Paste LiveRC URL{data.job.runId ? " instead" : ""}
          </button>
          {urlLaneOpen || !data.job.runId ? (
            <div className="space-y-2">
              <textarea
                value={timingUrls}
                onChange={(e) => setTimingUrls(e.target.value)}
                rows={3}
                placeholder="https://…liverc… (one per line)"
                className="w-full rounded-lg border border-border bg-secondary p-2.5 font-mono text-[11px] text-foreground"
              />
              <button
                type="button"
                disabled={timingLoading}
                onClick={() => void loadUrlTiming()}
                className="rounded-lg bg-primary px-3.5 py-2 text-[12px] font-bold text-primary-foreground disabled:opacity-60"
              >
                {timingLoading ? "Loading…" : "Load laps"}
              </button>
            </div>
          ) : null}

          {meDriver ? (
            <div className="space-y-2 border-t border-border pt-3">
              <span className="type-data-label">Your laps to analyze (best 3 pre-selected)</span>
              <div className="flex flex-wrap gap-1.5">
                {[...meDriver.laps]
                  .filter((l) => l.lapTimeSec > 0 && l.isIncluded !== false)
                  .sort((a, b) => a.lapTimeSec - b.lapTimeSec)
                  .slice(0, 10)
                  .map((l) => (
                    <button
                      key={l.lapNumber}
                      type="button"
                      onClick={() => toggleSelectedLap("me", l.lapNumber)}
                      className={cn(
                        chipToggleClass(session.selectedLaps.me.includes(l.lapNumber)),
                        "px-2.5 py-1.5 font-mono text-[11px] tabular-nums"
                      )}
                    >
                      L{l.lapNumber} · {l.lapTimeSec.toFixed(3)}
                    </button>
                  ))}
              </div>
              {compDriver ? (
                <>
                  <span className="type-data-label">{compDriver.driverName}&apos;s laps (optional)</span>
                  <div className="flex flex-wrap gap-1.5">
                    {[...compDriver.laps]
                      .filter((l) => l.lapTimeSec > 0 && l.isIncluded !== false)
                      .sort((a, b) => a.lapTimeSec - b.lapTimeSec)
                      .slice(0, 6)
                      .map((l) => (
                        <button
                          key={l.lapNumber}
                          type="button"
                          onClick={() => toggleSelectedLap("competitor", l.lapNumber)}
                          className={cn(
                            chipToggleClass(session.selectedLaps.competitor.includes(l.lapNumber)),
                            "px-2.5 py-1.5 font-mono text-[11px] tabular-nums"
                          )}
                        >
                          L{l.lapNumber} · {l.lapTimeSec.toFixed(3)}
                        </button>
                      ))}
                  </div>
                </>
              ) : null}
              <button
                type="button"
                disabled={session.selectedLaps.me.length === 0}
                onClick={() => setStep(3)}
                className="w-full rounded-xl bg-primary py-3.5 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---------- STEP 4: sync ---------- */}
      {step === 4 && session ? (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-5 lg:items-start">
          <div className="lg:sticky lg:top-4">{transport}</div>
          <div className="mt-4 space-y-3 lg:mt-0">
          <div>
            <h2 className="text-[16px] font-bold tracking-tight">Sync the laps</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Scrub to where the car crosses start/finish on{" "}
              <span className="font-semibold text-foreground">any one lap</span>, pick that lap
              below, and set it. Every other lap syncs from the timing — you only do this once.
            </p>
          </div>
          <div className="space-y-1.5">
            <span className="type-data-label">Which lap are you watching?</span>
            <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
              {selectedMeLaps.map((l, i) => (
                <button
                  key={l.lapNumber}
                  type="button"
                  onClick={() => {
                    setAnchorLap(l.lapNumber);
                    const t = lapStartVideoTime("me", l.lapNumber);
                    if (t != null) seekTo(t);
                  }}
                  className={cn(
                    chipToggleClass(anchorLap === l.lapNumber),
                    "shrink-0 px-3 py-2 font-mono text-[11px] tabular-nums"
                  )}
                >
                  L{l.lapNumber} · {l.lapTimeSec.toFixed(3)}
                  {i === 0 ? <span className="ml-1 text-[8px] tracking-[0.12em] text-[#4FD089]">BEST</span> : null}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            disabled={anchorLap == null || !videoSrc}
            onClick={setAnchorAtPlayhead}
            className={cn(
              "w-full rounded-xl py-3.5 text-[13px] font-bold disabled:opacity-50",
              anchored
                ? "border border-border bg-secondary text-foreground"
                : "bg-primary text-primary-foreground"
            )}
          >
            {anchored
              ? `Move the anchor to this frame (L${anchorLap ?? "?"})`
              : `Set L${anchorLap ?? "?"} start here`}
          </button>
          {anchored ? (
            <>
              <button
                type="button"
                onClick={() => setStep(5)}
                className="w-full rounded-xl bg-primary py-3.5 text-[13px] font-bold text-primary-foreground"
              >
                Continue to marking
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
                  Pin L{anchorLap ?? "?"} to the current frame
                </button>
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">
                  Optional — the anchor already maps every lap from the timing. Use this only if one
                  lap&apos;s computed start looks off; it overrides just that lap.
                </p>
              </details>
            </>
          ) : null}
          </div>
        </div>
      ) : null}

      {/* ---------- line editor (opens from Lines / Mark) ---------- */}
      {session && draftLines ? (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-5 lg:items-start">
          <div className="lg:sticky lg:top-4">{transport}</div>
          <div className="mt-4 space-y-3 lg:mt-0">
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
                <span className="w-7 shrink-0 text-center font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
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
                  <span className="shrink-0 pr-1 font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
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
          <div className="flex gap-2">
            <button
              type="button"
              disabled={savingLines}
              onClick={() => setDraftLines(null)}
              className="rounded-xl border border-border bg-secondary px-4 py-3 text-[12.5px] font-semibold text-muted-foreground disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={savingLines}
              onClick={() => void saveSectorLines()}
              className="flex-1 rounded-xl bg-primary py-3 text-[13px] font-bold text-primary-foreground disabled:opacity-60"
            >
              {savingLines ? "Saving…" : "Save lines"}
            </button>
          </div>
          </div>
        </div>
      ) : null}

      {/* ---------- STEP 3: line sets ---------- */}
      {step === 3 && session && !draftLines ? (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-5 lg:items-start">
          <div className="lg:sticky lg:top-4">{transport}</div>
          <div className="mt-4 space-y-3 lg:mt-0">
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
                    inUse ? "border-primary/60 bg-primary/5" : "border-border bg-secondary/60"
                  )}
                >
                  <button
                    type="button"
                    disabled={switchingSet}
                    onClick={() => void useLineSet(s.id)}
                    className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left disabled:opacity-60"
                  >
                    <span className="w-full truncate text-[12.5px] font-semibold text-foreground">
                      {s.name}
                    </span>
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">
                      {corners === 0 ? "no corner lines" : `${corners} corner${corners === 1 ? "" : "s"}`}
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
                className="w-full rounded-xl bg-primary py-3.5 text-[13px] font-bold text-primary-foreground"
              >
                Draw sector lines
              </button>
              <button
                type="button"
                onClick={() => setStep(anchored ? 6 : 4)}
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
                onClick={() => setStep(anchored ? 5 : 4)}
                className="flex-1 rounded-xl bg-primary py-3 text-[13px] font-bold text-primary-foreground"
              >
                {anchored ? "Continue to marking" : "Continue to sync"}
              </button>
            </div>
          )}
          </div>
        </div>
      ) : null}

      {step === 5 && session && !draftLines && nonSfLines.length === 0 ? (
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
            onClick={() => setStep(3)}
            className="w-full rounded-xl bg-primary py-3.5 text-[13px] font-bold text-primary-foreground"
          >
            Back to line sets
          </button>
          <button
            type="button"
            onClick={() => setStep(6)}
            className="w-full rounded-lg border border-border bg-secondary py-2.5 text-[12px] font-semibold text-muted-foreground"
          >
            Skip — whole-lap compare only
          </button>
        </div>
      ) : null}

      {step === 5 && session && !draftLines && nonSfLines.length > 0 ? (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-5 lg:items-start">
          <div className="space-y-2.5 lg:sticky lg:top-4">
            {markQueue[markCursor] ? (
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">
                {markQueue[markCursor]!.role === "competitor" ? `${compDriver?.driverName ?? "Rival"} · ` : ""}
                L{markQueue[markCursor]!.lapNumber} · {markQueue[markCursor]!.label} line
              </p>
            ) : null}
            {transport}
          </div>
          <div className="mt-4 space-y-3 lg:mt-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-[16px] font-bold tracking-tight">Mark sector crossings</h2>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                Start/finish is already synced. The video jumps near each corner crossing —
                fine-tune and confirm.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="shrink-0 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground"
            >
              Lines
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => advanceCursor(markCursor)}
              className="rounded-xl border border-border bg-secondary px-4 py-3.5 text-[12.5px] font-semibold text-muted-foreground"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={confirmMark}
              className="flex-1 rounded-xl bg-primary py-3.5 text-[13px] font-bold text-primary-foreground"
            >
              {markCursor >= markQueue.length ? "Finish →" : "Mark crossing"}
            </button>
          </div>

          {/* progress */}
          <div className="overflow-x-auto rounded-xl border border-border bg-secondary/50 p-2.5">
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
                      <td className="py-1 pr-2 font-mono text-[10.5px] text-muted-foreground">
                        {role === "competitor" ? "R·" : ""}L{lapNumber}
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
                                  ? "bg-[#4FD089] shadow-[0_0_5px_rgba(79,208,137,0.5)]"
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
          <button
            type="button"
            onClick={() => setStep(6)}
            className="w-full rounded-lg border border-border bg-secondary py-2.5 text-[12px] font-semibold text-muted-foreground"
          >
            Done marking
          </button>
          </div>
        </div>
      ) : null}

      {/* ---------- STEP 6: done ---------- */}
      {step === 6 && session && !draftLines ? (
        <div className="space-y-3">
          <div>
            <h2 className="flex items-center gap-2 text-[16px] font-bold tracking-tight">
              <Check className="h-4 w-4 text-[#4FD089]" aria-hidden />
              Done — the session has it
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {data.job.runId
                ? "Deltas now live on this run's Video section, same place as every compare."
                : "Link this analysis to a run to see deltas in Sessions."}
            </p>
          </div>

          {doneReport ? (
            <div className="space-y-2 rounded-xl border border-border bg-secondary/60 p-3">
              <span className="type-data-label">Lap compare · preview</span>
              <div className="flex items-end justify-between gap-3">
                <span
                  className={cn(
                    "font-mono text-2xl font-medium tabular-nums",
                    doneReport.totalDeltaSec < 0 ? "text-[#4FD089]" : "text-destructive"
                  )}
                >
                  {formatSignedDeltaSec(doneReport.totalDeltaSec)}
                  <span className="ml-1 text-xs text-muted-foreground">s</span>
                </span>
                <span className="max-w-[55%] text-right text-[11px] leading-relaxed text-muted-foreground">
                  {doneReport.summary}
                </span>
              </div>
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-faint">
                L{doneReport.a.lapIndex} vs L{doneReport.b.lapIndex} ·{" "}
                {doneReport.segments.length} segments
              </p>
            </div>
          ) : (
            <p className="rounded-lg border border-border bg-secondary/50 px-3 py-3 text-[12px] text-muted-foreground">
              No compare yet — it needs at least two laps with a synced start (anchor in the Sync
              step).
            </p>
          )}

          <Link
            href={backHref}
            className="block w-full rounded-xl bg-primary py-3.5 text-center text-[13px] font-bold text-primary-foreground no-underline"
          >
            {data.job.runId ? "Open in session" : "Back to Video tools"}
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
                  ? "Uploading…"
                  : `Save · ${Math.max(1, Math.round(pickedFile.size / (1024 * 1024)))}MB`}
              </button>
            </div>
          ) : uploadState === "done" ? (
            <p className="text-center text-[11px] text-[#4FD089]">Saved to library — clips enabled.</p>
          ) : null}
          {uploadError ? <p className="text-center text-[11px] text-destructive">{uploadError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Fine scrub wheel — drag horizontally, 1px = 4ms, ticks give tactile feedback. */
function FineWheel({ onDelta }: { onDelta: (dxPx: number) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ lastX: number; acc: number } | null>(null);

  return (
    <div
      ref={ref}
      className="relative h-12 touch-none select-none overflow-hidden rounded-xl border border-border bg-secondary"
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
      <span className="absolute inset-x-0 bottom-1 text-center font-mono text-[8.5px] tracking-[0.18em] text-faint">
        DRAG · 1PX = 4MS
      </span>
    </div>
  );
}
