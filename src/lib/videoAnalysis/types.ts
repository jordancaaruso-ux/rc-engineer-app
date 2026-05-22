/** Video analysis worker JSON contract (version 1). */

export const VIDEO_ANALYSIS_RESULT_VERSION = 1 as const;

export type VideoAnalysisSectorLineDef = {
  id: string;
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type VideoAnalysisLapV1 = {
  lapIndex: number;
  lapTimeSec: number;
  startSec: number;
  endSec: number;
  sectorTimesSec: Record<string, number>;
};

export type VideoAnalysisTrackV1 = {
  motTrackId: number;
  lapCount: number;
  bestLapSec: number;
  laps: VideoAnalysisLapV1[];
  crossingCount?: number;
  /** After manual id correction mapping */
  displayLabel?: string;
};

export type VideoAnalysisIdSwapHint = {
  lineId: string;
  timeSec: number;
  trackIds: number[];
};

export type VideoAnalysisAlignment = {
  ok?: boolean;
  error?: string | null;
  inlier_ratio?: number;
  reprojection_error_px?: number | null;
  homography?: number[][] | null;
};

export type VideoAnalysisResultV1 = {
  version: typeof VIDEO_ANALYSIS_RESULT_VERSION;
  videoPath?: string;
  fps?: number;
  frameSize?: { width: number; height: number };
  framesProcessed?: number;
  alignment?: VideoAnalysisAlignment | null;
  homography?: number[][] | null;
  sectorLines?: VideoAnalysisSectorLineDef[];
  tracks: VideoAnalysisTrackV1[];
  idSwapHints?: VideoAnalysisIdSwapHint[];
  detector?: string;
};

export type MotIdCorrection = {
  fromId: number;
  toId: number;
  startSec: number;
  endSec: number;
};

export function parseVideoAnalysisResultV1(raw: unknown): VideoAnalysisResultV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== VIDEO_ANALYSIS_RESULT_VERSION) return null;
  if (!Array.isArray(o.tracks)) return null;
  return o as unknown as VideoAnalysisResultV1;
}
