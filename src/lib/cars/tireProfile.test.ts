import assert from "node:assert/strict";
import test from "node:test";
import { POWER_TYPES, RACE_CLASSES } from "./carClasses";
import {
  NO_TIRE_PROFILE,
  TIRE_BUCKETS,
  hasTireProfileEntry,
  tireProfileForDiscipline,
} from "./tireProfile";

/** Every class the picker offers, in both powers — what a car can actually store. */
const EVERY_DISCIPLINE = RACE_CLASSES.flatMap((cls) =>
  POWER_TYPES.map((power) => ({ cls, discipline: `${cls.id}~${power.id}` }))
);

test("every class the picker offers has decided what its tires look like", () => {
  // A class added to RACE_CLASSES without a row here would fall through to "whole list" and
  // nobody would notice until a driver of that class opened the picker.
  for (const cls of RACE_CLASSES) {
    assert.ok(hasTireProfileEntry(cls.id), `no tire profile for class "${cls.id}"`);
  }
});

test("electric touring shops the touring list and keeps the single-tire form", () => {
  assert.deepEqual(tireProfileForDiscipline("touring~electric"), {
    bucket: "touring",
    split: false,
    boxes: [],
    frontRearSwitch: true,
    foldPrep: false,
  });
  assert.equal(tireProfileForDiscipline("fwd~electric").bucket, "touring");
  assert.equal(tireProfileForDiscipline("fwd~electric").split, false);
  // A legacy bare id, written before power was asked for, still places the car.
  assert.deepEqual(tireProfileForDiscipline("touring"), tireProfileForDiscipline("touring~electric"));
});

test("nitro touring runs foam: front and rear, each with its diameter, over the whole list", () => {
  // Founder call 2026-09-25 on the Infinity IF15II: "one-tenth nitro uses foam tires".
  assert.deepEqual(tireProfileForDiscipline("touring~nitro"), {
    bucket: null,
    split: true,
    boxes: ["diameter", "mods"],
    frontRearSwitch: false,
    foldPrep: false,
  });
  assert.deepEqual(tireProfileForDiscipline("touring~nitro"), tireProfileForDiscipline("pan-12th~electric"));
});

test("1/10 off-road shops the off-road list and logs front and rear with insert and wheel", () => {
  for (const d of [
    "buggy-2wd~electric",
    "buggy-4wd~electric",
    "stadium-truck~electric",
    "short-course~electric",
    "truggy-10th~electric",
  ]) {
    assert.deepEqual(
      tireProfileForDiscipline(d),
      { bucket: "offroad-10th", split: true, boxes: ["insert", "wheel", "mods"], frontRearSwitch: false, foldPrep: true },
      d
    );
  }
});

test("power changes the tires on a touring car only", () => {
  for (const cls of RACE_CLASSES) {
    const electric = tireProfileForDiscipline(`${cls.id}~electric`);
    const nitro = tireProfileForDiscipline(`${cls.id}~nitro`);
    if (cls.id === "touring") assert.notDeepEqual(nitro, electric);
    else assert.deepEqual(nitro, electric, cls.id);
  }
});

test("1/8 off-road gets the off-road step but no filter — nothing is imported for it yet", () => {
  for (const d of ["buggy-8th-4wd~nitro", "buggy-8th-2wd~electric", "truggy-8th~nitro", "other-offroad~electric~Monster"]) {
    assert.deepEqual(
      tireProfileForDiscipline(d),
      { bucket: null, split: true, boxes: ["insert", "wheel", "mods"], frontRearSwitch: false, foldPrep: true },
      d
    );
  }
  // Retired ids a pre-2026-09-03 row can still hold.
  assert.equal(tireProfileForDiscipline("buggy-8th").split, true);
  assert.equal(tireProfileForDiscipline("truggy").split, true);
});

test("pan cars, formula and 1/8 on-road log front and rear, each with its diameter", () => {
  // Founder call 2026-09-25: the boxes their own setup sheets ask for.
  for (const d of ["pan-12th~electric", "pan-10th~electric", "pan-8th~nitro", "formula~electric", "gt-8th~nitro"]) {
    assert.deepEqual(
      tireProfileForDiscipline(d),
      { bucket: null, split: true, boxes: ["diameter", "mods"], frontRearSwitch: false, foldPrep: false },
      d
    );
  }
});

test("1/5 GT logs front and rear with Modifications — no sheet to read yet", () => {
  assert.deepEqual(tireProfileForDiscipline("gt-5th~nitro"), {
    bucket: null,
    split: true,
    boxes: ["mods"],
    frontRearSwitch: false,
    foldPrep: false,
  });
});

test("a named other on-road class keeps today's one-tire form", () => {
  assert.deepEqual(tireProfileForDiscipline("other-onroad~electric~Legends"), NO_TIRE_PROFILE);
});

test("a car nothing can place keeps today's form and sees everything", () => {
  assert.deepEqual(tireProfileForDiscipline(null), NO_TIRE_PROFILE);
  assert.deepEqual(tireProfileForDiscipline(""), NO_TIRE_PROFILE);
  assert.deepEqual(tireProfileForDiscipline("   "), NO_TIRE_PROFILE);
  assert.deepEqual(tireProfileForDiscipline("hovercraft~electric"), NO_TIRE_PROFILE);
});

test("every front/rear class names at least one box, and a one-tire class names none", () => {
  for (const { discipline } of EVERY_DISCIPLINE) {
    const p = tireProfileForDiscipline(discipline);
    if (p.split) assert.ok(p.boxes.length > 0, discipline);
    else assert.equal(p.boxes.length, 0, discipline);
  }
});

test("electric touring and FWD offer the front/rear switch; a class that always splits never does", () => {
  // Founder "Yes", 2026-09-25.
  assert.equal(tireProfileForDiscipline("touring~electric").frontRearSwitch, true);
  assert.equal(tireProfileForDiscipline("fwd~electric").frontRearSwitch, true);
  for (const { discipline } of EVERY_DISCIPLINE) {
    const p = tireProfileForDiscipline(discipline);
    assert.ok(!(p.split && p.frontRearSwitch), discipline);
  }
});

test("tire prep starts folded on off-road only", () => {
  // Founder "Yes", 2026-09-25: off-road sheets almost never ask for additive; on-road nearly all do.
  for (const { cls, discipline } of EVERY_DISCIPLINE) {
    assert.equal(tireProfileForDiscipline(discipline).foldPrep, cls.surface === "offroad", discipline);
  }
});

test("every bucket a profile can name is one the catalog holds", () => {
  for (const { discipline } of EVERY_DISCIPLINE) {
    const { bucket } = tireProfileForDiscipline(discipline);
    if (bucket != null) assert.ok((TIRE_BUCKETS as readonly string[]).includes(bucket));
  }
});
