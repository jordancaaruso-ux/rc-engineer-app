/**
 * Run: `npm run test:engineer-starters`
 *
 * These guard the two things a driver actually notices: never being offered a
 * question the Engineer can't answer from the current subject, and the four
 * chips that fit on a phone rail spanning four kinds of question rather than
 * five ways to ask about the same run.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DASHBOARD_STARTER_COUNT,
  ENGINEER_STARTER_BOARD_COUNT,
  ENGINEER_STARTER_QUESTIONS,
  selectDashboardStarterQuestions,
  selectEngineerStarterQuestions,
} from "@/lib/engineerStarterQuestions";

const RUN_IN_FOCUS = { runInFocus: true, hasHistory: true };
const GENERAL_MODE = { runInFocus: false, hasHistory: true };
const BRAND_NEW = { runInFocus: false, hasHistory: false };

test("ids are unique — React keys and any future analytics depend on it", () => {
  const ids = ENGINEER_STARTER_QUESTIONS.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every question carries a label short enough for a rail and a longer real question", () => {
  for (const q of ENGINEER_STARTER_QUESTIONS) {
    assert.ok(q.label.length <= 26, `label too long for a 390px rail: ${q.label}`);
    assert.ok(
      q.text.length > q.label.length,
      `${q.id}: the composer text should be the fuller question, not the chip label`,
    );
    assert.ok(q.text.trim() === q.text, `${q.id}: composer text has stray whitespace`);
  }
});

test("no run in focus means no question that can only be answered from one", () => {
  for (const state of [GENERAL_MODE, BRAND_NEW]) {
    const picked = selectEngineerStarterQuestions(state);
    assert.equal(
      picked.some((q) => q.family === "run"),
      false,
      "a run-reading question with no run in focus is a dead end",
    );
  }
});

test("a driver with nothing logged still gets a full set of answerable questions", () => {
  const picked = selectEngineerStarterQuestions(BRAND_NEW);
  assert.ok(picked.length >= ENGINEER_STARTER_BOARD_COUNT, "not enough to fill the desktop board");
  assert.equal(
    picked.some((q) => q.id === "learn-what-worked" || q.id === "learn-untouched"),
    false,
    "these read across runs the driver hasn't logged yet",
  );
});

test("history without focus keeps the read-across questions but drops the read-this-run ones", () => {
  const picked = selectEngineerStarterQuestions(GENERAL_MODE);
  assert.ok(picked.some((q) => q.id === "learn-what-worked"));
  assert.equal(picked.some((q) => q.family === "run"), false);
});

test("the first four span four families, so a phone rail is never four of a kind", () => {
  for (const state of [RUN_IN_FOCUS, GENERAL_MODE, BRAND_NEW]) {
    const firstFour = selectEngineerStarterQuestions(state, 4);
    assert.equal(firstFour.length, 4);
    assert.equal(
      new Set(firstFour.map((q) => q.family)).size,
      4 - (state.runInFocus ? 0 : 1),
      "the rotation should deal one from each eligible family before repeating one",
    );
  }
});

test("selection is deterministic — same state, same chips, same order", () => {
  const a = selectEngineerStarterQuestions(RUN_IN_FOCUS).map((q) => q.id);
  const b = selectEngineerStarterQuestions(RUN_IN_FOCUS).map((q) => q.id);
  assert.deepEqual(a, b);
});

test("nothing is lost or duplicated by the rotation", () => {
  const picked = selectEngineerStarterQuestions(RUN_IN_FOCUS);
  assert.equal(picked.length, ENGINEER_STARTER_QUESTIONS.length);
  assert.equal(new Set(picked.map((q) => q.id)).size, picked.length);
});

test("limit trims without reordering", () => {
  const full = selectEngineerStarterQuestions(RUN_IN_FOCUS).map((q) => q.id);
  const board = selectEngineerStarterQuestions(RUN_IN_FOCUS, ENGINEER_STARTER_BOARD_COUNT).map(
    (q) => q.id,
  );
  assert.deepEqual(board, full.slice(0, ENGINEER_STARTER_BOARD_COUNT));
});

/* ── The phone dashboard's card (2026-08-20) ───────────────────────────────── */

test("the dashboard card asks about the car at the track, and about the craft away from it", () => {
  const atTrack = selectDashboardStarterQuestions({ hasRuns: true, isTrackDay: true });
  const offDay = selectDashboardStarterQuestions({ hasRuns: true, isTrackDay: false });

  assert.ok(atTrack.length > 0 && offDay.length > 0);
  assert.ok(
    atTrack.some((q) => q.family === "feel"),
    "a track day should offer the how-does-it-feel questions",
  );
  assert.ok(
    !offDay.some((q) => q.family === "feel"),
    "an off day should not ask about a car that isn't in front of the driver",
  );
  assert.ok(
    offDay.some((q) => q.family === "learn"),
    "an off day is when the learn questions are worth the slot",
  );
});

test("a driver with nothing logged is never offered a question about a run", () => {
  for (const isTrackDay of [true, false]) {
    const picked = selectDashboardStarterQuestions({ hasRuns: false, isTrackDay });
    assert.ok(picked.length > 0, "there must always be something to ask");
    assert.equal(
      picked.filter((q) => q.family === "run").length,
      0,
      "no run in focus means no read-this-run question",
    );
  }
});

test("the card never offers more than it can cycle through, and never repeats one", () => {
  for (const isTrackDay of [true, false]) {
    const picked = selectDashboardStarterQuestions({ hasRuns: true, isTrackDay });
    assert.ok(picked.length <= DASHBOARD_STARTER_COUNT);
    assert.equal(new Set(picked.map((q) => q.id)).size, picked.length);
  }
});
