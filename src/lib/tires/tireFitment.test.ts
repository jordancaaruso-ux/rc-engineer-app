import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_TIRE_FITMENT_END,
  STOCK_INSERT,
  TIRE_FITMENT_MODS_MAX,
  TIRE_FITMENT_NAME_MAX,
  formatTireDiameterMm,
  formatTireFitmentEnd,
  normalizeTireFitment,
  parseTireDiameterMm,
  recentFitmentValues,
  tireEndBoxesToShow,
  tireFitmentEndHasContent,
  tireFitmentHasContent,
  withTireFitmentEnd,
  type TireFitmentEnd,
} from "./tireFitment";

const end = (over: Partial<TireFitmentEnd>): TireFitmentEnd => ({ ...EMPTY_TIRE_FITMENT_END, ...over });

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
    { rear: end({ wheel: "Mono" }) }
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
    rear: end({ insert: "Stock", mods: "3 extra holes, trimmed insert" }),
  });
});

test("a diameter reads what a driver types: a decimal point or comma, with or without mm", () => {
  assert.equal(parseTireDiameterMm("42.5"), 42.5);
  assert.equal(parseTireDiameterMm("42,5"), 42.5);
  assert.equal(parseTireDiameterMm(" 42.5 mm "), 42.5);
  assert.equal(parseTireDiameterMm("42."), 42);
  assert.equal(parseTireDiameterMm(41), 41);
  // A caliper reads to 0.01 mm; more than that is noise.
  assert.equal(parseTireDiameterMm(42.567), 42.57);
});

test("a diameter that can't be a mounted tire is dropped, not stored", () => {
  for (const raw of ["", "  ", "4", "300", "1.65", "abc", "42.5.1", "-42", null, undefined, true, {}]) {
    assert.equal(parseTireDiameterMm(raw), null, String(raw));
  }
});

test("an end with only a diameter is kept, and reads as words", () => {
  const out = normalizeTireFitment({ front: { diameterMm: "40.5" }, rear: { diameterMm: 43 } });
  assert.deepEqual(out, { front: end({ diameterMm: 40.5 }), rear: end({ diameterMm: 43 }) });
  assert.equal(tireFitmentEndHasContent(out?.front), true);
  assert.equal(formatTireFitmentEnd(out?.front), "40.5 mm diameter");
  assert.equal(
    formatTireFitmentEnd(end({ diameterMm: 42.25, mods: "side walls glued" })),
    "42.25 mm diameter · side walls glued"
  );
  assert.equal(formatTireDiameterMm(42), "42");
});

test("setting one end keeps the other; clearing an end's last value drops it", () => {
  const start = { front: end({ insert: "Stock" }) };
  const both = withTireFitmentEnd(start, "rear", end({ wheel: "Mono" }));
  assert.deepEqual(both, {
    front: end({ insert: "Stock" }),
    rear: end({ wheel: "Mono" }),
  });
  const cleared = withTireFitmentEnd(both, "front", end({}));
  assert.deepEqual(cleared, { rear: end({ wheel: "Mono" }) });
  assert.equal(tireFitmentHasContent(withTireFitmentEnd(cleared, "rear", null)), false);
});

test("an end reads as words, without doubling a noun the driver already typed", () => {
  assert.equal(
    formatTireFitmentEnd(end({ insert: "Stock", wheel: "Mono", mods: "3 extra holes" })),
    "Stock insert · Mono wheel · 3 extra holes"
  );
  assert.equal(
    formatTireFitmentEnd(end({ insert: "AKA red inserts", wheel: "JC Mono Wheel" })),
    "AKA red inserts · JC Mono Wheel"
  );
  assert.equal(formatTireFitmentEnd(end({})), null);
  assert.equal(formatTireFitmentEnd(null), null);
});

test("the boxes shown are the class's own, plus any that already hold a value", () => {
  // A pan car asks for diameter and modifications only.
  assert.deepEqual(tireEndBoxesToShow(["diameter", "mods"], {}), ["diameter", "mods"]);
  // Off-road keeps its order: insert, wheel, then modifications.
  assert.deepEqual(tireEndBoxesToShow(["mods", "wheel", "insert"], null), ["insert", "wheel", "mods"]);
  // A run that logged an insert keeps showing it, whatever its car races now.
  assert.deepEqual(
    tireEndBoxesToShow(["diameter", "mods"], { rear: end({ insert: "Stock" }) }),
    ["insert", "diameter", "mods"]
  );
  assert.deepEqual(tireEndBoxesToShow([], { front: end({ diameterMm: 40 }) }), ["diameter"]);
  assert.deepEqual(tireEndBoxesToShow([], {}), []);
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
