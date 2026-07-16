import assert from "node:assert/strict";
import test from "node:test";
import { resolveAutoCopy, type CandidateRun } from "./autoCopyResolver";

const run = (over: Partial<CandidateRun>): CandidateRun => ({
  id: "r1",
  trackId: "track-scr",
  eventId: null,
  ...over,
});

test("same track (any day) → continue", () => {
  const d = resolveAutoCopy(run({ trackId: "track-scr", eventId: null }), { trackId: "track-scr", eventId: null });
  assert.equal(d.continueFromLast, true);
  assert.equal(d.reason, "same-track");
});

test("same event, different day → continue (weekend day 2)", () => {
  const d = resolveAutoCopy(
    run({ trackId: "track-scr", eventId: "evt-winter-r3" }),
    { trackId: "track-scr", eventId: "evt-winter-r3" },
  );
  assert.equal(d.continueFromLast, true);
});

test("same event but track record null → still continue via event", () => {
  const d = resolveAutoCopy(
    run({ trackId: "track-other", eventId: "evt-x" }),
    { trackId: "track-scr", eventId: "evt-x" },
  );
  assert.equal(d.continueFromLast, true);
  assert.equal(d.reason, "same-event");
});

test("different track + no event → fresh, offer manual copy", () => {
  const d = resolveAutoCopy(
    run({ trackId: "track-pemberton", eventId: null }),
    { trackId: "track-scr", eventId: null },
  );
  assert.equal(d.continueFromLast, false);
  assert.equal(d.reason, "different-context");
  assert.equal(d.offerManualCopy, true);
});

test("no prior run for this car → fresh, no manual copy", () => {
  const d = resolveAutoCopy(null, { trackId: "track-scr", eventId: null });
  assert.equal(d.continueFromLast, false);
  assert.equal(d.reason, "no-prior-run");
  assert.equal(d.offerManualCopy, false);
});

test("null trackIds do not falsely match", () => {
  const d = resolveAutoCopy(run({ trackId: null, eventId: null }), { trackId: null, eventId: null });
  assert.equal(d.continueFromLast, false, "two null tracks must not count as the same track");
});
