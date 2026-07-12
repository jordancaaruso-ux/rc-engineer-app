import "server-only";

import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/webPush/server";

/**
 * Time-based "log your runs?" nudge for tracks with NO Speedhive coverage — the graceful
 * fallback so the loop stays alive where auto-detection can't reach (founder decision
 * 2026-07-12). We can only know a driver is racing today from a formal Event (no
 * transponder feed exists here), so this is event-gated by design; eventless, no-Speedhive
 * test days remain out of reach until an explicit "at the track today" tap ships.
 *
 * Conservative v1: one nudge per user per day, only if they haven't logged a run today,
 * fired inside a daytime window. Same tap target as the detection push — the normal
 * Add Run flow, resuming today's draft.
 */

const NUDGE_DATE_KEY = "log_reminder_nudge_date";
const NEW_RUN_TAP_URL = "/runs/new?resume=1";

// Server-clock daytime window. NOTE: cron runs in UTC and we have no per-user timezone,
// so this maps to local afternoons only approximately — acceptable for the current small
// user base; per-user tz (or the explicit-arm tap) is the eventual fix.
const NUDGE_START_HOUR = 13;
const NUDGE_END_HOUR = 21;
const MAX_USERS_PER_RUN = 100;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type NudgeTarget = { userId: string; trackName: string | null };

/** Participants in an event active today at a track WITHOUT Speedhive coverage. */
async function getNudgeTargets(now: Date): Promise<NudgeTarget[]> {
  const events = await prisma.event.findMany({
    where: {
      startDate: { lte: endOfDay(now) },
      endDate: { gte: startOfDay(now) },
      track: { speedhiveUrl: null },
    },
    select: {
      track: { select: { name: true } },
      participations: { select: { userId: true } },
    },
  });

  const byUser = new Map<string, NudgeTarget>();
  for (const ev of events) {
    for (const p of ev.participations) {
      if (!byUser.has(p.userId)) {
        byUser.set(p.userId, { userId: p.userId, trackName: ev.track?.name ?? null });
      }
    }
  }
  return [...byUser.values()];
}

async function alreadyNudgedToday(userId: string, todayKey: string): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({
    where: { userId_key: { userId, key: NUDGE_DATE_KEY } },
    select: { value: true },
  });
  return row?.value === todayKey;
}

async function markNudged(userId: string, todayKey: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { userId_key: { userId, key: NUDGE_DATE_KEY } },
    create: { userId, key: NUDGE_DATE_KEY, value: todayKey },
    update: { value: todayKey },
  });
}

async function hasLoggedRunToday(userId: string, now: Date): Promise<boolean> {
  const count = await prisma.run.count({
    where: { userId, sortAt: { gte: startOfDay(now), lte: endOfDay(now) } },
  });
  return count > 0;
}

export async function runLogReminderNudge(
  now: Date,
): Promise<{ targets: number; nudged: number; skippedOutOfWindow: boolean }> {
  const hour = now.getHours();
  if (hour < NUDGE_START_HOUR || hour >= NUDGE_END_HOUR) {
    return { targets: 0, nudged: 0, skippedOutOfWindow: true };
  }

  const todayKey = localDateKey(now);
  const targets = (await getNudgeTargets(now)).slice(0, MAX_USERS_PER_RUN);
  let nudged = 0;

  for (const target of targets) {
    try {
      if (await alreadyNudgedToday(target.userId, todayKey)) continue;
      if (await hasLoggedRunToday(target.userId, now)) continue;

      const title = target.trackName ? `Racing at ${target.trackName}?` : "At the track today?";
      const res = await sendPushToUser(target.userId, {
        title,
        body: "Don't forget to log your runs — tap to add one.",
        url: NEW_RUN_TAP_URL,
        tag: "jrc-log-reminder",
      });
      // Mark nudged even if no live device, so we don't retry every 5 min all day.
      await markNudged(target.userId, todayKey);
      if (res.sent > 0) nudged += 1;
    } catch (err) {
      console.warn(
        "[log-reminder] user nudge failed",
        JSON.stringify({ userId: target.userId, error: err instanceof Error ? err.message : String(err) }),
      );
    }
  }

  return { targets: targets.length, nudged, skippedOutOfWindow: false };
}
