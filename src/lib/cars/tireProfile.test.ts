import assert from "node:assert/strict";
import test from "node:test";
import { RACE_CLASSES } from "./carClasses";
import {
  NO_TIRE_PROFILE,
  TIRE_BUCKETS,
  hasTireProfileEntry,
  tireProfileForDiscipline,
} from "./tireProfile";

test("every class the picker offers has decided what its tires look like", () => {
  // A class added to RACE_CLASSES without a row here would fall through to "whole list" and
  // nobody would notice until a driver of that class opened the picker.
  for (const cls of RACE_CLASSES) {
    assert.ok(hasTireProfileEntry(cls.id), `no tire profile for class "${cls.id}"`);
  }
});

test("touring shops the touring list and keeps the single-tire form", () => {
  assert.deepEqual(tireProfileForDiscipline("touring~electric"), {
    bucket: "touring",
    split: false,
    extras: false,
  });
  // FWD runs touring rubber.
  assert.equal(tireProfileForDiscipline("fwd~electric").bucket, "touring");
  // A legacy bare id, written before power was asked for, still places the car.
  assert.equal(tireProfileForDiscipline("touring").bucket, "touring");
});

test("1/10 off-road shops the off-road list and logs front and rear", () => {
  for (const d of [
    "buggy-2wd~electric",
    "buggy-4wd~electric",
    "stadium-truck~electric",
    "short-course~electric",
    "truggy-10th~electric",
  ]) {
    assert.deepEqual(
      tireProfileForDiscipline(d),
      { bucket: "offroad-10th", split: true, extras: true },
      d
    );
  }
});

test("power never changes the tires", () => {
  assert.deepEqual(
    tireProfileForDiscipline("buggy-4wd~nitro"),
    tireProfileForDiscipline("buggy-4wd~electric")
  );
});

test("1/8 off-road gets front and rear but no filter — nothing is imported for it yet", () => {
  for (const d of ["buggy-8th-4wd~nitro", "truggy-8th~nitro", "other-offroad~electric~Monster"]) {
    assert.deepEqual(tireProfileForDiscipline(d), { bucket: null, split: true, extras: true }, d);
  }
  // Retired ids a pre-2026-09-03 row can still hold.
  assert.equal(tireProfileForDiscipline("buggy-8th").split, true);
  assert.equal(tireProfileForDiscipline("truggy").split, true);
});

test("pan, formula and GT stay on today's form over the whole list", () => {
  for (const d of ["pan-12th~electric", "formula~electric", "gt-8th~nitro", "other-onroad~electric~Legends"]) {
    assert.deepEqual(tireProfileForDiscipline(d), NO_TIRE_PROFILE, d);
  }
});

test("a car nothing can place keeps today's form and sees everything", () => {
  assert.deepEqual(tireProfileForDiscipline(null), NO_TIRE_PROFILE);
  assert.deepEqual(tireProfileForDiscipline(""), NO_TIRE_PROFILE);
  assert.deepEqual(tireProfileForDiscipline("   "), NO_TIRE_PROFILE);
  assert.deepEqual(tireProfileForDiscipline("hovercraft~electric"), NO_TIRE_PROFILE);
});

test("every bucket a profile can name is one the catalog holds", () => {
  for (const cls of RACE_CLASSES) {
    const { bucket } = tireProfileForDiscipline(cls.id);
    if (bucket != null) assert.ok((TIRE_BUCKETS as readonly string[]).includes(bucket));
  }
});
