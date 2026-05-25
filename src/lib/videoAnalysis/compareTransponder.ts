import type { VideoAnalysisResultV1 } from "./types";

export type TransponderLapRow = { lapNumber: number; lapTimeSec: number };

export type LapCompareReport = {
  comparedLaps: number;
  medianDeltaSec: number | null;
  pctWithin0_15s: number;
  deltasSec: number[];
  videoLapTimesSec: number[];
  transponderLapTimesSec: number[];
};

export function compareVideoToTransponder(
  result: VideoAnalysisResultV1,
  transponderLaps: TransponderLapRow[],
  motTrackId?: number
): LapCompareReport | null {
  const tracks = result.tracks;
  if (!tracks.length) return null;
  const target =
    motTrackId != null
      ? tracks.find((t) => t.motTrackId === motTrackId)
      : [...tracks].sort((a, b) => b.lapCount - a.lapCount)[0];
  if (!target) return null;

  const videoByLap = new Map<number, number>();
  for (const lap of target.laps) {
    const key = lap.lapIndex;
    if (!videoByLap.has(key)) videoByLap.set(key, lap.lapTimeSec);
  }
  const refByLap = new Map<number, number>();
  for (const lap of transponderLaps) {
    if (!refByLap.has(lap.lapNumber)) refByLap.set(lap.lapNumber, lap.lapTimeSec);
  }

  const sharedLaps = [...videoByLap.keys()]
    .filter((n) => refByLap.has(n))
    .sort((a, b) => a - b);

  const deltas = sharedLaps.map((n) =>
    Math.abs(videoByLap.get(n)! - refByLap.get(n)!)
  );
  const videoTimes = sharedLaps.map((n) => videoByLap.get(n)!);
  const refTimes = sharedLaps.map((n) => refByLap.get(n)!);

  const n = deltas.length;
  const sorted = [...deltas].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null;
  const within015 = deltas.filter((d) => d <= 0.15).length;

  return {
    comparedLaps: n,
    medianDeltaSec: median,
    pctWithin0_15s: n ? within015 / n : 0,
    deltasSec: deltas.map((d) => Math.round(d * 1000) / 1000),
    videoLapTimesSec: videoTimes,
    transponderLapTimesSec: refTimes,
  };
}
