import "server-only";

import { dayBoundsForYmd } from "@/lib/sweep/getMyDayDays";
import {
  fetchPracticeLocationActivitiesInWindow,
  fetchPracticeTrainingSessions,
  type SpeedhivePracticeActivityRow,
  type SpeedhivePracticeTrainingSession,
} from "@/lib/speedhive/speedhivePracticeClient";
import { buildSpeedhivePracticeRunUrl, practiceLocationIdFromTrackUrl } from "@/lib/speedhive/speedhivePracticeUrl";
import { normalizeSpeedhiveTransponderNumber } from "@/lib/speedhive/speedhiveTransponder";
import type { GatheredCandidate } from "@/lib/sweep/fileDay";
import { sessionBlockIsClosed } from "@/lib/sweep/placeholderRules";
import { reportSweepFailure } from "@/lib/observability/reportSweep";
import { trackLocalYmd, type SweepPlanDoc, type SweepPlanTrack } from "@/lib/sweep/sweepDocs";

export type GatherResult = {
  /** Today's sessions per listening user — gathered, not yet filed. */
  byUser: Map<string, GatheredCandidate[]>;
  /** The listing returned a 429. */
  rateLimited: boolean;
  /** Anything else went wrong at the listing level (already reported). */
  failed: boolean;
};

export function emptyGather(): GatherResult {
  return { byUser: new Map(), rateLimited: false, failed: false };
}

export function pushCandidate(result: GatherResult, userId: string, c: GatheredCandidate): void {
  const list = result.byUser.get(userId);
  if (list) list.push(c);
  else result.byUser.set(userId, [c]);
}

function isRateLimit(err: unknown): boolean {
  return err instanceof Error && /HTTP 429$/.test(err.message);
}

function activityInstant(act: SpeedhivePracticeActivityRow): Date | null {
  const raw = act.endTime?.trim() || act.startTime?.trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function blockLastLapAt(block: SpeedhivePracticeTrainingSession): Date | null {
  let last: Date | null = null;
  for (const lap of block.laps ?? []) {
    const raw = lap.dateTimeStart?.trim();
    if (!raw) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    if (!last || d > last) last = d;
  }
  return last;
}

function blockHasLaps(block: SpeedhivePracticeTrainingSession): boolean {
  return (block.laps ?? []).some((l) => {
    const t = l.duration?.trim();
    return !!t && t !== "-" && Number(t.replace(",", ".")) > 0;
  });
}

/**
 * Today's practice-loop blocks at one Speedhive track, for every listening chip. The listing is
 * per TRACK: one call shows every chip that ran there, so a driver the plan did not place at this
 * track is found all the same. Nothing is filed here — the evening pass gathers every source
 * first and files the day once (`fileDay.ts`). Speedhive organisation (race results) URLs are
 * read separately in the evening pass.
 */
export async function gatherSpeedhivePractice(params: {
  plan: Pick<SweepPlanDoc, "chips" | "users">;
  track: SweepPlanTrack;
  /** The track-local day being gathered — today at 8 pm, yesterday at 8 am. */
  ymd: string;
  now: Date;
}): Promise<GatherResult> {
  const result = emptyGather();
  const { plan, track, now } = params;
  const locationId = practiceLocationIdFromTrackUrl(track.speedhiveUrl);
  if (!locationId) return result;

  let activities: SpeedhivePracticeActivityRow[];
  try {
    // The whole day, walked back page by page. The newest forty were read before: at a busy track
    // the 8 am look at yesterday found the evening and lost the morning (2026-09-17).
    const walked = await fetchPracticeLocationActivitiesInWindow(
      locationId,
      dayBoundsForYmd(params.ymd, track.timeZone),
    );
    activities = walked.activities;
    if (!walked.complete) result.failed = true;
  } catch (err) {
    if (isRateLimit(err)) {
      result.rateLimited = true;
      return result;
    }
    reportSweepFailure(err, { stage: "poll", source: "speedhive", trackId: track.id });
    result.failed = true;
    return result;
  }

  const todayYmd = params.ymd;
  type Hit = { act: SpeedhivePracticeActivityRow; instant: Date; chip: string; userIds: string[] };
  const hits: Hit[] = [];
  for (const act of activities) {
    if (!act.id) continue;
    const instant = activityInstant(act);
    if (!instant || trackLocalYmd(track.timeZone, instant) !== todayYmd) continue;
    const chip = act.chipCode ? normalizeSpeedhiveTransponderNumber(act.chipCode) : null;
    if (!chip) continue;
    const userIds = (plan.chips[chip] ?? []).filter((id) => plan.users[id]);
    if (userIds.length === 0) continue;
    hits.push({ act, instant, chip, userIds });
  }
  if (hits.length === 0) return result;

  // Newest activity per chip: only its last block can still be in progress.
  const newestByChip = new Map<string, number>();
  for (const h of hits) {
    const cur = newestByChip.get(h.chip);
    const curInstant = cur == null ? null : hits.find((x) => x.act.id === cur)?.instant ?? null;
    if (curInstant == null || h.instant > curInstant) newestByChip.set(h.chip, h.act.id);
  }

  hits.sort((a, b) => a.instant.getTime() - b.instant.getTime());

  for (const hit of hits) {
    let blocks: SpeedhivePracticeTrainingSession[];
    try {
      blocks = await fetchPracticeTrainingSessions(hit.act.id);
    } catch (err) {
      if (isRateLimit(err)) {
        result.rateLimited = true;
        return result;
      }
      reportSweepFailure(err, { stage: "poll", source: "speedhive", trackId: track.id });
      continue;
    }
    const withLaps = blocks.filter(blockHasLaps);
    const newestBlockId =
      withLaps.length > 0
        ? withLaps.reduce((a, b) => {
            const at = blockLastLapAt(a)?.getTime() ?? 0;
            const bt = blockLastLapAt(b)?.getTime() ?? 0;
            return bt > at ? b : a;
          }).id
        : null;
    const activityIsNewest = newestByChip.get(hit.chip) === hit.act.id;

    for (const block of withLaps) {
      // Never file a run that is still being driven — moot at 8 pm, cheap to keep honest.
      const closed = sessionBlockIsClosed(
        { lastLapAt: blockLastLapAt(block), isNewest: activityIsNewest && block.id === newestBlockId },
        now,
      );
      if (!closed) continue;
      const sessionUrl = buildSpeedhivePracticeRunUrl(locationId, hit.act.id, block.id);
      for (const userId of hit.userIds) {
        pushCandidate(result, userId, {
          sessionUrl,
          source: "speedhive",
          sourceKind: "practice",
          chipCode: hit.chip,
        });
      }
    }
  }
  return result;
}
