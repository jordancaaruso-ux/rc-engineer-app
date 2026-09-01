import assert from "node:assert/strict";
import {
  computeSpringRateFromSheetFormula,
  SPRING_RATE_BASE_GF_MM,
  SPRING_RATE_GAP_EXPONENT,
  SPRING_RATE_LEVER_MM,
  SPRING_RATE_SIDE_FACTOR,
  SPRING_RATE_SOFT_FACTOR,
  type SpringRateHardness,
  type SpringRateSide,
  type SpringRateSrs,
} from "@/lib/setupCalculations/springRateFormula";
import { computeSpringRateLookupForSide } from "@/lib/setupCalculations/springRateLookup";
import { SPRING_RATE_TABLE_GF_MM } from "@/lib/setupCalculations/springRateLookupTable";

const SIDES: SpringRateSide[] = ["front", "rear"];
const HARDNESSES: SpringRateHardness[] = ["hard", "soft"];
const SRSS: SpringRateSrs[] = ["I", "II"];

function rate(args: {
  side: SpringRateSide;
  srs: SpringRateSrs;
  hardness: SpringRateHardness;
  gapMm: number;
  ext?: number;
}): number | null {
  return computeSpringRateFromSheetFormula({
    side: args.side,
    srs: args.srs,
    hardness: args.hardness,
    gapMm: args.gapMm,
    lowerArmExtensionMm: args.ext ?? 0,
  }).rateGfMm;
}

// --- The constants are the PDF's, verbatim ----------------------------------------------------
{
  assert.equal(SPRING_RATE_BASE_GF_MM, 84.497);
  assert.equal(SPRING_RATE_GAP_EXPONENT, 0.1087);
  assert.equal(SPRING_RATE_SOFT_FACTOR, 0.797);
  assert.equal(SPRING_RATE_SIDE_FACTOR.front, 0.81);
  assert.equal(SPRING_RATE_SIDE_FACTOR.rear, 1, "the rear script has no side factor at all");
  // Awesomatix's own copy-paste slip, reproduced deliberately: the rear's SOFT branches use the
  // front's lever length. See the module header — do not 'correct' this.
  assert.equal(SPRING_RATE_LEVER_MM.rear.hard, 25.841);
  assert.equal(SPRING_RATE_LEVER_MM.rear.soft, 28.7);
  assert.equal(SPRING_RATE_LEVER_MM.front.hard, 28.7);
  assert.equal(SPRING_RATE_LEVER_MM.front.soft, 28.7);
}

// --- THE LOAD-BEARING TEST: the formula reproduces the retired table up to 4.0 mm ---------------
// 168 points across both sides, both springs and both SRS arrangements. This is what proves the
// script's two checkboxes were read the right way round — swap either and dozens of these fail.
{
  let checked = 0;
  let worst = 0;
  let worstAt = "";
  for (const srs of SRSS) {
    for (const side of SIDES) {
      for (const hardness of HARDNESSES) {
        const block = SPRING_RATE_TABLE_GF_MM[srs][side][hardness] as Record<string, number>;
        for (const [gapKey, tabled] of Object.entries(block)) {
          const gapMm = Number(gapKey);
          if (gapMm > 4.0) continue; // the table's linear tail — asserted as WRONG below
          const got = rate({ side, srs, hardness, gapMm });
          assert.ok(got != null, `${srs}/${side}/${hardness} @ ${gapKey} produced nothing`);
          const delta = Math.abs(got - tabled);
          if (delta > worst) {
            worst = delta;
            worstAt = `${srs}/${side}/${hardness} @ ${gapKey}: table ${tabled}, formula ${got.toFixed(3)}`;
          }
          // One unit in the table's last printed place. It is written to 1 dp, and the two SRS
          // blocks disagree with each other by 0.1 where they describe the SAME adjusted gap
          // (SRS II @ 4.0 says 68.5, SRS I @ 0.0 says 68.4, and the formula says 68.443 for both)
          // — so 0.1 is the table's own precision, not slack granted to the formula.
          assert.ok(
            delta <= 0.1,
            `${srs}/${side}/${hardness} @ ${gapKey}: table ${tabled} vs formula ${got.toFixed(3)}`
          );
          checked++;
        }
      }
    }
  }
  assert.ok(checked >= 160, `expected the whole grid below 4 mm, checked ${checked}`);
  console.log(`  reproduced ${checked} tabled values, worst gap ${worst.toFixed(3)} gf/mm (${worstAt})`);
}

// --- Above 4.0 mm the TABLE was wrong, and that is the point of the swap -----------------------
{
  // The table adds a flat 1.7 per 0.2 mm step from 4.0 up; the curve keeps compounding ~2.2%.
  const tabledAt5 = (SPRING_RATE_TABLE_GF_MM.I.front.hard as Record<string, number>)["5.0"]!;
  const formulaAt5 = rate({ side: "front", srs: "I", hardness: "hard", gapMm: 5.0 })!;
  assert.equal(tabledAt5, 114.2);
  assert.ok(formulaAt5 > 117 && formulaAt5 < 118, `expected ~117.9, got ${formulaAt5}`);
  assert.ok(
    (formulaAt5 - tabledAt5) / tabledAt5 > 0.03,
    "the table reads more than 3% low at the top of its range"
  );

  // Every step is the same multiple, all the way up — that is what "smooth" means here.
  const step = Math.exp(0.1087 * 0.2);
  for (const gapMm of [1.0, 3.0, 4.4, 6.0]) {
    const a = rate({ side: "front", srs: "I", hardness: "hard", gapMm })!;
    const b = rate({ side: "front", srs: "I", hardness: "hard", gapMm: gapMm + 0.2 })!;
    assert.ok(Math.abs(b / a - step) < 1e-9, `step broke at ${gapMm}`);
  }
}

