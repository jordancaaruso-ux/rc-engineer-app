import "server-only";

import { prisma } from "@/lib/prisma";
import {
  IMPORTED_SESSION_FIELD_STATS_VERSION,
  computeImportedSessionFieldStatsFromPayload,
  medianSorted,
  type ImportedSessionFieldDriverStatV1,
  type ImportedSessionFieldStatsV1,
} from "@/lib/lapImport/computeImportedSessionFieldStats";
import type {
  ImportedSessionFieldStatsEngineerCompactV1,
  PaceVsFieldMetricId,
  PaceVsFieldMetricSnapshotV1,
} from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import { normalizeLiveRcDriverNameForMatch } from "@/lib/lapWatch/liveRcNameNormalize";

function meanFromDrivers(
  drivers: ImportedSessionFieldDriverStatV1[],
  pick: (d: ImportedSessionFieldDriverStatV1) => number | null | undefined
): number | null {
  const xs = drivers.map(pick).filter((v): v is number => v != null && Number.isFinite(v));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Backfills `avgTop15Seconds` and field means when reading older `fieldStatsJson` rows.
 */
export function normalizeImportedSessionFieldStatsV1(stats: ImportedSessionFieldStatsV1): ImportedSessionFieldStatsV1 {
  const drivers = stats.drivers.map((d) => ({
    ...d,
    avgTop15Seconds: d.avgTop15Seconds ?? null,
  }));
  const f = stats.field;
  const avg10SortedAsc = drivers
    .map((x) => x.avgTop10Seconds)
    .filter((v): v is number => v != null && Number.isFinite(v))
    .sort((a, b) => a - b);
  return {
    ...stats,
    drivers,
    field: {
      medianBestSeconds: f.medianBestSeconds ?? null,
      medianAvgTop5Seconds: f.medianAvgTop5Seconds ?? null,
      medianAvgTop10Seconds: f.medianAvgTop10Seconds ?? medianSorted(avg10SortedAsc),
      minBestSeconds: f.minBestSeconds ?? null,
      meanBestSeconds: f.meanBestSeconds ?? meanFromDrivers(drivers, (x) => x.bestLapSeconds),
      meanAvgTop5Seconds: f.meanAvgTop5Seconds ?? meanFromDrivers(drivers, (x) => x.avgTop5Seconds),
      meanAvgTop10Seconds: f.meanAvgTop10Seconds ?? meanFromDrivers(drivers, (x) => x.avgTop10Seconds),
      meanAvgTop15Seconds: f.meanAvgTop15Seconds ?? meanFromDrivers(drivers, (x) => x.avgTop15Seconds),
    },
  };
}

export function importedSessionFieldStatsV1FromJson(raw: unknown): ImportedSessionFieldStatsV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as ImportedSessionFieldStatsV1;
  if (o.version !== IMPORTED_SESSION_FIELD_STATS_VERSION) return null;
  if (typeof o.driverCount !== "number" || !Array.isArray(o.drivers)) return null;
  if (!o.field || typeof o.field !== "object") return null;
  return normalizeImportedSessionFieldStatsV1(o);
}

function minFinite(values: Array<number | null | undefined>): number | null {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (xs.length === 0) return null;
  return Math.min(...xs);
}

function rankLowerIsBetter(
  drivers: ImportedSessionFieldDriverStatV1[],
  matchedId: string,
  valueOf: (d: ImportedSessionFieldDriverStatV1) => number | null | undefined
): { rank: number | null; entrantCount: number } {
  const finite = drivers
    .map((d) => ({ id: d.driverId, v: valueOf(d) }))
    .filter((x): x is { id: string; v: number } => x.v != null && Number.isFinite(x.v));
  const entrantCount = finite.length;
  if (entrantCount < 2) return { rank: null, entrantCount };
  const mine = finite.find((x) => x.id === matchedId);
  if (!mine) return { rank: null, entrantCount };
  const faster = finite.filter((x) => x.v < mine.v - 1e-9).length;
  return { rank: faster + 1, entrantCount };
}

