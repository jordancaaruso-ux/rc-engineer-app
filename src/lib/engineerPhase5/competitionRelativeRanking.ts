import "server-only";

import { getIncludedLaps, importedSetToLapRows } from "@/lib/lapAnalysis";
import type { ImportedSessionFieldStatsV1, ImportedSessionDriverLapInputsV1 } from "@/lib/lapImport/computeImportedSessionFieldStats";
import {
  computeImportedSessionFieldStatsFromDrivers,
  computeImportedSessionFieldStatsFromPayload,
} from "@/lib/lapImport/computeImportedSessionFieldStats";
import {
  buildImportedSessionFieldStatsEngineerCompact,
  importedSessionFieldStatsV1FromJson,
  primaryNormsFromImportedLapSets,
} from "@/lib/lapImport/importedTimingFieldStatsForEngineer";
import { prisma } from "@/lib/prisma";
import type { SearchRunsForEngineerResultRow } from "@/lib/engineerPhase5/engineerRunSearchTools";
import { normalizeLiveRcDriverNameForMatch } from "@/lib/lapWatch/liveRcNameNormalize";

export const COMPETITION_RELATIVE_RANKING_VERSION = 1 as const;

export type CompetitionRelativeRunRowV1 = {
  runId: string;
  whenLabel: string;
  trackName: string;
  sessionSummary: string;
  eligible: boolean;
  /** When ineligible — e.g. no multi-driver timing, or couldn't match primary driver for gaps. */
  ineligibleReason: string | null;
  /** Entrants with lap data after aggregation (timing session or ≥2 imported lap rows). */
  competitorDriverCount: number | null;
  /** Gap vs session-best best lap (**positive ⇒ you slower than**). */
  gapBestToSessionBestSeconds: number | null;
  /** Gap vs fastest avg-top‑5 among competitors. */
  gapAvgTop5ToSessionBestAvg5Seconds: number | null;
  /** Gap vs fastest avg-top‑10 among competitors. */
  gapAvgTop10ToSessionBestAvg10Seconds: number | null;
};

export type CompetitionRelativeRankingV1 = {
  version: typeof COMPETITION_RELATIVE_RANKING_VERSION;
  generatedAtIso: string;
  /**
   * How to interpret rows: positive gaps ⇒ slower than session-best competitor;
   * `bestRelativeRunIds` lists runs tied for closest overall (best lap then avg‑5 then avg‑10 lexicographically).
   */
  note: string;
  rows: CompetitionRelativeRunRowV1[];
  /** Run IDs tied for strongest relative pace (null if none eligible). */
  bestRelativeRunIds: string[];
};

const defaultNote =
  "competition-relative summary for runs in scope. **Positive gaps ⇒ you were slower than the session-best competitor** for best lap / avg top 5 / avg top 10. “Best relative pace” prefers **smallest** gap on best lap, then avg top 5, then avg top 10. Only rows with **eligible:true** counted for bestRelativeRunIds.";

function derivedStatsFromImportedSessionRow(row: {
  id: string;
  fieldStatsJson: unknown;
  parsedPayload: unknown;
}): ImportedSessionFieldStatsV1 | null {
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
  return stats != null && stats.driverCount >= 2 ? stats : null;
}

function driverInputsFromPersistedImportedSets(
  sets: ReadonlyArray<{
    id: string;
    driverName: string;
    displayName: string | null;
    laps: Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded: boolean }>;
  }>
): ImportedSessionDriverLapInputsV1[] | null {
  const out: ImportedSessionDriverLapInputsV1[] = [];
  for (const s of sets) {
    const rows = importedSetToLapRows(
      s.laps.map((l) => ({
        lapNumber: l.lapNumber,
        lapTimeSeconds: l.lapTimeSeconds,
        isIncluded: l.isIncluded,
      }))
    );
    const nums = getIncludedLaps(rows)
      .map((x) => x.lapTimeSeconds)
      .filter((t) => typeof t === "number" && Number.isFinite(t));
    if (nums.length === 0) continue;
    const label = (s.displayName?.trim() || s.driverName || "").trim() || "Driver";
    out.push({
      driverId: s.id,
      driverName: label,
      normalizedName: normalizeLiveRcDriverNameForMatch(label) || label.toLowerCase(),
      laps: nums,
    });
  }
  return out.length >= 2 ? out : null;
}

