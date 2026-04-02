import { LAP_SESSION_VERSION, type LapSessionV1, type LapSourceKind } from "./types";
import { computeLapMetrics } from "./metrics";
import type { LapSessionContext } from "./types";
import { getIncludedLaps, lapRowsFromTimesAndFlags } from "@/lib/lapAnalysis";

export function buildLapSessionV1(params: {
  laps: number[];
  sourceKind: LapSourceKind;
  sourceDetail?: string | null;
  parserId?: string | null;
  context?: LapSessionContext;
  perLap?: Array<{
    isOutlierWarning?: boolean;
    warningReason?: string | null;
    isFlagged?: boolean;
    flagReason?: string | null;
    isIncluded?: boolean;
  } | null> | null;
}): LapSessionV1 {
  const laps = params.laps.filter((n) => typeof n === "number" && Number.isFinite(n));
  let perLap = params.perLap;
  if (perLap && perLap.length !== laps.length) {
    perLap = null;
  }
  const rows = lapRowsFromTimesAndFlags(laps, perLap);
  const includedTimes = getIncludedLaps(rows).map((r) => r.lapTimeSeconds);
  const metrics = computeLapMetrics(includedTimes);
  return {
    version: LAP_SESSION_VERSION,
    source: {
      kind: params.sourceKind,
      detail: params.sourceDetail ?? null,
      parserId: params.parserId ?? null,
    },
    entries: [
      {
        role: "primary",
        laps: [...laps],
        metrics,
        perLap: perLap ?? undefined,
      },
    ],
    metrics,
    context: params.context ?? {},
  };
}

/** Safe parse for API: ignore invalid shapes, return null. */
export function tryParseLapSessionV1(raw: unknown): LapSessionV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return null;
  if (!o.source || typeof o.source !== "object") return null;
  const src = o.source as Record<string, unknown>;
  const kind = src.kind;
  if (kind !== "manual" && kind !== "screenshot" && kind !== "url" && kind !== "csv") return null;
  if (!Array.isArray(o.entries)) return null;
  return raw as LapSessionV1;
}
