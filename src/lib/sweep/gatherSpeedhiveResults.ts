import "server-only";

import {
  buildSessionPageUrl,
  fetchEventSessions,
  fetchOrganizationEventsSince,
  fetchSessionClassification,
  type SpeedhiveClassificationRow,
} from "@/lib/speedhive/speedhiveClient";
import {
  SPEEDHIVE_EVENT_LOOKBACK_DAYS,
  speedhiveSessionInstant,
  speedhiveSessionLocalYmd,
  ymdShift,
} from "@/lib/speedhive/speedhiveSessionTime";
import { classificationRowMatchesUser } from "@/lib/speedhive/speedhiveClassificationMatch";
import {
  getSpeedhiveDriverNamesForUser,
  getSpeedhiveTransponderNumbersForUser,
} from "@/lib/speedhive/speedhiveDriverSettings";
import { normalizeSpeedhiveDriverNamesForMatch } from "@/lib/speedhive/speedhiveDriverNames";
import { organizationIdFromTrackUrl } from "@/lib/speedhive/speedhiveUrl";
import { emptyGather, pushCandidate, type GatherResult } from "@/lib/sweep/gatherSpeedhivePractice";
import { reportSweepFailure } from "@/lib/observability/reportSweep";
import type { SweepPlanDoc, SweepPlanTrack } from "@/lib/sweep/sweepDocs";

type Identity = { userId: string; transponders: number[]; driverNorms: string[] };

function isRateLimit(err: unknown): boolean {
  return err instanceof Error && /HTTP 429$/.test(err.message);
}

/**
 * One day's race results from a Speedhive organisation page, for every listening driver at the
 * track — read ONCE per track. The old pass called the per-driver discovery for each driver,
 * which re-read the same events, sessions and classifications as many times as there were
 * drivers; here every classification row is matched against every driver's chip and names in
 * memory, and only sessions of the day being gathered are opened at all. Nothing is filed here.
 */
export async function gatherSpeedhiveResults(params: {
  plan: Pick<SweepPlanDoc, "users">;
  track: SweepPlanTrack;
  /** The track-local day being gathered — today at 8 pm, yesterday at 8 am. */
  ymd: string;
  userIds: readonly string[];
}): Promise<GatherResult> {
  const result = emptyGather();
  const { plan, track, ymd } = params;
  const organizationId = organizationIdFromTrackUrl(track.speedhiveUrl);
  if (!organizationId) return result;

  const identities = (
    await Promise.all(
      params.userIds
        .filter((id) => plan.users[id])
        .map(async (userId): Promise<Identity | null> => {
          const [names, transponders] = await Promise.all([
            getSpeedhiveDriverNamesForUser(userId).catch(() => [] as string[]),
            getSpeedhiveTransponderNumbersForUser(userId).catch(() => [] as number[]),
          ]);
          const driverNorms = normalizeSpeedhiveDriverNamesForMatch(names);
          if (driverNorms.length === 0 && transponders.length === 0) return null;
          return { userId, transponders, driverNorms: [...driverNorms] };
        }),
    )
  ).filter((i): i is Identity => i !== null);
  if (identities.length === 0) return result;

  try {
    // Every event that could hold the day, walked back through the organisation's history — the
    // newest twelve were read before, and each capped at forty sessions (2026-09-17).
    const walked = await fetchOrganizationEventsSince(
      organizationId,
      ymdShift(ymd, -SPEEDHIVE_EVENT_LOOKBACK_DAYS),
    );
    if (!walked.complete) result.failed = true;
    for (const event of walked.events) {
      if (!event.id) continue;
      const eventYmd = event.startDate?.slice(0, 10) ?? null;
      // An event that starts after the day cannot hold its sessions.
      if (eventYmd && eventYmd > ymd) continue;

      const sessions = await fetchEventSessions(event.id);
      for (const sess of sessions) {
        if (!sess.id) continue;
        // Speedhive's session time is the track's wall clock with no zone: its date IS the day.
        const sessionYmd = speedhiveSessionLocalYmd(sess.startTime, track.timeZone) ?? eventYmd;
        if (sessionYmd !== ymd) continue;

        let classification: SpeedhiveClassificationRow[];
        try {
          classification = await fetchSessionClassification(sess.id);
        } catch (err) {
          if (isRateLimit(err)) {
            result.rateLimited = true;
            return result;
          }
          continue;
        }
        const sourceKind: "practice" | "race" = sess.type?.toLowerCase() === "practice" ? "practice" : "race";
        const sessionUrl = buildSessionPageUrl(event.id, sess.id);
        for (const who of identities) {
          const hit = classification.some((row) =>
            classificationRowMatchesUser({
              row,
              userTransponders: who.transponders,
              driverNorms: who.driverNorms,
              raceClassFilter: null,
            }),
          );
          if (hit) {
            pushCandidate(result, who.userId, {
              sessionUrl,
              source: "speedhive",
              sourceKind,
              // The session page carries no time of its own; without this the run had none.
              listedAtIso: speedhiveSessionInstant(sess.startTime, track.timeZone)?.toISOString() ?? null,
            });
          }
        }
      }
    }
  } catch (err) {
    if (isRateLimit(err)) {
      result.rateLimited = true;
      return result;
    }
    reportSweepFailure(err, { stage: "poll", source: "speedhive", trackId: track.id });
    result.failed = true;
  }
  return result;
}
