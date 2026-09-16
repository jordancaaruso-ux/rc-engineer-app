import "server-only";

import { prisma } from "@/lib/prisma";
import { buildDebriefRecap, type DebriefRunSource } from "@/lib/debrief/buildDebriefRecap";
import { sendPushToUser } from "@/lib/webPush/server";
import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail";
import { confirmRunReturnHref } from "@/lib/runs/confirmRunHref";
import { outingSessionFromImportedRow, spanForExistingRun } from "@/lib/runs/outingsFromImportedSessions";
import { organizationIdFromTrackUrl } from "@/lib/speedhive/speedhiveUrl";
import { practiceLocationIdFromTrackUrl } from "@/lib/speedhive/speedhivePracticeUrl";
import { readDoc, writeDoc } from "@/lib/sweep/blobStore";
import { fileDayForUser, type GatheredCandidate } from "@/lib/sweep/fileDay";
import { gatherSpeedhivePractice } from "@/lib/sweep/gatherSpeedhivePractice";
import { gatherSpeedhiveResults } from "@/lib/sweep/gatherSpeedhiveResults";
import { gatherLiveRc } from "@/lib/sweep/gatherLiveRc";
import { dayBoundsForYmd } from "@/lib/sweep/getMyDayDays";
import { renderEveningSummaryEmail, renderEveningSummaryPush } from "@/lib/sweep/eveningSummary";
import { reportSweepFailure } from "@/lib/observability/reportSweep";
import {
  racedIntoTheEvening,
  trackDayDocKey,
  type SweepPlanDoc,
  type SweepPlanTrack,
  type SweepTrackDayDoc,
  type SweepTrackJob,
} from "@/lib/sweep/sweepDocs";

export type TrackLookReport = {
  job: SweepTrackJob;
  /** Drivers whose sessions were found on the timing sites. */
  gathered: string[];
  /** Drivers handed the day's summary on this look. */
  notified: string[];
  /** Drivers still racing at 8 pm: filed quietly, summary owed at 8 am. */
  deferred: string[];
  state: SweepTrackDayDoc["state"];
};

/**
 * One track, one day, one look — the worker's whole job. Gather every listening driver's sessions
 * from every source the track has, THEN file each driver's day once as outings (`fileDay.ts`),
 * then hand each of them their day — by push when they have a device, by email otherwise.
 *
 * Two looks exist (founder ruling 2026-09-16). The 8 pm look is the day's summary for a driver who
 * has been off the track since 7:30; a driver with a session at or after 7:30 pm is still racing,
 * so their sessions are filed quietly and the track owes them an 8 am look, which gathers the
 * night's sessions and sends the whole day then. Nothing is sent to a driver with nothing at this
 * track that day, and nobody is sent a day twice: the track's document remembers who was told.
 */
export async function runTrackLook(params: {
  track: SweepPlanTrack;
  plan: SweepPlanDoc;
  job: SweepTrackJob;
  now: Date;
}): Promise<TrackLookReport> {
  const { track, plan, job, now } = params;
  const zone = track.timeZone;
  const ymd = job.ymd;
  const day = dayBoundsForYmd(ymd, zone);
  const key = trackDayDocKey(track.id);
  const previous = await readDoc<SweepTrackDayDoc>(key);
  const alreadyTold = new Set(previous?.ymd === ymd ? previous.notifiedUserIds : []);
  const report: TrackLookReport = { job, gathered: [], notified: [...alreadyTold], deferred: [], state: "done" };

  const users = track.userIds.filter((id) => plan.users[id]);
  try {
    if (users.length > 0) {
      const gathered = new Map<string, GatheredCandidate[]>();
      const add = (userId: string, list: GatheredCandidate[]) => {
        const cur = gathered.get(userId);
        if (cur) cur.push(...list);
        else gathered.set(userId, [...list]);
      };

      if (track.speedhiveUrl && practiceLocationIdFromTrackUrl(track.speedhiveUrl)) {
        const r = await gatherSpeedhivePractice({ plan, track, ymd, now });
        for (const [userId, list] of r.byUser) add(userId, list);
      }
      if (track.speedhiveUrl && organizationIdFromTrackUrl(track.speedhiveUrl)) {
        const r = await gatherSpeedhiveResults({ plan, track, ymd, userIds: users });
        for (const [userId, list] of r.byUser) add(userId, list);
      }
      if (track.liveRcUrl) {
        const r = await gatherLiveRc({ plan, track, ymd, now, userIds: users });
        for (const [userId, list] of r.byUser) add(userId, list);
      }
      report.gathered = [...gathered.keys()];

      // A chip the listing showed may belong to a driver the plan did not place at this track.
      const touched = new Set<string>([...users, ...gathered.keys()]);

      for (const userId of touched) {
        const candidates = gathered.get(userId) ?? [];
        if (candidates.length > 0) {
          try {
            await fileDayForUser({ userId, track: { id: track.id, timeZone: zone }, candidates, now });
          } catch (err) {
            reportSweepFailure(err, { stage: "file", trackId: track.id, userId });
          }
        }
        const user = plan.users[userId];
        if (!user || alreadyTold.has(userId)) continue;
        try {
          if (job.slot === "evening") {
            const latest = await latestOnTrack(userId, track.id, zone, day);
            if (racedIntoTheEvening(latest, zone, ymd)) {
              report.deferred.push(userId);
              continue;
            }
          }
          const hadSomething = await deliverDaySummary({ userId, email: user.email, track, ymd, day });
          if (hadSomething) report.notified.push(userId);
        } catch (err) {
          reportSweepFailure(err, { stage: "notify", trackId: track.id, userId });
        }
      }
    }
  } finally {
    // Written whatever happened above: a look that threw is still over for the day.
    report.state = job.slot === "evening" && report.deferred.length > 0 ? "morning-owed" : "done";
    const doc: SweepTrackDayDoc = {
      v: 1,
      ymd,
      state: report.state,
      claimedIso: previous?.ymd === ymd ? previous.claimedIso : now.toISOString(),
      notifiedUserIds: report.notified,
    };
    await writeDoc(key, doc);
  }
  return report;
}

