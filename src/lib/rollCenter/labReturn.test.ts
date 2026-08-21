import test from "node:test";
import assert from "node:assert/strict";

import {
  LAB_DEFAULT_BACK,
  labBackQuery,
  safeLabBackHref,
} from "@/lib/rollCenter/labReturn";

test("safeLabBackHref keeps any same-origin app path", () => {
  assert.equal(safeLabBackHref("/runs/abc123"), "/runs/abc123");
  assert.equal(safeLabBackHref("/tools"), "/tools");
  // Hyphens are ordinary in these paths — the control-character guard must not eat them.
  assert.equal(safeLabBackHref("/analysis/roll-center"), "/analysis/roll-center");
  assert.equal(safeLabBackHref("/setup/comparison?a=1&b=2"), "/setup/comparison?a=1&b=2");
});

test("safeLabBackHref refuses anything that could leave the app", () => {
  assert.equal(safeLabBackHref("https://evil.example/x"), LAB_DEFAULT_BACK);
  assert.equal(safeLabBackHref("//evil.example/x"), LAB_DEFAULT_BACK);
  assert.equal(safeLabBackHref("javascript:alert(1)"), LAB_DEFAULT_BACK);
  assert.equal(safeLabBackHref("runs/abc"), LAB_DEFAULT_BACK);
  assert.equal(safeLabBackHref("/runs/a\nb"), LAB_DEFAULT_BACK);
  assert.equal(safeLabBackHref(undefined), LAB_DEFAULT_BACK);
  assert.equal(safeLabBackHref(["/runs/abc", "/x"]), "/runs/abc");
});

test("labBackQuery stays silent for the default and for anything it would refuse", () => {
  assert.equal(labBackQuery("/runs/abc"), "&back=%2Fruns%2Fabc");
  // Tools is where an unattributed arrival lands anyway — saying so twice only lengthens the URL.
  assert.equal(labBackQuery(LAB_DEFAULT_BACK), "");
  assert.equal(labBackQuery(null), "");
  assert.equal(labBackQuery(""), "");
  assert.equal(labBackQuery("https://evil.example"), "");
});