function buildPaceVsFieldMeanAnalysis(
  stats: ImportedSessionFieldStatsV1,
  matched: ImportedSessionFieldDriverStatV1
): PaceVsFieldMetricSnapshotV1[] | null {
  if (stats.driverCount < 2) return null;

  const f = stats.field;
  const drivers = stats.drivers;

  const rows: Array<{
    metric: PaceVsFieldMetricId;
    label: string;
    minLapsForUser: number;
    fieldMean: number | null;
    userVal: number | null;
    userValueOf: (d: ImportedSessionFieldDriverStatV1) => number | null | undefined;
  }> = [
    {
      metric: "best",
      label: "Best lap",
      minLapsForUser: 1,
      fieldMean: f.meanBestSeconds ?? null,
      userVal: matched.bestLapSeconds,
      userValueOf: (d) => d.bestLapSeconds,
    },
    {
      metric: "avg_top_5",
      label: "Avg top 5",
      minLapsForUser: 5,
      fieldMean: f.meanAvgTop5Seconds ?? null,
      userVal: matched.avgTop5Seconds,
      userValueOf: (d) => d.avgTop5Seconds,
    },
    {
      metric: "avg_top_10",
      label: "Avg top 10",
      minLapsForUser: 10,
      fieldMean: f.meanAvgTop10Seconds ?? null,
      userVal: matched.avgTop10Seconds,
      userValueOf: (d) => d.avgTop10Seconds,
    },
    {
      metric: "avg_top_15",
      label: "Avg top 15",
      minLapsForUser: 15,
      fieldMean: f.meanAvgTop15Seconds ?? null,
      userVal: matched.avgTop15Seconds,
      userValueOf: (d) => d.avgTop15Seconds,
    },
  ];

  const out: PaceVsFieldMetricSnapshotV1[] = [];
  for (const row of rows) {
    const userSeconds =
      row.userVal != null && Number.isFinite(row.userVal) ? row.userVal : null;
    const fieldMean =
      row.fieldMean != null && Number.isFinite(row.fieldMean) ? row.fieldMean : null;
    const { rank, entrantCount } = rankLowerIsBetter(drivers, matched.driverId, row.userValueOf);
    const gapUserMinusFieldMeanSeconds =
      userSeconds != null && fieldMean != null ? userSeconds - fieldMean : null;
    const meaningful =
      stats.driverCount >= 2 &&
      matched.lapCount >= row.minLapsForUser &&
      userSeconds != null &&
      fieldMean != null &&
      entrantCount >= 2;

    out.push({
      metric: row.metric,
      label: row.label,
      fieldMeanSeconds: fieldMean,
      userSeconds,
      gapUserMinusFieldMeanSeconds,
      rankInField: rank,
      fieldEntrantCountForMetric: entrantCount,
      meaningful,
    });
  }
  return out;
}

/** Append to lap-set fingerprint so summaries invalidate when linked session aggregates change. */
export function importedTimingFieldFingerprintToken(
  importedLapTimeSessionId: string | null,
  stats: ImportedSessionFieldStatsV1 | null
): string {
  if (!importedLapTimeSessionId?.trim() || !stats) return "";
  return `${importedLapTimeSessionId.trim()}:${stats.computedAtIso}`;
}

export function combinedEngineerFieldFingerprint(lapSetsFingerprint: string, sessionToken: string): string {
  if (!sessionToken) return lapSetsFingerprint;
  if (!lapSetsFingerprint) return `sess:${sessionToken}`;
  return `${lapSetsFingerprint}|sess:${sessionToken}`;
}

/**
 * Narrow stats for prompts: session "bests", field medians, matched driver gaps vs session-best,
 * and per-metric pace vs **session field mean** (arithmetic mean across entrants).
 */
