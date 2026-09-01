"use client";

/**
 * Does the browser decode lane match the validated offline one?
 *
 * The detector is checked offline against transponder lap times and Jordan's hand marks, decoding
 * with ffmpeg. The app cannot use ffmpeg, so it reads frames through a canvas instead — and a
 * canvas only ever returns RGBA, while the offline run reads the decoder's own luma plane. That
 * one difference is the whole risk: dropping colour is what made the kerb lines work at all, and
 * brightness recovered from RGB carries back however much chroma the matrix leaks.
 *
 * So this page runs the real browser path over the real file and prints the difference, target by
 * target, against the offline answer. It measures rather than assumes — which is the only reason
 * to trust the button in the analyze flow.
 *
 * Pick `IMG_4044.MOV`. Nothing is uploaded and nothing is saved.
 */

import { useMemo, useRef, useState } from "react";
import { notFound } from "next/navigation";

import {
  findCrossingsInBrowser,
  isScanAborted,
  type ScanProgress,
} from "@/lib/videoAnalysis/findCrossings/browserScan";
import type { LineCalibration } from "@/lib/videoAnalysis/findCrossings/calibrate";
import { refineByChaining } from "@/lib/videoAnalysis/findCrossings/refine";
import type { TrackedResult } from "@/lib/videoAnalysis/findCrossings/detector";
import {
  FIXTURE_LAP_STARTS,
  FIXTURE_LINES,
  FIXTURE_TARGETS,
  FIXTURE_VIDEO,
} from "./fixture";

