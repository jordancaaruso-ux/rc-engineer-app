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
};

const base = {
  trackName: "MR33 Arena",
  dateLabel: "Sat 19 Sep",
  recap,
  runCount: 5,
  unconfirmedCount: 2,
  looseCount: 0,
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
    "2 runs filed from the timing sheet — check and confirm.",
  ]);
});

test("push: one line with the best mark and what is left to do", () => {
  const p = renderEveningSummaryPush(base);
  assert.equal(p.title, "Your day at MR33 Arena");
  assert.equal(p.body, "5 runs · best 14.213 (Run 3) · top 5 14.402 · 2 to confirm");
  assert.equal(p.url, base.openPath);
});

/*
 * Founder ruling 2026-09-16: the notification announces the day like any other and NEVER asks
 * which car — the app asks that in a sheet when the driver arrives. So a day that filed runs must
 * not mention the sessions still waiting, and a day that filed none says what is there instead.
 */
test("push: a day that filed runs never mentions the car question", () => {
  const p = renderEveningSummaryPush({ ...base, looseCount: 2 });
  assert.equal(p.body, "5 runs · best 14.213 (Run 3) · top 5 14.402 · 2 to confirm");
  assert.ok(!/car/i.test(p.body));
  assert.equal(p.url, base.openPath);
});

test("push: a day where nothing could be filed says what is waiting, and still opens the app", () => {
  const p = renderEveningSummaryPush({
    ...base,
    recap: null,
    runCount: 0,
    unconfirmedCount: 0,
    looseCount: 3,
    openPath: "/?whichCar=t1&ymd=2026-09-19",
  });
  assert.equal(p.body, "3 sessions from today are ready");
  assert.ok(!/car/i.test(p.body));
  assert.equal(p.url, "/?whichCar=t1&ymd=2026-09-19");
});

test("email: subject carries the day, text and html carry the lines and absolute links", () => {
  const e = renderEveningSummaryEmail({ ...base, looseCount: 1 });
  assert.equal(e.subject, "MR33 Arena, Sat 19 Sep: 5 runs, best 14.213");
  assert.ok(e.text.includes("Best 14.213 (Run 3)"));
  assert.ok(e.text.includes("https://www."));
  assert.ok(e.html.includes("Your day at MR33 Arena"));
  assert.ok(e.html.includes("Open your day"));
  // One button, and no car question anywhere in it.
  assert.ok(!e.html.includes("Say which car"));
  assert.ok(!/which car/i.test(e.text));
  assert.ok(!e.html.includes("<script"));
});

test("email: a day that filed nothing is still worth sending", () => {
  const e = renderEveningSummaryEmail({
    ...base,
    recap: null,
    runCount: 0,
    unconfirmedCount: 0,
    looseCount: 2,
    openPath: "/?whichCar=t1&ymd=2026-09-19",
  });
  assert.equal(e.subject, "MR33 Arena, Sat 19 Sep: 2 sessions ready");
  assert.ok(e.text.includes("2 sessions from today are ready"));
});

test("a track name with markup is escaped in the email", () => {
  const e = renderEveningSummaryEmail({ ...base, trackName: "<b>Bad</b>" });
  assert.ok(e.html.includes("&lt;b&gt;Bad&lt;/b&gt;"));
  assert.ok(!e.html.includes("<b>Bad</b>"));
});
