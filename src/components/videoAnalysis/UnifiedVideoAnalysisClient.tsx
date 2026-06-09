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
  computeCompareOffsetSec,
  findDriverInSession,
  findTimingSession,
  primaryTimingSession,
  updateTimingSession,
} from "@/lib/manualVideoAnalysis/sessionModel";
import { predictSfEndTime, predictSfStartTime } from "@/lib/manualVideoAnalysis/sync";

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
      setActiveSessionId(primary?.sessionId ?? normalized.timingSessions[0]?.sessionId ?? "");
      const anchor = primary?.sync.anchor;
      if (anchor?.lapNumber) setAnchorLapInput(String(anchor.lapNumber));
      if (anchor?.anchorKind) setAnchorKind(anchor.anchorKind);
    }
  }, [jobId]);

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

  function setAnchor() {
    if (!session || !activeSessionId) return;
    const ts = findTimingSession(session, activeSessionId);
    if (!ts) return;
    const lapNumber = parseInt(anchorLapInput, 10);
    if (!Number.isFinite(lapNumber) || lapNumber < 1) return;
    const next = updateTimingSession(session, activeSessionId, {
      sync: {
        ...ts.sync,
        anchor: {
          videoTimeSec: currentVideoTime(),
          lapNumber,
          driverRole: "me",
          anchorKind,
        },
      },
    });
    void saveSession(next);
    const kindLabel = anchorKind === "sf_start" ? "start" : "finish";
    setMsg(`Baseline: your lap ${lapNumber} SF ${kindLabel} at ${currentVideoTime().toFixed(2)}s`);
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

  function setCompareSlot(role: DriverRole, sessionId: string, lapNumber: number) {
    if (!session) return;
    const slot: ManualCompareSlot = { sessionId, role, lapNumber };
    const compare = { ...session.compare };
    if (role === "me") compare.my = slot;
    else compare.competitor = slot;

    const ts = findTimingSession(session, sessionId);
    const driver = ts ? findDriverInSession(ts, role) : undefined;
    const alignAt = session.compare.alignAt ?? "sf_start";
    const predict = alignAt === "sf_finish" ? predictSfEndTime : predictSfStartTime;
    const t = driver && ts ? predict(driver, lapNumber, ts) : null;
    if (t != null) seekTo(t);

    void saveSession({ ...session, compare });
    setMsg(`Compare: ${role} lap ${lapNumber}${t != null ? ` @ ${t.toFixed(2)}s` : ""}`);
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

  const compareOffset = useMemo(
    () => (session ? computeCompareOffsetSec(session, session.compare) : null),
    [session]
  );

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
    void saveSession({ ...sess, compare: { ...sess.compare, alignAt } });
  }

  function nudgeCompareOffset(delta: number) {
    const cur = sess.compare.offsetNudgeSec ?? 0;
    void saveSession({
      ...sess,
      compare: { ...sess.compare, offsetNudgeSec: cur + delta },
    });
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
          videoRef={videoRef}
          bottomLabel={slotLabel(sess, sess.compare.my)}
          topLabel={slotLabel(sess, sess.compare.competitor)}
        />

        <div className="flex flex-col gap-3 text-xs max-h-[min(75vh,800px)] overflow-y-auto pr-1">
          {sess.timingSessions.length > 1 && (
            <div className="rounded-lg border border-border bg-card p-3 space-y-2">
              <p className="font-medium text-sm">Timing sessions</p>
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
                    onChange={() => setActiveSessionId(ts.sessionId)}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="font-medium block truncate">{ts.label}</span>
                    <span className="text-muted-foreground text-[10px]">
                      {ts.drivers.length} drivers ·{" "}
                      {ts.sync.anchor ? "anchored" : "no anchor"}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={ts.isOnVideo}
                    title="Session appears on this video"
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
            <p className="font-medium text-sm">SF anchor</p>
            <p className="text-muted-foreground">
              Scrub to when <strong>you</strong> cross SF on a known lap in{" "}
              <strong>{activeTs?.label ?? "session"}</strong>.
            </p>
            <div className="flex flex-wrap gap-2 items-center">
              <label className="flex items-center gap-1">
                Lap
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
                disabled={!anchorLapValid}
                onClick={setAnchor}
              >
                Set anchor here
              </button>
            </div>
            {hasAnchor && activeTs?.sync.anchor ? (
              <p className="text-muted-foreground font-mono">
                ✓ Lap {activeTs.sync.anchor.lapNumber}{" "}
                {activeTs.sync.anchor.anchorKind === "sf_start" ? "start" : "finish"} @{" "}
                {activeTs.sync.anchor.videoTimeSec.toFixed(2)}s
              </p>
            ) : null}
          </div>

          <div className="rounded-lg border border-border bg-card p-3 space-y-2">
            <p className="font-medium text-sm">Lap compare</p>
            <p className="text-muted-foreground">
              Click a lap to assign ghost overlay (me = bottom, competitor = ghost).
            </p>
            <div className="text-[10px] space-y-0.5 font-mono">
              <p>Me: {slotLabel(sess, sess.compare.my)}</p>
              <p>Vs: {slotLabel(sess, sess.compare.competitor)}</p>
            </div>
            <div className="flex flex-wrap gap-1 items-center">
              <span className="text-muted-foreground">Align at</span>
              <button
                type="button"
                className={`rounded px-1.5 py-0.5 border ${
                  (sess.compare.alignAt ?? "sf_start") === "sf_start"
                    ? "border-primary"
                    : "border-border"
                }`}
                onClick={() => setAlignAt("sf_start")}
              >
                SF start
              </button>
              <button
                type="button"
                className={`rounded px-1.5 py-0.5 border ${
                  sess.compare.alignAt === "sf_finish" ? "border-primary" : "border-border"
                }`}
                onClick={() => setAlignAt("sf_finish")}
              >
                SF finish
              </button>
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
                onClick={() =>
                  void saveSession({
                    ...sess,
                    compare: {
                      my: null,
                      competitor: null,
                      alignAt: sess.compare.alignAt,
                    },
                  })
                }
              >
                Clear
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
                        return (
                          <button
                            key={l.lapNumber}
                            type="button"
                            className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${
                              isCompare
                                ? "border-amber-500/60 bg-amber-500/10"
                                : isSector
                                  ? "border-primary bg-primary/15"
                                  : "border-border"
                            }`}
                            onClick={() => setCompareSlot(d.role, ts.sessionId, l.lapNumber)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              selectLapForSectors(ts.sessionId, d.role, l.lapNumber);
                            }}
                            title="Click: compare · Right-click: sector align"
                          >
                            L{l.lapNumber} {formatLap(l.lapTimeSec)}
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
