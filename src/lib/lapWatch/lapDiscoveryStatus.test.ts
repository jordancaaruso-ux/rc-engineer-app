import test from "node:test";
import assert from "node:assert/strict";

import {
  emptyLapDiscoveryStatus,
  lapDiscoveryStatusMessage,
  mergeLapDiscoveryStatuses,
  type LapDiscoveryStatus,
} from "@/lib/lapWatch/lapDiscoveryStatus";

function status(partial: Partial<LapDiscoveryStatus> & Pick<LapDiscoveryStatus, "code">): LapDiscoveryStatus {
  return {
    sources: ["liverc"],
    postedCount: 0,
    matchedCount: 0,
    timingPages: [],
    sessionsToday: [],
    ...partial,
  };
}

test("merge: the state a driver can act on wins", () => {
  // The bug this exists for: a track carrying both sites reported whichever ran first, so a name
  // typo at a LiveRC track that had posted all day read as "MYLAPS has nothing".
  const merged = mergeLapDiscoveryStatuses([
    status({ code: "nothing_posted", sources: ["speedhive"] }),
    status({ code: "no_match", sources: ["liverc"], postedCount: 14 }),
  ]);
  assert.equal(merged?.code, "no_match");
});

test("merge: counts and doors come from every source, not just the winner", () => {
  const merged = mergeLapDiscoveryStatuses([
    status({
      code: "no_match",
      sources: ["liverc"],
      postedCount: 14,
      timingPages: [{ source: "liverc", url: "https://liverc.com/x" }],
    }),
    status({
      code: "no_match",
      sources: ["speedhive"],
      postedCount: 9,
      timingPages: [{ source: "speedhive", url: "https://speedhive.mylaps.com/practice/1" }],
    }),
  ]);
  assert.equal(merged?.postedCount, 23);
  assert.deepEqual(merged?.sources, ["liverc", "speedhive"]);
  assert.equal(merged?.timingPages.length, 2);
});

test("merge: nothing to merge stays null", () => {
  assert.equal(mergeLapDiscoveryStatuses([null, undefined]), null);
});

test("merge: a single status passes through untouched", () => {
  const only = status({ code: "unreachable", sources: ["speedhive"] });
  assert.equal(mergeLapDiscoveryStatuses([only, null]), only);
});

test("message: no_match counts what was posted, never names other drivers", () => {
  const msg = lapDiscoveryStatusMessage(status({ code: "no_match", postedCount: 14 }));
  assert.match(msg, /14 sessions posted/);
  assert.doesNotMatch(msg, /Settings →/);
});

test("message: an empty track is never blamed on your name", () => {
  const msg = lapDiscoveryStatusMessage(status({ code: "nothing_posted" }));
  assert.doesNotMatch(msg, /name|transponder/i);
});

test("empty status carries the source it speaks for", () => {
  const s = emptyLapDiscoveryStatus("unreachable", "speedhive");
  assert.deepEqual(s.sources, ["speedhive"]);
  assert.match(lapDiscoveryStatusMessage(s), /MYLAPS/);
});
