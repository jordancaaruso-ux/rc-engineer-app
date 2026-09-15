import "server-only";

import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/webPush/server";
import { todayBoundsInTimeZone } from "@/lib/eventActive";
import { confirmRunHref } from "@/lib/runs/confirmRunHref";
import type { FileSessionOutcome } from "@/lib/sweep/fileSession";
import { formatBestLap } from "@/lib/sweep/formatLap";

export function runFiledPushText(input: {
  positions: number[];
  bestLapSeconds: number | null;
}): { title: string; body: string } {
  const sorted = [...new Set(input.positions)].sort((a, b) => a - b);
  const title =
    sorted.length <= 1
      ? `Run ${sorted[0] ?? 1} is in`
      : sorted.length === 2 && sorted[1] === sorted[0]! + 1
        ? `Runs ${sorted[0]}–${sorted[1]} are in`
        : `Runs ${sorted[0]}–${sorted[sorted.length - 1]} are in`;
  const best = formatBestLap(input.bestLapSeconds);
  return { title, body: best ? `Best ${best}` : "Laps are on the run" };
}

/**
 * Push #1 of two: the moment a session lands on a run at an armed track. Several sessions filed
 * in one tick coalesce into one push. Never sent for the evening pass — that has its own summary.
 */
export async function notifyRunsFiled(params: {
  userId: string;
  track: { id: string; timeZone: string };
  outcomes: FileSessionOutcome[];
}): Promise<void> {
  const filed = params.outcomes.filter(
    (o): o is Extract<FileSessionOutcome, { kind: "attached" | "placeholder" }> =>
      o.kind === "attached" || o.kind === "placeholder",
  );
  if (filed.length === 0) return;

  const positions: number[] = [];
  let best: number | null = null;
  let latest = filed[0]!;
  for (const o of filed) {
    const day = todayBoundsInTimeZone(params.track.timeZone, o.instant);
    const n = await prisma.run.count({
      where: {
        userId: params.userId,
        trackId: params.track.id,
        sortAt: { gte: day.start, lte: o.instant },
      },
    });
    positions.push(Math.max(1, n));
    if (o.bestLapSeconds != null && (best == null || o.bestLapSeconds < best)) best = o.bestLapSeconds;
    if (o.instant > latest.instant) latest = o;
  }
  const text = runFiledPushText({ positions, bestLapSeconds: best });
  const url = latest.kind === "attached" ? `/runs/${latest.runId}/edit` : confirmRunHref(latest.runId);
  await sendPushToUser(params.userId, { ...text, url, tag: "jrc-run-filed" });
}
