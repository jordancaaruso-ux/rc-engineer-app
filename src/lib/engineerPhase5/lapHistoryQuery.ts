import "server-only";

import { prisma } from "@/lib/prisma";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import {
  getAverageTopN,
  getBestLap,
  primaryLapRowsFromRun,
} from "@/lib/lapAnalysis";
import { formatLocalCalendarDate } from "@/lib/engineerPhase5/localCalendarInTimeZone";
import { matchTracksForEngineerQuery } from "@/lib/engineerPhase5/matchTrackForEngineer";
import {
  parseLapHistoryDateWindow,
  parseLapHistoryQueryIntent,
} from "@/lib/engineerPhase5/lapHistoryQueryParse";
import type { LapHistoryDateWindow } from "@/lib/engineerPhase5/parseLapHistoryWindow";

export { parseLapHistoryQueryIntent } from "@/lib/engineerPhase5/lapHistoryQueryParse";

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

export type LapHistoryAnswer =
  | { ok: true; reply: string; trackName: string; runCount: number }
  | { ok: false; reply: string };

/**
 * Answer lap-at-track history questions from the database (no LLM).
 */
export async function tryAnswerLapHistoryQuery(input: {
  userId: string;
  message: string;
  timeZone: string;
}): Promise<LapHistoryAnswer | null> {
  const intent = parseLapHistoryQueryIntent(input.message);
  if (!intent) return null;

  const tz = input.timeZone.trim() || "UTC";
  const dateWindow = intent.dateWindow ?? parseLapHistoryDateWindow(input.message, tz);

  const matches = await matchTracksForEngineerQuery(input.userId, intent.trackQuery);
  if (matches.length === 0) {
    return {
      ok: false,
      reply: `I couldn't find a track matching "${intent.trackQuery}" in your log. Check the track name in Tracks, or try the LiveRC slug (e.g. tftr).`,
    };
  }

  if (matches.length > 1 && matches[0]!.score - (matches[1]?.score ?? 0) < 8) {
    const names = matches.slice(0, 4).map((m) => m.name).join(", ");
    return {
      ok: false,
      reply: `Several tracks could match "${intent.trackQuery}": ${names}. Which one did you mean?`,
    };
  }

  const track = matches[0]!;

  const runs = await prisma.run.findMany({
    where: { userId: input.userId, trackId: track.id },
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
    },
  });

  const inWindow = runs.filter((r) => runInDateWindow(r, dateWindow, tz));
  if (inWindow.length === 0) {
    const when = dateWindow?.label ?? "that period";
    return {
      ok: false,
      reply: `No logged runs at **${track.name}** in ${when}.`,
    };
  }

  let bestLap: number | null = null;
  let bestRun: (typeof inWindow)[0] | null = null;
  let bestAvg5: number | null = null;
  let bestAvg5Run: (typeof inWindow)[0] | null = null;

  for (const run of inWindow) {
    const rows = primaryLapRowsFromRun(run);
    const lap = getBestLap(rows);
    if (lap != null && (bestLap == null || lap < bestLap)) {
      bestLap = lap;
      bestRun = run;
    }
    const avg5 = getAverageTopN(rows, 5);
    if (avg5 != null && (bestAvg5 == null || avg5 < bestAvg5)) {
      bestAvg5 = avg5;
      bestAvg5Run = run;
    }
  }

  const whenLabel = dateWindow?.label ?? "your log";
  const lines: string[] = [`At **${track.name}** (${whenLabel}, ${inWindow.length} run${inWindow.length === 1 ? "" : "s"}, excluded laps omitted):`];

  if (intent.wantsBestLap) {
    if (bestLap != null && bestRun) {
      const when = formatRunCreatedAtDateTime(
        resolveRunDisplayInstant(bestRun),
        tz
      );
      const session = formatRunSessionDisplay(bestRun);
      const car = bestRun.car?.name ?? bestRun.carNameSnapshot ?? "Car";
      lines.push(
        `- **Best lap:** ${formatLapSeconds(bestLap)} — ${when}, ${session}, ${car} ([view run](/runs/${bestRun.id}/edit))`
      );
    } else {
      lines.push("- **Best lap:** no included laps in this window.");
    }
  }

  if (intent.wantsAvgTop5) {
    if (bestAvg5 != null && bestAvg5Run) {
      const when = formatRunCreatedAtDateTime(
        resolveRunDisplayInstant(bestAvg5Run),
        tz
      );
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
    trackName: track.name,
    runCount: inWindow.length,
  };
}
