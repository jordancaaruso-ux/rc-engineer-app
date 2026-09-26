/**
 * Run: `npx tsx --test src/lib/runs/backfillOutingFold.test.ts`
 *
 * "Log them as 5 runs" after a LiveRC race import made no runs (test drive, 2026-09-26): all six of
 * the day's races were stored at the meeting's midnight, each "overlapped" the run being saved, and
 * each was quietly linked to it. Times below are the track's clock, as the save compares them.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planBackfillOutings, type BackfillOutingSession } from "./backfillOutingFold";
import type { OutingSession } from "./groupOutings";

const at = (hhmm: string) => new Date(`2026-09-13T${hhmm}:00.000Z`);

function race(id: string, startHhmm: string, minutes = 5, driverCount = 10): OutingSession {
  const start = at(startHhmm);
  return {
    id,
    kind: "official",
    start,
    end: new Date(start.getTime() + minutes * 60_000),
    driverCount,
    lapCount: 20,
  };
}

const timed = (session: OutingSession): BackfillOutingSession => ({ session, dateOnly: false });
const dateOnly = (session: OutingSession): BackfillOutingSession => ({ session, dateOnly: true });

test("races known only by their date never fold into the run being saved, or into each other", () => {
  const others = ["q1", "q2", "q3", "a3", "a2"].map((id) => dateOnly(race(id, "00:00")));
  const parentRun = { id: "run-a1-main", span: { start: at("00:00"), end: at("00:06") }, dateOnly: true };

  const plan = planBackfillOutings(others, [parentRun]);

  assert.deepEqual(plan.joined, [], "nothing joins the A1-Main's run");
  assert.deepEqual(
    plan.standalone.map((o) => o.sessionIds),
    [["q1"], ["q2"], ["q3"], ["a3"], ["a2"]],
    "five races, five runs"
  );
});

test("a date-only race doesn't join a run with a real time either", () => {
  // A practice run that really did go out just after midnight is still not the race.
  const plan = planBackfillOutings(
    [dateOnly(race("a1", "00:00"))],
    [{ id: "late-practice", span: { start: at("00:00"), end: at("00:05") }, dateOnly: false }]
  );
  assert.deepEqual(plan.joined, []);
  assert.deepEqual(plan.standalone.map((o) => o.primaryId), ["a1"]);
});

test("the day's races at their real times become runs of their own", () => {
  const others = [
    timed(race("h1", "11:03")),
    timed(race("h2", "12:04")),
    timed(race("h3", "13:06")),
    timed(race("a3", "15:18")),
    timed(race("a2", "16:16")),
  ];
  const parentRun = { id: "run-a1-main", span: { start: at("14:23"), end: at("14:30") }, dateOnly: false };

  const plan = planBackfillOutings(others, [parentRun]);

  assert.deepEqual(plan.joined, []);
  assert.equal(plan.standalone.length, 5);
});

test("the same race from a second timing site still joins the run that has it", () => {
  // What the fold is for: the heat on the run, posted again by Speedhive, is not another run.
  const copy = timed({ ...race("speedhive-copy", "14:24", 5, 10), kind: "official" });
  const parentRun = { id: "run-a1-main", span: { start: at("14:23"), end: at("14:30") }, dateOnly: false };

  const plan = planBackfillOutings([copy], [parentRun]);

  assert.deepEqual(plan.standalone, []);
  assert.deepEqual(
    plan.joined.map((j) => [j.runId, j.outing.sessionIds]),
    [["run-a1-main", ["speedhive-copy"]]]
  );
});

test("two sites' copies of one new heat are one run; a date-only race beside them is another", () => {
  const plan = planBackfillOutings(
    [
      timed(race("liverc-h2", "12:04", 5, 10)),
      timed({ ...race("speedhive-h2", "12:05", 5, 1), kind: "practice" }),
      dateOnly(race("liverc-a3", "00:00")),
    ],
    []
  );
  assert.deepEqual(
    plan.standalone.map((o) => o.sessionIds),
    [["liverc-h2", "speedhive-h2"], ["liverc-a3"]]
  );
});
