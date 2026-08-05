/**
 * Run: node --conditions=react-server --import tsx src/lib/engineerPhase5/comparableRunScore.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveGripTags,
  describeComparability,
  scoreComparability,
  type RunConditions,
} from "@/lib/engineerPhase5/comparableRunScore";

function conditions(o: Partial<RunConditions> = {}): RunConditions {
  return {
    tireTypeId: o.tireTypeId !== undefined ? o.tireTypeId : "tyre-a",
    gripTags: o.gripTags !== undefined ? o.gripTags : ["LOW"],
    layoutTags: o.layoutTags !== undefined ? o.layoutTags : ["TECHNICAL"],
  };
}

test("identical conditions match on every axis", () => {
  const b = scoreComparability(conditions(), conditions());
  assert.deepEqual([b.tyre, b.grip, b.layout], ["same", "same", "same"]);
  assert.equal(b.score, 8);
});

test("grip is ordinal — one notch apart is not the same as miles apart", () => {
  const nearby = scoreComparability(conditions(), conditions({ gripTags: ["MEDIUM"] }));
  const distant = scoreComparability(conditions(), conditions({ gripTags: ["VERY_HIGH"] }));
  assert.equal(nearby.grip, "adjacent");
  assert.equal(distant.grip, "different");
  assert.ok(nearby.score > distant.score, "adjacent grip must beat distant grip");
});

test("layout is ordinal too", () => {
  const nearby = scoreComparability(conditions(), conditions({ layoutTags: ["VERY_TECHNICAL"] }));
  const distant = scoreComparability(conditions(), conditions({ layoutTags: ["VERY_FAST"] }));
  assert.equal(nearby.layout, "adjacent");
  assert.equal(distant.layout, "different");
});

test("a track carrying two tags sits between them", () => {
  // LOW+MEDIUM has mean position 1.5, so LOW (1) is half a notch away.
  const b = scoreComparability(conditions({ gripTags: ["LOW", "MEDIUM"] }), conditions());
  assert.equal(b.grip, "adjacent");
});

test("losing the tyre hurts more than losing the layout", () => {
  const wrongTyre = scoreComparability(conditions(), conditions({ tireTypeId: "tyre-b" }));
  const wrongLayout = scoreComparability(conditions(), conditions({ layoutTags: ["VERY_FAST"] }));
  assert.ok(wrongTyre.score < wrongLayout.score);
});

test("tyre and grip alone must not score as a full match", () => {
  const full = scoreComparability(conditions(), conditions());
  const noLayout = scoreComparability(conditions(), conditions({ layoutTags: ["VERY_FAST"] }));
  assert.ok(noLayout.score < full.score, "founder: tyre+grip alone earns only a little");
  assert.equal(noLayout.score, 6);
});

test("missing tags read as unknown, never as a mismatch", () => {
  const b = scoreComparability(conditions(), conditions({ gripTags: [], tireTypeId: null }));
  assert.equal(b.grip, "unknown");
  assert.equal(b.tyre, "unknown");
  assert.equal(b.score, 2, "only the layout axis should contribute");
});

test("unrecognised tags are not treated as a mismatch", () => {
  const b = scoreComparability(conditions(), conditions({ gripTags: ["NOT_A_REAL_TAG"] }));
  assert.equal(b.grip, "unknown");
});

test("description reads as an engineer would say it", () => {
  const b = scoreComparability(conditions(), conditions());
  assert.equal(describeComparability(b), "same tyre, same grip level, same layout style");
});

test("description carries the gradient, not just match or miss", () => {
  const b = scoreComparability(conditions(), conditions({ gripTags: ["MEDIUM"] }));
  assert.equal(
    describeComparability(b),
    "same tyre, grip one notch away, same layout style"
  );
});

test("description names what was not recorded rather than hiding it", () => {
  const b = scoreComparability(conditions(), conditions({ gripTags: [] }));
  assert.equal(describeComparability(b), "same tyre, same layout style; grip not recorded");
});

test("description degrades honestly when there is nothing to compare on", () => {
  const bare: RunConditions = { tireTypeId: null, gripTags: [], layoutTags: [] };
  assert.equal(
    describeComparability(scoreComparability(bare, bare)),
    "nothing recorded to compare conditions on"
  );
});

/**
 * Per-run grip level, added 2026-08-04. Before it existed, grip was read off the Track, so
 * every run at a venue scored a perfect grip match against every other run there and the
 * axis carried no information within a track.
 */

test("a run's own grip level wins over the track's general tags", () => {
  const tags = resolveGripTags("HIGH", ["LOW", "MEDIUM"]);
  assert.deepEqual(tags, ["HIGH"]);
});

test("the track's tags are the fallback when the run has no level", () => {
  assert.deepEqual(resolveGripTags(null, ["LOW"]), ["LOW"]);
  assert.deepEqual(resolveGripTags("   ", ["LOW"]), ["LOW"]);
  assert.deepEqual(resolveGripTags(undefined, ["LOW"]), ["LOW"]);
});

test("no level and no track tags is unknown, not a guess", () => {
  assert.equal(resolveGripTags(null, null), null);
  assert.equal(
    scoreComparability(
      { tireTypeId: "t", gripTags: resolveGripTags(null, null), layoutTags: ["TECHNICAL"] },
      { tireTypeId: "t", gripTags: resolveGripTags(null, null), layoutTags: ["TECHNICAL"] }
    ).grip,
    "unknown"
  );
});

test("two sessions at ONE track can now differ on grip", () => {
  const track = ["MEDIUM"];
  const morning = { tireTypeId: "t", gripTags: resolveGripTags("LOW", track), layoutTags: ["TECHNICAL"] };
  const afternoon = { tireTypeId: "t", gripTags: resolveGripTags("HIGH", track), layoutTags: ["TECHNICAL"] };

  assert.equal(scoreComparability(morning, afternoon).grip, "different");
  // The old behaviour, for contrast: both read the track and matched perfectly.
  const oldMorning = { ...morning, gripTags: track };
  const oldAfternoon = { ...afternoon, gripTags: track };
  assert.equal(scoreComparability(oldMorning, oldAfternoon).grip, "same");
});

test("a session one notch off the venue's usual grip reads as adjacent", () => {
  const a = { tireTypeId: "t", gripTags: resolveGripTags("MEDIUM", ["MEDIUM"]), layoutTags: ["TECHNICAL"] };
  const b = { tireTypeId: "t", gripTags: resolveGripTags("LOW", ["MEDIUM"]), layoutTags: ["TECHNICAL"] };
  assert.equal(scoreComparability(a, b).grip, "adjacent");
});
