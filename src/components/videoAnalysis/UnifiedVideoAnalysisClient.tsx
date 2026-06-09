"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DualPlayheadVideo } from "./DualPlayheadVideo";
import type { SectorLineNorm } from "./SectorLineCanvas";
import type {
  AnchorKind,
  CompareAlignAt,
  DriverRole,
  ManualCompareSlot,
  ManualVideoSessionV2,
} from "@/lib/manualVideoAnalysis/types";
import { LAP_START_LINE_KEY, lapSfKey } from "@/lib/manualVideoAnalysis/types";
import { compareBestLaps, averageSectorSplits } from "@/lib/manualVideoAnalysis/sectors";
import {
  getLapAlignmentPreview,
  getLapAlignSteps,
  isValidLapSpan,
  confirmLapAlignmentMarks,
  type LapAlignmentPreview,
} from "@/lib/manualVideoAnalysis/predictSectors";
import { normalizeManualSession, setLapIncluded } from "@/lib/manualVideoAnalysis/timing";
import {
  findDriverInSession,
  findTimingSession,
  primaryTimingSession,
  getCompareSfAlignment,
  referenceAnchoredSession,
  updateTimingSession,
  videoTimeAtLapSf,
} from "@/lib/manualVideoAnalysis/sessionModel";

type SectorLineApi = SectorLineNorm & { sortOrder: number };

type JobData = {
  job: {
    id: string;
    track: { id: string; name: string };
    profile: { id: string; name: string };
    runId: string | null;
  };
  manual: { session: ManualVideoSessionV2 } | null;
  sectorLines: SectorLineApi[];
};

type ActiveLap = { sessionId: string; role: DriverRole; lapNumber: number };
type SyncMode = "anchor" | "compare";

function formatLap(sec: number): string {
  return sec.toFixed(3);
}

function slotLabel(
  session: ManualVideoSessionV2,
  slot: ManualCompareSlot | null
): string {
  if (!slot) return "—";
  const ts = findTimingSession(session, slot.sessionId);
  const d = ts ? findDriverInSession(ts, slot.role) : undefined;
  const name = d?.driverName ?? slot.role;
  const sess = ts?.label ?? slot.sessionId.slice(0, 8);
  return `${name} L${slot.lapNumber} · ${sess}`;
}

