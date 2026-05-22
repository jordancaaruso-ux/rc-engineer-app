"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { VideoWithLineOverlay } from "./VideoWithLineOverlay";
import { VideoFrameControls } from "./VideoFrameControls";
import type { SectorLineNorm } from "./SectorLineCanvas";
import type {
  ManualVideoSessionV1,
  ManualDriver,
  DriverRole,
} from "@/lib/manualVideoAnalysis/types";
import { lapSfKey } from "@/lib/manualVideoAnalysis/types";
import { buildSfPredictions, type LapSfPrediction } from "@/lib/manualVideoAnalysis/sync";
import {
  computeLapBreakdown,
  compareBestLaps,
  averageSectorSplits,
  type SectorCompareRow,
} from "@/lib/manualVideoAnalysis/sectors";
import {
  normalizeManualSession,
  setLapIncluded,
} from "@/lib/manualVideoAnalysis/timing";

type SectorLineApi = SectorLineNorm & { sortOrder: number };

type JobData = {
  job: {
    id: string;
    track: { id: string; name: string };
    profile: { id: string; name: string };
    runId: string | null;
    analysisMode: string;
  };
  manual: {
    session: ManualVideoSessionV1;
    sfPredictions: LapSfPrediction[];
    compareBest: SectorCompareRow[];
    avgSectorsMe: Record<string, number>;
    avgSectorsCompetitor: Record<string, number>;
  } | null;
  sectorLines: SectorLineApi[];
};

type Tab = "sync" | "mark" | "compare";

