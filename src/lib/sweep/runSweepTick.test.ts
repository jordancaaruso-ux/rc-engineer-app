import test from "node:test";
import assert from "node:assert/strict";
import { runSweepTick, type SweepStore } from "./runSweepTick";
import {
  trackDayDocKey,
  type SweepPlanDoc,
  type SweepPlanTrack,
  type SweepTrackDayDoc,
  type SweepTrackJob,
} from "./sweepDocs";

/*
 * The dispatcher against an in-memory Blob. Run with the react-server condition (the module is
 * server-only): `npm run test:sweep-schedule`.
 */

const SYD = "Australia/Sydney";
const PARIS = "Europe/Paris";

function memoryStore(seed: Record<string, unknown> = {}): SweepStore & { docs: Map<string, unknown> } {
  const docs = new Map<string, unknown>(Object.entries(seed));
  return {
    docs,
    readDoc: async <T,>(key: string) => (docs.has(key) ? (structuredClone(docs.get(key)) as T) : null),
    writeDoc: async (key, doc) => {
      docs.set(key, structuredClone(doc));
    },
    deleteDoc: async (key) => {
      docs.delete(key);
    },
  };
}

function track(id: string, timeZone: string): SweepPlanTrack {
  return { id, name: id, speedhiveUrl: null, liveRcUrl: "https://x.liverc.com", timeZone, userIds: ["u1"] };
}

function plan(tracks: SweepPlanTrack[]): SweepPlanDoc {
  return {
    v: 1,
    builtIso: "2026-09-19T00:05:00.000Z",
    users: { u1: { id: "u1", email: "a@b.c", timeZone: SYD, chips: [], liveRcName: "A", tier: "pro" } },
    chips: {},
    tracks: Object.fromEntries(tracks.map((t) => [t.id, t])),
  };
}

// 20:05 Sydney on the 19th.
const SYD_EVENING = new Date("2026-09-19T10:05:00Z");
// 08:10 Sydney on the 20th.
const SYD_MORNING = new Date("2026-09-19T22:10:00Z");

test("a track at 8 pm is claimed BEFORE the worker is called, and only once", async () => {
  const store = memoryStore({ "plan.json": plan([track("t1", SYD), track("p1", PARIS)]) });
  const seen: Array<{ job: SweepTrackJob; claimedAtDispatch: SweepTrackDayDoc | null }> = [];
  const dispatch = async (job: SweepTrackJob) => {
    seen.push({ job, claimedAtDispatch: (store.docs.get(trackDayDocKey(job.trackId)) as SweepTrackDayDoc) ?? null });
  };

  const first = await runSweepTick(SYD_EVENING, { dispatch, store });
  assert.deepEqual(first.dispatched, [{ trackId: "t1", ymd: "2026-09-19", slot: "evening" }]);
  assert.equal(seen[0]?.claimedAtDispatch?.state, "evening-claimed");
  assert.equal(seen[0]?.claimedAtDispatch?.ymd, "2026-09-19");

  // Five minutes later, the same window: the claim stands, nothing is handed off again.
  const second = await runSweepTick(new Date("2026-09-19T10:10:00Z"), { dispatch, store });
  assert.deepEqual(second.dispatched, []);
  assert.equal(seen.length, 1);
  // Paris at 12:05 was never in a window and never cost a document.
  assert.equal(store.docs.has(trackDayDocKey("p1")), false);
});

test("a failed hand-off gives the claim back so the next tick tries again", async () => {
  const store = memoryStore({ "plan.json": plan([track("t1", SYD)]) });
  let calls = 0;
  const dispatch = async () => {
    calls += 1;
    if (calls === 1) throw new Error("worker answered HTTP 503");
  };
  const first = await runSweepTick(SYD_EVENING, { dispatch, store });
  assert.deepEqual(first.dispatched, []);
  assert.equal(first.failed.length, 1);
  assert.equal(store.docs.has(trackDayDocKey("t1")), false);

  const second = await runSweepTick(new Date("2026-09-19T10:10:00Z"), { dispatch, store });
  assert.equal(second.dispatched.length, 1);
  assert.equal(calls, 2);
});