// --- The table's two cliffs are gone -----------------------------------------------------------
{
  // Off-step gaps used to be snapped to a neighbour; they now answer for themselves.
  const at13 = computeSpringRateLookupForSide(
    {
      spring_front: "STD",
      srs_arrangement_front: "I",
      spring_gap_front: "1.3",
    },
    "front"
  );
  assert.equal(at13.resolution, "computed_ok");
  assert.ok(at13.rate != null && Math.abs(at13.rate - 78.8) < 0.1, `got ${at13.rate}, expected ~78.8`);
  const tabledAt14 = (SPRING_RATE_TABLE_GF_MM.I.front.hard as Record<string, number>)["1.4"]!;
  assert.notEqual(
    Number(at13.rate!.toFixed(1)),
    tabledAt14,
    "1.3 must no longer read its 1.4 neighbour"
  );

  // Outside 0–5 mm used to be refused outright.
  const at54 = computeSpringRateLookupForSide(
    { spring_front: "STD", srs_arrangement_front: "I", spring_gap_front: "5.4" },
    "front"
  );
  assert.equal(at54.resolution, "computed_ok");
  assert.ok(at54.rate != null && Math.abs(at54.rate - 123.1) < 0.1, `got ${at54.rate}`);
}

// --- SRS II is 4 mm less gap, not a separate curve ---------------------------------------------
{
  for (const side of SIDES) {
    for (const hardness of HARDNESSES) {
      const ii = rate({ side, srs: "II", hardness, gapMm: 3 })!;
      const iShiftedDown = rate({ side, srs: "I", hardness, gapMm: -1 })!;
      assert.ok(Math.abs(ii - iShiftedDown) < 1e-9, `${side}/${hardness}: SRS II is not gap − 4`);
    }
  }
}

// --- The extension is a LEVER RATIO, not a subtraction from the gap -----------------------------
// This is the substantive difference from the retired table, which did `gap − extension`.
{
  const plain = rate({ side: "front", srs: "I", hardness: "hard", gapMm: 3, ext: 0 })!;
  const withExt = rate({ side: "front", srs: "I", hardness: "hard", gapMm: 3, ext: 1 })!;
  const asTheTableWouldHave = rate({ side: "front", srs: "I", hardness: "hard", gapMm: 2, ext: 0 })!;

  // lever² / (lever + ext)² = 28.7² / 29.7²
  assert.ok(Math.abs(withExt / plain - (28.7 * 28.7) / (29.7 * 29.7)) < 1e-9);
  assert.ok(
    Math.abs(withExt - asTheTableWouldHave) > 3,
    `the two readings must differ — lever ${withExt.toFixed(1)} vs subtract ${asTheTableWouldHave.toFixed(1)}`
  );

  // Zero extension is exactly a ratio of 1, so it drops out — which is why the table was right for
  // 2,911 of the 2,912 recorded sides.
  const r = computeSpringRateFromSheetFormula({
    side: "rear",
    srs: "I",
    hardness: "hard",
    gapMm: 2.4,
    lowerArmExtensionMm: 0,
  });
  assert.equal(r.leverRatio, 1);
}

// --- An extension that cancels the lever is not a rate ------------------------------------------
{
  assert.equal(rate({ side: "front", srs: "I", hardness: "hard", gapMm: 3, ext: -28.7 }), null);
  assert.equal(rate({ side: "front", srs: "I", hardness: "hard", gapMm: 3, ext: -40 }), null);

  const refused = computeSpringRateLookupForSide(
    {
      spring_front: "STD",
      srs_arrangement_front: "I",
      spring_gap_front: "3",
      lower_arm_extension_front: "-28.7",
    },
    "front"
  );
  assert.equal(refused.resolution, "unsupported_lookup_value");
  assert.equal(refused.rate, null);
}

// --- Still refuses what it always refused -------------------------------------------------------
{
  const noSpring = computeSpringRateLookupForSide(
    { srs_arrangement_front: "I", spring_gap_front: "3" },
    "front"
  );
  assert.equal(noSpring.resolution, "missing_input_value");

  const oddSpring = computeSpringRateLookupForSide(
    { spring_front: "medium", srs_arrangement_front: "I", spring_gap_front: "3" },
    "front"
  );
  assert.equal(oddSpring.resolution, "missing_input_mapping");

  const oddSrs = computeSpringRateLookupForSide(
    { spring_front: "STD", srs_arrangement_front: "3", spring_gap_front: "3" },
    "front"
  );
  assert.equal(oddSrs.resolution, "missing_input_mapping");
}

console.log("springRateFormula.test.ts ok");
