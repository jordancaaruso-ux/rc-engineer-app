"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { VideoWithLineOverlay } from "./VideoWithLineOverlay";
import { VideoFrameControls } from "./VideoFrameControls";
import type { SectorLineNorm } from "./SectorLineCanvas";
import type { ManualVideoSessionV1, DriverRole } from "@/lib/manualVideoAnalysis/types";
import { lapSfKey } from "@/lib/manualVideoAnalysis/types";
import { compareBestLaps, averageSectorSplits } from "@/lib/manualVideoAnalysis/sectors";
import {
  getLapAlignmentPreview,
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
  const [anchorLapInput, setAnchorLapInput] = useState("1");
  const [showDiscardPool, setShowDiscardPool] = useState(false);

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
    };
  }, []);

  async function saveSession(next: ManualVideoSessionV1) {
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
      return;
    }
    void load();
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

  function fineTuneSf(role: DriverRole, lapNumber: number) {
    if (!session) return;
    const key = lapSfKey(role, lapNumber);
    void saveSession({
      ...session,
      sync: {
        ...session.sync,
        perLapSfEnd: {
          ...session.sync.perLapSfEnd,
          [key]: currentVideoTime(),
        },
      },
    });
    setMsg(`Finish updated for lap ${lapNumber}`);
  }

  function discardLap(role: DriverRole, lapNumber: number) {
    if (!session) return;
    void saveSession(setLapIncluded(session, role, lapNumber, false));
    if (activeLap?.role === role && activeLap.lapNumber === lapNumber) {
      setActiveLap(null);
    }
    setMsg(`Lap ${lapNumber} discarded — top 3 refilled`);
  }

  function selectLap(role: DriverRole, lapNumber: number) {
    setActiveLap({ role, lapNumber });
    if (!session) return;
    const preview = getLapAlignmentPreview(session, sectorLinesForCompute, role, lapNumber);
    if (preview?.lapStartSec != null) {
      seekTo(Math.max(0, preview.lapStartSec - 1));
    } else if (preview?.lapEndSec != null) {
      seekTo(preview.lapEndSec);
    }
    if (preview?.crossings[0]) {
      setActiveLine(preview.crossings[0].lineKey);
    }
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

  function jumpToCrossing(c: { lineKey: string; videoTimeSec: number }) {
    setActiveLine(c.lineKey);
    seekTo(c.videoTimeSec);
  }

  function setCrossingAtPlayhead(lineKey: string) {
    if (!session || !activeLap) return;
    const t = currentVideoTime();
    const marks = session.marks.filter(
      (m) =>
        !(
          m.driverRole === activeLap.role &&
          m.lapNumber === activeLap.lapNumber &&
          m.lineKey === lineKey
        )
    );
    marks.push({
      driverRole: activeLap.role,
      lapNumber: activeLap.lapNumber,
      lineKey,
      videoTimeSec: t,
    });
    if (lineKey === "sf") {
      const key = lapSfKey(activeLap.role, activeLap.lapNumber);
      void saveSession({
        ...session,
        marks,
        sync: {
          ...session.sync,
          perLapSfEnd: { ...session.sync.perLapSfEnd, [key]: t },
        },
      });
    } else {
      void saveSession({ ...session, marks });
    }
    setMsg(`${lineKey} at ${t.toFixed(2)}s`);
  }

  const activePreview: LapAlignmentPreview | null =
    session && activeLap
      ? getLapAlignmentPreview(
          session,
          sectorLinesForCompute,
          activeLap.role,
          activeLap.lapNumber
        )
      : null;

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !activePreview?.crossings.length) return;
    const onTime = () => {
      const t = v.currentTime;
      let best = activePreview.crossings[0]!;
      let bestD = Math.abs(t - best.videoTimeSec);
      for (const c of activePreview.crossings) {
        const d = Math.abs(t - c.videoTimeSec);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (bestD < 1.5) setActiveLine(best.lineKey);
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [activePreview]);

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
            <p className="text-muted-foreground">Click a lap to preview. × discards (next fastest refills).</p>
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
                  {activePreview.lapTimeSec.toFixed(3)}s transponder
                </span>
              </p>
              {!activePreview.crossings.length ? (
                <p className="text-amber-600 dark:text-amber-400">Set baseline first.</p>
              ) : (
                <>
                  <p className="text-muted-foreground">
                    Guessed sectors (equal split). Scrub to match, then confirm.
                  </p>
                  <ul className="space-y-1">
                    {activePreview.crossings.map((c) => (
                      <li
                        key={c.lineKey}
                        className={`flex items-center justify-between gap-2 rounded px-1.5 py-0.5 ${
                          activeLine === c.lineKey ? "bg-primary/10" : ""
                        }`}
                      >
                        <span>
                          {c.label}
                          <span className="font-mono text-muted-foreground ml-1">
                            {c.videoTimeSec.toFixed(2)}s
                          </span>
                          {c.confirmed ? <span className="text-green-600 ml-1">✓</span> : null}
                        </span>
                        <span className="shrink-0 flex gap-1">
                          <button
                            type="button"
                            className="underline"
                            onClick={() => jumpToCrossing(c)}
                          >
                            Go
                          </button>
                          <button
                            type="button"
                            className="underline"
                            onClick={() => setCrossingAtPlayhead(c.lineKey)}
                          >
                            Here
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1 hover:bg-muted"
                      onClick={() => {
                        if (activePreview.lapEndSec != null) seekTo(activePreview.lapEndSec);
                      }}
                    >
                      Jump to finish
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1 hover:bg-muted"
                      onClick={() => fineTuneSf(activeLap.role, activeLap.lapNumber)}
                    >
                      Finish at playhead
                    </button>
                    <button
                      type="button"
                      className="rounded-md bg-primary px-2 py-1 text-primary-foreground ml-auto"
                      onClick={confirmActiveLap}
                    >
                      Confirm lap
                    </button>
                  </div>
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
