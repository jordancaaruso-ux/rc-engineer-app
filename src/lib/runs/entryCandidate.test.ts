/**
 * The Log run card's "Last run · Practice · 4h ago" reads when the car was on track, not when the
 * log was started (test drive 2026-09-26: a run raced on 25 Sep read "4h ago" the next morning).
 *
 *   npx tsx --test src/lib/runs/entryCandidate.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { runOnTrackIso, toEntryCandidate } from "@/lib/runs/entryCandidate";

const raced = new Date("2026-09-25T04:10:00.000Z");
const logged = new Date("2026-09-26T05:00:00.000Z");

test("the session time wins, then the time the run is filed under, then the log", () => {
  assert.equal(
    runOnTrackIso({ createdAt: logged, sessionCompletedAt: raced, sortAt: logged }),
    raced.toISOString()
  );
  assert.equal(runOnTrackIso({ createdAt: logged, sessionCompletedAt: null, sortAt: raced }), raced.toISOString());
  assert.equal(runOnTrackIso({ createdAt: logged }), logged.toISOString());
  // The wizard's copy of the run arrives as JSON, so as strings.
  assert.equal(
    runOnTrackIso({ createdAt: logged.toISOString(), sessionCompletedAt: raced.toISOString() }),
    raced.toISOString()
  );
});

test("the Log run entry candidate carries the on-track time", () => {
  const candidate = toEntryCandidate({
    id: "r1",
    createdAt: logged,
    sessionCompletedAt: raced,
    sortAt: raced,
    carId: "c1",
    trackId: null,
    eventId: null,
    meetingSessionType: null,
    sessionLabel: null,
  });
  assert.equal(candidate?.whenIso, raced.toISOString());
});
