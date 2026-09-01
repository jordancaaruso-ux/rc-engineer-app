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

test("a chassis derived from a driver's PDF answers with what they chose", () => {
  // The whole point of the column (2026-08-26). The slug is a fingerprint, so the catalog map
  // cannot place it and this used to be null forever.
  assert.equal(
    disciplineForCar({ setupSheetModel: { slug: "sheet_a1b2c3d4e5f60718", discipline: "buggy-4wd" } }),
    "buggy-4wd"
  );
  // Same trim rule as carClass: whitespace is not an answer.
  assert.equal(
    disciplineForCar({ setupSheetModel: { slug: "sheet_a1b2c3d4e5f60718", discipline: "   " } }),
    null
  );
  // Rows that predate the column keep answering null rather than guessing.
  assert.equal(
    disciplineForCar({ setupSheetModel: { slug: "sheet_a1b2c3d4e5f60718", discipline: null } }),
    null
  );
});

test("the curated catalog outranks the chassis's own discipline", () => {
  // The founder reviewed this slug; a driver's answer on the same row must not override him.
  assert.equal(
    disciplineForCar({ setupSheetModel: { slug: "xray_x4", discipline: "crawler" } }),
    "touring"
  );
});

test("the chassis's discipline outranks the per-car override", () => {
  // Order is catalog → chassis → car. The chassis answer is global and deliberate; carClass is
  // the last-resort gap filler, so it must not win over a chassis that states its own.
  assert.equal(
    disciplineForCar({
      setupSheetModel: { slug: "sheet_a1b2c3d4e5f60718", discipline: "short-course" },
      carClass: "buggy-2wd",
    }),
    "short-course"
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
  // Standing note for whoever wires the next discipline filter. The MAP is still touring-only by
  // construction — but as of 2026-08-26 the answer as a whole no longer is: every chassis created
  // from a driver's PDF now carries its own discipline, and those are the rows the map never
  // covered. So a filter built on `disciplineForCar` is live from the first non-touring chassis
  // somebody uploads, not from the next time this table is edited.
  const slugs = ["awesomatix_a800rr", "mugen_mtc3", "xray_t4", "yokomo_bd12", "arc_r12"];
  for (const slug of slugs) {
    assert.equal(disciplineForCar({ setupSheetModel: { slug } }), "touring", slug);
  }
});
