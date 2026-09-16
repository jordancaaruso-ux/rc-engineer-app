import "server-only";

import { deleteDoc, readDoc, writeDoc } from "@/lib/sweep/blobStore";
import { PLAN_DOC_KEY } from "@/lib/sweep/buildSweepPlan";
import { reportSweepFailure } from "@/lib/observability/reportSweep";
import {
  eveningWindowOpen,
  morningWindowOpen,
  previousLocalYmd,
  trackDayDocKey,
  trackLocalYmd,
  type SweepPlanDoc,
  type SweepPlanTrack,
  type SweepTrackDayDoc,
  type SweepTrackJob,
} from "@/lib/sweep/sweepDocs";

/**
 * How many tracks one tick hands off. Each hand-off is its own function invocation running
 * concurrently, so this is the ceiling on how many timing sites the sweep is reading at once —
 * the rate limit. Whatever a tick leaves behind is still unclaimed and goes on the next tick, five
 * minutes later, inside the same half-hour window (`SLOT_WINDOW_MINUTES`).
 */
export const DISPATCH_PER_TICK = 25;

/** The Blob calls the tick makes, injectable so the dispatcher is unit-tested against memory. */
export type SweepStore = {
  readDoc: <T>(key: string) => Promise<T | null>;
  writeDoc: <T>(key: string, doc: T) => Promise<void>;
  deleteDoc: (key: string) => Promise<void>;
};

/**
 * Hands one track's look to a worker. Resolves once the worker has ACCEPTED the job (not when
 * it has finished); rejects when it could not be handed off at all, in which case the tick gives
 * the claim back so the next tick tries again.
 */
export type DispatchFn = (job: SweepTrackJob, track: SweepPlanTrack, plan: SweepPlanDoc) => Promise<void>;

export type TickReport = {
  ok: true;
  planBuiltIso: string | null;
  /** Jobs handed to workers on this tick. */
  dispatched: SweepTrackJob[];
  /** Jobs that were due but left for the next tick (over `DISPATCH_PER_TICK`). */
  waiting: number;
  /** Hand-offs that failed and were given back. */
  failed: SweepTrackJob[];
  skipped?: string;
};

const DOC_READ_CONCURRENCY = 8;

/**
 * One cron tick: the dispatcher. Reads the plan, finds every track whose local clock says a look
 * is due — 8 pm for today, or 8 am for a track that owes last night — claims each one in its own
 * Blob document, and hands it to a worker. The tick itself reads no timing site and touches no
 * Postgres; a tick with no track in a window reads one document and stops.
 *
 * Claim BEFORE hand-off (founder's scaling pass, 2026-09-16): a worker that dies after sending a
 * driver's summary leaves a claimed document, so the next tick never re-sends. The price is that a
 * dead worker's tracks are not retried that day, which is the same promise the old single-pass
 * tick made ("a broken evening must not retry every five minutes").
 */
export async function runSweepTick(
  now = new Date(),
  opts: {
    dispatch?: DispatchFn;
    store?: SweepStore;
    maxPerTick?: number;
    /** Dev drive only: these jobs are due now, whatever the clock says. */
    force?: SweepTrackJob[];
  } = {},
): Promise<TickReport> {
  const store: SweepStore = opts.store ?? { readDoc, writeDoc, deleteDoc };
  const maxPerTick = opts.maxPerTick ?? DISPATCH_PER_TICK;
  const plan = await store.readDoc<SweepPlanDoc>(PLAN_DOC_KEY);
  const report: TickReport = {
    ok: true,
    planBuiltIso: plan?.builtIso ?? null,
    dispatched: [],
    waiting: 0,
    failed: [],
  };
  if (!plan || !opts.dispatch) return report;

  const forced = new Map((opts.force ?? []).map((j) => [j.trackId, j]));
  const due: Array<{ job: SweepTrackJob; track: SweepPlanTrack; previous: SweepTrackDayDoc | null }> = [];

  // Only tracks inside a window cost a document read; the rest are decided from the clock alone.
  const candidates = Object.values(plan.tracks).filter(
    (t) => forced.has(t.id) || eveningWindowOpen(t.timeZone, now) || morningWindowOpen(t.timeZone, now),
  );
  await forEachPooled(candidates, DOC_READ_CONCURRENCY, async (track) => {
    const previous = await store.readDoc<SweepTrackDayDoc>(trackDayDocKey(track.id));
    const forcedJob = forced.get(track.id);
    if (forcedJob) {
      due.push({ job: forcedJob, track, previous });
      return;
    }
    if (eveningWindowOpen(track.timeZone, now)) {
      const ymd = trackLocalYmd(track.timeZone, now);
      // Any state for today means the day is spoken for: claimed, done, or owed.
      if (previous?.ymd === ymd) return;
      due.push({ job: { trackId: track.id, ymd, slot: "evening" }, track, previous });
      return;
    }
    if (morningWindowOpen(track.timeZone, now)) {
      if (previous?.state !== "morning-owed") return;
      if (previous.ymd !== previousLocalYmd(track.timeZone, now)) {
        // A debt older than last night is forgiven: a week-old "your day" is noise, not a summary.
        await store.writeDoc(trackDayDocKey(track.id), { ...previous, state: "done" });
        return;
      }
      due.push({ job: { trackId: track.id, ymd: previous.ymd, slot: "morning" }, track, previous });
    }
  });

  // Stable order so the tracks left waiting are the same ones next tick, not a shuffle.
  due.sort((a, b) => a.track.id.localeCompare(b.track.id));
  const taken = due.slice(0, maxPerTick);
  report.waiting = due.length - taken.length;

  for (const { job, track, previous } of taken) {
    const key = trackDayDocKey(track.id);
    const claim: SweepTrackDayDoc = {
      v: 1,
      ymd: job.ymd,
      state: job.slot === "evening" ? "evening-claimed" : "morning-claimed",
      claimedIso: now.toISOString(),
      notifiedUserIds: previous?.ymd === job.ymd ? previous.notifiedUserIds : [],
    };
    await store.writeDoc(key, claim);
    try {
      await opts.dispatch(job, track, plan);
      report.dispatched.push(job);
    } catch (err) {
      reportSweepFailure(err, { stage: "dispatch", trackId: track.id });
      report.failed.push(job);
      // The worker never started: give the claim back so the next tick tries again.
      if (previous) await store.writeDoc(key, previous);
      else await store.deleteDoc(key);
    }
  }
  return report;
}

async function forEachPooled<T>(
  items: readonly T[],
  size: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
