import test from "node:test";
import assert from "node:assert/strict";
import type { DebriefRecap } from "@/lib/debrief/buildDebriefRecap";
import {
  eveningSummaryLines,
  renderEveningSummaryEmail,
  renderEveningSummaryPush,
} from "./eveningSummary";

const recap: DebriefRecap = {
  runCount: 5,
  lapCount: 92,
  dayCount: 1,
  best: { seconds: 14.213, runId: "r3", runLabel: "Run 3", dayLabel: null },
  top5: { seconds: 14.402, runId: "r3", runLabel: "Run 3", dayLabel: null },
  fiveMin: { label: "19/5:00.1", lapCount: 19, seconds: 300.1, runId: "r4", runLabel: "Run 4", dayLabel: null },
  field: null,
  rating: null,
  tyres: [
    { name: "Ride 28", runCount: 3, best: 14.213, top5: 14.402, fiveMin: "19/5:00.1", fromNew: [] },
    { name: "Ride 32", runCount: 2, best: 14.51, top5: 14.7, fiveMin: null, fromNew: [] },
  ],
  airTempC: { min: 18, max: 23 },
  setup: [],
};

const base = {
  trackName: "MR33 Arena",
  dateLabel: "Sat 19 Sep",
  recap,
  runCount: 5,
  unconfirmedCount: 2,
  unloggedCount: 0,
  openPath: "/runs/history?openGroup=r3&level=day",
};

test("lines: figures in Debrief order, tyres only when more than one, then the asks", () => {
  assert.deepEqual(eveningSummaryLines(base), [
    "5 runs · 92 laps",
    "Best 14.213 (Run 3)",
    "Top 5 14.402 (Run 3)",
    "5-min 19/5:00.1 (Run 4)",
    "Ride 28: 3 runs · best 14.213",
    "Ride 32: 2 runs · best 14.510",
    "Air 18–23°C",
    "2 runs to confirm.",
  ]);
});

test("push: one line with the best mark and what is left to do", () => {
  const p = renderEveningSummaryPush(base);
  assert.equal(p.title, "Your day at MR33 Arena");
  assert.equal(p.body, "5 runs · best 14.213 (Run 3) · top 5 14.402 · 2 to confirm");
  assert.equal(p.url, base.openPath);
});

/*
 * Founder rulings 2026-09-16 and 2026-09-18: the notification announces the day like any other
 * and NEVER asks a question — nothing files itself, so the runs the driver did not log are a
 * COUNT here, and the sheet lists them to keep or not when the driver arrives.
 */
test("push: a day with runs says how many on the timing sheet were not logged", () => {
  const p = renderEveningSummaryPush({ ...base, unloggedCount: 2 });
  assert.equal(p.body, "5 runs · best 14.213 (Run 3) · top 5 14.402 · 2 to confirm · 2 not logged");
  assert.ok(!/car/i.test(p.body));
  assert.equal(p.url, base.openPath);
});

test("push: a day where the driver logged nothing counts the runs on the sheet, and opens the sheet", () => {
  const p = renderEveningSummaryPush({
    ...base,
    recap: null,
    runCount: 0,
    unconfirmedCount: 0,
    unloggedCount: 3,
    openPath: "/?unlogged=t1&ymd=2026-09-19",
  });
  assert.equal(p.body, "3 runs on the timing sheet you didn't log");
  assert.ok(!/car/i.test(p.body));
  assert.equal(p.url, "/?unlogged=t1&ymd=2026-09-19");
});

test("email: the unlogged line says where to deal with them, and the subject carries the count", () => {
  const e = renderEveningSummaryEmail({ ...base, unconfirmedCount: 0, unloggedCount: 1 });
  assert.ok(e.text.includes("1 run on the timing sheet you didn't log — open the day to keep the ones you want."));
  assert.equal(e.subject, "MR33 Arena, Sat 19 Sep: 5 runs, best 14.213");
  const none = renderEveningSummaryEmail({ ...base, recap: null, runCount: 0, unconfirmedCount: 0, unloggedCount: 2 });
  assert.equal(none.subject, "MR33 Arena, Sat 19 Sep: 2 runs you didn't log");
});
