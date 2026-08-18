"use client";

/**
 * The run's Video section (VIDEO_ANALYSIS_REWORK Phase A): analysis status row +
 * "Analyze video" entry, and the corner-by-corner lap compare (VIDEO_TRACE Phase 1,
 * UI interview-locked 2026-07-10) — ranked gain/loss cards + lap-in-order strip,
 * best-vs-2nd-best default, deterministic template hero sentence, tap a sector →
 * ghosted clip of both laps, car-vs-car via the same picker.
 *
 * Compare data comes from either engine: worker results (resultJson) or manual
 * marks (manualJson via compareCarsFromManualSession) — one surface, two engines.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/panel";
import { Collapse } from "@/components/ui/Collapse";
import { chipToggleClass } from "@/components/ui/chipToggle";
import { formatLap } from "@/lib/runLaps";
import type { MotIdCorrection, VideoAnalysisResultV1 } from "@/lib/videoAnalysis/types";
import type { ManualVideoSessionV2 } from "@/lib/manualVideoAnalysis/types";
import {
  collectCompareCars,
  compareLaps,
  defaultLapPair,
  formatSignedDeltaSec,
  EVEN_SEGMENT_THRESHOLD_SEC,
  type CompareCar,
  type CompareLap,
  type SectorSegment,
} from "@/lib/videoAnalysis/lapCompare";
import { compareCarsFromManualSession } from "@/lib/videoAnalysis/manualCompareAdapter";
import { SectorClipPlayer } from "@/components/videoAnalysis/SectorClipPlayer";

const GAIN_TEXT = "text-gain";
const GAIN_BG = "bg-gain";
const LOSS_TEXT = "text-destructive";
const LOSS_BG = "bg-destructive";

type JobSummary = {
  id: string;
  status: string;
  profileName: string;
  analysisMode: string;
};

type PanelData = {
  cars: CompareCar[];
  lineDefs: Array<{ id: string; label: string }>;
  videoUrl: string | null;
  source: "worker" | "manual";
  transponder: { comparedLaps: number; medianDeltaSec: number | null } | null;
};

type LapRef = { carId: number; lapIndex: number };

function findLap(cars: CompareCar[], ref: LapRef | null): CompareLap | null {
  if (!ref) return null;
  const car = cars.find((c) => c.carId === ref.carId);
  return car?.laps.find((l) => l.lapIndex === ref.lapIndex) ?? null;
}

/** "BEST" / "2ND" / "" — this lap's time rank within its own car. */
function lapRankTag(cars: CompareCar[], lap: CompareLap): string {
  const car = cars.find((c) => c.carId === lap.carId);
  if (!car) return "";
  const rank = [...car.laps]
    .sort((x, y) => x.lapTimeSec - y.lapTimeSec)
    .findIndex((l) => l.lapIndex === lap.lapIndex);
  return rank === 0 ? "BEST" : rank === 1 ? "2ND" : "";
}

function deltaTextClass(deltaSec: number): string {
  if (deltaSec <= -EVEN_SEGMENT_THRESHOLD_SEC) return GAIN_TEXT;
  if (deltaSec >= EVEN_SEGMENT_THRESHOLD_SEC) return LOSS_TEXT;
  return "text-muted-foreground";
}