/** Slack either side of the day for wall-clock timing sites stored as fake UTC (see getMyDay). */
const DAY_SLACK_MS = 36 * 60 * 60 * 1000;

/**
 * The last instant the driver was on track at this track that day, from every session the app
 * holds for it — timing imports and the runs they logged themselves. Null when there is none.
 */
async function latestOnTrack(
  userId: string,
  trackId: string,
  zone: string,
  day: { start: Date; end: Date },
): Promise<Date | null> {
  const [imports, runs] = await Promise.all([
    prisma.importedLapTimeSession.findMany({
      where: {
        userId,
        trackId,
        sessionCompletedAt: {
          gte: new Date(day.start.getTime() - DAY_SLACK_MS),
          lt: new Date(day.end.getTime() + DAY_SLACK_MS),
        },
      },
      select: { id: true, sourceUrl: true, parserId: true, parsedPayload: true, sessionCompletedAt: true },
      take: 80,
    }),
    prisma.run.findMany({
      where: { userId, trackId, sortAt: { gte: day.start, lt: day.end } },
      select: {
        sortAt: true,
        sessionCompletedAt: true,
        lapTimes: true,
        localTimeZone: true,
        detectedImportedLapSession: {
          select: { id: true, sourceUrl: true, parserId: true, parsedPayload: true, sessionCompletedAt: true },
        },
      },
    }),
  ]);
  let latest: Date | null = null;
  const consider = (d: Date | null | undefined) => {
    if (d && d >= day.start && d < day.end && (!latest || d > latest)) latest = d;
  };
  for (const row of imports) consider(outingSessionFromImportedRow(row, zone)?.end);
  for (const run of runs) consider(spanForExistingRun(run, zone)?.end ?? run.sessionCompletedAt ?? run.sortAt);
  return latest;
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

/** The driver's day at the track, sent. False when there was nothing to send. */
async function deliverDaySummary(params: {
  userId: string;
  email: string | null;
  track: SweepPlanTrack;
  ymd: string;
  day: { start: Date; end: Date };
}): Promise<boolean> {
  const { userId, track, ymd, day } = params;

  const [runs, looseRows] = await Promise.all([
    prisma.run.findMany({
      where: { userId, trackId: track.id, sortAt: { gte: day.start, lt: day.end } },
      orderBy: [{ sortAt: "desc" }, { createdAt: "desc" }],
      select: SUMMARY_RUN_SELECT,
    }),
    prisma.importedLapTimeSession.findMany({
      where: {
        userId,
        trackId: track.id,
        linkedRunId: null,
        sweepFiledAt: { not: null },
        sessionCompletedAt: {
          gte: new Date(day.start.getTime() - DAY_SLACK_MS),
          lt: new Date(day.end.getTime() + DAY_SLACK_MS),
        },
      },
      select: { id: true, sourceUrl: true, parserId: true, parsedPayload: true, sessionCompletedAt: true },
      take: 60,
    }),
  ]);
  const loose = looseRows.filter((r) => {
    const s = outingSessionFromImportedRow(r, track.timeZone);
    return !!s && s.start >= day.start && s.start < day.end;
  });
  if (runs.length === 0 && loose.length === 0) return false;

  const dateLabel = new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${ymd}T12:00:00Z`));

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
  /*
   * Where the notification lands (founder ruling 2026-09-16). The day when the look filed a run to
   * open it by — a day is addressed by a run — else the dashboard, because a day with nothing on it
   * has no address yet. When sessions are still waiting on a car, the landing carries the flag that
   * opens the "Which car?" sheet over whatever it lands on; answering it files the runs and the
   * sheet lands on the day it just made.
   */
  const base = anchorRunId ? confirmRunReturnHref(anchorRunId) : "/";
  const openPath =
    loose.length > 0
      ? `${base}${base.includes("?") ? "&" : "?"}whichCar=${encodeURIComponent(track.id)}&ymd=${ymd}`
      : base;
  const summary = {
    trackName: track.name,
    dateLabel,
    recap,
    runCount: runs.length,
    unconfirmedCount: runs.filter((r) => r.unconfirmedAt != null).length,
    looseCount: loose.length,
    openPath,
  };

  const [webDevices, nativeDevices] = await Promise.all([
    prisma.pushSubscription.count({ where: { userId } }),
    prisma.nativePushDevice.count({ where: { userId } }),
  ]);
  if (webDevices + nativeDevices > 0) {
    const push = renderEveningSummaryPush(summary);
    const sent = await sendPushToUser(userId, { ...push, tag: "jrc-evening" });
    if (sent.sent > 0) return true;
    // Every device was stale and pruned: fall through to email.
  }
  if (!params.email) return true;
  const email = renderEveningSummaryEmail(summary);
  await sendTransactionalEmail({ to: params.email, ...email }, { label: "evening-summary" });
  return true;
}
