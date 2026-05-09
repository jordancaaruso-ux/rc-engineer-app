import "server-only";

import { prisma } from "@/lib/prisma";
import {
  IMPORTED_SESSION_FIELD_STATS_VERSION,
  computeImportedSessionFieldStatsFromPayload,
  type ImportedSessionFieldStatsV1,
} from "@/lib/lapImport/computeImportedSessionFieldStats";
import type { ImportedSessionFieldStatsEngineerCompactV1 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import { normalizeLiveRcDriverNameForMatch } from "@/lib/lapWatch/liveRcNameNormalize";

export function importedSessionFieldStatsV1FromJson(raw: unknown): ImportedSessionFieldStatsV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as ImportedSessionFieldStatsV1;
  if (o.version !== IMPORTED_SESSION_FIELD_STATS_VERSION) return null;
  if (typeof o.driverCount !== "number" || !Array.isArray(o.drivers)) return null;
  return o as ImportedSessionFieldStatsV1;
}

function minFinite(values: Array<number | null | undefined>): number | null {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (xs.length === 0) return null;
  return Math.min(...xs);
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
 * Narrow stats for prompts: session "bests", field medians, and matched driver gaps
 * (**positive ⇒ slower than** session-best for that metric column).
 */
export function buildImportedSessionFieldStatsEngineerCompact(
  stats: ImportedSessionFieldStatsV1,
  primaryNormalizedNames: readonly string[]
): ImportedSessionFieldStatsEngineerCompactV1 {
  const sessionBestBest = stats.field.minBestSeconds;
  const sessionBestAvg5 = minFinite(stats.drivers.map((d) => d.avgTop5Seconds));
  const sessionBestAvg10 = minFinite(stats.drivers.map((d) => d.avgTop10Seconds));

  const normPrimary = primaryNormalizedNames.filter(Boolean);
  let matched: ImportedSessionFieldStatsV1["drivers"][number] | null = null;

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

  return {
    version: 1,
    driverCount: stats.driverCount,
    sessionBestBestLapSeconds: sessionBestBest,
    sessionBestAvgTop5Seconds: sessionBestAvg5,
    sessionBestAvgTop10Seconds: sessionBestAvg10,
    fieldMedianBestSeconds: stats.field.medianBestSeconds,
    fieldMedianAvgTop5Seconds: stats.field.medianAvgTop5Seconds,
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
