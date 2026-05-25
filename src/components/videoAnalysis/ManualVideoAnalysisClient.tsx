"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { VideoWithLineOverlay } from "./VideoWithLineOverlay";
import { VideoFrameControls } from "./VideoFrameControls";
import type { SectorLineNorm } from "./SectorLineCanvas";
import type { ManualVideoSessionV1, DriverRole } from "@/lib/manualVideoAnalysis/types";
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

type SectorLineApi = SectorLineNorm & { sortOrder: number };

type JobData = {
  job: {
    id: string;
    track: { id: string; name: string };
    profile: { id: string; name: string };
    runId: string | null;
  };
  manual: { session: ManualVideoSessionV1 } | null;
  sectorLines: SectorLineApi[];
};

type ActiveLap = { role: DriverRole; lapNumber: number };

function Top3LapChips({
  label,
  lapNumbers,
  driverLaps,
  active,
  onSelect,
  onDiscard,
}: {
  label: string;
  lapNumbers: number[];
  driverLaps: { lapNumber: number; lapTimeSec: number }[];
  active: ActiveLap | null;
  onSelect: (lapNumber: number) => void;
  onDiscard: (lapNumber: number) => void;
}) {
  const timeByLap = new Map(driverLaps.map((l) => [l.lapNumber, l.lapTimeSec]));
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {lapNumbers.map((n) => {
          const isActive = active?.lapNumber === n;
          return (
            <div
              key={n}
              className={`inline-flex items-center rounded-md border text-xs font-mono ${
                isActive ? "border-primary bg-primary/15" : "border-border bg-muted/30"
              }`}
            >
              <button
                type="button"
                className="px-2 py-1 hover:bg-muted/50 rounded-l-md"
                onClick={() => onSelect(n)}
              >
                L{n} {(timeByLap.get(n) ?? 0).toFixed(2)}s
              </button>
              <button
                type="button"
                className="px-1.5 py-1 text-muted-foreground hover:text-foreground border-l border-border rounded-r-md"
                title="Discard lap (next fastest refills top 3)"
                onClick={(e) => {
                  e.stopPropagation();
                  onDiscard(n);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
        {lapNumbers.length === 0 && (
          <span className="text-muted-foreground text-xs">No laps — check discards</span>
        )}
      </div>
    </div>
  );
}

export function ManualVideoAnalysisClient({ jobId }: { jobId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoObjectUrlRef = useRef<string | null>(null);
  const [data, setData] = useState<JobData | null>(null);
  const [session, setSession] = useState<ManualVideoSessionV1 | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeLine, setActiveLine] = useState<string | null>(null);
  const [activeLap, setActiveLap] = useState<ActiveLap | null>(null);
  const [alignStepIndex, setAlignStepIndex] = useState(0);
  const [anchorLapInput, setAnchorLapInput] = useState("1");
  const [showDiscardPool, setShowDiscardPool] = useState(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPersistRef = useRef<ManualVideoSessionV1 | null>(null);

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
      if (normalized.sync.anchor?.lapNumber) {
        setAnchorLapInput(String(normalized.sync.anchor.lapNumber));
      }
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

  async function persistSession(next: ManualVideoSessionV1, opts?: { reload?: boolean }) {
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

  function schedulePersist(next: ManualVideoSessionV1) {
    pendingPersistRef.current = next;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      const pending = pendingPersistRef.current;
      pendingPersistRef.current = null;
      if (pending) void persistSession(pending);
    }, 500);
  }

  async function saveSession(next: ManualVideoSessionV1) {
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
    if (!session) return;
    const lapNumber = parseInt(anchorLapInput, 10);
    if (!Number.isFinite(lapNumber) || lapNumber < 1) return;
    void saveSession({
      ...session,
      sync: {
        ...session.sync,
        anchor: {
          videoTimeSec: currentVideoTime(),
          lapNumber,
          driverRole: "me",
        },
      },
    });
    setMsg(`Baseline: your lap ${lapNumber} finish at ${currentVideoTime().toFixed(2)}s`);
  }

  function applyMarkAtPlayhead(
    base: ManualVideoSessionV1,
    lap: ActiveLap,
    lineKey: string,
    isLapFinish: boolean
  ): ManualVideoSessionV1 {
    const t = currentVideoTime();
    const marks = base.marks.filter(
      (m) =>
        !(m.driverRole === lap.role && m.lapNumber === lap.lapNumber && m.lineKey === lineKey)
    );
    marks.push({
      driverRole: lap.role,
      lapNumber: lap.lapNumber,
      lineKey,
      videoTimeSec: t,
    });
    let next: ManualVideoSessionV1 = { ...base, marks };
    if (isLapFinish) {
      const key = lapSfKey(lap.role, lap.lapNumber);
      next = {
        ...next,
        sync: {
          ...next.sync,
          perLapSfEnd: { ...next.sync.perLapSfEnd, [key]: t },
        },
      };
    }
    return normalizeManualSession(next);
  }

  function discardLap(role: DriverRole, lapNumber: number) {
    if (!session) return;
    void saveSession(setLapIncluded(session, role, lapNumber, false));
    if (activeLap?.role === role && activeLap.lapNumber === lapNumber) {
      setActiveLap(null);
    }
    setMsg(`Lap ${lapNumber} discarded — top 3 refilled`);
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

  function selectLap(role: DriverRole, lapNumber: number) {
    if (!session) return;
    const preview = getLapAlignmentPreview(session, sectorLinesForCompute, role, lapNumber);
    setActiveLap({ role, lapNumber });
    setAlignStepIndex(0);
    if (preview?.lapStartSec == null || preview.lapEndSec == null) {
      setMsg("Set your lap finish baseline first.");
      return;
    }
    const steps = getLapAlignSteps(preview);
    if (steps.length === 0) {
      setMsg("Could not predict lap timing.");
      return;
    }
    seekToAlignStep(preview, 0, steps);
    setMsg(`Lap ${lapNumber}: at lap start — align sectors, then lap finish.`);
  }

  function advanceAlignStep(applyPlayhead: boolean) {
    if (!session || !activeLap) return;
    let s = session;
    const preview0 = getLapAlignmentPreview(s, sectorLinesForCompute, activeLap.role, activeLap.lapNumber);
    if (!preview0?.lapEndSec) return;
    const steps0 = getLapAlignSteps(preview0);
    const step = steps0[alignStepIndex];
    if (!step) return;

    if (applyPlayhead) {
      s = applyMarkAtPlayhead(s, activeLap, step.lineKey, step.isLapFinish);
      setSession(s);
      schedulePersist(s);
    }

    const preview = getLapAlignmentPreview(s, sectorLinesForCompute, activeLap.role, activeLap.lapNumber);
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
            m.driverRole === activeLap.role &&
            m.lapNumber === activeLap.lapNumber &&
            m.lineKey === LAP_START_LINE_KEY
        )
      : activePreview?.crossings.find((c) => c.lineKey === currentAlignStep.lineKey)?.confirmed);

  if (!data || !session) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const meDriver = session.drivers.find((d) => d.role === "me");
  const compDriver = session.drivers.find((d) => d.role === "competitor");
  const meName = meDriver?.driverName ?? "Me";
  const compName = compDriver?.driverName ?? "Competitor";
  const anchorLap = parseInt(anchorLapInput, 10);
  const anchorLapValid = Number.isFinite(anchorLap) && anchorLap >= 1;
  const hasAnchor = Boolean(session.sync.anchor);

  const compareRows =
    sectorLinesForCompute.length
      ? compareBestLaps(session, sectorLinesForCompute)
      : [];
  const avgMe = averageSectorSplits(session, sectorLinesForCompute, "me");
  const avgComp = averageSectorSplits(session, sectorLinesForCompute, "competitor");

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
        {session.localVideoName && (
          <span className="text-muted-foreground ml-2">{session.localVideoName}</span>
        )}
      </label>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)]">
        <div className="flex flex-col gap-2 min-w-0">
          <VideoWithLineOverlay
            videoSrc={videoSrc}
            lines={lines}
            activeLineKey={activeLine}
            videoRef={videoRef}
          />
          <VideoFrameControls videoRef={videoRef} active={!!videoSrc} />
        </div>

        <div className="flex flex-col gap-3 text-xs max-h-[min(70vh,720px)] overflow-y-auto pr-1">
          <div className="rounded-lg border border-border bg-card p-3 space-y-2">
            <p className="font-medium text-sm">1. Baseline finish</p>
            <p className="text-muted-foreground">
              Scrub to when <strong>{meName}</strong> crosses the finish on a known lap.
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
              <button
                type="button"
                className="rounded-md bg-primary px-2.5 py-1 text-primary-foreground"
                disabled={!anchorLapValid}
                onClick={setAnchor}
              >
                Set lap {anchorLapValid ? anchorLap : ""} finish here
              </button>
            </div>
            {hasAnchor ? (
              <p className="text-muted-foreground font-mono">
                ✓ Lap {session.sync.anchor!.lapNumber} @ {session.sync.anchor!.videoTimeSec.toFixed(2)}s
              </p>
            ) : null}
          </div>

          <div
            className={`rounded-lg border border-border bg-card p-3 space-y-2 ${!hasAnchor ? "opacity-50 pointer-events-none" : ""}`}
          >
            <p className="font-medium text-sm">2. Top 3 laps</p>
            <p className="text-muted-foreground">
              Click a lap — video jumps to calculated lap start (SF), then S1, S2, …, finish.
            </p>
            {meDriver && (
              <Top3LapChips
                label={meName}
                lapNumbers={session.selectedLaps.me}
                driverLaps={meDriver.laps}
                active={activeLap?.role === "me" ? activeLap : null}
                onSelect={(n) => selectLap("me", n)}
                onDiscard={(n) => discardLap("me", n)}
              />
            )}
            {compDriver && (
              <Top3LapChips
                label={compName}
                lapNumbers={session.selectedLaps.competitor}
                driverLaps={compDriver.laps}
                active={activeLap?.role === "competitor" ? activeLap : null}
                onSelect={(n) => selectLap("competitor", n)}
                onDiscard={(n) => discardLap("competitor", n)}
              />
            )}

            <details
              open={showDiscardPool}
              onToggle={(e) => setShowDiscardPool((e.target as HTMLDetailsElement).open)}
            >
              <summary className="cursor-pointer text-muted-foreground">Discard other laps</summary>
              <div className="mt-2 space-y-2 max-h-32 overflow-y-auto">
                {[meDriver, compDriver].map((d) =>
                  d ? (
                    <div key={d.role}>
                      <p className="font-medium">{d.role === "me" ? meName : compName}</p>
                      <ul className="flex flex-wrap gap-1 mt-1">
                        {d.laps.map((l) => (
                          <li key={l.lapNumber}>
                            <label className="inline-flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={l.isIncluded !== false}
                                onChange={(e) => {
                                  if (!session) return;
                                  void saveSession(
                                    setLapIncluded(session, d.role, l.lapNumber, e.target.checked)
                                  );
                                }}
                              />
                              <span className="font-mono">L{l.lapNumber}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null
                )}
              </div>
            </details>
          </div>

          {activeLap && activePreview && (
            <div className="rounded-lg border border-primary/40 bg-card p-3 space-y-2">
              <p className="font-medium text-sm">
                Lap {activeLap.lapNumber} · {activeLap.role === "me" ? meName : compName}
                <span className="font-mono text-muted-foreground ml-2">
                  {activePreview.lapTimeSec.toFixed(3)}s
                </span>
              </p>
              {!currentAlignStep ? (
                <p className="text-amber-600 dark:text-amber-400">Set baseline first.</p>
              ) : (
                <>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    Step {alignStepIndex + 1} of {alignSteps.length}
                  </p>
                  <p className="font-medium text-sm">{currentAlignStep.label}</p>
                  <p className="text-muted-foreground">
                    {currentAlignStep.isLapStart
                      ? "Exact calculated lap start (SF crossing). Adjust if needed, then Next."
                      : currentAlignStep.isLapFinish
                        ? "Calculated lap finish (SF). Adjust if needed, then save."
                        : "Guessed sector time from lap split — align crossing, then Next."}
                  </p>
                  <p className="font-mono text-muted-foreground">
                    Predicted {currentAlignStep.videoTimeSec.toFixed(2)}s
                    {currentStepConfirmed ? " · adjusted ✓" : ""}
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {alignSteps.map((s, i) => (
                      <button
                        key={`${s.lineKey}-${i}`}
                        type="button"
                        title={s.label}
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] border ${
                          i === alignStepIndex
                            ? "border-primary bg-primary/15"
                            : "border-border opacity-60"
                        }`}
                        onClick={() => seekToAlignStep(activePreview, i, alignSteps)}
                      >
                        {s.isLapStart ? "Start" : s.isLapFinish ? "End" : s.lineKey}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1 hover:bg-muted"
                      onClick={() =>
                        seekToAlignStep(activePreview, alignStepIndex, alignSteps)
                      }
                    >
                      Replay step
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1 hover:bg-muted"
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
                  </div>
                  {alignStepIndex >= alignSteps.length - 1 && (
                    <button
                      type="button"
                      className="rounded-md border border-green-600/50 px-2 py-1 w-full mt-1 hover:bg-muted"
                      onClick={confirmActiveLap}
                    >
                      Save lap alignment
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          <button
            type="button"
            className="text-xs text-left underline text-muted-foreground"
            onClick={() => setShowCompare((v) => !v)}
          >
            {showCompare ? "Hide" : "Show"} compare results
          </button>

          {showCompare && (
            <div className="rounded-lg border border-border bg-card p-3 space-y-3">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-1">Sector</th>
                    <th className="text-right py-1">{meName}</th>
                    <th className="text-right py-1">{compName}</th>
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
              <p className="text-muted-foreground">Avg best 3 (confirmed marks)</p>
              <table className="w-full">
                <tbody>
                  {lines
                    .filter((l) => l.lineKey !== "sf")
                    .map((ln) => (
                      <tr key={ln.lineKey} className="border-b border-border/50">
                        <td className="py-0.5">{ln.label}</td>
                        <td className="text-right font-mono">
                          {avgMe.get(ln.lineKey)?.toFixed(3) ?? "—"}
                        </td>
                        <td className="text-right font-mono">
                          {avgComp.get(ln.lineKey)?.toFixed(3) ?? "—"}
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
