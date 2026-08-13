import assert from "node:assert/strict";
import test from "node:test";
import {
  preferredSetupSource,
  resolveSetupSourceDefault,
  setupListState,
  type SetupListState,
} from "./setupSourceDefault";

const ALL_STATES: SetupListState[] = ["unknown", "empty", "present"];

/** The default with every suppression off — only the two list states vary. */
function resolve(previousRuns: SetupListState, savedSetups: SetupListState) {
  return resolveSetupSourceDefault({
    previousRuns,
    savedSetups,
    isEditing: false,
    driverChoseForThisCar: false,
    alreadyDefaultedForThisCar: false,
    sheetHasContent: false,
  });
}

test("setupListState treats not-loaded and failed alike: no evidence", () => {
  // The lists in hand are the previous car's — count says nothing about this one.
  assert.equal(setupListState({ loadedForThisCar: false, ok: true, count: 0 }), "unknown");
  assert.equal(setupListState({ loadedForThisCar: false, ok: true, count: 9 }), "unknown");
  // Request failed: empty because nothing came back, not because the car has nothing.
  assert.equal(setupListState({ loadedForThisCar: true, ok: false, count: 0 }), "unknown");
  // Only a resolved request for this car is evidence.
  assert.equal(setupListState({ loadedForThisCar: true, ok: true, count: 0 }), "empty");
  assert.equal(setupListState({ loadedForThisCar: true, ok: true, count: 1 }), "present");
});

test("previous runs win, with or without saved setups (founder priority)", () => {
  for (const saved of ALL_STATES) {
    assert.equal(resolve("present", saved), "previous_runs", `saved=${saved}`);
  }
});

test("saved setups are the answer only when the car has no runs", () => {
  assert.equal(resolve("empty", "present"), "other");
});

test("a car with nothing behind it lands on New (onboarding finding #1)", () => {
  // The case the original seed existed for: ten of ten new accounts opened on an
  // empty "Previous runs". This must keep working.
  assert.equal(resolve("empty", "empty"), "new");
});

test("an unknown runs list never downgrades the face", () => {
  // In flight or failed — either way, promoting Saved or New here is the bug that
  // put established drivers on a blank sheet.
  for (const saved of ALL_STATES) {
    assert.equal(resolve("unknown", saved), null, `saved=${saved}`);
  }
});

test("an unknown saved list only blocks when runs are empty", () => {
  assert.equal(resolve("empty", "unknown"), null);
  // ...but a runs list that answered the question is not blocked by it. This is
  // what Promise.allSettled buys over Promise.all: one route failing must not
  // blind the other.
  assert.equal(resolve("present", "unknown"), "previous_runs");
});

test("editing a run or resuming a draft never moves the face", () => {
  for (const previousRuns of ALL_STATES) {
    for (const savedSetups of ALL_STATES) {
      assert.equal(
        resolveSetupSourceDefault({
          previousRuns,
          savedSetups,
          isEditing: true,
          driverChoseForThisCar: false,
          alreadyDefaultedForThisCar: false,
          sheetHasContent: false,
        }),
        null,
        `${previousRuns}/${savedSetups}`
      );
    }
  }
});

test("an explicit choice on this car is never overridden", () => {
  assert.equal(
    resolveSetupSourceDefault({
      previousRuns: "present",
      savedSetups: "present",
      isEditing: false,
      driverChoseForThisCar: true,
      alreadyDefaultedForThisCar: false,
      sheetHasContent: false,
    }),
    null
  );
});

test("the default lands once per car, so a late list refresh cannot move it", () => {
  assert.equal(
    resolveSetupSourceDefault({
      previousRuns: "present",
      savedSetups: "present",
      isEditing: false,
      driverChoseForThisCar: false,
      alreadyDefaultedForThisCar: true,
      sheetHasContent: false,
    }),
    null
  );
});

test("a sheet with content already answers the question", () => {
  // Wizard prefill, copy-last-run and the restored local draft all put values on
  // the sheet without recording a source of their own.
  assert.equal(
    resolveSetupSourceDefault({
      previousRuns: "empty",
      savedSetups: "empty",
      isEditing: false,
      driverChoseForThisCar: false,
      alreadyDefaultedForThisCar: false,
      sheetHasContent: true,
    }),
    null
  );
});

test("the rule is a function of the facts, not of the face it is replacing", () => {
  // The property the old one-way seed violated: it could only ever move
  // previous_runs → new, so once it fired the answer could never be revisited.
  // Same inputs must give the same answer every time it is asked.
  for (const previousRuns of ALL_STATES) {
    for (const savedSetups of ALL_STATES) {
      assert.equal(
        resolve(previousRuns, savedSetups),
        resolve(previousRuns, savedSetups),
        `${previousRuns}/${savedSetups}`
      );
      assert.equal(
        resolve(previousRuns, savedSetups),
        preferredSetupSource(previousRuns, savedSetups),
        `${previousRuns}/${savedSetups}`
      );
    }
  }
});
