import "server-only";

import { deleteDoc, listDocs, readDoc, writeDoc } from "@/lib/sweep/blobStore";
import { PLAN_DOC_KEY, planViewForUserTrack } from "@/lib/sweep/buildSweepPlan";
import { armTrack, armedDocKey } from "@/lib/sweep/armTrack";
import { pollSpeedhiveTrack, type PollResult } from "@/lib/sweep/pollSpeedhiveTrack";
import { pollLiveRcTrack } from "@/lib/sweep/pollLiveRcTrack";
import { notifyRunsFiled } from "@/lib/sweep/notifyRunFiled";
import { reportSweepFailure } from "@/lib/observability/reportSweep";
import {
  backoffAfterFailure,
  eveningWindowOpen,
  isArmedDocExpired,
  isSourceDue,
  NO_BACKOFF,
  planViewForArmedDoc,
  trackLocalYmd,
  type ArmedBy,
  type ArmedTrackDoc,
  type SweepPlanDoc,
  type SweepPlanTrack,
  type SweepPlanUser,
  type SweepSource,
} from "@/lib/sweep/sweepDocs";

/** Inside the route's `maxDuration`, with room for the last poll to finish. */
const DEFAULT_BUDGET_MS = 100_000;

export type TickReport = {
  ok: true;
  planBuiltIso: string | null;
  armedTracks: number;
  polled: Array<{ trackId: string; source: SweepSource; filed: number; rateLimited: boolean }>;
  evening: string[];
  skipped?: string;
};

export type EveningPassFn = (track: SweepPlanTrack, plan: SweepPlanDoc, now: Date) => Promise<void>;

type PlanView = { users: Record<string, SweepPlanUser>; chips: Record<string, string[]> };

function emptyPlan(): SweepPlanDoc {
  return { v: 1, builtIso: new Date(0).toISOString(), users: {}, chips: {}, tracks: {}, evening: {} };
}

/**
 * One cron tick. Reads the plan and the armed docs from Blob; polls the tracks that are due
 * inside a wall-clock budget; runs the evening pass for tracks whose local clock says 8 pm.
 * A tick with nothing due touches nothing but Blob — Postgres stays asleep.
 */
export async function runSweepTick(
  now = new Date(),
  opts: {
    budgetMs?: number;
    evening?: EveningPassFn;
    /** Dev drive only: run the evening pass for these tracks now, whatever the clock says. */
    forceEveningTrackIds?: string[];
  } = {},
): Promise<TickReport> {
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const started = Date.now();
  const plan = (await readDoc<SweepPlanDoc>(PLAN_DOC_KEY)) ?? emptyPlan();
  const report: TickReport = {
    ok: true,
    planBuiltIso: plan.builtIso === new Date(0).toISOString() ? null : plan.builtIso,
    armedTracks: 0,
    polled: [],
    evening: [],
  };

  const keys = await listDocs("armed/");
  type Due = { key: string; doc: ArmedTrackDoc; view: PlanView; track: SweepPlanTrack; source: SweepSource; last: number };
  const due: Due[] = [];
  for (const key of keys) {
    const doc = await readDoc<ArmedTrackDoc>(key);
    if (!doc) continue;
    if (isArmedDocExpired(doc, now)) {
      await deleteDoc(key);
      continue;
    }
    report.armedTracks += 1;
    const { users, chips, track } = planViewForArmedDoc(plan, doc);
    for (const source of ["speedhive", "liverc"] as const) {
      const url = source === "speedhive" ? track.speedhiveUrl : track.liveRcUrl;
      if (!url || !isSourceDue(doc, source, now)) continue;
      due.push({ key, doc, view: { users, chips }, track, source, last: new Date(doc.lastPolledIso[source] ?? 0).getTime() });
    }
  }
  due.sort((a, b) => a.last - b.last);

  for (const item of due) {
    if (Date.now() - started > budgetMs) break;
    const filed = await pollOne(item.view, item.track, item.doc, item.source, now, true);
    item.doc.lastPolledIso[item.source] = now.toISOString();
    await writeDoc(item.key, item.doc);
    report.polled.push({ trackId: item.track.id, source: item.source, filed: filed.count, rateLimited: filed.rateLimited });
  }

  if (opts.evening && report.planBuiltIso) {
    const forced = new Set(opts.forceEveningTrackIds ?? []);
    for (const track of Object.values(plan.tracks)) {
      if (Date.now() - started > budgetMs) break;
      const isForced = forced.has(track.id);
      if (!isForced && !eveningWindowOpen(track.timeZone, now)) continue;
      const ymd = trackLocalYmd(track.timeZone, now);
      if (!isForced && plan.evening[track.id]?.doneYmd === ymd) continue;
      try {
        await opts.evening(track, plan, now);
        report.evening.push(track.id);
      } catch (err) {
        reportSweepFailure(err, { stage: "evening", trackId: track.id });
      }
      // Marked done even on failure: a broken evening must not retry every five minutes.
      plan.evening[track.id] = { doneYmd: ymd };
      await writeDoc(PLAN_DOC_KEY, plan);
    }
  }
  return report;
}

