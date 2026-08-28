/**
 * Corner-by-corner lap compare from video sector crossings (VIDEO_TRACE_NORTH_STAR Phase 1).
 *
 * Worker split semantics (video-analysis/rc_video_analysis/analyze.py): a lap's
 * `sectorTimesSec[lineId]` is the elapsed time from lap start to the first crossing
 * of that line — a cumulative split, NOT a sector duration. Segments are derived
 * from consecutive splits; absolute video times come from `lap.startSec + split`,
 * which is what sector clip playback seeks to.
 *
 * Built on worker results only for now; the manual flow's computeLapBreakdown
 * (src/lib/manualVideoAnalysis/sectors.ts) yields the same shape and can adapt in later.
 */

import type { MotIdCorrection, VideoAnalysisResultV1 } from "./types";
import { applyMotIdCorrections } from "./sectorStats";

export type CompareLap = {
  carId: number;
  carLabel: string;
  lapIndex: number;
  lapTimeSec: number;
  /** Absolute video time of the lap's start/finish crossing. */
  startSec: number;
  endSec: number;
  /** lineId -> elapsed sec from lap start (cumulative split). */
  splits: Record<string, number>;
};

export type CompareCar = {
  carId: number;
  carLabel: string;
  lapCount: number;
  bestLapSec: number;
  laps: CompareLap[];
};

export type SegmentWindow = { startSec: number; endSec: number };

export type SectorSegment = {
  key: string;
  /** "S1".. in track order. */
  name: string;
  fromLabel: string;
  toLabel: string;
  aSec: number;
  bSec: number;
  /** aSec - bSec; negative = lap A faster through this segment. */
  deltaSec: number;
  /** |deltaSec| / max|deltaSec| across segments — magnitude-bar scale. */
  share: number;
  /** Absolute video-time windows for sector clip playback. */
  aWindow: SegmentWindow;
  bWindow: SegmentWindow;
};

export type LapCompareReport = {
  a: CompareLap;
  b: CompareLap;
  /** a.lapTimeSec - b.lapTimeSec; segment deltas sum to this exactly. */
  totalDeltaSec: number;
  /** Track order. */
  segments: SectorSegment[];
  /** Deterministic template sentence describing where the delta came from. */
  summary: string;
};

/** Segments within ±this are presented as "even". */
export const EVEN_SEGMENT_THRESHOLD_SEC = 0.02;

const SF_LABEL = "Start/finish";

export function collectCompareCars(
  result: VideoAnalysisResultV1,
  corrections?: MotIdCorrection[] | null
): CompareCar[] {
  const tracks = applyMotIdCorrections(result.tracks, corrections);
  const cars = tracks.map((t) => {
    const carLabel = t.displayLabel?.trim() || `Car ${t.motTrackId}`;
    const laps = [...t.laps]
      .sort((x, y) => x.lapIndex - y.lapIndex)
      .map((l) => ({
        carId: t.motTrackId,
        carLabel,
        lapIndex: l.lapIndex,
        lapTimeSec: l.lapTimeSec,
        startSec: l.startSec,
        endSec: l.endSec,
        splits: l.sectorTimesSec ?? {},
      }));
    return {
      carId: t.motTrackId,
      carLabel,
      lapCount: laps.length,
      bestLapSec: Math.min(...laps.map((l) => l.lapTimeSec)),
      laps,
    };
  });
  // Most laps first — same "primary car" heuristic as compareVideoToTransponder.
  return cars.sort((x, y) => y.lapCount - x.lapCount || x.carId - y.carId);
}

/**
 * Best + 2nd-best lap of a car (the surface's default compare), or null if <2 laps.
 *
 * Among laps that have sector splits first: the surface exists to show WHERE a lap was won,
 * and a best lap with no crossings marked can only say "whole-lap delta only". Falls back to
 * time alone when fewer than two laps carry splits.
 */
export function defaultLapPair(car: CompareCar): { a: CompareLap; b: CompareLap } | null {
  if (car.laps.length < 2) return null;
  const byTime = (laps: CompareLap[]) => [...laps].sort((x, y) => x.lapTimeSec - y.lapTimeSec);
  const withSplits = byTime(car.laps.filter((l) => Object.keys(l.splits).length > 0));
  const pool = withSplits.length >= 2 ? withSplits : byTime(car.laps);
  return { a: pool[0]!, b: pool[1]! };
}

/**
 * Line ids usable for segmenting both laps: split present and inside the lap on
 * each side, ordered by lap A's splits, with lap B forced monotonic in that order
 * (a non-monotonic B split means a spurious/missed crossing — drop the line).
 */
function commonOrderedLines(a: CompareLap, b: CompareLap): string[] {
  const usable = Object.keys(a.splits).filter((id) => {
    const sa = a.splits[id];
    const sb = b.splits[id];
    return (
      typeof sa === "number" &&
      typeof sb === "number" &&
      sa > 0 &&
      sa < a.lapTimeSec &&
      sb > 0 &&
      sb < b.lapTimeSec
    );
  });
  usable.sort((x, y) => a.splits[x]! - a.splits[y]!);
  const kept: string[] = [];
  let lastB = 0;
  for (const id of usable) {
    const sb = b.splits[id]!;
    if (sb <= lastB) continue;
    kept.push(id);
    lastB = sb;
  }
  return kept;
}

