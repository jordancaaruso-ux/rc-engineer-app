import type { MotIdCorrection, VideoAnalysisResultV1, VideoAnalysisTrackV1 } from "./types";

/** Apply MOT id corrections to a copy of track list. */
export function applyMotIdCorrections(
  tracks: VideoAnalysisTrackV1[],
  corrections: MotIdCorrection[] | null | undefined
): VideoAnalysisTrackV1[] {
  if (!corrections?.length) return tracks;
  const merged = new Map<number, VideoAnalysisTrackV1>();

  for (const tr of tracks) {
    let laps = [...tr.laps];
    let motId = tr.motTrackId;
    for (const c of corrections) {
      const inRange = (lap: { startSec: number; endSec: number }) =>
        lap.endSec >= c.startSec && lap.startSec <= c.endSec;
      if (c.fromId === motId) {
        const affected = laps.filter(inRange);
        if (affected.length > 0) {
          laps = laps.filter((l) => !inRange(l));
          const existing = merged.get(c.toId);
          if (existing) {
            merged.set(c.toId, {
              ...existing,
              laps: [...existing.laps, ...affected],
              lapCount: existing.lapCount + affected.length,
              bestLapSec: Math.min(
                existing.bestLapSec,
                ...affected.map((l) => l.lapTimeSec),
                existing.bestLapSec
              ),
            });
          } else {
            merged.set(c.toId, {
              ...tr,
              motTrackId: c.toId,
              laps: affected,
              lapCount: affected.length,
              bestLapSec: Math.min(...affected.map((l) => l.lapTimeSec)),
            });
          }
          motId = c.toId;
        }
      }
    }
    const cur = merged.get(motId);
    if (cur) {
      merged.set(motId, {
        ...cur,
        laps: [...cur.laps, ...laps],
        lapCount: cur.laps.length + laps.length,
        bestLapSec: Math.min(
          cur.bestLapSec,
          ...laps.map((l) => l.lapTimeSec),
          cur.bestLapSec
        ),
      });
    } else {
      merged.set(motId, { ...tr, laps });
    }
  }

  return [...merged.values()].filter((t) => t.laps.length > 0);
}

export type SectorFastestRow = {
  sectorId: string;
  sectorLabel: string;
  fastestMotTrackId: number;
  fastestSec: number;
  byTrack: Array<{ motTrackId: number; bestSec: number | null; rank: number }>;
};

export function computeSectorMatrix(
  result: VideoAnalysisResultV1,
  corrections?: MotIdCorrection[] | null
): SectorFastestRow[] {
  const tracks = applyMotIdCorrections(result.tracks, corrections);
  const lineDefs = result.sectorLines ?? [];
  const sectorIds = lineDefs.map((l) => l.id).filter((id) => id !== "sf");

  return sectorIds.map((sectorId) => {
    const label = lineDefs.find((l) => l.id === sectorId)?.label ?? sectorId;
    const byTrack: Array<{ motTrackId: number; bestSec: number | null }> = tracks.map((tr) => {
      let best: number | null = null;
      for (const lap of tr.laps) {
        const s = lap.sectorTimesSec[sectorId];
        if (s != null && (best == null || s < best)) best = s;
      }
      return { motTrackId: tr.motTrackId, bestSec: best };
    });
    const ranked = [...byTrack]
      .filter((r) => r.bestSec != null)
      .sort((a, b) => (a.bestSec ?? 0) - (b.bestSec ?? 0));
    const rankMap = new Map(ranked.map((r, i) => [r.motTrackId, i + 1]));
    const fastest = ranked[0];
    return {
      sectorId,
      sectorLabel: label,
      fastestMotTrackId: fastest?.motTrackId ?? -1,
      fastestSec: fastest?.bestSec ?? 0,
      byTrack: byTrack.map((r) => ({
        ...r,
        rank: rankMap.get(r.motTrackId) ?? 0,
      })),
    };
  });
}
