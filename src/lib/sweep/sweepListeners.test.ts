import assert from "node:assert/strict";
import { test } from "node:test";

import { isSweepListenerEmail, parseSweepListenerAllowlist } from "./sweepListeners";

test("unset or blank means everyone listens", () => {
  assert.equal(parseSweepListenerAllowlist(undefined), null);
  assert.equal(parseSweepListenerAllowlist("   "), null);
  assert.equal(isSweepListenerEmail("anyone@example.com", null), true);
  assert.equal(isSweepListenerEmail(null, null), true);
});

test("a list narrows listening to those emails, case-insensitively", () => {
  const allow = parseSweepListenerAllowlist(" Jordan@Example.com, mate@example.com;other@x.io\nnot-an-email ");
  assert.deepEqual([...allow!].sort(), ["jordan@example.com", "mate@example.com", "other@x.io"]);
  assert.equal(isSweepListenerEmail("jordan@example.com", allow), true);
  assert.equal(isSweepListenerEmail("JORDAN@EXAMPLE.COM ", allow), true);
  assert.equal(isSweepListenerEmail("stranger@example.com", allow), false);
  assert.equal(isSweepListenerEmail(null, allow), false);
});

test("a list with no real addresses lets nobody listen", () => {
  const allow = parseSweepListenerAllowlist("nobody");
  assert.equal(allow!.size, 0);
  assert.equal(isSweepListenerEmail("jordan@example.com", allow), false);
});