export function compareLaps(
  a: CompareLap,
  b: CompareLap,
  lineDefs?: Array<{ id: string; label: string }> | null
): LapCompareReport {
  const labelById = new Map((lineDefs ?? []).map((l) => [l.id, l.label]));
  const lineLabel = (id: string) => labelById.get(id)?.trim() || id.toUpperCase();

  const lines = commonOrderedLines(a, b);
  const boundsA = [0, ...lines.map((id) => a.splits[id]!), a.lapTimeSec];
  const boundsB = [0, ...lines.map((id) => b.splits[id]!), b.lapTimeSec];

  const segments: SectorSegment[] = [];
  for (let i = 0; i < boundsA.length - 1; i++) {
    const aSec = boundsA[i + 1]! - boundsA[i]!;
    const bSec = boundsB[i + 1]! - boundsB[i]!;
    segments.push({
      key: `seg${i}`,
      name: lines.length === 0 ? "Full lap" : `S${i + 1}`,
      fromLabel: i === 0 ? SF_LABEL : lineLabel(lines[i - 1]!),
      toLabel: i === boundsA.length - 2 ? SF_LABEL : lineLabel(lines[i]!),
      aSec,
      bSec,
      deltaSec: aSec - bSec,
      share: 0,
      aWindow: { startSec: a.startSec + boundsA[i]!, endSec: a.startSec + boundsA[i + 1]! },
      bWindow: { startSec: b.startSec + boundsB[i]!, endSec: b.startSec + boundsB[i + 1]! },
    });
  }
  const maxAbs = Math.max(...segments.map((s) => Math.abs(s.deltaSec)), 1e-9);
  for (const s of segments) s.share = Math.abs(s.deltaSec) / maxAbs;

  return {
    a,
    b,
    totalDeltaSec: a.lapTimeSec - b.lapTimeSec,
    segments,
    summary: buildCompareSummary(segments, lines.length),
  };
}

/** Human anchor for a segment in prose ("S3" or the ending line's label). */
function segmentDisplayName(seg: SectorSegment): string {
  if (seg.toLabel !== SF_LABEL && seg.toLabel.toLowerCase() !== seg.name.toLowerCase()) {
    return seg.toLabel;
  }
  return seg.name;
}

/**
 * Deterministic template sentence — where the delta came from. Written from lap A's
 * perspective ("gained" = A faster). No LLM by design (interview-locked 2026-07-10).
 */
export function buildCompareSummary(segments: SectorSegment[], commonLineCount: number): string {
  if (commonLineCount === 0) {
    return "No shared sector crossings on these two laps — whole-lap delta only.";
  }
  const thr = EVEN_SEGMENT_THRESHOLD_SEC;
  const gains = segments.filter((s) => s.deltaSec <= -thr).sort((x, y) => x.deltaSec - y.deltaSec);
  const losses = segments.filter((s) => s.deltaSec >= thr).sort((x, y) => y.deltaSec - x.deltaSec);

  if (gains.length === 0 && losses.length === 0) {
    return "Dead even the whole way around — nothing between these two laps.";
  }

  const secs = (v: number) => `${Math.abs(v).toFixed(2)}s`;

  if (gains.length > 0 && losses.length > 0) {
    const gTotal = gains.reduce((sum, s) => sum + s.deltaSec, 0);
    const lTotal = losses.reduce((sum, s) => sum + s.deltaSec, 0);
    return `Gained ${secs(gTotal)} in ${segmentDisplayName(gains[0]!)}, gave ${secs(
      lTotal
    )} back in ${segmentDisplayName(losses[0]!)}.`;
  }

  const oneSided = gains.length > 0 ? gains : losses;
  const verb = gains.length > 0 ? "came" : "went";
  const total = oneSided.reduce((sum, s) => sum + Math.abs(s.deltaSec), 0);
  const top1 = Math.abs(oneSided[0]!.deltaSec);
  const top2 = oneSided.length > 1 ? top1 + Math.abs(oneSided[1]!.deltaSec) : top1;

  if (top1 >= 0.6 * total) {
    return `Almost all of it ${verb} in ${segmentDisplayName(oneSided[0]!)}.`;
  }
  if (oneSided.length > 1 && top2 >= 0.75 * total) {
    return `Almost all of it ${verb} in ${segmentDisplayName(oneSided[0]!)} and ${segmentDisplayName(
      oneSided[1]!
    )}.`;
  }
  return "Spread across the lap — no single corner decided it.";
}

/** "+0.123" / "−0.123" (typographic minus), for mono delta readouts. */
export function formatSignedDeltaSec(deltaSec: number, decimals = 3): string {
  const sign = deltaSec < 0 ? "−" : "+";
  return `${sign}${Math.abs(deltaSec).toFixed(decimals)}`;
}
