import assert from "node:assert/strict";
import test from "node:test";
import { disciplineForCar } from "./chassisPlatform";
import {
  disciplineLabel,
  formatDiscipline,
  isDisciplineValue,
  isKnownDisciplineClass,
  isSamePlatform,
  parseDiscipline,
} from "./carClasses";

test("discipline comes from the chassis model slug", () => {
  assert.equal(
    disciplineForCar({ setupSheetModel: { slug: "xray_x4" } }),
    "touring~electric"
  );
  // User-created duplicates are slug-suffixed but stay on the platform they forked from.
  assert.equal(
    disciplineForCar({ setupSheetModel: { slug: "mugen_mtc3_2" } }),
    "touring~electric"
  );
});

test("legacy setupSheetTemplate cars resolve without a model row", () => {
  assert.equal(
    disciplineForCar({ setupSheetTemplate: "AWESOMATIX_A800RR" }),
    "touring~electric"
  );
});

test("a chassis derived from a driver's PDF answers with what they chose", () => {
  // The whole point of the column (2026-08-26). The slug is a fingerprint, so the catalog map
  // cannot place it and this used to be null forever.
  assert.equal(
    disciplineForCar({
      setupSheetModel: { slug: "sheet_a1b2c3d4e5f60718", discipline: "buggy-4wd~electric" },
    }),
    "buggy-4wd~electric"
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
    disciplineForCar({ setupSheetModel: { slug: "xray_x4", discipline: "buggy-2wd~nitro" } }),
    "touring~electric"
  );
});

test("the chassis's discipline outranks the per-car override", () => {
  // Order is catalog → chassis → car. The chassis answer is global and deliberate; carClass is
  // the last-resort gap filler, so it must not win over a chassis that states its own.
  assert.equal(
    disciplineForCar({
      setupSheetModel: { slug: "sheet_a1b2c3d4e5f60718", discipline: "short-course~electric" },
      carClass: "buggy-2wd~electric",
    }),
    "short-course~electric"
  );
});

test("carClass is the override for a chassis the catalog can't place", () => {
  assert.equal(
    disciplineForCar({
      setupSheetModel: { slug: "some_users_own_chassis" },
      carClass: "buggy-8th-4wd~nitro",
    }),
    "buggy-8th-4wd~nitro"
  );
  assert.equal(disciplineForCar({ carClass: "truggy-8th~nitro" }), "truggy-8th~nitro");
  assert.equal(disciplineForCar({ carClass: "  gt-5th~nitro  " }), "gt-5th~nitro");
  // Blank strings are not a discipline.
  assert.equal(disciplineForCar({ carClass: "   " }), null);
});

