import { prisma } from "@/lib/prisma";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import {
  describeComparability,
  resolveGripTags,
  scoreComparability,
  type ComparableRun,
  type RunConditions,
} from "@/lib/engineer/comparableRunScore";

export type { ComparableRun };

/**
 * DORMANT SINCE 2026-08-05 — NOTHING CALLS THIS.
 *
 * It was wired into the reasoning spine, which the Engineer v0 teardown removed: the chat now
 * sends the model the knowledge base, a short prompt and the conversation, and no run data at
 * all. This module is kept, unwired and intact, because comparable runs are the intended next
 * rung — when per-car facts go back in, they go in as a plain block of facts rather than as
 * spine scaffolding. Verify it still matches the schema before trusting it again.
 *
 * Answers the founder's actual first question — *"was the car ever good in these
 * conditions and what was different since then"* — by finding the past runs on this car
 * whose conditions are closest to the one being discussed.
 *
 * This is ADDITIVE, not a replacement for `pickEngineerReferenceRun`. That picker is
 * chronological on purpose ("what did you change since last session") and three callers
 * legitimately want that question answered. What was missing is this one.
 *
 * WHY THIS REPLACES THE CONFIDENCE SCORE. `problemStatement.diagnosisConfidence` grades
 * certainty by counting reasons to doubt — tyre change, track change, too many keys moved.
 * A driver with no history trips none of them and scores "high", so the app was most
 * certain about the drivers it knew least. The honest input is not a grade but a fact:
 * here is the nearest thing on file and here is how near it is. The model calibrates off
 * that far better than a rule can.
 *
 * Rating is reported, never filtered on. If the closest run in these conditions was rated
 * 4, "it has never been good here either" is exactly what the Engineer should be able to
 * say — and a threshold would hide it.
 */

const MAX_CANDIDATES_SCANNED = 300;

function sortMs(run: { createdAt: Date; sessionCompletedAt: Date | null }): number {
  return resolveRunDisplayInstant({
    createdAt: run.createdAt,
    sessionCompletedAt: run.sessionCompletedAt,
  }).getTime();
}

/**
 * Best first. Closeness leads; a rated run beats an unrated one at equal closeness
 * because an unrated run cannot answer "was it good"; recency breaks the remaining ties.
 */
function compareCandidates(a: ComparableRun, b: ComparableRun): number {
  const byScore = b.comparability.score - a.comparability.score;
  if (byScore !== 0) return byScore;
  const aRated = a.carRating != null ? 1 : 0;
  const bRated = b.carRating != null ? 1 : 0;
  if (aRated !== bRated) return bRated - aRated;
  return Date.parse(b.whenIso) - Date.parse(a.whenIso);
}

/**
 * Takes only the anchor run id and reads that run's own conditions, so the pipeline does
 * not have to thread tyre and track tags through every builder that sits between it and
 * here. One extra query, and the call site stays a single line.
 */
export async function findComparableRunsForEngineer(
  userId: string,
  anchorRunId: string,
  opts?: { limit?: number }
): Promise<ComparableRun[]> {
  const current = await prisma.run.findFirst({
    where: { id: anchorRunId.trim(), userId },
    select: {
      id: true,
      carId: true,
      createdAt: true,
      sessionCompletedAt: true,
      tireTypeId: true,
      gripLevel: true,
      track: { select: { gripTags: true, layoutTags: true } },
    },
  });
  if (!current?.carId) return [];

  const limit = opts?.limit ?? 3;
  const tCurrent = sortMs(current);

  const peers = await prisma.run.findMany({
    where: {
      userId,
      carId: current.carId,
      id: { not: current.id },
    },
    select: {
      id: true,
      createdAt: true,
      sessionCompletedAt: true,
      carRating: true,
      tireTypeId: true,
      gripLevel: true,
      track: { select: { name: true, gripTags: true, layoutTags: true } },
    },
    take: MAX_CANDIDATES_SCANNED,
    orderBy: { createdAt: "desc" },
  });

  const currentConditions: RunConditions = {
    tireTypeId: current.tireTypeId,
    gripTags: resolveGripTags(current.gripLevel, current.track?.gripTags),
    layoutTags: current.track?.layoutTags ?? null,
  };

  const scored: ComparableRun[] = [];
  for (const peer of peers) {
    // Only the past can be a reference — a later run is not something he has learned from yet.
    if (sortMs(peer) >= tCurrent) continue;

    const comparability = scoreComparability(currentConditions, {
      tireTypeId: peer.tireTypeId,
      gripTags: resolveGripTags(peer.gripLevel, peer.track?.gripTags),
      layoutTags: peer.track?.layoutTags ?? null,
    });

    // Nothing in common on any recorded axis is not a comparison, it is a coincidence.
    if (comparability.score === 0) continue;

    scored.push({
      runId: peer.id,
      whenIso: resolveRunDisplayInstant({
        createdAt: peer.createdAt,
        sessionCompletedAt: peer.sessionCompletedAt,
      }).toISOString(),
      trackName: peer.track?.name ?? null,
      carRating: peer.carRating,
      comparability,
      howClose: describeComparability(comparability),
    });
  }

  scored.sort(compareCandidates);
  return scored.slice(0, limit);
}