function sortTriple(
  row: CompetitionRelativeRunRowV1
): [number, number, number] {
  if (!row.eligible)
    return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  return [
    row.gapBestToSessionBestSeconds ?? Number.POSITIVE_INFINITY,
    row.gapAvgTop5ToSessionBestAvg5Seconds ?? Number.POSITIVE_INFINITY,
    row.gapAvgTop10ToSessionBestAvg10Seconds ?? Number.POSITIVE_INFINITY,
  ];
}

function cmpTriple(a: CompetitionRelativeRunRowV1, b: CompetitionRelativeRunRowV1): number {
  const [a1, a2, a3] = sortTriple(a);
  const [b1, b2, b3] = sortTriple(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  if (a3 !== b3) return a3 - b3;
  return 0;
}

/**
 * Batch hydrate competition gaps for Engineer **resolvedRunScope**: linked timing sessions
 * and/or multi-driver `RunImportedLapSet` rows.
 */
export async function buildCompetitionRelativeRankingForRunScope(opts: {
  userId: string;
  chronologicalRuns: SearchRunsForEngineerResultRow[];
  /** Caller label (shown to model alongside rows). */
  scopeLabel?: string | null;
}): Promise<CompetitionRelativeRankingV1 | null> {
  const chrono = opts.chronologicalRuns;
  if (!chrono.length) return null;

  const ids = [...new Set(chrono.map((r) => r.runId))];
  const dbRuns = await prisma.run.findMany({
    where: { userId: opts.userId, id: { in: ids } },
    select: {
      id: true,
      importedLapTimeSessionId: true,
      importedLapSets: {
        select: {
          id: true,
          driverName: true,
          displayName: true,
          isPrimaryUser: true,
          laps: {
            select: {
              lapNumber: true,
              lapTimeSeconds: true,
              isIncluded: true,
            },
            orderBy: { lapNumber: "asc" as const },
          },
        },
      },
    },
  });
  const byId = new Map(dbRuns.map((r) => [r.id, r]));

  const sessionIds = [...new Set(dbRuns.map((r) => r.importedLapTimeSessionId).filter(Boolean))] as string[];
  const sessMap = new Map<string, ImportedSessionFieldStatsV1 | null>();
  if (sessionIds.length > 0) {
    const sessions = await prisma.importedLapTimeSession.findMany({
      where: { userId: opts.userId, id: { in: sessionIds } },
      select: { id: true, fieldStatsJson: true, parsedPayload: true },
    });
    for (const s of sessions) {
      sessMap.set(s.id, derivedStatsFromImportedSessionRow(s));
    }
  }

  const rows: CompetitionRelativeRunRowV1[] = [];

  for (const sr of chrono) {
    const run = byId.get(sr.runId);
    const norms = primaryNormsFromImportedLapSets(run?.importedLapSets ?? []);

    let stats: ImportedSessionFieldStatsV1 | null = null;
    if (run?.importedLapTimeSessionId?.trim()) {
      stats = sessMap.get(run.importedLapTimeSessionId.trim()) ?? null;
    }
    if (!stats && run?.importedLapSets?.length) {
      const inputs = driverInputsFromPersistedImportedSets(run.importedLapSets);
      stats = inputs ? computeImportedSessionFieldStatsFromDrivers(inputs) : null;
    }

    if (!run) {
      rows.push({
        runId: sr.runId,
        whenLabel: sr.whenLabel,
        trackName: sr.trackName,
        sessionSummary: sr.sessionSummary,
        eligible: false,
        ineligibleReason: "Run not found for this account.",
        competitorDriverCount: null,
        gapBestToSessionBestSeconds: null,
        gapAvgTop5ToSessionBestAvg5Seconds: null,
        gapAvgTop10ToSessionBestAvg10Seconds: null,
      });
      continue;
    }

    if (!stats || stats.driverCount < 2) {
      rows.push({
        runId: sr.runId,
        whenLabel: sr.whenLabel,
        trackName: sr.trackName,
        sessionSummary: sr.sessionSummary,
        eligible: false,
        ineligibleReason:
          "Need multi-driver lap timing — link a timing URL session on this run and/or persist ≥2 competitor imported lap drivers from the log.",
        competitorDriverCount: stats?.driverCount ?? null,
        gapBestToSessionBestSeconds: null,
        gapAvgTop5ToSessionBestAvg5Seconds: null,
        gapAvgTop10ToSessionBestAvg10Seconds: null,
      });
      continue;
    }

    const compact = buildImportedSessionFieldStatsEngineerCompact(stats, norms);
    const you = compact.matchedYou;
    const hasAnyGap =
      you != null &&
      ((you.gapBestToSessionBestSeconds != null && Number.isFinite(you.gapBestToSessionBestSeconds)) ||
        (you.gapAvgTop5ToSessionBestAvg5Seconds != null &&
          Number.isFinite(you.gapAvgTop5ToSessionBestAvg5Seconds)) ||
        (you.gapAvgTop10ToSessionBestAvg10Seconds != null &&
          Number.isFinite(you.gapAvgTop10ToSessionBestAvg10Seconds)));

    let ineligibleReason: string | null = null;
    if (!you) {
      ineligibleReason =
        "Multi-driver lap data exists but your row was not matched — mark your laps as primary when importing competitors or ensure LiveRC/driver naming aligns.";
    } else if (!hasAnyGap) {
      ineligibleReason = "Insufficient laps to derive best vs session best or averages.";
    }

    const eligible = compact.driverCount >= 2 && hasAnyGap && you != null;

    rows.push({
      runId: sr.runId,
      whenLabel: sr.whenLabel,
      trackName: sr.trackName,
      sessionSummary: sr.sessionSummary,
      eligible,
      ineligibleReason,
      competitorDriverCount: compact.driverCount,
      gapBestToSessionBestSeconds: you?.gapBestToSessionBestSeconds ?? null,
      gapAvgTop5ToSessionBestAvg5Seconds: you?.gapAvgTop5ToSessionBestAvg5Seconds ?? null,
      gapAvgTop10ToSessionBestAvg10Seconds: you?.gapAvgTop10ToSessionBestAvg10Seconds ?? null,
    });
  }

  const eligibleSorted = [...rows.filter((r) => r.eligible)].sort(cmpTriple);
  const tieKey = eligibleSorted.length > 0 ? sortTriple(eligibleSorted[0]!) : null;
  const tieIds =
    tieKey &&
    !(tieKey[0] === Number.POSITIVE_INFINITY && tieKey[1] === Number.POSITIVE_INFINITY)
      ? eligibleSorted.filter((r) => {
          const [b1, b2, b3] = tieKey;
          const [r1, r2, r3] = sortTriple(r);
          return r1 === b1 && r2 === b2 && r3 === b3;
        }).map((r) => r.runId)
      : [];

  const labelExtra = opts.scopeLabel?.trim() ? ` Scope: "${opts.scopeLabel.trim()}".` : "";
  return {
    version: COMPETITION_RELATIVE_RANKING_VERSION,
    generatedAtIso: new Date().toISOString(),
    note: `${defaultNote}${labelExtra}`,
    rows,
    bestRelativeRunIds: tieIds.length > 0 ? tieIds : [],
  };
}