export function UnifiedVideoAnalysisClient({ jobId }: { jobId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoObjectUrlRef = useRef<string | null>(null);
  const [data, setData] = useState<JobData | null>(null);
  const [session, setSession] = useState<ManualVideoSessionV2 | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [showCompareResults, setShowCompareResults] = useState(false);
  const [sectorsOpen, setSectorsOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeLine, setActiveLine] = useState<string | null>(null);
  const [activeLap, setActiveLap] = useState<ActiveLap | null>(null);
  const [alignStepIndex, setAlignStepIndex] = useState(0);
  const [anchorLapInput, setAnchorLapInput] = useState("1");
  const [anchorKind, setAnchorKind] = useState<AnchorKind>("sf_finish");
  const [anchorDriverRole, setAnchorDriverRole] = useState<DriverRole>("me");
  const [syncMode, setSyncMode] = useState<SyncMode>("anchor");
  const [ghostPreviewActive, setGhostPreviewActive] = useState(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPersistRef = useRef<ManualVideoSessionV2 | null>(null);

  const lines: SectorLineNorm[] =
    data?.sectorLines.map((l) => ({
      lineKey: l.lineKey,
      label: l.label,
      x1: l.x1,
      y1: l.y1,
      x2: l.x2,
      y2: l.y2,
      sortOrder: l.sortOrder,
    })) ?? [];

  const sectorLinesForCompute =
    data?.sectorLines.map((l) => ({
      lineKey: l.lineKey,
      label: l.label,
      sortOrder: l.sortOrder,
    })) ?? [];

  const load = useCallback(async () => {
    const res = await fetch(`/api/video-analysis/jobs/${jobId}`);
    if (!res.ok) return;
    const json = (await res.json()) as JobData;
    setData(json);
    if (json.manual?.session) {
      const normalized = normalizeManualSession(json.manual.session);
      setSession(normalized);
      const primary = primaryTimingSession(normalized);
      const initialId = primary?.sessionId ?? normalized.timingSessions[0]?.sessionId ?? "";
      setActiveSessionId(initialId);
      const initialTs = normalized.timingSessions.find((s) => s.sessionId === initialId);
      const anchor = initialTs?.sync.anchor;
      if (anchor?.lapNumber) setAnchorLapInput(String(anchor.lapNumber));
      if (anchor?.anchorKind) setAnchorKind(anchor.anchorKind);
      if (anchor?.driverRole) setAnchorDriverRole(anchor.driverRole);
      else if (initialTs?.drivers.some((d) => d.role === "me")) setAnchorDriverRole("me");
    }
  }, [jobId]);

  function syncAnchorFieldsFromSession(sessionId: string, s: ManualVideoSessionV2) {
    const ts = findTimingSession(s, sessionId);
    const anchor = ts?.sync.anchor;
    if (anchor?.lapNumber) setAnchorLapInput(String(anchor.lapNumber));
    else setAnchorLapInput("1");
    setAnchorKind(anchor?.anchorKind ?? "sf_finish");
    if (anchor?.driverRole) setAnchorDriverRole(anchor.driverRole);
    else if (ts?.drivers.some((d) => d.role === "me")) setAnchorDriverRole("me");
    else if (ts?.drivers[0]) setAnchorDriverRole(ts.drivers[0].role);
  }

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (videoObjectUrlRef.current) URL.revokeObjectURL(videoObjectUrlRef.current);
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, []);

  async function persistSession(next: ManualVideoSessionV2, opts?: { reload?: boolean }) {
    const normalized = normalizeManualSession(next);
    setSession(normalized);
    setSaving(true);
    setMsg(null);
    const res = await fetch(`/api/video-analysis/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manualJson: normalized }),
    });
    setSaving(false);
    if (!res.ok) {
      setMsg("Failed to save");
      return false;
    }
    if (opts?.reload) void load();
    return true;
  }

  function schedulePersist(next: ManualVideoSessionV2) {
    pendingPersistRef.current = next;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      const pending = pendingPersistRef.current;
      pendingPersistRef.current = null;
      if (pending) void persistSession(pending);
    }, 500);
  }

  async function saveSession(next: ManualVideoSessionV2) {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    pendingPersistRef.current = null;
    await persistSession(next, { reload: true });
  }

  function setVideoFile(file: File | null) {
    if (videoObjectUrlRef.current) {
      URL.revokeObjectURL(videoObjectUrlRef.current);
      videoObjectUrlRef.current = null;
    }
    if (!file) {
      setVideoSrc(null);
      return;
    }
    const url = URL.createObjectURL(file);
    videoObjectUrlRef.current = url;
    setVideoSrc(url);
    if (session) void saveSession({ ...session, localVideoName: file.name });
  }

  function currentVideoTime(): number {
    return videoRef.current?.currentTime ?? 0;
  }

  function seekTo(sec: number | null, pause = true) {
    if (sec == null || !videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, sec);
    if (pause) videoRef.current.pause();
  }

  function anchorAtPlayhead(
    sessionId: string,
    role: DriverRole,
    lapNumber: number,
    driverName: string,
    opts?: { videoTimeSec?: number }
  ) {
    if (!session) return;
    const ts = findTimingSession(session, sessionId);
    if (!ts) return;
    const t = opts?.videoTimeSec ?? currentVideoTime();
    const next = updateTimingSession(session, sessionId, {
      isOnVideo: true,
      sync: {
        ...ts.sync,
        anchor: {
          videoTimeSec: t,
          lapNumber,
          driverRole: role,
          anchorKind,
        },
      },
    });
    setAnchorLapInput(String(lapNumber));
    setAnchorDriverRole(role);
    setSession(next);
    schedulePersist(next);
    setGhostPreviewActive(false);
    const kindLabel = anchorKind === "sf_start" ? "start" : "finish";
    setMsg(
      `Anchor: ${driverName} lap ${lapNumber} SF ${kindLabel} = ${t.toFixed(3)}s. Scrub, click lap again or edit time below to refine.`
    );
  }

  function setAnchorFromForm() {
    if (!session || !activeSessionId) return;
    const lapNumber = parseInt(anchorLapInput, 10);
    if (!Number.isFinite(lapNumber) || lapNumber < 1) return;
    const driver = findDriverInSession(
      findTimingSession(session, activeSessionId)!,
      anchorDriverRole
    );
    if (!driver) return;
    anchorAtPlayhead(activeSessionId, anchorDriverRole, lapNumber, driver.driverName);
  }

  function updateAnchorVideoTime(sessionId: string, videoTimeSec: number) {
    if (!session || !Number.isFinite(videoTimeSec) || videoTimeSec < 0) return;
    const ts = findTimingSession(session, sessionId);
    const anchor = ts?.sync.anchor;
    if (!ts || !anchor) return;
    const next = updateTimingSession(session, sessionId, {
      sync: {
        ...ts.sync,
        anchor: { ...anchor, videoTimeSec },
      },
    });
    setSession(next);
    schedulePersist(next);
    setGhostPreviewActive(false);
  }

  function nudgeAnchorTime(sessionId: string, deltaSec: number) {
    const ts = session ? findTimingSession(session, sessionId) : undefined;
    const anchor = ts?.sync.anchor;
    if (!anchor) return;
    updateAnchorVideoTime(sessionId, anchor.videoTimeSec + deltaSec);
  }

  function clearAnchor(sessionId: string) {
    if (!session) return;
    const ts = findTimingSession(session, sessionId);
    if (!ts?.sync.anchor) return;
    const next = updateTimingSession(session, sessionId, {
      sync: { ...ts.sync, anchor: undefined, perLapSfEnd: undefined },
    });
    setSession(next);
    schedulePersist(next);
    setGhostPreviewActive(false);
    setMsg("Anchor cleared — scrub video and click a lap to set again.");
  }

  function seekToAnchorSession(sessionId: string) {
    const ts = session ? findTimingSession(session, sessionId) : undefined;
    const t = ts?.sync.anchor?.videoTimeSec;
    if (t == null) return;
    setActiveLine("sf");
    seekTo(t);
  }

  function previewGhostCompare(s?: ManualVideoSessionV2) {
    const base = s ?? session;
    if (!base) return;
    const alignment = getCompareSfAlignment(base, base.compare);
    if (!alignment) {
      setMsg("Pick one of your laps and one competitor lap in Compare mode first.");
      return;
    }
    setGhostPreviewActive(true);
    setActiveLine("sf");
    seekTo(alignment.bottomSec);
    setMsg(
      `Ghost preview at SF — bottom L${base.compare.my!.lapNumber}, ghost L${base.compare.competitor!.lapNumber}. Switch to Anchor mode to fix timing.`
    );
  }

  function applyMarkAtPlayhead(
    base: ManualVideoSessionV2,
    lap: ActiveLap,
    lineKey: string,
    isLapFinish: boolean
  ): ManualVideoSessionV2 {
    const t = currentVideoTime();
    const marks = base.marks.filter(
      (m) =>
        !(
          m.sessionId === lap.sessionId &&
          m.driverRole === lap.role &&
          m.lapNumber === lap.lapNumber &&
          m.lineKey === lineKey
        )
    );
    marks.push({
      sessionId: lap.sessionId,
      driverRole: lap.role,
      lapNumber: lap.lapNumber,
      lineKey,
      videoTimeSec: t,
    });
    let next: ManualVideoSessionV2 = { ...base, marks };
    if (isLapFinish) {
      const ts = findTimingSession(next, lap.sessionId);
      if (ts) {
        const key = lapSfKey(lap.role, lap.lapNumber);
        next = updateTimingSession(next, lap.sessionId, {
          sync: {
            ...ts.sync,
            perLapSfEnd: { ...ts.sync.perLapSfEnd, [key]: t },
          },
        });
      }
    }
    return normalizeManualSession(next);
  }

  function discardLap(sessionId: string, role: DriverRole, lapNumber: number) {
    if (!session) return;
    void saveSession(setLapIncluded(session, sessionId, role, lapNumber, false));
    if (
      activeLap?.sessionId === sessionId &&
      activeLap.role === role &&
      activeLap.lapNumber === lapNumber
    ) {
      setActiveLap(null);
    }
    setMsg(`Lap ${lapNumber} discarded`);
  }

  function overlayLineForStep(step: { lineKey: string; isLapStart: boolean; isLapFinish: boolean }) {
    if (step.isLapStart || step.isLapFinish) return "sf";
    return step.lineKey;
  }

  function seekToAlignStep(
    preview: LapAlignmentPreview,
    stepIndex: number,
    steps: ReturnType<typeof getLapAlignSteps>
  ) {
    const step = steps[stepIndex];
    if (!step) return;
    setAlignStepIndex(stepIndex);
    setActiveLine(overlayLineForStep(step));
    seekTo(step.videoTimeSec);
  }

  function selectLapForSectors(sessionId: string, role: DriverRole, lapNumber: number) {
    if (!session) return;
    const preview = getLapAlignmentPreview(session, sectorLinesForCompute, sessionId, role, lapNumber);
    setActiveLap({ sessionId, role, lapNumber });
    setSectorsOpen(true);
    setAlignStepIndex(0);
    if (preview?.lapStartSec == null || preview.lapEndSec == null) {
      setMsg("Set SF anchor for this session first.");
      return;
    }
    const steps = getLapAlignSteps(preview);
    if (steps.length === 0) {
      setMsg("Could not predict lap timing.");
      return;
    }
    seekToAlignStep(preview, 0, steps);
    setMsg(`Lap ${lapNumber}: align sectors from lap start.`);
  }

  function jumpAlignAt(): CompareAlignAt {
    return session?.compare.alignAt ?? "sf_finish";
  }

  function seekToLapSf(sessionId: string, role: DriverRole, lapNumber: number): number | null {
    if (!session) return null;
    const alignAt = jumpAlignAt();
    const t = videoTimeAtLapSf(session, sessionId, role, lapNumber, alignAt);
    if (t == null) {
      const ref = referenceAnchoredSession(session);
      if (!ref) {
        setMsg(
          "Set your video anchor first: scrub to a known SF crossing, then click “Mark crossing at playhead”."
        );
      } else {
        setMsg("Could not map this lap to video — check anchor lap number and driver.");
      }
      return null;
    }
    setActiveLine("sf");
    seekTo(t);
    return t;
  }

  function onLapClick(
    sessionId: string,
    role: DriverRole,
    lapNumber: number,
    driverName: string
  ) {
    if (!session) return;

    if (syncMode === "anchor") {
      if (sessionId !== activeSessionId) {
        setActiveSessionId(sessionId);
        syncAnchorFieldsFromSession(sessionId, session);
        setMsg(`Switched to ${driverName}'s session — scrub to SF crossing, then click lap ${lapNumber} again.`);
        return;
      }
      anchorAtPlayhead(sessionId, role, lapNumber, driverName);
      return;
    }

    const slot: ManualCompareSlot = { sessionId, role, lapNumber };
    const compare = { ...session.compare };
    if (role === "me") compare.my = slot;
    else compare.competitor = slot;
    const next = { ...session, compare };
    setSession(next);
    schedulePersist(next);
    setGhostPreviewActive(false);

    if (compare.my && compare.competitor) {
      setMsg(
        `Compare: your L${compare.my.lapNumber} vs ${driverName} L${compare.competitor.lapNumber}. Click Preview ghost when ready.`
      );
    } else {
      setMsg(
        role === "me"
          ? `Your lap ${lapNumber} selected — pick a competitor lap.`
          : `Competitor lap ${lapNumber} selected — pick one of your laps.`
      );
    }
  }

  function previewJumpToLap(sessionId: string, role: DriverRole, lapNumber: number) {
    const t = seekToLapSf(sessionId, role, lapNumber);
    if (t != null) {
      setMsg(`Jumped to predicted SF @ ${t.toFixed(2)}s (from anchor math).`);
    }
  }

  function advanceAlignStep(applyPlayhead: boolean) {
    if (!session || !activeLap) return;
    let s = session;
    const preview0 = getLapAlignmentPreview(
      s,
      sectorLinesForCompute,
      activeLap.sessionId,
      activeLap.role,
      activeLap.lapNumber
    );
    if (!preview0?.lapEndSec) return;
    const steps0 = getLapAlignSteps(preview0);
    const step = steps0[alignStepIndex];
    if (!step) return;

    if (applyPlayhead) {
      s = applyMarkAtPlayhead(s, activeLap, step.lineKey, step.isLapFinish);
      setSession(s);
      schedulePersist(s);
    }

    const preview = getLapAlignmentPreview(
      s,
      sectorLinesForCompute,
      activeLap.sessionId,
      activeLap.role,
      activeLap.lapNumber
    );
    if (!preview) return;
    const steps = getLapAlignSteps(preview);
    const nextIndex = alignStepIndex + 1;
    if (nextIndex >= steps.length) {
      setAlignStepIndex(steps.length - 1);
      setMsg("All steps done — save lap alignment.");
      return;
    }
    seekToAlignStep(preview, nextIndex, steps);
    const next = steps[nextIndex]!;
    setMsg(`${next.label} — frame-step if needed, then Next`);
  }

  function confirmActiveLap() {
    if (!session || !activeLap) return;
    const next = confirmLapAlignmentMarks(
      session,
      sectorLinesForCompute,
      activeLap.sessionId,
      activeLap.role,
      activeLap.lapNumber
    );
    void saveSession(next);
    setMsg(`Lap ${activeLap.lapNumber} alignment saved`);
  }

  const activePreview: LapAlignmentPreview | null = useMemo(
    () =>
      session && activeLap
        ? getLapAlignmentPreview(
            session,
            sectorLinesForCompute,
            activeLap.sessionId,
            activeLap.role,
            activeLap.lapNumber
          )
        : null,
    [session, activeLap, sectorLinesForCompute]
  );

  const alignSteps = useMemo(
    () =>
      activePreview && isValidLapSpan(activePreview.lapStartSec, activePreview.lapEndSec)
        ? getLapAlignSteps(activePreview)
        : [],
    [activePreview]
  );
  const currentAlignStep = alignSteps[alignStepIndex] ?? null;

  const currentStepConfirmed =
    session &&
    activeLap &&
    currentAlignStep &&
    (currentAlignStep.isLapStart
      ? session.marks.some(
          (m) =>
            m.sessionId === activeLap.sessionId &&
            m.driverRole === activeLap.role &&
            m.lapNumber === activeLap.lapNumber &&
            m.lineKey === LAP_START_LINE_KEY
        )
      : activePreview?.crossings.find((c) => c.lineKey === currentAlignStep.lineKey)?.confirmed);

  const compareSfAlignment = useMemo(
    () =>
      session?.compare.my && session?.compare.competitor
        ? getCompareSfAlignment(session, session.compare)
        : null,
    [session]
  );
  const ghostCompareActive =
    syncMode === "compare" && compareSfAlignment != null;
  const compareOffset = compareSfAlignment?.offsetSec ?? null;

  if (!data || !session) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const sess = session;

  const activeTs = findTimingSession(sess, activeSessionId);
  const hasAnchor = Boolean(activeTs?.sync.anchor);
  const anchorLap = parseInt(anchorLapInput, 10);
  const anchorLapValid = Number.isFinite(anchorLap) && anchorLap >= 1;

  const primaryId = primaryTimingSession(sess)?.sessionId ?? "";
  const compareRows = sectorLinesForCompute.length
    ? compareBestLaps(sess, sectorLinesForCompute)
    : [];
  const avgMe = averageSectorSplits(sess, sectorLinesForCompute, primaryId, "me");
  const avgComp = averageSectorSplits(sess, sectorLinesForCompute, primaryId, "competitor");

  function setAlignAt(alignAt: CompareAlignAt) {
    const next = { ...sess, compare: { ...sess.compare, alignAt } };
    setSession(next);
    schedulePersist(next);
    if (ghostPreviewActive) previewGhostCompare(next);
  }

  function nudgeCompareOffset(delta: number) {
    const cur = sess.compare.offsetNudgeSec ?? 0;
    const next = {
      ...sess,
      compare: { ...sess.compare, offsetNudgeSec: cur + delta },
    };
    setSession(next);
    schedulePersist(next);
    if (ghostPreviewActive) previewGhostCompare(next);
  }

  return (
    <div className="flex flex-col gap-3 max-w-6xl">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/videos/analysis" className="underline text-muted-foreground">
          ← Hub
        </Link>
        <span className="text-muted-foreground">/</span>
        <span>
          {data.job.track.name} · {data.job.profile.name}
        </span>
        {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
        <Link
          href={`/videos/analysis/tracks/${data.job.track.id}`}
          className="text-xs underline ml-auto"
        >
          Edit sector lines
        </Link>
      </div>

      <label className="text-xs block">
        Video
        <input
          type="file"
          accept="video/*"
          className="mt-0.5 w-full max-w-sm rounded-md border border-border px-2 py-1"
          onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
        />
        {sess.localVideoName && (
          <span className="text-muted-foreground ml-2">{sess.localVideoName}</span>
        )}
      </label>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,1fr)]">
        <DualPlayheadVideo
          videoSrc={videoSrc}
          lines={lines}
          activeLineKey={activeLine}
          offsetSec={compareOffset}
          ghostCompareActive={ghostCompareActive}
          alignBottomSec={
            ghostPreviewActive ? (compareSfAlignment?.bottomSec ?? null) : null
          }
          videoRef={videoRef}
          bottomLabel={slotLabel(sess, sess.compare.my)}
          topLabel={slotLabel(sess, sess.compare.competitor)}
        />

        <div className="flex flex-col gap-3 text-xs max-h-[min(75vh,800px)] overflow-y-auto pr-1">
          <div className="rounded-lg border border-primary/30 bg-card p-3 space-y-1">
            <p className="font-medium text-sm">How to sync</p>
            <ol className="list-decimal list-inside text-muted-foreground space-y-1">
              <li>Load your video above.</li>
              <li>
                <strong className="text-foreground">Anchor mode</strong> — select session, scrub to
                SF crossing, click that lap time (sets anchor at playhead; editable below).
              </li>
              <li>
                <strong className="text-foreground">Compare mode</strong> — pick your lap +
                competitor lap, then Preview ghost.
              </li>
            </ol>
          </div>

          {sess.timingSessions.length > 1 && (
            <div className="rounded-lg border border-border bg-card p-3 space-y-2">
              <p className="font-medium text-sm">Timing sessions</p>
              <p className="text-muted-foreground text-[10px]">
                Check “on video” only for sessions filmed in this clip. Other URLs are timing-only.
              </p>
              {sess.timingSessions.map((ts) => (
                <label
                  key={ts.sessionId}
                  className={`flex items-start gap-2 cursor-pointer rounded-md p-1.5 ${
                    activeSessionId === ts.sessionId ? "bg-primary/10" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="activeSession"
                    checked={activeSessionId === ts.sessionId}
                    onChange={() => {
                      setActiveSessionId(ts.sessionId);
                      syncAnchorFieldsFromSession(ts.sessionId, sess);
                    }}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="font-medium block truncate">{ts.label}</span>
                    <span className="text-muted-foreground text-[10px]">
                      {ts.drivers.map((d) => d.driverName).join(", ")} ·{" "}
                      {ts.sync.anchor ? "anchored" : "needs anchor"}
                      {!ts.isOnVideo ? " · timing only" : ""}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={ts.isOnVideo}
                    title="This session was filmed in the uploaded video"
                    onChange={(e) => {
                      void saveSession(
                        updateTimingSession(sess, ts.sessionId, {
                          isOnVideo: e.target.checked,
                        })
                      );
                    }}
                  />
                </label>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-border bg-card p-3 space-y-2">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="font-medium text-sm">Mode</span>
              <button
                type="button"
                className={`rounded px-2 py-0.5 border text-xs ${
                  syncMode === "anchor" ? "border-primary bg-primary/15" : "border-border"
                }`}
                onClick={() => {
                  setSyncMode("anchor");
                  setGhostPreviewActive(false);
                }}
              >
                Anchor (scrub + click lap)
              </button>
              <button
                type="button"
                className={`rounded px-2 py-0.5 border text-xs ${
                  syncMode === "compare" ? "border-primary bg-primary/15" : "border-border"
                }`}
                onClick={() => setSyncMode("compare")}
              >
                Compare (ghost laps)
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-3 space-y-2">
            <p className="font-medium text-sm">Step 2 — Anchor video to transponder</p>
            <p className="text-muted-foreground">
              Select a timing session above, scrub to when{" "}
              <strong>
                {(activeTs && findDriverInSession(activeTs, anchorDriverRole)?.driverName) ??
                  "this driver"}
              </strong>{" "}
              crosses SF on lap #…, then <strong>click that lap</strong> (or use Mark at playhead).
              Repeat per session if both drivers are on this video.
            </p>
            <div className="flex flex-wrap gap-2 items-center">
              {activeTs && activeTs.drivers.length > 1 && (
                <label className="flex items-center gap-1">
                  Driver
                  <select
                    className="rounded border border-border px-1 py-0.5 max-w-[120px]"
                    value={anchorDriverRole}
                    onChange={(e) => setAnchorDriverRole(e.target.value as DriverRole)}
                  >
                    {activeTs.drivers.map((d) => (
                      <option key={d.key} value={d.role}>
                        {d.driverName}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex items-center gap-1">
                Lap #
                <input
                  className="w-12 rounded border border-border px-1 py-0.5 font-mono"
                  value={anchorLapInput}
                  onChange={(e) => setAnchorLapInput(e.target.value)}
                />
              </label>
              <select
                className="rounded border border-border px-1 py-0.5"
                value={anchorKind}
                onChange={(e) => setAnchorKind(e.target.value as AnchorKind)}
              >
                <option value="sf_finish">Finish crossing</option>
                <option value="sf_start">Start crossing</option>
              </select>
              <button
                type="button"
                className="rounded-md bg-primary px-2.5 py-1 text-primary-foreground"
                disabled={!anchorLapValid || syncMode !== "anchor"}
                onClick={setAnchorFromForm}
              >
                Mark at playhead
              </button>
            </div>
            {hasAnchor && activeTs?.sync.anchor ? (
              <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-2">
                <p className="font-mono text-[11px]">
                  ✓ {findDriverInSession(activeTs, activeTs.sync.anchor.driverRole)?.driverName}{" "}
                  lap {activeTs.sync.anchor.lapNumber}{" "}
                  {activeTs.sync.anchor.anchorKind === "sf_start" ? "start" : "finish"}
                </p>
                <label className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">Video time (s)</span>
                  <input
                    type="number"
                    step="0.001"
                    min={0}
                    className="w-28 rounded border border-border px-1.5 py-0.5 font-mono"
                    value={activeTs.sync.anchor.videoTimeSec}
                    onChange={(e) =>
                      updateAnchorVideoTime(activeSessionId, parseFloat(e.target.value))
                    }
                  />
                  <button
                    type="button"
                    className="rounded border border-border px-1.5 py-0.5 hover:bg-muted"
                    onClick={() => updateAnchorVideoTime(activeSessionId, currentVideoTime())}
                  >
                    Use playhead
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border px-1.5 py-0.5 hover:bg-muted"
                    onClick={() => seekToAnchorSession(activeSessionId)}
                  >
                    Seek
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border px-1.5 py-0.5 hover:bg-muted"
                    onClick={() => nudgeAnchorTime(activeSessionId, -0.05)}
                  >
                    −50ms
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border px-1.5 py-0.5 hover:bg-muted"
                    onClick={() => nudgeAnchorTime(activeSessionId, 0.05)}
                  >
                    +50ms
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border px-1.5 py-0.5 text-muted-foreground hover:bg-muted"
                    onClick={() => clearAnchor(activeSessionId)}
                  >
                    Clear
                  </button>
                </label>
              </div>
            ) : (
              <p className="text-muted-foreground">No anchor for this session yet.</p>
            )}
            {sess.timingSessions
              .filter((ts) => ts.sessionId !== activeSessionId && ts.sync.anchor)
              .map((ts) => (
                <p key={ts.sessionId} className="text-[10px] text-muted-foreground font-mono">
                  {ts.label}: anchored lap {ts.sync.anchor!.lapNumber} @{" "}
                  {ts.sync.anchor!.videoTimeSec.toFixed(3)}s
                </p>
              ))}
          </div>

          <div className="rounded-lg border border-border bg-card p-3 space-y-2">
            <p className="font-medium text-sm">Step 3 — Ghost compare</p>
            <p className="text-muted-foreground">
              Switch to <strong>Compare</strong> mode, pick one of your laps and one competitor lap,
              then Preview ghost. Switch back to Anchor mode anytime to fix timing.
            </p>
            {ghostCompareActive && (
              <p className="text-primary font-medium">
                Ghost compare active · offset {compareOffset! >= 0 ? "+" : ""}
                {compareOffset!.toFixed(2)}s
              </p>
            )}
            <div className="flex flex-wrap gap-1 items-center">
              <span className="text-muted-foreground">Jump to</span>
              <button
                type="button"
                className={`rounded px-1.5 py-0.5 border ${
                  jumpAlignAt() === "sf_finish" ? "border-primary" : "border-border"
                }`}
                onClick={() => setAlignAt("sf_finish")}
              >
                SF finish
              </button>
              <button
                type="button"
                className={`rounded px-1.5 py-0.5 border ${
                  jumpAlignAt() === "sf_start" ? "border-primary" : "border-border"
                }`}
                onClick={() => setAlignAt("sf_start")}
              >
                SF start
              </button>
            </div>
            <div className="text-[10px] space-y-0.5 font-mono">
              <p>Bottom: {slotLabel(sess, sess.compare.my)}</p>
              <p>Ghost: {slotLabel(sess, sess.compare.competitor)}</p>
            </div>
            <button
              type="button"
              className="rounded-md bg-primary px-2.5 py-1 text-primary-foreground disabled:opacity-50"
              disabled={!ghostCompareActive}
              onClick={() => previewGhostCompare()}
            >
              Preview ghost at SF
            </button>
            <div className="flex flex-wrap gap-1 items-center">
              <button
                type="button"
                className="rounded border border-border px-1 py-0.5"
                onClick={() => nudgeCompareOffset(-0.05)}
              >
                −50ms
              </button>
              <button
                type="button"
                className="rounded border border-border px-1 py-0.5"
                onClick={() => nudgeCompareOffset(0.05)}
              >
                +50ms
              </button>
              <button
                type="button"
                className="rounded border border-border px-1 py-0.5 text-muted-foreground"
                onClick={() => {
                  const next = {
                    ...sess,
                    compare: {
                      my: null,
                      competitor: null,
                      alignAt: sess.compare.alignAt,
                    },
                  };
                  setSession(next);
                  schedulePersist(next);
                  setGhostPreviewActive(false);
                }}
              >
                Clear compare
              </button>
            </div>
            {compareOffset != null && (
              <p className="font-mono text-muted-foreground">
                Offset {compareOffset >= 0 ? "+" : ""}
                {compareOffset.toFixed(3)}s
              </p>
            )}
          </div>

          {sess.timingSessions.map((ts) => (
            <div key={ts.sessionId} className="rounded-lg border border-border bg-card p-3 space-y-2">
              <p className="font-medium text-sm">{ts.label}</p>
              {ts.drivers.map((d) => (
                <div key={`${ts.sessionId}-${d.key}`}>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase">
                    {d.driverName} ({d.role})
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {d.laps
                      .filter((l) => l.isIncluded !== false)
                      .map((l) => {
                        const isAnchor =
                          ts.sync.anchor?.driverRole === d.role &&
                          ts.sync.anchor.lapNumber === l.lapNumber;
                        const isCompare =
                          (sess.compare.my?.sessionId === ts.sessionId &&
                            sess.compare.my.role === d.role &&
                            sess.compare.my.lapNumber === l.lapNumber) ||
                          (sess.compare.competitor?.sessionId === ts.sessionId &&
                            sess.compare.competitor?.role === d.role &&
                            sess.compare.competitor?.lapNumber === l.lapNumber);
                        const isSector =
                          activeLap?.sessionId === ts.sessionId &&
                          activeLap.role === d.role &&
                          activeLap.lapNumber === l.lapNumber;
                        const predicted = videoTimeAtLapSf(
                          sess,
                          ts.sessionId,
                          d.role,
                          l.lapNumber,
                          jumpAlignAt()
                        );
                        const canSeek = predicted != null;
                        return (
                          <button
                            key={l.lapNumber}
                            type="button"
                            className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${
                              isAnchor
                                ? "border-green-600/60 bg-green-500/10"
                                : isCompare
                                  ? "border-amber-500/60 bg-amber-500/10"
                                  : isSector
                                    ? "border-primary bg-primary/15"
                                    : "border-border hover:bg-muted/50"
                            }`}
                            onClick={() =>
                              onLapClick(ts.sessionId, d.role, l.lapNumber, d.driverName)
                            }
                            onContextMenu={(e) => {
                              e.preventDefault();
                              if (syncMode === "anchor") {
                                previewJumpToLap(ts.sessionId, d.role, l.lapNumber);
                              } else {
                                selectLapForSectors(ts.sessionId, d.role, l.lapNumber);
                              }
                            }}
                            title={
                              syncMode === "anchor"
                                ? `Click: set anchor at playhead · Right-click: jump to predicted SF`
                                : `Click: select for ghost compare`
                            }
                          >
                            L{l.lapNumber} {formatLap(l.lapTimeSec)}
                            {canSeek ? (
                              <span className="text-muted-foreground ml-1">
                                @{predicted!.toFixed(1)}s
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                  </div>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-muted-foreground text-[10px]">
                      Discard laps
                    </summary>
                    <ul className="flex flex-wrap gap-1 mt-1">
                      {d.laps.map((l) => (
                        <li key={l.lapNumber}>
                          <label className="inline-flex items-center gap-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={l.isIncluded !== false}
                              onChange={(e) => {
                                void saveSession(
                                  setLapIncluded(
                                    sess,
                                    ts.sessionId,
                                    d.role,
                                    l.lapNumber,
                                    e.target.checked
                                  )
                                );
                              }}
                            />
                            <span className="font-mono">L{l.lapNumber}</span>
                          </label>
                          {l.isIncluded !== false && (
                            <button
                              type="button"
                              className="ml-1 text-muted-foreground"
                              onClick={() => discardLap(ts.sessionId, d.role, l.lapNumber)}
                            >
                              ×
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              ))}
            </div>
          ))}

          <details
            open={sectorsOpen}
            onToggle={(e) => setSectorsOpen((e.target as HTMLDetailsElement).open)}
            className="rounded-lg border border-border bg-card"
          >
            <summary className="cursor-pointer p-3 font-medium text-sm">
              Sector alignment (right-click a lap)
            </summary>
            <div className="px-3 pb-3 space-y-2">
              {activeLap && activePreview ? (
                <>
                  <p className="font-medium">
                    Lap {activeLap.lapNumber} · {activeLap.role}
                  </p>
                  {!currentAlignStep ? (
                    <p className="text-amber-600 dark:text-amber-400">Set anchor first.</p>
                  ) : (
                    <>
                      <p className="text-[10px] text-muted-foreground uppercase">
                        Step {alignStepIndex + 1} of {alignSteps.length}
                      </p>
                      <p className="font-medium">{currentAlignStep.label}</p>
                      <p className="font-mono text-muted-foreground">
                        {currentAlignStep.videoTimeSec.toFixed(2)}s
                        {currentStepConfirmed ? " · adjusted ✓" : ""}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-md border border-border px-2 py-1"
                          onClick={() => advanceAlignStep(true)}
                        >
                          Set here & next
                        </button>
                        <button
                          type="button"
                          className="rounded-md bg-primary px-2 py-1 text-primary-foreground"
                          onClick={() => advanceAlignStep(false)}
                        >
                          Next →
                        </button>
                        {alignStepIndex >= alignSteps.length - 1 && (
                          <button
                            type="button"
                            className="rounded-md border border-green-600/50 px-2 py-1"
                            onClick={confirmActiveLap}
                          >
                            Save alignment
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">Right-click a lap chip to align sectors.</p>
              )}
            </div>
          </details>

          <button
            type="button"
            className="text-xs text-left underline text-muted-foreground"
            onClick={() => setShowCompareResults((v) => !v)}
          >
            {showCompareResults ? "Hide" : "Show"} sector compare table
          </button>

          {showCompareResults && (
            <div className="rounded-lg border border-border bg-card p-3 space-y-3">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-1">Sector</th>
                    <th className="text-right py-1">Me</th>
                    <th className="text-right py-1">Comp</th>
                    <th className="text-right py-1">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {compareRows.map((r) => (
                    <tr key={r.lineKey} className="border-b border-border/50">
                      <td className="py-0.5">{r.label}</td>
                      <td className="text-right font-mono">
                        {r.meBestSec?.toFixed(3) ?? "—"}
                      </td>
                      <td className="text-right font-mono">
                        {r.competitorBestSec?.toFixed(3) ?? "—"}
                      </td>
                      <td className="text-right font-mono">
                        {r.deltaSec != null
                          ? `${r.deltaSec >= 0 ? "+" : ""}${r.deltaSec.toFixed(3)}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
