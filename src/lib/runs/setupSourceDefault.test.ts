import assert from "node:assert/strict";
import test from "node:test";
import {
  preferredSetupSource,
  resolveSetupSourceDefault,
  savedSetupToLoad,
  setupListState,
  type SetupListState,
} from "./setupSourceDefault";
import { chassisValueCount, setupHasChassisValue } from "@/lib/setup/runContextSetupKeys";

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

// --- A setup saved on the car reaches the run (test drive 2026-09-26) ---------------------------
//
// Jack saved "Knox club spec" (two boxes) on his B7.1 and logged four runs. Each landed on "Saved"
// with the picker left unpicked, so each run stored only the rear tyre the form writes into the
// setup, and that tyre was then counted: "Setup 1 values · as last run", Setup ticked, no setup.

const TYRE_ONLY = {
  tires: { tireTypeId: "knox-blue", displayName: "Knox Mob Club Spec Rear Blue", tireRunNumber: 2, tireAgeKnown: true },
};
const KNOX_CLUB_SPEC = { box_1: 3.5, box_2: 2 };

/** Both list states, counted exactly as the run form counts them. */
function listStates(
  runs: Array<{ setupSnapshot: { data: unknown } }>,
  saved: Array<{ setupData: unknown }>
) {
  return {
    previousRuns: setupListState({
      loadedForThisCar: true,
      ok: true,
      count: runs.filter((r) => setupHasChassisValue(r.setupSnapshot.data)).length,
    }),
    savedSetups: setupListState({
      loadedForThisCar: true,
      ok: true,
      count: saved.filter((s) => setupHasChassisValue(s.setupData)).length,
    }),
  };
}

test("the tyre the form writes into a run's setup is not a setup value", () => {
  assert.equal(chassisValueCount(TYRE_ONLY), 0);
  assert.equal(setupHasChassisValue(TYRE_ONLY), false);
  // Nor does it add one to a real setup: two boxes read 2 values, not 3.
  assert.equal(chassisValueCount({ ...KNOX_CLUB_SPEC, ...TYRE_ONLY }), 2);
  assert.equal(setupHasChassisValue({ ...KNOX_CLUB_SPEC, ...TYRE_ONLY }), true);
});

test("values are counted as stored: blanks are nothing, zero is a value, a row counts once", () => {
  assert.equal(chassisValueCount({ toe_rear: "", camber_front: "  ", droop_front: null }), 0);
  assert.equal(chassisValueCount({ downstop_front: 0 }), 1);
  // A preset row and its "other" box are one row once stored.
  assert.equal(
    chassisValueCount({ chassis: { selectedPreset: "", otherText: "st" }, chassis_other: "st" }),
    1
  );
  assert.equal(setupHasChassisValue({ chassis: { selectedPreset: "", otherText: "" } }), false);
  assert.equal(setupHasChassisValue({ top_deck_screws: ["", ""] }), false);
  assert.equal(chassisValueCount(null), 0);
  assert.equal(setupHasChassisValue("nonsense"), false);
});

test("a car whose runs carry no setup lands on its saved setup, and loads it", () => {
  const runs = [1, 2, 3, 4].map(() => ({ setupSnapshot: { data: TYRE_ONLY } }));
  const saved = [{ id: "knox", setupData: KNOX_CLUB_SPEC }];
  const { previousRuns, savedSetups } = listStates(runs, saved);
  assert.equal(previousRuns, "empty");
  assert.equal(resolve(previousRuns, savedSetups), "other");
  assert.equal(savedSetupToLoad(saved)?.id, "knox");
});

test("runs that carry a setup still come first (the prefill tap carries them)", () => {
  const runs = [{ setupSnapshot: { data: { ...KNOX_CLUB_SPEC, ...TYRE_ONLY } } }];
  const saved = [{ id: "knox", setupData: KNOX_CLUB_SPEC }];
  const { previousRuns, savedSetups } = listStates(runs, saved);
  assert.equal(resolve(previousRuns, savedSetups), "previous_runs");
});

test("an empty saved setup is listed, but never loaded and never a reason to land on Saved", () => {
  const empty = { id: "friday-night", setupData: {} };
  assert.equal(savedSetupToLoad([empty]), null);
  const { previousRuns, savedSetups } = listStates([], [empty]);
  assert.equal(savedSetups, "empty");
  assert.equal(resolve(previousRuns, savedSetups), "new");
});

test("the setup loaded is the car's only one, else its newest with a value in it", () => {
  // The route lists newest first, the car's named setups ahead of its uploaded sheets.
  const newestButEmpty = { id: "friday-night", setupData: {} };
  const newer = { id: "tuesday", setupData: { toe_rear: 2.5 } };
  const older = { id: "base", setupData: { toe_rear: 3 } };
  assert.equal(savedSetupToLoad([older])?.id, "base");
  assert.equal(savedSetupToLoad([newer, older])?.id, "tuesday");
  assert.equal(savedSetupToLoad([newestButEmpty, newer, older])?.id, "tuesday");
  assert.equal(savedSetupToLoad([{ id: "tyre-only", setupData: TYRE_ONLY }, older])?.id, "base");
  assert.equal(savedSetupToLoad([]), null);
});
