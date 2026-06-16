import "server-only";

import { prisma } from "@/lib/prisma";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import {
  getAverageTopN,
  getIncludedLaps,
  primaryLapRowsFromRun,
} from "@/lib/lapAnalysis";
import { formatLocalCalendarDate } from "@/lib/engineerPhase5/localCalendarInTimeZone";
import {
  matchTracksForEngineerQuery,
  type MatchedTrack,
} from "@/lib/engineerPhase5/matchTrackForEngineer";
import {
  extractLapHistoryPriorFromMessages,
  parseLapHistoryDateWindow,
  parseLapHistoryQueryIntent,
} from "@/lib/engineerPhase5/lapHistoryQueryParse";
import type { LapHistoryDateWindow } from "@/lib/engineerPhase5/parseLapHistoryWindow";

export { parseLapHistoryQueryIntent } from "@/lib/engineerPhase5/lapHistoryQueryParse";

const TRACK_SCORE_CLUSTER_GAP = 8;
const LAP_TIME_PROBE_TOLERANCE_SEC = 0.06;

type ScopedRun = {
  id: string;
  createdAt: Date;
  sessionCompletedAt: Date | null;
  loggingCompletedAt: Date | null;
  sessionType: string;
  meetingSessionType: string | null;
  meetingSessionCode: string | null;
  sessionLabel: string | null;
  lapTimes: unknown;
  lapSession: unknown;
  car: { name: string } | null;
  carNameSnapshot: string | null;
  track: { name: string } | null;
  tireSet: {
    label: string | null;
    tireType: { displayName: string; modelCode: string } | null;
  } | null;
};

type RankedLap = {
  lap: number;
  lapNumber: number;
  run: ScopedRun;
};

function formatLapSeconds(seconds: number): string {
  return `${seconds.toFixed(3)}s`;
}

function runInDateWindow(
  run: { createdAt: Date; sessionCompletedAt: Date | null; loggingCompletedAt: Date | null },
  window: LapHistoryDateWindow | null,
  timeZone: string
): boolean {
  if (!window) return true;
  const inst = resolveRunDisplayInstant(run);
  const ymd = formatLocalCalendarDate(inst, timeZone);
  return ymd >= window.dateFrom && ymd <= window.dateTo;
}

