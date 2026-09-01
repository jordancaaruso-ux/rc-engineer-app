import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  setupSnapshotHasValues,
  unfinishedRunToCarrySetupFrom,
  type SetupCarryRun,
} from "./prefillSetupSource";

const run = (
  id: string,
  loggingComplete: boolean,
  data: unknown = { toe_rear: "2.4" }
): SetupCarryRun => ({ id, loggingComplete, setupSnapshot: { id: `snap-${id}`, data } });

test("a draft in front of the last completed run carries its setup", () => {
  const completed = run("older", true, { toe_rear: "3" });
  const newest = run("draft", false, { toe_rear: "2.4" });
  assert.equal(unfinishedRunToCarrySetupFrom({ completed, newest })?.id, "draft");
});

test("nothing to decide when the newest run IS the completed one", () => {
  const only = run("only", true);
  assert.equal(unfinishedRunToCarrySetupFrom({ completed: only, newest: only }), null);
});

test("a completed run in front is left to the caller — it is already the source", () => {
  assert.equal(
    unfinishedRunToCarrySetupFrom({ completed: run("a", true), newest: run("b", true) }),
    null
  );
});

test("a draft with an EMPTY setup loses to the completed run behind it", () => {
  // Start-blank-then-abandon. Carrying this would wipe the sheet the driver races.
  const completed = run("older", true, { toe_rear: "3", camber_front: "-1.5" });
  assert.equal(unfinishedRunToCarrySetupFrom({ completed, newest: run("draft", false, {}) }), null);
  assert.equal(
    unfinishedRunToCarrySetupFrom({ completed, newest: run("draft", false, { toe_rear: "", spring_front: null }) }),
    null
  );
});

test("no runs, or no completed run, is not this rule's business", () => {
  assert.equal(unfinishedRunToCarrySetupFrom({ completed: null, newest: null }), null);
  assert.equal(unfinishedRunToCarrySetupFrom({ completed: null, newest: run("draft", false) }), null);
  assert.equal(unfinishedRunToCarrySetupFrom({ completed: run("a", true), newest: null }), null);
});

test("a draft with no setup snapshot at all carries nothing", () => {
  const newest: SetupCarryRun = { id: "draft", loggingComplete: false, setupSnapshot: null };
  assert.equal(unfinishedRunToCarrySetupFrom({ completed: run("a", true), newest }), null);
});

test("setupSnapshotHasValues reads the shapes a stored setup actually uses", () => {
  assert.equal(setupSnapshotHasValues({ toe_rear: "2.4" }), true);
  assert.equal(setupSnapshotHasValues({ ride_height: 5 }), true);
  // 0 is a value — a zeroed box is a measurement, not a blank.
  assert.equal(setupSnapshotHasValues({ downstop_front: 0 }), true);
  assert.equal(setupSnapshotHasValues({ diff_type: false }), true);
  // Grouped rows arrive as arrays, preset-with-other rows as objects.
  assert.equal(setupSnapshotHasValues({ top_deck_screws: ["", ""] }), false);
  assert.equal(setupSnapshotHasValues({ top_deck_screws: ["", "P1"] }), true);
  assert.equal(setupSnapshotHasValues({ spring_front: { preset: "", other: "" } }), false);
  assert.equal(setupSnapshotHasValues({ spring_front: { preset: "STD", other: "" } }), true);
  // A cleared box stores "" as a deletion marker — the absence of a value.
  assert.equal(setupSnapshotHasValues({ toe_rear: "", camber_front: "   " }), false);
  assert.equal(setupSnapshotHasValues({}), false);
  assert.equal(setupSnapshotHasValues(null), false);
  assert.equal(setupSnapshotHasValues("nonsense"), false);
});
