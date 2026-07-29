import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRunAnchorCandidate,
  distinctCandidateCars,
  filterCandidates,
  mergeAndSortCandidates,
  type AnchorCandidate,
} from "./anchorCandidates";

function runRow(over: Record<string, unknown> = {}) {
  return {
    id: "clx0run0aaaaaaaaaaaaaaa",
    createdAt: "2026-07-25T02:00:00.000Z",
    sortAt: "2026-07-25T02:00:00.000Z",
    sessionType: "RACE_MEETING",
    meetingSessionType: "QUALIFYING",
    meetingSessionCode: null,
    sessionLabel: "Q2",
    carId: "car_x4",
    carNameSnapshot: "Xray X4",
    trackNameSnapshot: "Keilor",
    bestLapSeconds: 14.203,
    ...over,
  } as Parameters<typeof buildRunAnchorCandidate>[0];
}

function candidate(over: Partial<AnchorCandidate> = {}): AnchorCandidate {
  return {
    kind: "run",
    id: "id",
    label: "label",
    sublabel: null,
    chipLabel: "chip",
    carId: null,
    carName: null,
    sortIso: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

test("run candidate carries car identity in the chip label", () => {
  const c = buildRunAnchorCandidate(runRow());
  assert.equal(c.kind, "run");
  assert.ok(c.chipLabel.includes("Xray X4"), c.chipLabel);
  // Session segment follows picker convention: the sessionLabel wins over the type word.
  assert.ok(c.label.includes("Q2"), c.label);
  assert.ok(c.sublabel?.includes("Keilor"), c.sublabel ?? "");
  assert.ok(c.sublabel?.includes("14.203"), c.sublabel ?? "");
});

test("run candidate survives missing car/track/lap data", () => {
  const c = buildRunAnchorCandidate(
    runRow({ carNameSnapshot: null, trackNameSnapshot: null, bestLapSeconds: null, carId: null })
  );
  assert.equal(c.carName, null);
  assert.equal(c.sublabel, null);
  assert.ok(c.chipLabel.length > 0);
});

test("mergeAndSortCandidates orders newest first across kinds and caps", () => {
  const a = candidate({ id: "a", sortIso: "2026-07-01T00:00:00.000Z" });
  const b = candidate({ id: "b", kind: "setup", sortIso: "2026-07-03T00:00:00.000Z" });
  const c = candidate({ id: "c", kind: "event", sortIso: "2026-07-02T00:00:00.000Z" });
  const merged = mergeAndSortCandidates([[a], [b, c]]);
  assert.deepEqual(merged.map((x) => x.id), ["b", "c", "a"]);
  assert.equal(mergeAndSortCandidates([[a, b, c]], 2).length, 2);
});

test("filterCandidates matches label, sublabel and car name, case-insensitive", () => {
  const items = [
    candidate({ id: "1", label: "Today · Q2", sublabel: "Keilor — 14.203", carName: "Xray X4" }),
    candidate({ id: "2", label: "Yesterday · Practice", sublabel: "Hobart", carName: "Awesomatix" }),
  ];
  assert.deepEqual(filterCandidates(items, "keilor").map((c) => c.id), ["1"]);
  assert.deepEqual(filterCandidates(items, "AWESO").map((c) => c.id), ["2"]);
  assert.equal(filterCandidates(items, "").length, 2);
  assert.equal(filterCandidates(items, "zzz").length, 0);
});

test("distinctCandidateCars dedupes and skips unnamed cars", () => {
  const cars = distinctCandidateCars([
    candidate({ carId: "a", carName: "X4" }),
    candidate({ carId: "a", carName: "X4" }),
    candidate({ carId: "b", carName: "Mi9" }),
    candidate({ carId: null, carName: "ghost" }),
  ]);
  assert.deepEqual(cars, [
    { carId: "a", carName: "X4" },
    { carId: "b", carName: "Mi9" },
  ]);
});
