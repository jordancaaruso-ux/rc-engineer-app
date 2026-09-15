import "server-only";

import { prisma } from "@/lib/prisma";
import { buildDebriefRecap, type DebriefRunSource } from "@/lib/debrief/buildDebriefRecap";
import { todayBoundsInTimeZone } from "@/lib/eventActive";
import { sendPushToUser } from "@/lib/webPush/server";
import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail";
import { confirmRunReturnHref } from "@/lib/runs/confirmRunHref";
import { discoverSpeedhiveSessionsForUser } from "@/lib/speedhive/discoverSpeedhiveSessionsForUser";
import { organizationIdFromTrackUrl } from "@/lib/speedhive/speedhiveUrl";
import { practiceLocationIdFromTrackUrl } from "@/lib/speedhive/speedhivePracticeUrl";
import { readDoc } from "@/lib/sweep/blobStore";
import { armedDocKey } from "@/lib/sweep/armTrack";
import { fileSessionForUser } from "@/lib/sweep/fileSession";
import { pollSpeedhiveTrack } from "@/lib/sweep/pollSpeedhiveTrack";
import { pollLiveRcTrack } from "@/lib/sweep/pollLiveRcTrack";
import { renderEveningSummaryEmail, renderEveningSummaryPush } from "@/lib/sweep/eveningSummary";
import { reportSweepFailure } from "@/lib/observability/reportSweep";
import {
  newArmedTrackDoc,
  trackLocalYmd,
  type ArmedTrackDoc,
  type SweepPlanDoc,
  type SweepPlanTrack,
} from "@/lib/sweep/sweepDocs";

/**
 * 8 pm at the track: look once for every listening driver who races here, file what the day
 * left behind, then hand each of them their day — by push when they have a device, by email
 * otherwise. Nothing is sent to a driver with nothing at this track today.
 */
export async function runEveningPass(track: SweepPlanTrack, plan: SweepPlanDoc, now: Date): Promise<void> {
  const users = track.userIds.filter((id) => plan.users[id]);
  if (users.length === 0) return;

  // The armed doc (if today's) carries what the pollers already handled; a scratch one otherwise.
  // Nothing is written back: filing is idempotent, and the doc dies at midnight anyway.
  const doc: ArmedTrackDoc =
    (await readDoc<ArmedTrackDoc>(armedDocKey(track.id))) ?? newArmedTrackDoc(track, now);

  const touched = new Set<string>(users);

  if (track.speedhiveUrl && practiceLocationIdFromTrackUrl(track.speedhiveUrl)) {
    const r = await pollSpeedhiveTrack({ plan, track, doc, now });
    for (const id of r.byUser.keys()) touched.add(id);
  }
  if (track.speedhiveUrl && organizationIdFromTrackUrl(track.speedhiveUrl)) {
    const todayYmd = trackLocalYmd(track.timeZone, now);
    for (const userId of users) {
      try {
        const found = await discoverSpeedhiveSessionsForUser({ userId, trackSpeedhiveUrl: track.speedhiveUrl });
        const todays = found.unimportedCandidates.filter(
          (c) => c.sessionCompletedAtIso && trackLocalYmd(track.timeZone, new Date(c.sessionCompletedAtIso)) === todayYmd,
        );
        for (const c of todays) {
          await fileSessionForUser({
            userId,
            track: { id: track.id, timeZone: track.timeZone },
            sessionUrl: c.sessionUrl,
            source: "speedhive",
            sourceKind: c.sourceKind,
            now,
          });
        }
      } catch (err) {
        reportSweepFailure(err, { stage: "evening", source: "speedhive", trackId: track.id, userId });
      }
    }
  }
  if (track.liveRcUrl) {
    await pollLiveRcTrack({ plan, track, doc, now, userIds: users });
  }

  for (const userId of touched) {
    const user = plan.users[userId];
    if (!user) continue;
    try {
      await deliverEveningSummary({ userId, email: user.email, track, now });
    } catch (err) {
      reportSweepFailure(err, { stage: "notify", trackId: track.id, userId });
    }
  }
}

const SUMMARY_RUN_SELECT = {
  id: true,
  userId: true,
  carId: true,
  carNameSnapshot: true,
  car: { select: { name: true } },
  createdAt: true,
  sortAt: true,
  sessionCompletedAt: true,
  loggingCompletedAt: true,
  localTimeZone: true,
  lapTimes: true,
  lapSession: true,
  loggingComplete: true,
  unconfirmedAt: true,
  bestLapSeconds: true,
  avgTop5LapSeconds: true,
  sessionType: true,
  meetingSessionType: true,
  meetingSessionCode: true,
  sessionLabel: true,
  tireStintId: true,
  tireRunNumber: true,
  tireAgeKnown: true,
  tireType: { select: { id: true, displayName: true } },
  carRating: true,
  conditionsAirTempC: true,
} as const;

async function deliverEveningSummary(params: {
  userId: string;
  email: string | null;
  track: SweepPlanTrack;
  now: Date;
}): Promise<void> {
  const { userId, track, now } = params;
  const day = todayBoundsInTimeZone(track.timeZone, now);

  const [runs, loose] = await Promise.all([
    prisma.run.findMany({
      where: { userId, trackId: track.id, sortAt: { gte: day.start, lt: day.end } },
      orderBy: [{ sortAt: "desc" }, { createdAt: "desc" }],
      select: SUMMARY_RUN_SELECT,
    }),
    prisma.importedLapTimeSession.findMany({
      where: { userId, trackId: track.id, linkedRunId: null, sweepFiledAt: { gte: day.start } },
      orderBy: { sessionCompletedAt: "asc" },
      select: { id: true },
    }),
  ]);
  if (runs.length === 0 && loose.length === 0) return;

  const dateLabel = new Intl.DateTimeFormat("en-AU", {
    timeZone: track.timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(now);

  const recap =
    runs.length > 0
      ? buildDebriefRecap(
          {
            title: "Test day",
            type: "Testing",
            trackName: track.name,
            dateLabel,
            runs: runs as unknown as DebriefRunSource[],
          },
          { zones: { viewerTimeZone: track.timeZone } },
        )
      : null;

  const anchorRunId = recap?.best?.runId ?? runs[0]?.id ?? null;
  const summary = {
    trackName: track.name,
    dateLabel,
    recap,
    runCount: runs.length,
    unconfirmedCount: runs.filter((r) => r.unconfirmedAt != null).length,
    looseCount: loose.length,
    openPath: anchorRunId ? confirmRunReturnHref(anchorRunId) : "/runs/history",
    whichCarPath: loose[0] ? `/runs/new?importedLapTimeSessionId=${encodeURIComponent(loose[0].id)}` : null,
  };

  const [webDevices, nativeDevices] = await Promise.all([
    prisma.pushSubscription.count({ where: { userId } }),
    prisma.nativePushDevice.count({ where: { userId } }),
  ]);
  if (webDevices + nativeDevices > 0) {
    const push = renderEveningSummaryPush(summary);
    const sent = await sendPushToUser(userId, { ...push, tag: "jrc-evening" });
    if (sent.sent > 0) return;
    // Every device was stale and pruned: fall through to email.
  }
  if (!params.email) return;
  const email = renderEveningSummaryEmail(summary);
  await sendTransactionalEmail({ to: params.email, ...email }, { label: "evening-summary" });
}
