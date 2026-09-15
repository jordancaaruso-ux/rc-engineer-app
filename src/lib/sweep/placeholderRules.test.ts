import test from "node:test";
import assert from "node:assert/strict";
import { isDissolvable, sessionBlockIsClosed, SESSION_QUIET_MS } from "./placeholderRules";

test("only an unconfirmed run may dissolve", () => {
  assert.equal(isDissolvable({ unconfirmedAt: new Date() }), true);
  assert.equal(isDissolvable({ unconfirmedAt: null }), false);
});

test("an older block is closed whatever its clock says", () => {
  const now = new Date("2026-09-19T10:00:00Z");
  assert.equal(sessionBlockIsClosed({ lastLapAt: now, isNewest: false }, now), true);
});

test("the newest block waits for four quiet minutes", () => {
  const now = new Date("2026-09-19T10:00:00Z");
  const recent = new Date(now.getTime() - SESSION_QUIET_MS + 1000);
  const old = new Date(now.getTime() - SESSION_QUIET_MS);
  assert.equal(sessionBlockIsClosed({ lastLapAt: recent, isNewest: true }, now), false);
  assert.equal(sessionBlockIsClosed({ lastLapAt: old, isNewest: true }, now), true);
});

test("a block with no clock is filed rather than held forever", () => {
  const now = new Date("2026-09-19T10:00:00Z");
  assert.equal(sessionBlockIsClosed({ lastLapAt: null, isNewest: true }, now), true);
});