test("a catalogued chassis wins over a stale carClass", () => {
  // Inference is the source of truth; the column only fills gaps. A car re-pointed at a real
  // chassis must not keep reporting whatever was typed into the old picker.
  assert.equal(
    disciplineForCar({ setupSheetModel: { slug: "xray_x4" }, carClass: "buggy-2wd~electric" }),
    "touring~electric"
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

/* ------------------------------------------------------------------ the 2026-09-03 list ---- */

test("electric and nitro are different disciplines", () => {
  // Founder call 2026-09-03. They never share a heat, so they must never share a comparison.
  assert.equal(isSamePlatform("touring~electric", "touring~nitro"), false);
  assert.equal(isSamePlatform("touring~electric", "touring~electric"), true);
  assert.equal(isSamePlatform("buggy-8th-2wd~nitro", "buggy-8th-4wd~nitro"), false);
});

test("a legacy answer with no power still compares on its class", () => {
  // Rows written before power was asked for say nothing about it, and reading that silence as
  // "not nitro" would quietly un-compare cars that have been comparing for months.
  assert.equal(isSamePlatform("touring", "touring~nitro"), true);
  assert.equal(isSamePlatform("touring", "touring~electric"), true);
  assert.equal(isSamePlatform("touring", "buggy-2wd~electric"), false);
});

test("two Others are the same discipline only when they name the same thing", () => {
  assert.equal(
    isSamePlatform("other-onroad~electric~Legends", "other-onroad~electric~legends"),
    true
  );
  assert.equal(
    isSamePlatform("other-onroad~electric~Legends", "other-onroad~electric~Vintage TC"),
    false
  );
  // An onroad Other and an offroad Other are never the same thing, whatever they're called.
  assert.equal(
    isSamePlatform("other-onroad~electric~Rally", "other-offroad~electric~Rally"),
    false
  );
});

test("a stored answer round-trips", () => {
  assert.equal(formatDiscipline({ classId: "touring", power: "electric" }), "touring~electric");
  assert.equal(
    formatDiscipline({ classId: "other-offroad", power: "nitro", otherLabel: " Rally  Cross " }),
    "other-offroad~nitro~Rally Cross"
  );
  const parsed = parseDiscipline("other-offroad~nitro~Rally Cross");
  assert.deepEqual(parsed, {
    classId: "other-offroad",
    power: "nitro",
    otherLabel: "Rally Cross",
  });
});

test("a half-answer has no spelling, so it can never be stored", () => {
  // The whole reason DisciplineField holds the partial state instead of the parent.
  assert.equal(formatDiscipline({ classId: "touring", power: null }), "");
  assert.equal(formatDiscipline({ classId: "", power: "electric" }), "");
  assert.equal(formatDiscipline({ classId: "not-a-class", power: "electric" }), "");
  // An "Other" with no name is not an answer either — it says only "not on your list".
  assert.equal(formatDiscipline({ classId: "other-onroad", power: "electric" }), "");
});

test("the driver's gate demands a whole answer; the founder's does not", () => {
  assert.equal(isDisciplineValue("touring~electric"), true);
  assert.equal(isDisciplineValue("other-onroad~nitro~Legends"), true);
  assert.equal(isDisciplineValue("touring"), false); // no power
  assert.equal(isDisciplineValue("other-onroad~nitro"), false); // no name
  assert.equal(isDisciplineValue("crawler~electric"), false); // retired class
  assert.equal(isDisciplineValue("touring~petrol"), false);
  assert.equal(isDisciplineValue(""), false);

  // The bulk/admin door: a bare class is enough, a made-up one still isn't.
  assert.equal(isKnownDisciplineClass("touring"), true);
  assert.equal(isKnownDisciplineClass("buggy-8th-4wd~nitro"), true);
  assert.equal(isKnownDisciplineClass("crawler"), false);
  assert.equal(isKnownDisciplineClass("touring~petrol"), false);
});

test("a typed class name can't forge a field boundary", () => {
  // "~" is the separator, so it is stripped out of anything a driver types rather than escaped.
  assert.equal(
    formatDiscipline({ classId: "other-onroad", power: "electric", otherLabel: "A~nitro~B" }),
    "other-onroad~electric~A nitro B"
  );
});

test("an answer reads as words, and an old one still reads as words", () => {
  assert.equal(disciplineLabel("touring~electric"), "1/10 Touring · Electric");
  assert.equal(disciplineLabel("buggy-8th-4wd~nitro"), "1/8 Buggy 4WD · Nitro");
  assert.equal(disciplineLabel("other-onroad~electric~Legends"), "Legends · Electric");
  // Legacy: no power, and a class that isn't offered any more.
  assert.equal(disciplineLabel("touring"), "1/10 Touring");
  assert.equal(disciplineLabel("crawler"), "Crawler / trail");
  assert.equal(disciplineLabel("buggy-8th"), "1/8 Buggy");
  // Something nobody has ever heard of still renders rather than blanking the row.
  assert.equal(disciplineLabel("wildcard"), "wildcard");
  assert.equal(disciplineLabel(null), null);
});

test("today's catalog cannot discriminate: every chassis in it is electric touring", () => {
  // Standing note for whoever wires the next discipline filter. The MAP is still touring-only by
  // construction — but as of 2026-08-26 the answer as a whole no longer is: every chassis created
  // from a driver's PDF now carries its own discipline, and those are the rows the map never
  // covered. So a filter built on `disciplineForCar` is live from the first non-touring chassis
  // somebody uploads, not from the next time this table is edited.
  const slugs = ["awesomatix_a800rr", "mugen_mtc3", "xray_t4", "yokomo_bd12", "arc_r12"];
  for (const slug of slugs) {
    assert.equal(disciplineForCar({ setupSheetModel: { slug } }), "touring~electric", slug);
  }
});