function DriverLapIncludeList({
  driver,
  displayName,
  onToggle,
}: {
  driver: ManualDriver;
  displayName: string;
  onToggle: (lapNumber: number, included: boolean) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="font-medium text-xs">{displayName}</p>
      <ul className="space-y-0.5">
        {driver.laps.map((lap) => (
          <li key={lap.lapNumber} className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={lap.isIncluded !== false}
                onChange={(e) => onToggle(lap.lapNumber, e.target.checked)}
              />
              <span className="font-mono">L{lap.lapNumber}</span>
              <span className="font-mono text-muted-foreground">
                {lap.lapTimeSec.toFixed(3)}s
              </span>
            </label>
            {lap.isIncluded === false && (
              <span className="text-muted-foreground">discarded</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ManualVideoAnalysisClient({ jobId }: { jobId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoObjectUrlRef = useRef<string | null>(null);
  const [data, setData] = useState<JobData | null>(null);
  const [session, setSession] = useState<ManualVideoSessionV1 | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("sync");
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeLine, setActiveLine] = useState<string | null>(null);
  const [markLap, setMarkLap] = useState<{ role: DriverRole; lapNumber: number } | null>(null);
  const [anchorLapInput, setAnchorLapInput] = useState("1");
  const [showGlobalOffset, setShowGlobalOffset] = useState(false);

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
    if (session) {
      void saveSession({ ...session, localVideoName: file.name });
    }
  }

  function currentVideoTime(): number {
    return videoRef.current?.currentTime ?? 0;
  }

  function seekTo(sec: number | null) {
    if (sec == null || !videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, sec);
    videoRef.current.pause();
  }

  function setAnchor() {
    if (!session) return;
    const lapNumber = parseInt(anchorLapInput, 10);
    if (!Number.isFinite(lapNumber) || lapNumber < 1) return;
    const next: ManualVideoSessionV1 = {
      ...session,
      sync: {
        ...session.sync,
        anchor: {
          videoTimeSec: currentVideoTime(),
          lapNumber,
          driverRole: "me",
        },
      },
    };
    void saveSession(next);
    const name = session.drivers.find((d) => d.role === "me")?.driverName ?? "You";
    setMsg(
      `Baseline set: ${name} lap ${lapNumber} crosses finish at ${currentVideoTime().toFixed(2)}s`
    );
  }

  function setPerLapSf(role: DriverRole, lapNumber: number) {
    if (!session) return;
    const key = lapSfKey(role, lapNumber);
    const next: ManualVideoSessionV1 = {
      ...session,
      sync: {
        ...session.sync,
        perLapSfEnd: {
          ...session.sync.perLapSfEnd,
          [key]: currentVideoTime(),
        },
      },
    };
    void saveSession(next);
    const name =
      session.drivers.find((d) => d.role === role)?.driverName ??
      (role === "me" ? "You" : "Competitor");
    setMsg(`Fine-tuned finish: ${name} lap ${lapNumber}`);
  }

  function toggleLapIncluded(role: DriverRole, lapNumber: number, included: boolean) {
    if (!session) return;
    void saveSession(setLapIncluded(session, role, lapNumber, included));
    if (!included && markLap?.role === role && markLap.lapNumber === lapNumber) {
      setMarkLap(null);
    }
  }

  function upsertMark(role: DriverRole, lapNumber: number, lineKey: string) {
    if (!session) return;
    const t = currentVideoTime();
    const marks = session.marks.filter(
      (m) => !(m.driverRole === role && m.lapNumber === lapNumber && m.lineKey === lineKey)
    );
    marks.push({ driverRole: role, lapNumber, lineKey, videoTimeSec: t });
    void saveSession({ ...session, marks });
    setMsg(`Marked ${lineKey} at ${t.toFixed(3)}s`);
  }

  function jumpAndFineTune(role: DriverRole, lapNumber: number) {
    const p = predictions.find(
      (x) => x.driverRole === role && x.lapNumber === lapNumber
    );
    seekTo(p?.predictedEndSec ?? null);
    setMsg(
      p?.predictedEndSec != null
        ? `Jumped to predicted finish — use frame step, then Fine-tune finish`
        : `Set your lap 1 baseline first`
    );
  }

  const predictions =
    session && data
      ? buildSfPredictions(session.drivers, session.sync, session.selectedLaps)
      : [];

  const sectorLinesForCompute =
    data?.sectorLines.map((l) => ({
      lineKey: l.lineKey,
      label: l.label,
      sortOrder: l.sortOrder,
    })) ?? [];

  const compareRows =
    session && sectorLinesForCompute.length
      ? compareBestLaps(session, sectorLinesForCompute)
      : [];

  const avgMe =
    session && sectorLinesForCompute.length
      ? averageSectorSplits(session, sectorLinesForCompute, "me")
      : new Map();
  const avgComp =
    session && sectorLinesForCompute.length
      ? averageSectorSplits(session, sectorLinesForCompute, "competitor")
      : new Map();

  const markOrder = [...lines]
    .filter((l) => l.lineKey !== "sf")
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (!data || !session) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const meDriver = session.drivers.find((d) => d.role === "me");
  const compDriver = session.drivers.find((d) => d.role === "competitor");
  const meName = meDriver?.driverName ?? "Me";
  const compName = compDriver?.driverName ?? "Competitor";
  const anchorLap = parseInt(anchorLapInput, 10);
  const anchorLapValid = Number.isFinite(anchorLap) && anchorLap >= 1;

  const markLapChips = [
    ...session.selectedLaps.me.map((n) => ({ role: "me" as const, n })),
    ...session.selectedLaps.competitor.map((n) => ({ role: "competitor" as const, n })),
  ];

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/videos/analysis" className="underline text-muted-foreground">
          ← Hub
        </Link>
        <span className="text-muted-foreground">/</span>
        <span>
          {data.job.track.name} · {data.job.profile.name}
        </span>
        {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
      </div>

      <label className="text-xs block max-w-md">
        Video file (local — re-select if you reopen this page)
        <input
          type="file"
          accept="video/*"
          className="mt-1 w-full rounded-md border border-border px-2 py-1"
          onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
        />
        {session.localVideoName && (
          <span className="text-muted-foreground block mt-1">Last: {session.localVideoName}</span>
        )}
      </label>

      <VideoWithLineOverlay
        videoSrc={videoSrc}
        lines={lines}
        activeLineKey={activeLine}
        videoRef={videoRef}
      />
      <VideoFrameControls videoRef={videoRef} active={!!videoSrc} />

      <div className="flex gap-2 text-xs">
        {(["sync", "mark", "compare"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`rounded-md px-3 py-1.5 border ${
              tab === t ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
            }`}
            onClick={() => setTab(t)}
          >
            {t === "sync" ? "1. Timing sync" : t === "mark" ? "2. Sector marks" : "3. Compare"}
          </button>
        ))}
        <Link
          href={`/videos/analysis/tracks/${data.job.track.id}`}
          className="rounded-md border border-border px-3 py-1.5 hover:bg-muted ml-auto"
        >
          Edit lines
        </Link>
      </div>

      {tab === "sync" && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4 text-xs">
          <h2 className="font-medium text-sm">Timing sync</h2>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>
              Scrub to when <strong>{meName}</strong> crosses the finish line on a known lap (usually
              lap 1).
            </li>
            <li>Uncheck any bad laps (e.g. out-lap / incomplete lap 1).</li>
            <li>
              For each included lap: <strong>Jump to finish</strong> → frame-step →{" "}
              <strong>Fine-tune finish</strong>.
            </li>
          </ol>

          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
            <p className="font-medium text-sm">Step 1 — Baseline (your car)</p>
            <div className="flex flex-wrap gap-2 items-center">
              <label>
                My lap #
                <input
                  className="ml-1 w-14 rounded border border-border px-1 py-0.5"
                  value={anchorLapInput}
                  onChange={(e) => setAnchorLapInput(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground"
                onClick={setAnchor}
                disabled={!anchorLapValid}
              >
                {anchorLapValid
                  ? `Set my lap ${anchorLap} finish here`
                  : "Set finish here"}
              </button>
            </div>
            {session.sync.anchor ? (
              <p className="text-muted-foreground">
                Baseline: {meName} lap {session.sync.anchor.lapNumber} at{" "}
                {session.sync.anchor.videoTimeSec.toFixed(2)}s in video
              </p>
            ) : (
              <p className="text-amber-600 dark:text-amber-400">
                Set a baseline before jumping to other laps.
              </p>
            )}
          </div>

          <div className="space-y-3">
            <p className="font-medium text-sm">Laps to analyze</p>
            <p className="text-muted-foreground">
              All laps are included by default. Uncheck to discard (common for race lap 1).
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              {meDriver && (
                <DriverLapIncludeList
                  driver={meDriver}
                  displayName={meName}
                  onToggle={(lapNumber, included) =>
                    toggleLapIncluded("me", lapNumber, included)
                  }
                />
              )}
              {compDriver && (
                <DriverLapIncludeList
                  driver={compDriver}
                  displayName={compName}
                  onToggle={(lapNumber, included) =>
                    toggleLapIncluded("competitor", lapNumber, included)
                  }
                />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <p className="font-medium text-sm">Step 2 — Sync finish per lap</p>
            {!session.sync.anchor && (
              <p className="text-muted-foreground">Complete step 1 first.</p>
            )}
            <table className="w-full text-left">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  <th className="py-1">Driver</th>
                  <th className="py-1">Lap</th>
                  <th className="py-1">Transponder</th>
                  <th className="py-1">Predicted finish</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {predictions.map((p) => (
                  <tr key={`${p.driverRole}-${p.lapNumber}`} className="border-b border-border/50">
                    <td className="py-1">{p.driverRole === "me" ? meName : compName}</td>
                    <td className="py-1 font-mono">{p.lapNumber}</td>
                    <td className="py-1 font-mono">{p.lapTimeSec.toFixed(3)}s</td>
                    <td className="py-1 font-mono">
                      {p.predictedEndSec != null ? `${p.predictedEndSec.toFixed(2)}s` : "—"}
                      {p.overridden ? " ✓" : ""}
                    </td>
                    <td className="py-1 whitespace-nowrap">
                      <button
                        type="button"
                        className="underline mr-2"
                        disabled={p.predictedEndSec == null}
                        onClick={() => jumpAndFineTune(p.driverRole, p.lapNumber)}
                      >
                        Jump here
                      </button>
                      <button
                        type="button"
                        className="underline"
                        onClick={() => setPerLapSf(p.driverRole, p.lapNumber)}
                      >
                        Fine-tune finish
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details
            className="text-muted-foreground"
            open={showGlobalOffset || (session.sync.globalOffsetSec ?? 0) !== 0}
            onToggle={(e) => setShowGlobalOffset((e.target as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer font-medium text-foreground">
              Advanced: shift all predicted times
            </summary>
            <p className="mt-2">
              Adds seconds to every predicted finish time. Use only if every lap is consistently
              early or late vs the video; per-lap <strong>Fine-tune finish</strong> is usually better.
            </p>
            <label className="flex items-center gap-1 mt-2">
              Shift (seconds)
              <input
                type="number"
                step="0.1"
                className="w-20 rounded border border-border px-1"
                value={session.sync.globalOffsetSec ?? 0}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  void saveSession({
                    ...session,
                    sync: {
                      ...session.sync,
                      globalOffsetSec: Number.isFinite(v) ? v : 0,
                    },
                  });
                }}
              />
            </label>
          </details>
        </div>
      )}

      {tab === "mark" && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3 text-xs">
          <h2 className="font-medium text-sm">Sector frame marks</h2>
          <p className="text-muted-foreground">
            Pick a lap, jump near the start, scrub with frame step, mark each sector at the playhead.
            Mark the finish line last.
          </p>
          {markLapChips.length === 0 ? (
            <p className="text-muted-foreground">
              No laps selected — include laps on the Timing sync tab.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {markLapChips.map(({ role, n }) => (
                <button
                  key={`${role}-${n}`}
                  type="button"
                  className={`rounded-md px-2 py-1 border ${
                    markLap?.role === role && markLap?.lapNumber === n
                      ? "border-primary bg-primary/10"
                      : "border-border"
                  }`}
                  onClick={() => setMarkLap({ role, lapNumber: n })}
                >
                  {role === "me" ? meName : compName} L{n}
                </button>
              ))}
            </div>
          )}
          {markLap && (
            <div className="space-y-2">
              <p className="font-medium">
                {markLap.role === "me" ? meName : compName} — lap {markLap.lapNumber}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 hover:bg-muted"
                  onClick={() => {
                    const p = predictions.find(
                      (x) =>
                        x.driverRole === markLap.role && x.lapNumber === markLap.lapNumber
                    );
                    seekTo(p?.predictedStartSec ?? p?.predictedEndSec ?? null);
                  }}
                >
                  Jump to lap start
                </button>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 hover:bg-muted"
                  onClick={() => jumpAndFineTune(markLap.role, markLap.lapNumber)}
                >
                  Jump to finish
                </button>
              </div>
              {markOrder.map((ln) => (
                <button
                  key={ln.lineKey}
                  type="button"
                  className="block w-full text-left rounded border border-border px-2 py-1 hover:bg-muted"
                  onClick={() => {
                    setActiveLine(ln.lineKey);
                    upsertMark(markLap.role, markLap.lapNumber, ln.lineKey);
                  }}
                >
                  Mark {ln.label} at playhead
                  {session.marks.find(
                    (m) =>
                      m.driverRole === markLap.role &&
                      m.lapNumber === markLap.lapNumber &&
                      m.lineKey === ln.lineKey
                  )
                    ? ` ✓ ${session.marks.find((m) => m.driverRole === markLap.role && m.lapNumber === markLap.lapNumber && m.lineKey === ln.lineKey)!.videoTimeSec.toFixed(2)}s`
                    : ""}
                </button>
              ))}
              <button
                type="button"
                className="block w-full text-left rounded border border-green-600/50 px-2 py-1 hover:bg-muted"
                onClick={() => {
                  setActiveLine("sf");
                  upsertMark(markLap.role, markLap.lapNumber, "sf");
                }}
              >
                Mark finish line at playhead
                {session.marks.find(
                  (m) =>
                    m.driverRole === markLap.role &&
                    m.lapNumber === markLap.lapNumber &&
                    m.lineKey === "sf"
                )
                  ? ` ✓`
                  : ""}
              </button>
              {(() => {
                const bd = computeLapBreakdown(
                  session,
                  sectorLinesForCompute,
                  markLap.role,
                  markLap.lapNumber
                );
                if (!bd) return null;
                return (
                  <ul className="font-mono text-[10px] text-muted-foreground mt-2">
                    {bd.sectors.map((s) => (
                      <li key={s.lineKey}>
                        {s.label}: {s.splitSec > 0 ? `${s.splitSec.toFixed(3)}s` : "—"}
                      </li>
                    ))}
                    {bd.lapEndSec != null && bd.lapStartSec != null && (
                      <li>Lap total (video): {(bd.lapEndSec - bd.lapStartSec).toFixed(3)}s</li>
                    )}
                    <li>Transponder: {bd.lapTimeSec.toFixed(3)}s</li>
                  </ul>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {tab === "compare" && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4 text-xs">
          <h2 className="font-medium text-sm">Compare</h2>
          <h3 className="text-muted-foreground">Best lap vs best lap (sector splits)</h3>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-1">Sector</th>
                <th className="text-right py-1">{meName}</th>
                <th className="text-right py-1">{compName}</th>
                <th className="text-right py-1">Δ (you−them)</th>
              </tr>
            </thead>
            <tbody>
              {compareRows.map((r) => (
                <tr key={r.lineKey} className="border-b border-border/50">
                  <td className="py-1">{r.label}</td>
                  <td className="text-right font-mono">
                    {r.meBestSec != null ? r.meBestSec.toFixed(3) : "—"}
                  </td>
                  <td className="text-right font-mono">
                    {r.competitorBestSec != null ? r.competitorBestSec.toFixed(3) : "—"}
                  </td>
                  <td
                    className={`text-right font-mono ${
                      r.deltaSec != null && r.deltaSec < 0 ? "text-green-400" : ""
                    }`}
                  >
                    {r.deltaSec != null ? `${r.deltaSec >= 0 ? "+" : ""}${r.deltaSec.toFixed(3)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="text-muted-foreground pt-2">
            Average across best 3 included laps (marked sectors)
          </h3>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-1">Sector</th>
                <th className="text-right py-1">{meName} avg</th>
                <th className="text-right py-1">{compName} avg</th>
              </tr>
            </thead>
            <tbody>
              {lines
                .filter((l) => l.lineKey !== "sf")
                .map((ln) => (
                  <tr key={ln.lineKey} className="border-b border-border/50">
                    <td className="py-1">{ln.label}</td>
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

      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
