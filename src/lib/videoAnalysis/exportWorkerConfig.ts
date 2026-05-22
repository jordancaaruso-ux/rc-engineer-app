import type { TrackCameraProfile, TrackSectorLine } from "@prisma/client";

export type WorkerConfigExport = {
  fps: number;
  start_finish_line_id: string;
  reference_frame_path?: string;
  sector_lines: Array<{
    id: string;
    label: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }>;
};

export function buildWorkerConfig(
  lines: Pick<TrackSectorLine, "lineKey" | "label" | "x1" | "y1" | "x2" | "y2">[],
  opts?: { fps?: number; referenceFramePath?: string | null }
): WorkerConfigExport {
  const sf = lines.find((l) => l.lineKey === "sf") ?? lines[0];
  return {
    fps: opts?.fps ?? 60,
    start_finish_line_id: sf?.lineKey ?? "sf",
    reference_frame_path: opts?.referenceFramePath ?? undefined,
    sector_lines: lines.map((l) => ({
      id: l.lineKey,
      label: l.label,
      x1: l.x1,
      y1: l.y1,
      x2: l.x2,
      y2: l.y2,
    })),
  };
}