async function pollOne(
  view: PlanView,
  track: SweepPlanTrack,
  doc: ArmedTrackDoc,
  source: SweepSource,
  now: Date,
  armed: boolean,
): Promise<{ count: number; rateLimited: boolean }> {
  let result: PollResult;
  if (source === "speedhive") result = await pollSpeedhiveTrack({ plan: view, track, doc, now });
  else result = await pollLiveRcTrack({ plan: view, track, doc, now });

  if (result.rateLimited) {
    doc.backoff = backoffAfterFailure(doc.backoff, now);
  } else if (!result.failed) {
    doc.backoff = NO_BACKOFF;
  }

  let count = 0;
  for (const [userId, outcomes] of result.byUser) {
    count += outcomes.filter((o) => o.kind === "attached" || o.kind === "placeholder").length;
    if (!armed) continue;
    try {
      await notifyRunsFiled({ userId, track: { id: track.id, timeZone: track.timeZone }, outcomes });
    } catch (err) {
      reportSweepFailure(err, { stage: "notify", source, trackId: track.id, userId });
    }
  }
  return { count, rateLimited: result.rateLimited };
}

/**
 * Arm a track for a driver and look at it straight away — the app opened at the track, or a run
 * was just saved there. Runs after the response (`after()`), so it costs the driver nothing.
 * Falls back to a one-user plan view when the nightly plan does not know the track or the
 * driver yet; the armed doc then carries those facts for the ticks that follow.
 */
export async function armAndPollTrackNow(params: {
  trackId: string;
  userId: string;
  armedBy: ArmedBy;
  /** Look now, not just arm. A draft is "about to go out" — nothing to find yet, so it only arms. */
  poll?: boolean;
  now?: Date;
}): Promise<void> {
  const now = params.now ?? new Date();
  const plan = (await readDoc<SweepPlanDoc>(PLAN_DOC_KEY)) ?? emptyPlan();
  let track = plan.tracks[params.trackId] ?? null;
  let user = plan.users[params.userId] ?? null;
  if (!track || !user) {
    const fresh = await planViewForUserTrack(params.userId, params.trackId);
    if (!fresh) return;
    track = track ?? fresh.track;
    user = user ?? fresh.user;
  }
  const doc = await armTrack({
    track,
    user: { id: user.id, chips: user.chips, liveRcName: user.liveRcName },
    armedBy: params.armedBy,
    now,
  });
  if (params.poll === false) return;
  const { users, chips } = planViewForArmedDoc(plan, doc);
  for (const source of ["speedhive", "liverc"] as const) {
    const url = source === "speedhive" ? track.speedhiveUrl : track.liveRcUrl;
    if (!url) continue;
    try {
      await pollOne({ users, chips }, track, doc, source, now, true);
      doc.lastPolledIso[source] = now.toISOString();
    } catch (err) {
      reportSweepFailure(err, { stage: "poll", source, trackId: track.id, userId: params.userId });
    }
  }
  await writeDoc(armedDocKey(track.id), doc);
}
