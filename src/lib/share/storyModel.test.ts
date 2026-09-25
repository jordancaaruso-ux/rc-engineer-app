import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStoryData,
  formatPaceGap,
  ordinal,
  parseStoryFrame,
  parseStoryLook,
  titleCaseName,
  type StoryRunInput,
} from "@/lib/share/storyModel";

/** What goes on a story. The render test proves it draws; this pins what it says. */

const RUN: StoryRunInput = {
  sessionType: "RACE_MEETING",
  meetingSessionType: "RACE",
  // Lap 11 is a crash: far past the clean-pace ceiling, so the chart pins it to the top.
  lapTimes: [15.867, 15.955, 15.947, 15.773, 16.173, 16.248, 15.934, 16.067, 16.098, 16.194, 19.9, 16.361],
  car: { name: "A800RR" },
  track: { name: "Bayside" },
  event: { name: "2026 QLD State Titles" },
};

const FIELD = { position: 1, fieldSize: 10, paceVsField: -0.333, fieldAveragePace: 16.329, timingName: "JORDAN CARUSO" };

test("the account name leads; the timing sheet's name stands in when there is none", () => {
  assert.equal(buildStoryData({ run: RUN, dateStamp: "X", accountName: "Jordan C", field: FIELD }).driver, "Jordan C");
  assert.equal(buildStoryData({ run: RUN, dateStamp: "X", accountName: null, field: FIELD }).driver, "Jordan Caruso");
  assert.equal(
    buildStoryData({ run: RUN, dateStamp: "X", accountName: "  ", field: null, timingName: "SAM O'NEIL-SMITH" }).driver,
    "Sam O'Neil-Smith"
  );
  assert.equal(buildStoryData({ run: RUN, dateStamp: "X" }).driver, null);
});

test("finish and pace come from the field, and are absent without one", () => {
  const withField = buildStoryData({ run: RUN, dateStamp: "X", field: FIELD });
  assert.deepEqual(withField.finish, { position: 1, of: 10 });
  assert.equal(withField.paceVsField, -0.333);
  assert.equal(withField.fieldAveragePace, 16.329);
  const alone = buildStoryData({ run: RUN, dateStamp: "X" });
  assert.equal(alone.finish, null);
  assert.equal(alone.paceVsField, null);
  assert.equal(alone.fieldAveragePace, null);
});

test("the figures: best lap, laps, time without thousandths, consistency to one decimal", () => {
  const d = buildStoryData({ run: RUN, dateStamp: "SUN 28 JUN 2026", field: FIELD });
  assert.equal(d.best, "15.773");
  assert.equal(d.session, "Race");
  assert.equal(d.event, "2026 QLD State Titles");
  assert.equal(d.dateStamp, "SUN 28 JUN 2026");
  assert.match(d.time ?? "", /^\d+:\d{2}$/);
  assert.match(d.consistency ?? "", /^\d+\.\d%$/);
});

test("the trace flags the best lap and pins slow laps under the clean-pace ceiling", () => {
  const d = buildStoryData({ run: RUN, dateStamp: "X" });
  assert.ok(d.trace);
  const best = d.trace.laps.filter((l) => l.flag === "best");
  assert.equal(best.length, 1);
  assert.equal(best[0]!.seconds, 15.773);
  assert.ok(Math.abs(d.trace.ceiling - 15.773 * 1.15) < 1e-9);
  assert.ok(d.trace.laps.some((l) => l.seconds > d.trace!.ceiling), "the 19.9 stays, drawn pinned to the top");
});

test("a run with too few laps has no trace", () => {
  assert.equal(buildStoryData({ run: { ...RUN, lapTimes: [15.9, 16.0] }, dateStamp: "X" }).trace, null);
});

test("names, places and gaps read the way a poster prints them", () => {
  assert.equal(titleCaseName("JORDAN CARUSO"), "Jordan Caruso");
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  assert.equal(formatPaceGap(-0.3325), "−0.333");
  assert.equal(formatPaceGap(0.12), "+0.120");
});

test("unknown looks and frames fall back to the defaults", () => {
  assert.equal(parseStoryLook("B"), "B");
  assert.equal(parseStoryLook("poster"), "C");
  assert.equal(parseStoryLook(null), "C");
  assert.equal(parseStoryFrame("post"), "post");
  assert.equal(parseStoryFrame("square"), "story");
});
