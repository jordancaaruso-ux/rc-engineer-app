import test from "node:test";
import assert from "node:assert/strict";

import {
  safeSetupEditorBackHref,
  setupEditorBackQuery,
} from "@/lib/setup/setupEditorReturn";

const CAR = "/cars/car_123";

test("a same-origin app path is kept", () => {
  assert.equal(safeSetupEditorBackHref("/runs/run_abc", CAR), "/runs/run_abc");
  assert.equal(safeSetupEditorBackHref("/runs/history?open=day-3", CAR), "/runs/history?open=day-3");
  // Hyphens are ordinary in these paths and must survive the control-character guard.
  assert.equal(safeSetupEditorBackHref("/analysis/roll-center", CAR), "/analysis/roll-center");
});

test("anything that could leave the app falls back", () => {
  assert.equal(safeSetupEditorBackHref("https://evil.example/x", CAR), CAR);
  assert.equal(safeSetupEditorBackHref("//evil.example/x", CAR), CAR);
  assert.equal(safeSetupEditorBackHref("javascript:alert(1)", CAR), CAR);
  assert.equal(safeSetupEditorBackHref("runs/abc", CAR), CAR);
  assert.equal(safeSetupEditorBackHref(undefined, CAR), CAR);
  assert.equal(safeSetupEditorBackHref("", CAR), CAR);
  assert.equal(safeSetupEditorBackHref("/runs/a b", CAR), CAR);
  assert.equal(safeSetupEditorBackHref("/x".repeat(400), CAR), CAR);
});

test("a repeated param takes the first value", () => {
  assert.equal(safeSetupEditorBackHref(["/runs/one", "/runs/two"], CAR), "/runs/one");
});

test("the query tail is encoded, and empty when there is nothing to say", () => {
  assert.equal(setupEditorBackQuery("/runs/run_abc"), "&back=%2Fruns%2Frun_abc");
  assert.equal(setupEditorBackQuery(null), "");
  assert.equal(setupEditorBackQuery(undefined), "");
  assert.equal(setupEditorBackQuery("https://evil.example"), "");
});
