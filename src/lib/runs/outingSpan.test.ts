import test from "node:test";
import assert from "node:assert/strict";
import {
  durationFromDrivers,
  estimateDurationSeconds,
  outingKindFor,
  sameTimeOnTrack,
  spanFrom,
  spansOverlap,
  timeAnchorFor,
} from "@/lib/runs/outingSpan";

test("race results are official, lap feeds are practice — by parser id, then by URL", () => {
  assert.equal(outingKindFor("liverc_race_result_v1", null), "official");
  assert.equal(outingKindFor("speedhive_api_v1", null), "official");
  assert.equal(outingKindFor("myrcm_report_v1", null), "official");
  assert.equal(outingKindFor("liverc_practice_session_v1", null), "practice");
  assert.equal(outingKindFor("speedhive_practice_v1", null), "practice");
  assert.equal(
    outingKindFor(null, "https://speedhive.mylaps.com/practice/4591/activities/12/sessions/3"),
    "practice",
  );
  assert.equal(outingKindFor(null, "https://track.liverc.com/results/?p=view_race_result&id=9"), "official");
});

test("only Speedhive race results stamp the end of the session", () => {
  assert.equal(timeAnchorFor("speedhive_api_v1", null), "end");
  assert.equal(timeAnchorFor("speedhive_practice_v1", null), "start");
  assert.equal(timeAnchorFor("liverc_race_result_v1", null), "start");
  assert.equal(timeAnchorFor(null, "https://speedhive.mylaps.com/sessions/123"), "end");
  assert.equal(timeAnchorFor(null, "https://speedhive.mylaps.com/practice/4591/activities/12"), "start");
});

test("a span is built forward from a start and backward from an end", () => {
  const at = new Date("2026-09-19T02:00:00Z");
  const fwd = spanFrom(at, 300, "start");
  assert.equal(fwd.start.toISOString(), "2026-09-19T02:00:00.000Z");
  assert.equal(fwd.end.toISOString(), "2026-09-19T02:05:00.000Z");
  const back = spanFrom(at, 300, "end");
  assert.equal(back.start.toISOString(), "2026-09-19T01:55:00.000Z");
  assert.equal(back.end.toISOString(), "2026-09-19T02:00:00.000Z");
  const point = spanFrom(at, Number.NaN, "start");
  assert.equal(point.start.getTime(), point.end.getTime());
});

test("a shared window is as long as its longest runner", () => {
  assert.equal(durationFromDrivers([{ laps: [15, 15, 15] }, { laps: [16, 16, 16, 16] }, { laps: [] }]), 64);
  assert.equal(durationFromDrivers([]), 0);
});

test("the sheet's estimate needs both a lap count and a best lap", () => {
  assert.equal(estimateDurationSeconds(20, 15), 20 * 15 * 1.08);
  assert.equal(estimateDurationSeconds(null, 15), null);
  assert.equal(estimateDurationSeconds(20, 0), null);
});

test("overlap includes touching ends", () => {
  const a = { start: new Date(0), end: new Date(1000) };
  assert.equal(spansOverlap(a, { start: new Date(1000), end: new Date(2000) }), true);
  assert.equal(spansOverlap(a, { start: new Date(1001), end: new Date(2000) }), false);
  assert.equal(spansOverlap(a, { start: new Date(-500), end: new Date(-1) }), false);
});

test("the same time on track shares at least half of the shorter window", () => {
  const s = (sec: number) => new Date(sec * 1000);
  const heat = { start: s(0), end: s(631) };
  // The practice loop's copy of the heat, three seconds off at each end.
  assert.equal(sameTimeOnTrack(heat, { start: s(3), end: s(634) }), true);
  // A loop block that caught only part of the heat still sat inside it.
  assert.equal(sameTimeOnTrack(heat, { start: s(200), end: s(420) }), true);
  // The next heat, touching at the changeover, is not the same race.
  assert.equal(sameTimeOnTrack(heat, { start: s(600), end: s(1230) }), false);
  assert.equal(sameTimeOnTrack(heat, { start: s(631), end: s(1260) }), false);
});

test("a split run's halves on a minutes-only site touch, but are not the same time on track", () => {
  // LiveRC prints 10:00 and 10:04; the laps say each half ran about five minutes.
  const first = { start: new Date("2026-09-12T00:00:00Z"), end: new Date("2026-09-12T00:05:00Z") };
  const second = { start: new Date("2026-09-12T00:04:00Z"), end: new Date("2026-09-12T00:09:30Z") };
  assert.equal(spansOverlap(first, second), true, "the evening pass's looser rule would group them");
  assert.equal(sameTimeOnTrack(first, second), false);
});

test("a window with no length is never the same time on track", () => {
  const point = { start: new Date(1000), end: new Date(1000) };
  assert.equal(sameTimeOnTrack({ start: new Date(0), end: new Date(5000) }, point), false);
  assert.equal(sameTimeOnTrack(point, point), false);
});