export function buildImportedSessionFieldStatsEngineerCompact(
  statsInput: ImportedSessionFieldStatsV1,
  primaryNormalizedNames: readonly string[]
): ImportedSessionFieldStatsEngineerCompactV1 {
  const stats = normalizeImportedSessionFieldStatsV1(statsInput);

  const sessionBestBest = stats.field.minBestSeconds;
  const sessionBestAvg5 = minFinite(stats.drivers.map((d) => d.avgTop5Seconds));
  const sessionBestAvg10 = minFinite(stats.drivers.map((d) => d.avgTop10Seconds));

  const normPrimary = primaryNormalizedNames.filter(Boolean);
  let matched: ImportedSessionFieldDriverStatV1 | null = null;

  if (normPrimary.length > 0) {
    for (const d of stats.drivers) {
      const n = normalizeLiveRcDriverNameForMatch(d.driverName);
      if (normPrimary.some((p) => p === n || p === d.normalizedName)) {
        matched = d;
        break;
      }
    }
  }
  if (!matched && stats.drivers.length === 1) matched = stats.drivers[0] ?? null;

  let matchedYou: ImportedSessionFieldStatsEngineerCompactV1["matchedYou"] = null;
  if (matched) {
    const gapBest =
      matched.bestLapSeconds != null && sessionBestBest != null
        ? matched.bestLapSeconds - sessionBestBest
        : null;
    const gap5 =
      matched.avgTop5Seconds != null && sessionBestAvg5 != null
        ? matched.avgTop5Seconds - sessionBestAvg5
        : null;
    const gap10 =
      matched.avgTop10Seconds != null && sessionBestAvg10 != null
        ? matched.avgTop10Seconds - sessionBestAvg10
        : null;
    matchedYou = {
      label: matched.driverName,
      rankByBest: matched.rankByBest,
      bestLapSeconds: matched.bestLapSeconds,
      avgTop5Seconds: matched.avgTop5Seconds,
      avgTop10Seconds: matched.avgTop10Seconds,
      gapBestToSessionBestSeconds: gapBest,
      gapAvgTop5ToSessionBestAvg5Seconds: gap5,
      gapAvgTop10ToSessionBestAvg10Seconds: gap10,
    };
  }

  const paceVsFieldMeanAnalysis =
    matched && stats.driverCount >= 2 ? buildPaceVsFieldMeanAnalysis(stats, matched) : null;

  return {
    version: 1,
    driverCount: stats.driverCount,
    sessionBestBestLapSeconds: sessionBestBest,
    sessionBestAvgTop5Seconds: sessionBestAvg5,
    sessionBestAvgTop10Seconds: sessionBestAvg10,
    fieldMedianBestSeconds: stats.field.medianBestSeconds,
    fieldMedianAvgTop5Seconds: stats.field.medianAvgTop5Seconds,
    fieldMedianAvgTop10Seconds: stats.field.medianAvgTop10Seconds ?? null,
    paceVsFieldMeanAnalysis,
    matchedYou,
  };
}

export function primaryNormsFromImportedLapSets(
  sets: ReadonlyArray<{ driverName: string; isPrimaryUser: boolean }>
): string[] {
  const out: string[] = [];
  for (const s of sets) {
    if (!s.isPrimaryUser) continue;
    const n = normalizeLiveRcDriverNameForMatch(s.driverName);
    if (n) out.push(n);
  }
  return out;
}

/**
 * Load `fieldStatsJson` for the linked timing session (or compute from `parsedPayload` and persist).
 */
export async function resolveImportedTimingFieldStatsForEngineer(opts: {
  userId: string;
  importedLapTimeSessionId: string | null;
  importedLapSetsForMatch: ReadonlyArray<{ driverName: string; isPrimaryUser: boolean }>;
}): Promise<{
  compact: ImportedSessionFieldStatsEngineerCompactV1 | null;
  fingerprintToken: string;
}> {
  const sid = opts.importedLapTimeSessionId?.trim();
  if (!sid) return { compact: null, fingerprintToken: "" };

  const row = await prisma.importedLapTimeSession.findFirst({
    where: { id: sid, userId: opts.userId },
    select: { id: true, fieldStatsJson: true, parsedPayload: true },
  });
  if (!row) return { compact: null, fingerprintToken: "" };

  let stats = importedSessionFieldStatsV1FromJson(row.fieldStatsJson);
  if (!stats && row.parsedPayload != null) {
    stats = computeImportedSessionFieldStatsFromPayload(row.parsedPayload);
    if (stats) {
      stats = normalizeImportedSessionFieldStatsV1(stats);
      void prisma.importedLapTimeSession
        .update({
          where: { id: row.id },
          data: { fieldStatsJson: stats as object },
        })
        .catch(() => {});
    }
  }
  if (!stats) return { compact: null, fingerprintToken: "" };

  const norms = primaryNormsFromImportedLapSets(opts.importedLapSetsForMatch);
  const compact = buildImportedSessionFieldStatsEngineerCompact(stats, norms);
  return {
    compact,
    fingerprintToken: importedTimingFieldFingerprintToken(row.id, stats),
  };
}
