import "server-only";

import {
  buildSessionPageUrl,
  fetchEventSessions,
  fetchOrganizationEvents,
  fetchSessionClassification,
  type SpeedhiveClassificationRow,
} from "@/lib/speedhive/speedhiveClient";
import { classificationRowMatchesUser } from "@/lib/speedhive/speedhiveClassificationMatch";
import {
  getSpeedhiveDriverNamesForUser,
  getSpeedhiveTransponderNumbersForUser,
} from "@/lib/speedhive/speedhiveDriverSettings";
import { normalizeSpeedhiveDriverNamesForMatch } from "@/lib/speedhive/speedhiveDriverNames";
import { organizationIdFromTrackUrl } from "@/lib/speedhive/speedhiveUrl";
import { emptyGather, pushCandidate, type GatherResult } from "@/lib/sweep/gatherSpeedhivePractice";
import { reportSweepFailure } from "@/lib/observability/reportSweep";
import { trackLocalYmd, type SweepPlanDoc, type SweepPlanTrack } from "@/lib/sweep/sweepDocs";

/** Newest events on the organisation page; a club posts one or two a weekend. */
const MAX_EVENTS = 12;
/** A multi-day meeting's Sunday sessions sit under an event that started on the Friday. */
const EVENT_LOOKBACK_DAYS = 3;
const MAX_SESSIONS_PER_EVENT = 40;

type Identity = { userId: string; transponders: number[]; driverNorms: string[] };

function isRateLimit(err: unknown): boolean {
  return err instanceof Error && /HTTP 429$/.test(err.message);
}

function ymdShift(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

  const earliestEventYmd = ymdShift(ymd, -EVENT_LOOKBACK_DAYS);
  try {
    const events = await fetchOrganizationEvents(organizationId, MAX_EVENTS);
    for (const event of events) {
      if (!event.id) continue;
      const eventYmd = event.startDate?.slice(0, 10) ?? null;
      // An event that starts after the day, or ended well before it, cannot hold its sessions.
      if (eventYmd && (eventYmd > ymd || eventYmd < earliestEventYmd)) continue;

      const sessions = (await fetchEventSessions(event.id)).slice(0, MAX_SESSIONS_PER_EVENT);
      for (const sess of sessions) {
        if (!sess.id) continue;
        const startIso = sess.startTime ? new Date(sess.startTime) : null;
        const sessionYmd =
          startIso && !Number.isNaN(startIso.getTime()) ? trackLocalYmd(track.timeZone, startIso) : eventYmd;
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
          if (hit) pushCandidate(result, who.userId, { sessionUrl, source: "speedhive", sourceKind });
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
