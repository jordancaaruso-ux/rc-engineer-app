import test from "node:test";
import assert from "node:assert/strict";
import { groupOutings, PIT_STOP_GAP_MS, type OutingSession } from "@/lib/runs/groupOutings";

const T0 = Date.parse("2026-09-19T00:00:00Z");
const min = (m: number) => new Date(T0 + m * 60 * 1000);

function practice(id: string, startMin: number, endMin: number, laps = 10): OutingSession {
  return { id, kind: "practice", start: min(startMin), end: min(endMin), driverCount: 1, lapCount: laps };
}
function heat(id: string, startMin: number, endMin: number, drivers = 10, laps = 20): OutingSession {
  return { id, kind: "official", start: min(startMin), end: min(endMin), driverCount: drivers, lapCount: laps };
}

test("5 laps, two minutes in the pits, back out: the practice feed's two blocks are one run", () => {
  const out = groupOutings([practice("sh-a", 0, 1.5, 5), practice("sh-b", 3.5, 8, 14)]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0]!.sessionIds, ["sh-b", "sh-a"]);
  assert.equal(out[0]!.start.getTime(), min(0).getTime());
  assert.equal(out[0]!.end.getTime(), min(8).getTime());
});

test("a stop longer than a pit stop is a new run", () => {
  const out = groupOutings([practice("a", 0, 5), practice("b", 5 + PIT_STOP_GAP_MS / 60000 + 0.5, 12)]);
  assert.equal(out.length, 2);
});

test("a timed practice window on LiveRC spans both fragments and leads the outing", () => {
  const liverc: OutingSession = { id: "lrc", kind: "practice", start: min(0), end: min(10), driverCount: 6, lapCount: 25 };
  const out = groupOutings([practice("sh-a", 0.5, 2, 5), liverc, practice("sh-b", 4, 9.5, 15)]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.primaryId, "lrc");
  assert.deepEqual(out[0]!.sessionIds, ["lrc", "sh-a", "sh-b"]);
});

test("the heat result outranks the practice-loop block that ran during it", () => {
  const out = groupOutings([practice("loop", 0, 5.2, 19), heat("q2", 0.1, 5.1)]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.primaryId, "q2");
  assert.equal(out[0]!.kind, "official");
});

test("the same heat on two sites is one outing, and the fuller sheet leads", () => {
  const out = groupOutings([heat("speedhive", 0, 5, 8, 20), heat("liverc", 0.2, 5.1, 10, 20)]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.primaryId, "liverc");
});

test("a practice block a minute after a heat is the next thing, not the heat", () => {
  const out = groupOutings([heat("q1", 0, 5), practice("warmup", 6, 9)]);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.primaryId, "q1");
  assert.equal(out[1]!.primaryId, "warmup");
});

test("heats that do not overlap stay separate, in the day's order whatever the input order", () => {
  const out = groupOutings([heat("q3", 60, 65), heat("q1", 0, 5), heat("q2", 30, 35)]);
  assert.deepEqual(out.map((o) => o.primaryId), ["q1", "q2", "q3"]);
});

test("a session with no known length is a point in time and still joins by the pit-stop rule", () => {
  const out = groupOutings([practice("a", 0, 0, 0), practice("b", 2, 6, 12)]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.primaryId, "b");
});

test("an empty day is an empty list", () => {
  assert.deepEqual(groupOutings([]), []);
});
