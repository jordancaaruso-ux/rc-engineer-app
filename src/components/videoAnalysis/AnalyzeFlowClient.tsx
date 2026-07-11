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
};

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
const STEP_LABELS: Record<Step, string> = { 1: "Video", 2: "Timing", 3: "Sync", 4: "Mark", 5: "Done" };

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
  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [timingLoading, setTimingLoading] = useState(false);
  const [urlLaneOpen, setUrlLaneOpen] = useState(false);
  const [timingUrls, setTimingUrls] = useState("");
  const [anchorLap, setAnchorLap] = useState<number | null>(null);
  const [markCursor, setMarkCursor] = useState(0);
  const [uploadState, setUploadState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);

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
    // Resume at the furthest sensible step.
    const anchored = s ? Boolean(referenceAnchoredSession(s)) : false;
    if (json.job.videoAssetId && s && s.timingSessions.length > 0) {
      setStep(anchored ? 4 : 3);
    } else if (json.job.videoAssetId) {
      setStep(2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

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

  function seekTo(sec: number) {
    const v = videoRef.current;
    const t = Math.max(0, Math.min(duration || Number.MAX_SAFE_INTEGER, sec));
    lastSeekRef.current = t;
    setClock(t);
    if (v) {
      v.currentTime = t;
      v.pause();
      setPlaying(false);
    }
  }

  function nudge(deltaSec: number) {
    seekTo((videoRef.current?.currentTime ?? clock) + deltaSec);
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
    const t = videoRef.current?.currentTime ?? clock;
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
    const t = videoRef.current?.currentTime ?? clock;
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
      for (const lapNumber of laps) {
        for (const line of nonSfLines) {
          targets.push({ role, lapNumber, lineKey: line.lineKey, label: line.label });
        }
        targets.push({ role, lapNumber, lineKey: "sf", label: "SF end" });
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
    if (step !== 4 || !markQueue.length) return;
    // Start at the first unmarked target.
    const firstOpen = markQueue.findIndex((t) => markFor(t) == null);
    const idx = firstOpen === -1 ? 0 : firstOpen;
    setMarkCursor(idx);
    jumpToTarget(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function advanceCursor(from: number) {
    const nextIdx = from + 1;
    if (nextIdx >= markQueue.length) {
      setStep(5);
      return;
    }
    setMarkCursor(nextIdx);
    jumpToTarget(nextIdx);
  }

  function confirmMark() {
    if (!session || !primary) return;
    const t = markQueue[markCursor];
    if (!t) {
      setStep(5);
      return;
    }
    const videoTimeSec = videoRef.current?.currentTime ?? clock;
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
  }, [session, data, step === 5 ? session?.marks.length : 0]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (s === 3) return anchored;
    if (s === 4) return markQueue.length > 0 && markQueue.every((t) => markFor(t) != null);
    return false;
  };

  const canEnter = (s: Step): boolean => {
    if (s === 1) return true;
    if (s === 2) return Boolean(videoSrc);
    if (s === 3) return stepDone(2) && Boolean(videoSrc);
    if (s === 4) return anchored;
    return anchored;
  };

  const backHref = data.job.runId ? "/runs/history" : "/videos";

  const transport = (
    <div className="space-y-2.5">
      <div className="relative overflow-hidden rounded-xl border border-border bg-black">
        <video
          ref={videoRef}
          src={videoSrc ?? undefined}
          muted
          playsInline
          preload="metadata"
          className="aspect-video w-full object-contain"
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration || 0);
            if (lastSeekRef.current > 0) e.currentTarget.currentTime = lastSeekRef.current;
          }}
          onTimeUpdate={(e) => setClock(e.currentTarget.currentTime)}
          onClick={togglePlay}
        />
        <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-background/70 px-2 py-0.5 font-mono text-[12px] tabular-nums text-foreground backdrop-blur-sm">
          {fmtClock(clock)}
        </span>
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-background/70 text-foreground backdrop-blur-sm"
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(duration, 0.01)}
        step={0.05}
        value={Math.min(clock, duration || clock)}
        onChange={(e) => seekTo(Number(e.target.value))}
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
    <div className="mx-auto flex max-w-md flex-col gap-4 pb-10">
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

      {/* ---------- STEP 3: sync ---------- */}
      {step === 3 && session ? (
        <div className="space-y-3">
          <div>
            <h2 className="text-[16px] font-bold tracking-tight">
              Find L{anchorLap ?? "?"}&apos;s lap start
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Scrub until the car crosses the start/finish line, then set it. One anchor syncs
              every lap.
            </p>
          </div>
          {transport}
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
          <button
            type="button"
            disabled={anchorLap == null || !videoSrc}
            onClick={setAnchorAtPlayhead}
            className="w-full rounded-xl bg-primary py-3.5 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
          >
            Set L{anchorLap ?? "?"} start here
          </button>
          {anchored ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={pinSelectedLapHere}
                className="flex-1 rounded-lg border border-border bg-secondary py-2.5 text-[12px] font-semibold text-foreground"
              >
                Pin L{anchorLap ?? "?"} here
              </button>
              <button
                type="button"
                onClick={() => setStep(4)}
                className="flex-1 rounded-lg bg-primary py-2.5 text-[12px] font-bold text-primary-foreground"
              >
                Continue to marking
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---------- STEP 4: mark ---------- */}
      {step === 4 && session ? (
        <div className="space-y-3">
          <div>
            <h2 className="text-[16px] font-bold tracking-tight">Mark sector crossings</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              This unlocks corner-by-corner deltas. The video jumps near each crossing — fine-tune
              and confirm.
            </p>
          </div>
          {markQueue[markCursor] ? (
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">
              {markQueue[markCursor]!.role === "competitor" ? `${compDriver?.driverName ?? "Rival"} · ` : ""}
              L{markQueue[markCursor]!.lapNumber} · {markQueue[markCursor]!.label} line
            </p>
          ) : null}
          {transport}
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
                  <th className="table-col-header pb-1 text-center">SF</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(new Set(markQueue.map((t) => `${t.role}:${t.lapNumber}`))).map((key) => {
                  const [role, lapStr] = key.split(":") as [DriverRole, string];
                  const lapNumber = Number(lapStr);
                  const cells = [...nonSfLines.map((l) => l.lineKey), "sf"];
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
            onClick={() => setStep(5)}
            className="w-full rounded-lg border border-border bg-secondary py-2.5 text-[12px] font-semibold text-muted-foreground"
          >
            Done marking
          </button>
        </div>
      ) : null}

      {/* ---------- STEP 5: done ---------- */}
      {step === 5 && session ? (
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