test("more tracks than one tick takes: the rest wait, in a stable order, for the next tick", async () => {
  const tracks = ["a", "b", "c", "d", "e"].map((id) => track(id, SYD));
  const store = memoryStore({ "plan.json": plan(tracks) });
  const handed: string[] = [];
  const dispatch = async (job: SweepTrackJob) => {
    handed.push(job.trackId);
  };
  const first = await runSweepTick(SYD_EVENING, { dispatch, store, maxPerTick: 2 });
  assert.deepEqual(handed, ["a", "b"]);
  assert.equal(first.waiting, 3);
  const second = await runSweepTick(new Date("2026-09-19T10:10:00Z"), { dispatch, store, maxPerTick: 2 });
  assert.deepEqual(handed, ["a", "b", "c", "d"]);
  assert.equal(second.waiting, 1);
  const third = await runSweepTick(new Date("2026-09-19T10:15:00Z"), { dispatch, store, maxPerTick: 2 });
  assert.deepEqual(handed, ["a", "b", "c", "d", "e"]);
  assert.equal(third.waiting, 0);
});

test("8 am: only a track that owes last night is handed its morning look, keeping who was told", async () => {
  const owed: SweepTrackDayDoc = {
    v: 1,
    ymd: "2026-09-19",
    state: "morning-owed",
    claimedIso: "2026-09-19T10:05:00.000Z",
    notifiedUserIds: ["u1"],
  };
  const finished: SweepTrackDayDoc = { ...owed, state: "done" };
  const store = memoryStore({
    "plan.json": plan([track("owes", SYD), track("fine", SYD)]),
    [trackDayDocKey("owes")]: owed,
    [trackDayDocKey("fine")]: finished,
  });
  const handed: SweepTrackJob[] = [];
  const report = await runSweepTick(SYD_MORNING, {
    dispatch: async (job) => {
      handed.push(job);
    },
    store,
  });
  assert.deepEqual(handed, [{ trackId: "owes", ymd: "2026-09-19", slot: "morning" }]);
  assert.equal(report.waiting, 0);
  const claimed = store.docs.get(trackDayDocKey("owes")) as SweepTrackDayDoc;
  assert.equal(claimed.state, "morning-claimed");
  assert.deepEqual(claimed.notifiedUserIds, ["u1"]);
  assert.equal((store.docs.get(trackDayDocKey("fine")) as SweepTrackDayDoc).state, "done");
});

test("a debt older than last night is forgiven, not sent", async () => {
  const stale: SweepTrackDayDoc = {
    v: 1,
    ymd: "2026-09-12",
    state: "morning-owed",
    claimedIso: "2026-09-12T10:05:00.000Z",
    notifiedUserIds: [],
  };
  const store = memoryStore({ "plan.json": plan([track("t1", SYD)]), [trackDayDocKey("t1")]: stale });
  const report = await runSweepTick(SYD_MORNING, {
    dispatch: async () => {
      throw new Error("must not be called");
    },
    store,
  });
  assert.deepEqual(report.dispatched, []);
  assert.equal((store.docs.get(trackDayDocKey("t1")) as SweepTrackDayDoc).state, "done");
});

test("a quiet tick reads the plan and nothing else", async () => {
  const store = memoryStore({ "plan.json": plan([track("t1", SYD)]) });
  const reads: string[] = [];
  const spy: SweepStore = {
    ...store,
    readDoc: async (key) => {
      reads.push(key);
      return store.readDoc(key);
    },
  };
  // 15:00 Sydney: no window anywhere.
  const report = await runSweepTick(new Date("2026-09-19T05:00:00Z"), { dispatch: async () => {}, store: spy });
  assert.deepEqual(report.dispatched, []);
  assert.deepEqual(reads, ["plan.json"]);
});
