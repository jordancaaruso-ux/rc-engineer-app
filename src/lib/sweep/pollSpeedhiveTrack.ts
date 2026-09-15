import "server-only";

import {
  fetchPracticeLocationActivities,
  fetchPracticeTrainingSessions,
  type SpeedhivePracticeActivityRow,
  type SpeedhivePracticeTrainingSession,
} from "@/lib/speedhive/speedhivePracticeClient";
import { buildSpeedhivePracticeRunUrl, practiceLocationIdFromTrackUrl } from "@/lib/speedhive/speedhivePracticeUrl";
import { normalizeSpeedhiveTransponderNumber } from "@/lib/speedhive/speedhiveTransponder";
import { fileSessionForUser, type FileSessionOutcome } from "@/lib/sweep/fileSession";
import { sessionBlockIsClosed } from "@/lib/sweep/placeholderRules";
import { reportSweepFailure } from "@/lib/observability/reportSweep";
import {
  rememberSeen,
  trackLocalYmd,
  type ArmedTrackDoc,
  type SweepPlanDoc,
  type SweepPlanTrack,
} from "@/lib/sweep/sweepDocs";

/** Enough for a club day: one listing call covers every chip at the track. */
const LISTING_COUNT = 40;

export type PollResult = {
  /** Outcomes per user, for the caller to push about. */
  byUser: Map<string, FileSessionOutcome[]>;
  /** The listing returned a 429: back the track off. */
  rateLimited: boolean;
  /** Anything else went wrong at the listing level (already reported). */
  failed: boolean;
};

function emptyResult(): PollResult {
  return { byUser: new Map(), rateLimited: false, failed: false };
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
 * One tick at one Speedhive practice track. The listing is per TRACK: one call shows every chip
 * that ran there recently, so it also arms drivers the app did not know were there (`chip`).
 * Blocks still being driven are left for the next tick; everything filed is remembered on the
 * doc so a session is handled once. Speedhive organisation (race results) URLs are not polled
 * here — the evening pass covers them.
 */
export async function pollSpeedhiveTrack(params: {
  plan: Pick<SweepPlanDoc, "chips" | "users">;
  track: SweepPlanTrack;
  doc: ArmedTrackDoc;
  now: Date;
}): Promise<PollResult> {
  const result = emptyResult();
  const { plan, track, doc, now } = params;
  const locationId = practiceLocationIdFromTrackUrl(track.speedhiveUrl);
  if (!locationId) return result;

  let activities: SpeedhivePracticeActivityRow[];
  try {
    activities = await fetchPracticeLocationActivities(locationId, { count: LISTING_COUNT });
  } catch (err) {
    if (isRateLimit(err)) {
      result.rateLimited = true;
      return result;
    }
    reportSweepFailure(err, { stage: "poll", source: "speedhive", trackId: track.id });
    result.failed = true;
    return result;
  }

  const todayYmd = trackLocalYmd(track.timeZone, now);
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

  // Oldest first so "Run N" counts up the way the day happened.
  hits.sort((a, b) => a.instant.getTime() - b.instant.getTime());

  for (const hit of hits) {
    for (const userId of hit.userIds) {
      if (!doc.users[userId]) {
        doc.users[userId] = {
          armedBy: "chip",
          armedAtIso: now.toISOString(),
          chips: plan.users[userId]?.chips ?? [hit.chip],
          liveRcName: plan.users[userId]?.liveRcName ?? null,
        };
      }
      const doneKey = `${userId}:${hit.act.id}:done`;
      if (doc.seen.includes(doneKey)) continue;

      let blocks: SpeedhivePracticeTrainingSession[];
      try {
        blocks = await fetchPracticeTrainingSessions(hit.act.id);
      } catch (err) {
        if (isRateLimit(err)) {
          result.rateLimited = true;
          return result;
        }
        reportSweepFailure(err, { stage: "poll", source: "speedhive", trackId: track.id, userId });
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

      let allHandled = true;
      for (const block of withLaps) {
        const key = `${userId}:${hit.act.id}:${block.id}`;
        if (doc.seen.includes(key)) continue;
        const closed = sessionBlockIsClosed(
          { lastLapAt: blockLastLapAt(block), isNewest: activityIsNewest && block.id === newestBlockId },
          now,
        );
        if (!closed) {
          allHandled = false;
          continue;
        }
        const sessionUrl = buildSpeedhivePracticeRunUrl(locationId, hit.act.id, block.id);
        try {
          const outcome = await fileSessionForUser({
            userId,
            track: { id: track.id, timeZone: track.timeZone },
            sessionUrl,
            source: "speedhive",
            sourceKind: "practice",
            chipCode: hit.chip,
            now,
          });
          (result.byUser.get(userId) ?? result.byUser.set(userId, []).get(userId)!).push(outcome);
          doc.seen = rememberSeen(doc.seen, key);
        } catch (err) {
          allHandled = false;
          reportSweepFailure(err, { stage: "file", source: "speedhive", trackId: track.id, userId, url: sessionUrl });
        }
      }
      if (allHandled && !activityIsNewest) doc.seen = rememberSeen(doc.seen, doneKey);
    }
  }
  return result;
}