type Row = {
  id: string;
  lineKey: string;
  expected: number | null;
  got: number | null;
  deltaMs: number | null;
  source: string;
  moved: boolean;
};

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export default function FindCrossingsDebugPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [ready, setReady] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [cals, setCals] = useState<Record<string, LineCalibration> | null>(null);
  const [stats, setStats] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [chain, setChain] = useState(true);
  // The learning pass reads WHOLE laps with every line active at once — several times the
  // per-frame work of a narrow window, and the case that kept coming back empty.
  const [wholeLaps, setWholeLaps] = useState(false);

  const summary = useMemo(() => {
    if (!rows) return null;
    const hits = rows.filter((r) => r.deltaMs != null).map((r) => Math.abs(r.deltaMs!));
    const bothFound = rows.filter((r) => r.expected != null && r.got != null).length;
    const weMissed = rows.filter((r) => r.expected != null && r.got == null).length;
    const weFoundExtra = rows.filter((r) => r.expected == null && r.got != null).length;
    return {
      bothFound,
      weMissed,
      weFoundExtra,
      medianMs: median(hits),
      within1Frame: hits.filter((d) => d <= 33).length,
      within100: hits.filter((d) => d <= 100).length,
      worst: hits.length ? Math.max(...hits) : 0,
    };
  }, [rows]);

  function onPick(file: File) {
    const video = videoRef.current!;
    setRows(null);
    setStats(null);
    setError(null);
    setReady(false);
    video.src = URL.createObjectURL(file);
    video.muted = true;
  }

  async function run() {
    const video = videoRef.current;
    if (!video || !dims) return;
    setRunning(true);
    setError(null);
    setRows(null);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const scan = await findCrossingsInBrowser({
        video,
        frameW: dims.w,
        frameH: dims.h,
        lines: FIXTURE_LINES,
        targets: wholeLaps
          ? FIXTURE_LAP_STARTS.flatMap((l) =>
              ["s1", "s2", "s3", "s4", "s5"].map((lineKey) => ({
                id: `me:${l.lapNumber}:${lineKey}`,
                lineKey,
                lapNumber: l.lapNumber,
                centerSec: l.videoTimeSec + 8,
                truthSec: null,
                searchFrom: l.videoTimeSec,
                searchTo: l.videoTimeSec + 16,
              }))
            )
          : FIXTURE_TARGETS.map((t) => ({
              id: t.id,
              lineKey: t.lineKey,
              lapNumber: t.lapNumber,
              centerSec: t.centerSec,
              truthSec: null,
            })),
        onProgress: setProgress,
        signal: controller.signal,
      });

      // Chaining needs the lap starts as fixed anchors, exactly as the analyze flow supplies them
      // from the transponder lap list. No candidates, so the chain can start here but never move it.
      const sfAnchors: TrackedResult[] = FIXTURE_LAP_STARTS.map((l) => ({
        id: `sf-L${l.lapNumber}`,
        lineKey: "sf",
        lapNumber: l.lapNumber,
        centerSec: l.videoTimeSec,
        truthSec: l.videoTimeSec,
        detectedSec: l.videoTimeSec,
        eventCount: 0,
        quality: null,
        source: "confirmed",
        rawEventCount: 0,
        trackCrossingCount: 0,
        candidates: [],
        colourRejected: 0,
        candidateColours: [],
      }));

      const chained = chain
        ? refineByChaining([...sfAnchors, ...scan.results], "sf")
        : scan.results;

      const expectedById = new Map(FIXTURE_TARGETS.map((t) => [t.id, t.expected]));
      const next: Row[] = chained.map((r) => {
        const expected = expectedById.get(r.id) ?? null;
        const got = r.detectedSec;
        return {
          id: r.id,
          lineKey: r.lineKey,
          expected,
          got,
          deltaMs: expected != null && got != null ? (got - expected) * 1000 : null,
          source: r.source ?? "—",
          moved: "movedBy" in r && (r as { movedBy?: number }).movedBy != null,
        };
      });
      next.sort((a, b) => a.id.localeCompare(b.id));
      setRows(next);
      setCals(scan.calibrations);
      const per = (ms: number) => (ms / Math.max(1, scan.framesRead)).toFixed(1);
      setStats(
        [
          `${scan.framesRead} frames in ${(scan.elapsedMs / 1000).toFixed(0)}s`,
          `${(scan.framesRead / (scan.elapsedMs / 1000)).toFixed(1)} fps`,
          `median gap ${scan.timings.medianFrameGapMs.toFixed(0)}ms`,
          `per frame: draw ${per(scan.timings.drawMs)} · read ${per(scan.timings.readMs)} · luma ${per(scan.timings.lumaMs)} · detect ${per(scan.timings.detectMs)}ms`,
        ].join(" · ") +
          "\n" +
          scan.segments
            .map(
              (s) =>
                `${s.from.toFixed(1)}–${s.to.toFixed(1)}s: ${s.frames} frames, ${s.medianMediaGapMs.toFixed(0)}ms apart, for ${s.targets} target${s.targets === 1 ? "" : "s"} in ${(s.wallMs / 1000).toFixed(1)}s${s.rate < 1 ? ` @ ${Math.round(s.rate * 100)}% speed` : ""}${s.starved ? "  ** STARVED — reported as not found **" : ""}`
            )
            .join("\n")
      );
    } catch (e) {
      if (!isScanAborted(e)) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="text-[18px] font-bold tracking-tight">Find crossings — browser vs offline</h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          Pick <strong>{FIXTURE_VIDEO}</strong>. Runs the app&rsquo;s own decode path over{" "}
          {FIXTURE_TARGETS.length} known crossings and compares each one against the validated
          offline answer. Nothing is uploaded or saved.
        </p>
      </div>

      <input
        type="file"
        accept="video/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
        }}
        className="block w-full text-[12px]"
      />

      <video
        ref={videoRef}
        muted
        playsInline
        preload="auto"
        className="w-full rounded-lg border border-border bg-black"
        onLoadedMetadata={(e) => {
          setDims({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight });
          setReady(e.currentTarget.videoWidth > 0);
        }}
      />

      {dims ? (
        <p className="text-[11.5px] text-muted-foreground">
          {dims.w}×{dims.h}
          {dims.w === 0 ? " — no picture (hardware decoding off?)" : ""}
        </p>
      ) : null}

      <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <input type="checkbox" checked={chain} onChange={(e) => setChain(e.target.checked)} />
        Chain each lap (second pass)
      </label>
      <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <input
          type="checkbox"
          checked={wholeLaps}
          onChange={(e) => setWholeLaps(e.target.checked)}
        />
        Read whole laps, every line at once (the learning pass)
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!ready || running}
          onClick={run}
          className="rounded-lg primary-face bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          {running ? "Scanning…" : "Run"}
        </button>
        {running ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="rounded-lg border border-border bg-secondary px-4 py-2 text-[13px] font-semibold text-muted-foreground"
          >
            Stop
          </button>
        ) : null}
      </div>

      {running && progress ? (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div
              className="h-full bg-primary"
              style={{ width: `${Math.max(2, progress.fraction * 100)}%` }}
            />
          </div>
          <p className="text-[11.5px] text-muted-foreground">{progress.note}</p>
        </div>
      ) : null}

      {error ? <p className="text-[12.5px] text-loss">{error}</p> : null}

      {cals ? (
        <div className="rounded-lg border border-border bg-secondary/50 p-3">
          <span className="type-data-label">How each line was read</span>
          <ul className="mt-1 space-y-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
            {Object.entries(cals).map(([key, c]) => (
              <li key={key}>
                <strong>{key}</strong> · {c.mode} @ {c.thresh} · colour{" "}
                {c.colour?.quiet ?? "—"}/{c.colour?.typical ?? "—"} · brightness{" "}
                {c.luma?.quiet ?? "—"}/{c.luma?.typical ?? "—"} · penalty{" "}
                {c.colourPenalty?.toFixed(1) ?? "—"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {summary ? (
        <div className="rounded-lg border border-border bg-secondary/50 p-3 text-[12.5px] leading-relaxed">
          <p>
            <strong>{summary.bothFound}</strong> found by both · median{" "}
            <strong>{summary.medianMs.toFixed(1)}ms</strong> · within one frame{" "}
            <strong>
              {summary.within1Frame}/{summary.bothFound}
            </strong>{" "}
            · within 100ms{" "}
            <strong>
              {summary.within100}/{summary.bothFound}
            </strong>{" "}
            · worst {summary.worst.toFixed(0)}ms
          </p>
          <p className="text-muted-foreground">
            {summary.weMissed} the offline run found and this missed · {summary.weFoundExtra} this
            found and the offline run missed
          </p>
          {stats ? <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-faint">{stats}</pre> : null}
        </div>
      ) : null}

      {rows ? (
        <table className="w-full border-collapse text-[11.5px] tabular-nums">
          <thead>
            <tr>
              <th className="table-col-header text-left">Target</th>
              <th className="table-col-header text-right">Offline</th>
              <th className="table-col-header text-right">Browser</th>
              <th className="table-col-header text-right">Δ</th>
              <th className="table-col-header text-left">How</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="py-0.5">{r.id}</td>
                <td className="py-0.5 text-right">{r.expected?.toFixed(3) ?? "—"}</td>
                <td className="py-0.5 text-right">{r.got?.toFixed(3) ?? "—"}</td>
                <td
                  className={
                    r.deltaMs == null
                      ? "py-0.5 text-right text-faint"
                      : Math.abs(r.deltaMs) <= 33
                        ? "py-0.5 text-right text-gain"
                        : Math.abs(r.deltaMs) <= 100
                          ? "py-0.5 text-right"
                          : "py-0.5 text-right text-loss"
                  }
                >
                  {r.deltaMs == null ? "—" : `${r.deltaMs.toFixed(0)}ms`}
                </td>
                <td className="py-0.5 text-muted-foreground">
                  {r.source}
                  {r.moved ? " · chained" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