export function LapComparePanel({
  runId,
  trackId,
  allowMutations = true,
}: {
  runId: string;
  trackId?: string | null;
  /** False for a teammate's run — no analyze CTA, section hidden without data. */
  allowMutations?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [job, setJob] = useState<JobSummary | null>(null);
  const [data, setData] = useState<PanelData | null>(null);
  const [aRef, setARef] = useState<LapRef | null>(null);
  const [bRef, setBRef] = useState<LapRef | null>(null);
  const [sortMode, setSortMode] = useState<"rank" | "track">("rank");
  const [openSeg, setOpenSeg] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSlot, setPickerSlot] = useState<"a" | "b">("b");
  const [pickerCarId, setPickerCarId] = useState<number | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setJob(null);
    setData(null);
    setARef(null);
    setBRef(null);
    void (async () => {
      try {
        const listRes = await fetch(
          `/api/video-analysis/jobs?runId=${encodeURIComponent(runId)}`
        );
        if (!listRes.ok) return;
        const list = (await listRes.json()) as {
          jobs?: Array<{
            id: string;
            status: string;
            hasResult: boolean;
            hasManual?: boolean;
            analysisMode?: string;
            profile?: { name?: string };
          }>;
        };
        const jobs = list.jobs ?? [];
        const row =
          jobs.find((j) => j.hasResult) ?? jobs.find((j) => j.hasManual) ?? jobs[0];
        if (!alive) return;
        if (!row) return;
        setJob({
          id: row.id,
          status: row.status,
          profileName: row.profile?.name ?? "Video analysis",
          analysisMode: row.analysisMode ?? "worker",
        });
        if (!row.hasResult && !row.hasManual) return;

        const detailRes = await fetch(`/api/video-analysis/jobs/${row.id}`);
        if (!detailRes.ok) return;
        const detail = (await detailRes.json()) as {
          job?: { videoAssetId?: string | null; idCorrectionsJson?: unknown };
          result?: VideoAnalysisResultV1 | null;
          manual?: { session?: ManualVideoSessionV2 } | null;
          transponderCompare?: {
            comparedLaps: number;
            medianDeltaSec: number | null;
          } | null;
          sectorLines?: Array<{ lineKey: string; label: string; sortOrder: number }>;
        };
        if (!alive) return;

        const profileLines = detail.sectorLines ?? [];
        let cars: CompareCar[] = [];
        let lineDefs: Array<{ id: string; label: string }> = [];
        let source: "worker" | "manual" = "worker";

        if (detail.result) {
          const corrections =
            (detail.job?.idCorrectionsJson as MotIdCorrection[] | null) ?? null;
          cars = collectCompareCars(detail.result, corrections);
          lineDefs = detail.result.sectorLines?.length
            ? detail.result.sectorLines.map((l) => ({ id: l.id, label: l.label }))
            : profileLines.map((l) => ({ id: l.lineKey, label: l.label }));
        } else if (detail.manual?.session) {
          source = "manual";
          cars = compareCarsFromManualSession(detail.manual.session, profileLines);
          lineDefs = profileLines.map((l) => ({ id: l.lineKey, label: l.label }));
        }
        if (cars.length === 0) return;

        // Default: the primary car's best vs 2nd-best; if it only has one lap,
        // fall back to its best vs the next car's best.
        const primary = cars[0]!;
        let a: CompareLap | null = null;
        let b: CompareLap | null = null;
        const pair = defaultLapPair(primary);
        if (pair) {
          a = pair.a;
          b = pair.b;
        } else if (cars.length > 1) {
          a = [...primary.laps].sort((x, y) => x.lapTimeSec - y.lapTimeSec)[0] ?? null;
          const rivalBest = [...cars[1]!.laps].sort((x, y) => x.lapTimeSec - y.lapTimeSec)[0];
          b = rivalBest ?? null;
        }
        if (!a || !b) return;

        setData({
          cars,
          lineDefs,
          source,
          videoUrl: detail.job?.videoAssetId
            ? `/api/videos/${encodeURIComponent(detail.job.videoAssetId)}/file`
            : null,
          transponder: detail.transponderCompare ?? null,
        });
        setARef({ carId: a.carId, lapIndex: a.lapIndex });
        setBRef({ carId: b.carId, lapIndex: b.lapIndex });
        setPickerCarId(a.carId);
      } catch {
        // Section falls back to the entry states on fetch failure.
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [runId]);

  const lapA = data ? findLap(data.cars, aRef) : null;
  const lapB = data ? findLap(data.cars, bRef) : null;

  const report = useMemo(() => {
    if (!lapA || !lapB || !data) return null;
    return compareLaps(lapA, lapB, data.lineDefs);
  }, [lapA, lapB, data]);

  // Avoid a flash of the CTA before the fetch resolves.
  if (!loaded) return null;

  const hasCompare = Boolean(data && report && lapA && lapB);

  // Teammate runs: their jobs are invisible to us (user-scoped API) — show
  // nothing rather than an analyze prompt for someone else's run.
  if (!hasCompare && !allowMutations) return null;

  const analyzeHref = trackId
    ? `/videos/analysis/manual/new?trackId=${encodeURIComponent(trackId)}&runId=${encodeURIComponent(runId)}`
    : null;

  const statusRow = (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-secondary/50 px-3 py-2.5">
      {job && hasCompare ? (
        <>
          <span className="min-w-0 truncate text-[12px] font-semibold tracking-tight">
            {job.profileName}
          </span>
          <span className="rounded-md border border-gain/25 bg-gain/10 px-1.5 py-0.5 micro-caps text-gain">
            Analyzed
          </span>
          <Link
            href={`/videos/analysis/jobs/${encodeURIComponent(job.id)}`}
            className="ml-auto shrink-0 text-[11px] font-bold text-primary-ink no-underline hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            Open session
          </Link>
        </>
      ) : job ? (
        <>
          <span className="min-w-0 truncate text-[12px] font-semibold tracking-tight">
            {job.profileName}
          </span>
          <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 micro-caps text-muted-foreground">
            {job.analysisMode === "manual" ? "Sync in progress" : job.status}
          </span>
          <Link
            href={`/videos/analysis/jobs/${encodeURIComponent(job.id)}`}
            className="ml-auto shrink-0 text-[11px] font-bold text-primary-ink no-underline hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            Continue
          </Link>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 text-[12px] text-muted-foreground">
            {analyzeHref
              ? "No video analysis on this run yet."
              : "Set a track on this run to analyze video."}
          </span>
          {analyzeHref ? (
            <Link
              href={analyzeHref}
              className="shrink-0 rounded-lg primary-face bg-primary px-3 py-1.5 text-[11.5px] font-bold text-primary-foreground no-underline transition-colors hover:bg-[#E6BE00]"
              onClick={(e) => e.stopPropagation()}
            >
              Analyze video
            </Link>
          ) : null}
        </>
      )}
    </div>
  );

  if (!hasCompare) {
    return (
      <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
        <Eyebrow>Video</Eyebrow>
        {statusRow}
      </div>
    );
  }

  const d = data!;
  const rep = report!;
  const la = lapA!;
  const lb = lapB!;

  const crossCar = la.carId !== lb.carId;
  const sorted =
    sortMode === "rank"
      ? [...rep.segments].sort((x, y) => Math.abs(y.deltaSec) - Math.abs(x.deltaSec))
      : rep.segments;
  const totalASec = rep.segments.reduce((s, x) => s + x.aSec, 0);
  const pickerCar = d.cars.find((c) => c.carId === pickerCarId) ?? d.cars[0]!;

  function jumpToSegment(seg: SectorSegment) {
    setOpenSeg(d.videoUrl ? seg.key : null);
    cardRefs.current[seg.key]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function pickLap(lap: CompareLap) {
    const ref = { carId: lap.carId, lapIndex: lap.lapIndex };
    if (pickerSlot === "a") setARef(ref);
    else setBRef(ref);
    setOpenSeg(null);
    setPickerOpen(false);
  }

  const lapChip = (lap: CompareLap, slot: "a" | "b") => {
    const tag = lapRankTag(d.cars, lap);
    return (
      <button
        type="button"
        onClick={() => {
          setPickerSlot(slot);
          setPickerCarId(lap.carId);
          setPickerOpen((v) => !v || pickerSlot !== slot);
        }}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-lg border border-border bg-secondary px-2.5 py-2 text-left transition-colors hover:border-foreground/30"
      >
        <span className="truncate micro-caps text-faint">
          {crossCar ? `${lap.carLabel} · ` : ""}L{lap.lapIndex}
          {tag ? <span className={cn("ml-1", tag === "BEST" && GAIN_TEXT)}>{tag}</span> : null}
        </span>
        <span className="fig-stat text-foreground">
          {formatLap(lap.lapTimeSec)}
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      <Eyebrow>Video</Eyebrow>
      {statusRow}

      {/* Hero: total delta + template read */}
      <div className="space-y-2.5 rounded-lg border border-border bg-secondary/60 p-3">
        <div className="flex items-end justify-between gap-3">
          <div
            className={cn(
              "text-3xl font-medium leading-none tabular-nums",
              deltaTextClass(rep.totalDeltaSec)
            )}
          >
            {formatSignedDeltaSec(rep.totalDeltaSec)}
            <span className="ml-1 text-sm text-muted-foreground">s</span>
          </div>
          <p className="max-w-[55%] text-right text-xs leading-relaxed text-muted-foreground">
            {rep.summary}
          </p>
        </div>

        <div className="flex items-stretch gap-2">
          {lapChip(la, "a")}
          <span className="self-center tabular-nums text-[10px] text-faint">VS</span>
          {lapChip(lb, "b")}
        </div>

        {/* Lap picker */}
        <Collapse open={pickerOpen}>
          <div className="space-y-2 border-t border-border pt-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="micro-caps text-faint">
                Set lap {pickerSlot === "a" ? "A" : "B"} from
              </span>
              {d.cars.map((car) => (
                <button
                  key={car.carId}
                  type="button"
                  onClick={() => setPickerCarId(car.carId)}
                  className={cn(
                    chipToggleClass(car.carId === pickerCar.carId),
                    "px-2 py-0.5 text-[10.5px]"
                  )}
                >
                  {car.carLabel}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[...pickerCar.laps]
                .sort((x, y) => x.lapTimeSec - y.lapTimeSec)
                .map((lap) => {
                  const active =
                    (pickerSlot === "a" ? aRef : bRef)?.carId === lap.carId &&
                    (pickerSlot === "a" ? aRef : bRef)?.lapIndex === lap.lapIndex;
                  return (
                    <button
                      key={lap.lapIndex}
                      type="button"
                      onClick={() => pickLap(lap)}
                      className={cn(chipToggleClass(active),"px-2 py-1 text-[11px] tabular-nums")}
                    >
                      L{lap.lapIndex} · {formatLap(lap.lapTimeSec)}
                    </button>
                  );
                })}
            </div>
            {pickerCar.carId !== d.cars[0]!.carId ? (
              <p className="text-[10.5px] leading-relaxed text-muted-foreground">
                Same video, same camera — car-to-car sector deltas are as trustworthy as
                your own lap-to-lap numbers.
              </p>
            ) : null}
          </div>
        </Collapse>
      </div>

      {/* Lap-in-order strip */}
      {rep.segments.length > 1 ? (
        <div className="space-y-1">
          <div className="flex h-6 gap-0.5 overflow-hidden rounded-md">
            {rep.segments.map((seg) => {
              const k = deltaTextClass(seg.deltaSec);
              const alpha = 0.14 + 0.5 * seg.share;
              const bg =
                k === GAIN_TEXT
                  ? `rgba(79,208,137,${alpha.toFixed(2)})`
                  : k === LOSS_TEXT
                    ? `rgba(229,100,78,${alpha.toFixed(2)})`
                    : undefined;
              return (
                <button
                  key={seg.key}
                  type="button"
                  onClick={() => jumpToSegment(seg)}
                  title={`${seg.name}: ${formatSignedDeltaSec(seg.deltaSec)}s`}
                  className="flex min-w-0 items-center justify-center bg-secondary transition-[filter] hover:brightness-125"
                  style={{ flexGrow: Math.max(seg.aSec, 0.1), flexBasis: 0, ...(bg ? { background: bg } : {}) }}
                >
                  <span className="truncate px-0.5 tabular-nums text-[9px] text-foreground/80">
                    {seg.name}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex justify-between tabular-nums text-[8.5px] tracking-[0.12em] text-faint">
            <span>START</span>
            <span>{totalASec.toFixed(1)}s LAP</span>
            <span>FINISH</span>
          </div>
        </div>
      ) : null}

      {/* Ranked cards */}
      <div className="flex items-center justify-between pt-0.5">
        <span className="type-data-label">Where it happened</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setSortMode("rank")}
            className={cn(chipToggleClass(sortMode === "rank"), "px-2 py-0.5 text-[10px]")}
          >
            Biggest first
          </button>
          <button
            type="button"
            onClick={() => setSortMode("track")}
            className={cn(chipToggleClass(sortMode === "track"), "px-2 py-0.5 text-[10px]")}
          >
            Track order
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        {sorted.map((seg) => {
          const even = Math.abs(seg.deltaSec) < EVEN_SEGMENT_THRESHOLD_SEC;
          const gained = seg.deltaSec <= -EVEN_SEGMENT_THRESHOLD_SEC;
          const routeCaption = `${seg.fromLabel} → ${seg.toLabel}`;
          if (even) {
            return (
              <div
                key={seg.key}
                ref={(el) => {
                  cardRefs.current[seg.key] = el;
                }}
                className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2 opacity-70"
              >
                <span className="text-[12.5px] font-medium text-muted-foreground">
                  {seg.name} — even
                </span>
                <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                  {formatSignedDeltaSec(seg.deltaSec)}
                </span>
              </div>
            );
          }
          const open = openSeg === seg.key;
          return (
            <div
              key={seg.key}
              ref={(el) => {
                cardRefs.current[seg.key] = el;
              }}
              className="rounded-lg border border-border bg-secondary/50 transition-colors hover:border-foreground/20"
            >
              <button
                type="button"
                onClick={() => setOpenSeg(open ? null : d.videoUrl ? seg.key : null)}
                className="block w-full p-3 text-left"
                aria-expanded={open}
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-semibold tracking-tight text-foreground">
                    {seg.name}
                  </span>
                  <span className="truncate tabular-nums text-[9px] tracking-[0.08em] text-faint">
                    {routeCaption}
                  </span>
                  <span
                    className={cn(
                      "ml-auto text-[15px] font-medium tabular-nums",
                      deltaTextClass(seg.deltaSec)
                    )}
                  >
                    {formatSignedDeltaSec(seg.deltaSec)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded-md border px-1.5 py-0.5 micro-caps",
                      gained
                        ? "border-gain/25 bg-gain/10 text-gain"
                        : "border-destructive/25 bg-destructive/10 text-destructive"
                    )}
                  >
                    {gained ? "Gained" : "Lost"} {Math.abs(seg.deltaSec).toFixed(2)}s
                  </span>
                  {d.videoUrl ? (
                    <span className="ml-auto inline-flex items-center gap-1 text-[10.5px] font-bold text-primary-ink">
                      <Play className="h-2.5 w-2.5" aria-hidden />
                      Watch both laps
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn("h-full rounded-full", gained ? GAIN_BG : LOSS_BG)}
                    style={{ width: `${Math.max(4, Math.round(seg.share * 100))}%` }}
                  />
                </div>
              </button>
              {d.videoUrl ? (
                <Collapse open={open}>
                  <div className="border-t border-border p-3">
                    {open ? (
                      <SectorClipPlayer
                        videoUrl={d.videoUrl}
                        aWindow={seg.aWindow}
                        bWindow={seg.bWindow}
                        aLabel={`${crossCar ? `${la.carLabel} ` : ""}L${la.lapIndex}`}
                        bLabel={`${crossCar ? `${lb.carLabel} ` : ""}L${lb.lapIndex}`}
                      />
                    ) : null}
                  </div>
                </Collapse>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="text-center micro-caps leading-relaxed text-faint">
        {d.source === "manual"
          ? "Sector timing from your video marks · lap times from transponder"
          : d.transponder &&
              d.transponder.comparedLaps > 0 &&
              d.transponder.medianDeltaSec != null
            ? `Sector timing from video · median Δ vs transponder ${d.transponder.medianDeltaSec.toFixed(2)}s over ${d.transponder.comparedLaps} laps`
            : "Sector timing from video crossings"}
      </p>
    </div>
  );
}
