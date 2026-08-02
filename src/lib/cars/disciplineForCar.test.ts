import assert from "node:assert/strict";
import test from "node:test";
import { disciplineForCar } from "./chassisPlatform";
import { isSamePlatform } from "./carClasses";

test("discipline comes from the chassis model slug", () => {
  assert.equal(
    disciplineForCar({ setupSheetModel: { slug: "xray_x4" } }),
    "touring"
  );
  // User-created duplicates are slug-suffixed but stay on the platform they forked from.
  assert.equal(
    disciplineForCar({ setupSheetModel: { slug: "mugen_mtc3_2" } }),
    "touring"
  );
});

test("legacy setupSheetTemplate cars resolve without a model row", () => {
  assert.equal(
    disciplineForCar({ setupSheetTemplate: "AWESOMATIX_A800RR" }),
    "touring"
  );
});

test("carClass is the override for a chassis the catalog can't place", () => {
  assert.equal(
    disciplineForCar({ setupSheetModel: { slug: "some_users_own_chassis" }, carClass: "buggy-8th" }),
    "buggy-8th"
  );
  assert.equal(disciplineForCar({ carClass: "truggy" }), "truggy");
  assert.equal(disciplineForCar({ carClass: "  crawler  " }), "crawler");
  // Blank strings are not a discipline.
  assert.equal(disciplineForCar({ carClass: "   " }), null);
});

test("a catalogued chassis wins over a stale carClass", () => {
  // Inference is the source of truth; the column only fills gaps. A car re-pointed at a real
  // chassis must not keep reporting whatever was typed into the old picker.
  assert.equal(
    disciplineForCar({ setupSheetModel: { slug: "xray_x4" }, carClass: "buggy-2wd" }),
    "touring"
  );
});

test("nothing known resolves to null, not a guess", () => {
  assert.equal(disciplineForCar(null), null);
  assert.equal(disciplineForCar(undefined), null);
  assert.equal(disciplineForCar({}), null);
  assert.equal(disciplineForCar({ setupSheetModel: { slug: null } }), null);
});

test("unknown discipline pairs as SAME, so a peer run list never hides on a null", () => {
  // The teammate lap-compare list scopes with isSamePlatform. If null were strict, a peer whose
  // cars aren't catalogued would show zero runs — worse than the over-broad list it replaced.
  const catalogued = disciplineForCar({ setupSheetModel: { slug: "xray_x4" } });
  const unknown = disciplineForCar({ setupSheetModel: { slug: "some_users_own_chassis" } });
  assert.equal(isSamePlatform(catalogued, unknown), true);
  assert.equal(isSamePlatform(unknown, unknown), true);
  assert.equal(isSamePlatform(catalogued, catalogued), true);
});

test("today's catalog cannot discriminate: every chassis in it is touring", () => {
  // Standing note for whoever wires the next discipline filter — this one is inert on current
  // data by construction, not by accident. It starts biting when a non-touring chassis lands in
  // CHASSIS_PLATFORM_BY_SLUG, or when something can write carClass again.
  const slugs = ["awesomatix_a800rr", "mugen_mtc3", "xray_t4", "yokomo_bd12", "arc_r12"];
  for (const slug of slugs) {
    assert.equal(disciplineForCar({ setupSheetModel: { slug } }), "touring", slug);
  }
});
