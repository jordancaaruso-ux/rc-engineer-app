import assert from "node:assert/strict";
import test from "node:test";
import {
  STOCK_INSERT,
  TIRE_FITMENT_MODS_MAX,
  TIRE_FITMENT_NAME_MAX,
  formatTireFitmentEnd,
  normalizeTireFitment,
  recentFitmentValues,
  tireFitmentHasContent,
  withTireFitmentEnd,
} from "./tireFitment";

test("text is trimmed, squeezed and capped", () => {
  const out = normalizeTireFitment({
    rear: { insert: "  Dirt-Tech   closed  cell ", wheel: "x".repeat(200), mods: "m".repeat(500) },
  });
  assert.equal(out?.rear?.insert, "Dirt-Tech closed cell");
  assert.equal(out?.rear?.wheel?.length, TIRE_FITMENT_NAME_MAX);
  assert.equal(out?.rear?.mods?.length, TIRE_FITMENT_MODS_MAX);
});

test("an empty end is dropped and an empty value is null — never a hollow object", () => {
  assert.equal(normalizeTireFitment(null), null);
  assert.equal(normalizeTireFitment({}), null);
  assert.equal(normalizeTireFitment([]), null);
  assert.equal(normalizeTireFitment("Stock"), null);
  assert.equal(normalizeTireFitment({ front: { insert: "  ", wheel: "", mods: null } }), null);
  assert.deepEqual(
    normalizeTireFitment({ front: { insert: "" }, rear: { wheel: "Mono" } }),
    { rear: { insert: null, wheel: "Mono", mods: null } }
  );
});

test("anything that is not text is ignored, not stringified", () => {
  assert.equal(normalizeTireFitment({ rear: { insert: 12, wheel: { a: 1 }, mods: true } }), null);
});

test("there are no vent-hole number fields — holes are words in the one box", () => {
  // Founder ruling 2026-09-19. A stale client sending the rejected shape loses those keys.
  const out = normalizeTireFitment({
    rear: { insert: "Stock", holeMm: 2.5, holeCount: 3, mods: "3 extra holes, trimmed insert" },
  });
  assert.deepEqual(out, {
    rear: { insert: "Stock", wheel: null, mods: "3 extra holes, trimmed insert" },
  });
});

test("setting one end keeps the other; clearing an end's last value drops it", () => {
  const start = { front: { insert: "Stock", wheel: null, mods: null } };
  const both = withTireFitmentEnd(start, "rear", { insert: null, wheel: "Mono", mods: null });
  assert.deepEqual(both, {
    front: { insert: "Stock", wheel: null, mods: null },
    rear: { insert: null, wheel: "Mono", mods: null },
  });
  const cleared = withTireFitmentEnd(both, "front", { insert: null, wheel: null, mods: null });
  assert.deepEqual(cleared, { rear: { insert: null, wheel: "Mono", mods: null } });
  assert.equal(tireFitmentHasContent(withTireFitmentEnd(cleared, "rear", null)), false);
});

test("an end reads as words, without doubling a noun the driver already typed", () => {
  assert.equal(
    formatTireFitmentEnd({ insert: "Stock", wheel: "Mono", mods: "3 extra holes" }),
    "Stock insert · Mono wheel · 3 extra holes"
  );
  assert.equal(
    formatTireFitmentEnd({ insert: "AKA red inserts", wheel: "JC Mono Wheel", mods: null }),
    "AKA red inserts · JC Mono Wheel"
  );
  assert.equal(formatTireFitmentEnd({ insert: null, wheel: null, mods: null }), null);
  assert.equal(formatTireFitmentEnd(null), null);
});

test("the own list is newest first, one spelling per thing, across both ends", () => {
  const rows = [
    { rear: { insert: "Dirt-Tech", wheel: "Mono" }, front: { insert: "dirt-tech", wheel: "Slim" } },
    { rear: { insert: "AKA Red", wheel: "mono" } },
    null,
    "junk",
    { front: { insert: "Dirt-Tech", mods: "trimmed" } },
  ];
  assert.deepEqual(recentFitmentValues(rows), {
    inserts: ["Dirt-Tech", "AKA Red"],
    wheels: ["Mono", "Slim"],
  });
});

test("Stock is always offered, so it never takes a slot in the recents", () => {
  const rows = [{ rear: { insert: STOCK_INSERT } }, { rear: { insert: "stock" } }, { rear: { insert: "Medium" } }];
  assert.deepEqual(recentFitmentValues(rows).inserts, ["Medium"]);
});

test("the own list stops at its limit", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ rear: { insert: `Insert ${i}`, wheel: `Wheel ${i}` } }));
  const out = recentFitmentValues(rows, 3);
  assert.deepEqual(out.inserts, ["Insert 0", "Insert 1", "Insert 2"]);
  assert.deepEqual(out.wheels, ["Wheel 0", "Wheel 1", "Wheel 2"]);
});