function runMatchesTireLabel(
  run: {
    tireSet: {
      label: string | null;
      tireType: { displayName: string; modelCode: string } | null;
    } | null;
  },
  tireLabelContains: string | null
): boolean {
  if (!tireLabelContains) return true;
  const needle = tireLabelContains.trim().toLowerCase();
  if (!needle) return true;
  const parts = [
    run.tireSet?.tireType?.displayName,
    run.tireSet?.tireType?.modelCode,
    run.tireSet?.label,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return parts.includes(needle);
}

function collectRankedLaps(runs: ScopedRun[]): RankedLap[] {
  const all: RankedLap[] = [];
  for (const run of runs) {
    for (const row of getIncludedLaps(primaryLapRowsFromRun(run))) {
      all.push({ lap: row.lapTimeSeconds, lapNumber: row.lapNumber, run });
    }
  }
  all.sort((a, b) => a.lap - b.lap || a.lapNumber - b.lapNumber);
  return all;
}

/** Nth fastest distinct lap time (1 = best). */
function distinctRankedLap(entries: RankedLap[], rank: number): RankedLap | null {
  if (rank < 1 || entries.length === 0) return null;
  const seenMs = new Set<number>();
  for (const entry of entries) {
    const key = Math.round(entry.lap * 1000);
    if (seenMs.has(key)) continue;
    seenMs.add(key);
    if (seenMs.size === rank) return entry;
  }
  return null;
}

function formatRankedLapLine(
  label: string,
  entry: RankedLap,
  timeZone: string
): string {
  const when = formatRunCreatedAtDateTime(resolveRunDisplayInstant(entry.run), timeZone);
  const session = formatRunSessionDisplay(entry.run);
  const car = entry.run.car?.name ?? entry.run.carNameSnapshot ?? "Car";
  return `- **${label}:** ${formatLapSeconds(entry.lap)} (lap ${entry.lapNumber}) — ${when}, ${session}, ${car} ([view run](/runs/${entry.run.id}/edit))`;
}

/**
 * When several tracks tie on score and share the same display name (e.g. duplicate TFTR rows),
 * search all of them instead of asking the user to pick.
 */
function resolveTrackCluster(
  matches: MatchedTrack[],
  trackQuery: string
): { ok: true; trackIds: string[]; displayName: string } | { ok: false; reply: string } {
  if (matches.length === 0) {
    return {
      ok: false,
      reply: `I couldn't find a track matching "${trackQuery}" in your log. Check the track name in Tracks, or try the LiveRC slug (e.g. tftr).`,
    };
  }

  const topScore = matches[0]!.score;
  const cluster = matches.filter((m) => topScore - m.score < TRACK_SCORE_CLUSTER_GAP);
  if (cluster.length === 1) {
    return { ok: true, trackIds: [cluster[0]!.id], displayName: cluster[0]!.name };
  }

  const uniqueNames = [...new Set(cluster.map((m) => m.name.trim().toLowerCase()))];
  if (uniqueNames.length > 1) {
    const names = cluster.slice(0, 4).map((m) => m.name).join(", ");
    return {
      ok: false,
      reply: `Several tracks could match "${trackQuery}": ${names}. Which one did you mean?`,
    };
  }

  return { ok: true, trackIds: cluster.map((m) => m.id), displayName: cluster[0]!.name };
}

export type LapHistoryAnswer =
  | { ok: true; reply: string; trackName: string; runCount: number }
  | { ok: false; reply: string };

/**
 * Answer lap-at-track history questions from the database (no LLM).
 */
export async function tryAnswerLapHistoryQuery(input: {
  userId: string;
  message: string;
  messages?: Array<{ role: string; content: string }>;
  timeZone: string;
}): Promise<LapHistoryAnswer | null> {
  const prior =
    input.messages && input.messages.length > 1
      ? extractLapHistoryPriorFromMessages(input.messages.slice(0, -1))
      : null;
  const intent = parseLapHistoryQueryIntent(input.message, prior);
  if (!intent) return null;

  const tz = input.timeZone.trim() || "UTC";
  const dateWindow =
    intent.dateWindow ?? parseLapHistoryDateWindow(input.message, tz) ?? prior?.dateWindow ?? null;

  const matches = await matchTracksForEngineerQuery(input.userId, intent.trackQuery);
  const resolved = resolveTrackCluster(matches, intent.trackQuery);
  if (!resolved.ok) return resolved;

  const { trackIds, displayName } = resolved;

  const runs = await prisma.run.findMany({
    where: { userId: input.userId, trackId: { in: trackIds } },
    orderBy: { createdAt: "desc" },
    take: 600,
    select: {
      id: true,
      createdAt: true,
      sessionCompletedAt: true,
      loggingCompletedAt: true,
      sessionType: true,
      meetingSessionType: true,
      meetingSessionCode: true,
      sessionLabel: true,
      lapTimes: true,
      lapSession: true,
      car: { select: { name: true } },
      carNameSnapshot: true,
      track: { select: { name: true } },
      tireSet: {
        select: {
          label: true,
          tireType: { select: { displayName: true, modelCode: true } },
        },
      },
    },
  });

  const inWindow = runs.filter((r) => runInDateWindow(r, dateWindow, tz));
  const scoped = inWindow.filter((r) => runMatchesTireLabel(r, intent.tireLabelContains));

  if (scoped.length === 0) {
    const when = dateWindow?.label ?? "that period";
    const tireNote = intent.tireLabelContains
      ? ` with tire set label matching **${intent.tireLabelContains}**`
      : "";
    return {
      ok: false,
      reply: `No logged runs at **${displayName}**${tireNote} in ${when}.`,
    };
  }

  const whenLabel = dateWindow?.label ?? "your log";
  const tireScope = intent.tireLabelContains
    ? `tire **${intent.tireLabelContains}** · `
    : "";
  const lines: string[] = [
    `At **${displayName}** (${tireScope}${whenLabel}, ${scoped.length} run${scoped.length === 1 ? "" : "s"}, excluded laps omitted):`,
  ];

  const rankedLaps = collectRankedLaps(scoped);

  if (intent.lapTimeProbe != null) {
    const probe = intent.lapTimeProbe;
    const hits = rankedLaps.filter((e) => Math.abs(e.lap - probe) <= LAP_TIME_PROBE_TOLERANCE_SEC);
    if (hits.length === 0) {
      const closest = distinctRankedLap(rankedLaps, 1);
      const second = distinctRankedLap(rankedLaps, 2);
      const hint =
        closest && second
          ? ` Your fastest laps there are **${formatLapSeconds(closest.lap)}** and **${formatLapSeconds(second.lap)}**.`
          : closest
            ? ` Your best there is **${formatLapSeconds(closest.lap)}**.`
            : "";
      return {
        ok: false,
        reply: `I don't see a **${probe.toFixed(1)}s** lap at **${displayName}** in ${whenLabel} (within ${(LAP_TIME_PROBE_TOLERANCE_SEC * 1000).toFixed(0)} ms).${hint}`,
      };
    }
    const seen = new Set<string>();
    for (const hit of hits.slice(0, 5)) {
      const key = `${hit.run.id}:${hit.lapNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(
        formatRankedLapLine(`**${hit.lap.toFixed(3)}s** lap`, hit, tz)
      );
    }
    return { ok: true, reply: lines.join("\n"), trackName: displayName, runCount: scoped.length };
  }

  if (intent.wantsBestLap) {
    const entry = distinctRankedLap(rankedLaps, intent.lapRank);
    if (entry) {
      const rankLabel =
        intent.lapRank === 1
          ? "Best lap"
          : intent.lapRank === 2
            ? "Next best lap"
            : `${intent.lapRank}${intent.lapRank === 3 ? "rd" : "th"} best lap`;
      lines.push(formatRankedLapLine(rankLabel, entry, tz));
    } else {
      lines.push(
        `- **Rank #${intent.lapRank}:** not enough distinct lap times in this window (only ${new Set(rankedLaps.map((e) => Math.round(e.lap * 1000))).size} unique).`
      );
    }
  }

  if (intent.wantsAvgTop5) {
    let bestAvg5: number | null = null;
    let bestAvg5Run: ScopedRun | null = null;
    for (const run of scoped) {
      const rows = primaryLapRowsFromRun(run);
      const avg5 = getAverageTopN(rows, 5);
      if (avg5 != null && (bestAvg5 == null || avg5 < bestAvg5)) {
        bestAvg5 = avg5;
        bestAvg5Run = run;
      }
    }
    if (bestAvg5 != null && bestAvg5Run) {
      const when = formatRunCreatedAtDateTime(resolveRunDisplayInstant(bestAvg5Run), tz);
      const session = formatRunSessionDisplay(bestAvg5Run);
      const car = bestAvg5Run.car?.name ?? bestAvg5Run.carNameSnapshot ?? "Car";
      lines.push(
        `- **Best avg top 5:** ${formatLapSeconds(bestAvg5)} — ${when}, ${session}, ${car} ([view run](/runs/${bestAvg5Run.id}/edit))`
      );
    } else {
      lines.push("- **Best avg top 5:** need at least one included lap per run (5 laps for a meaningful avg).");
    }
  }

  return {
    ok: true,
    reply: lines.join("\n"),
    trackName: displayName,
    runCount: scoped.length,
  };
}
