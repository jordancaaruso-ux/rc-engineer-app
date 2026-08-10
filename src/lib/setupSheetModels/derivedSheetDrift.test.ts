import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";
import { deriveSchemaFromAcroForm } from "@/lib/setupSheetModels/deriveSchemaFromAcroForm";
import { derivedSheetFingerprint } from "@/lib/setupSheetModels/derivedSheetFingerprint";
import { readDerivedSheetValues } from "@/lib/setupSheetModels/readDerivedSheetValues";

/**
 * Run with `npm run test:derived-import`. Needs `--conditions=react-server` because
 * `pdfFormFields` carries the `server-only` guard.
 *
 * ======================== WHY THIS TEST IS THE IMPORTANT ONE ========================
 *
 * Everything about importing a driver's own sheet rests on one property: **the same sheet must
 * derive the same boxes every time, however full it happens to be.**
 *
 * If that ever stops holding, nothing errors. Two drivers on the same sheet quietly stop sharing a
 * row, a driver's second upload of their own sheet mints a second row, and — worst — a key that
 * used to mean one box comes to mean another. `SetupSnapshot.data` is keyed by these keys and run
 * history is immutable, so by the time anyone notices, the damage is already saved.
 *
 * The two Mugen files are a natural experiment and the reason this can be tested at all: the same
 * sheet style, filled by different people to different extents. Mugen's own copy carries 71 boxes
 * of kit defaults; Sören's carries 91 including his name and his track. If fill state could
 * perturb the derivation, these two would disagree.
 *
 * Measured 2026-08-10: they agree exactly. This test pins that.
 */

const GOLD = "scripts/setup-extract-eval/gold/";
const MUGEN_BLANK = `${GOLD}mugen-mtc3/files/MTC3_EditableSetupSheet_CW.pdf`;
const MUGEN_FILLED = `${GOLD}mugen-mtc3/files/soren-test.pdf`;
const XRAY_22 = `${GOLD}xray-x4-2022/files/X42022_blank.pdf`;
const XRAY_26 = `${GOLD}xray-x4-2026/files/x4_2026_set_up_editable_v02.pdf`;
/** Same sheet as XRAY_26, exported flat. Xray publishes both on one page. */
const XRAY_26_FLAT = `${GOLD}xray-x4-2026/files/x4_2026_set_up_blank.pdf`;

async function derive(path: string) {
  const extraction = await extractPdfFormFields(readFileSync(path));
  const derived = deriveSchemaFromAcroForm(extraction, "test");
  return {
    extraction,
    derived,
    keys: derived.schema.fields.map((f) => f.key),
    fingerprint: derivedSheetFingerprint({
      schema: derived.schema,
      formFieldMappings: derived.formFieldMappings,
    }),
  };
}

async function main() {
  const blank = await derive(MUGEN_BLANK);
  const filled = await derive(MUGEN_FILLED);

  // --- The property everything rests on ---
  assert.deepEqual(
    filled.keys,
    blank.keys,
    "the same sheet must derive the same boxes in the same order, however full it is"
  );
  assert.equal(
    filled.fingerprint,
    blank.fingerprint,
    "the same sheet must resolve to one shared row, so two drivers do not each mint their own"
  );

  /*
   * Box positions too — the fill surface places every box from these fractions, so real drift here
   * would put the driver's values in the wrong places on their own sheet.
   *
   * Compared with a tolerance rather than exactly, and the tolerance is measured rather than
   * guessed. Two PDFs storing the same rectangle do not store identical floating-point numbers:
   * across the Mugen pair, 192 of 193 boxes differ, and the worst difference is 6.7e-8 of the page
   * — one ten-thousandth of a pixel on a 1200px render. `POSITION_TOLERANCE` sits ~150x above that
   * noise floor and ~100x below any movement a person could see, so this catches a box genuinely
   * moving while ignoring arithmetic.
   */
  const POSITION_TOLERANCE = 1e-5;
  const boxAt = (d: Awaited<ReturnType<typeof derive>>) => new Map(d.derived.boxes.map((b) => [b.key, b]));
  const before = boxAt(blank);
  const after = boxAt(filled);
  let worstShift = 0;
  for (const [key, b] of before) {
    const other = after.get(key);
    if (!other) continue;
    assert.equal(other.pageNumber, b.pageNumber, `${key} must stay on the same page`);
    worstShift = Math.max(
      worstShift,
      Math.abs(b.x - other.x),
      Math.abs(b.y - other.y),
      Math.abs(b.width - other.width),
      Math.abs(b.height - other.height)
    );
  }
  assert.ok(
    worstShift < POSITION_TOLERANCE,
    `no box may move between two copies of one sheet (worst shift ${worstShift.toExponential(2)} of the page)`
  );

  // --- Different sheets must NOT share a row ---
  const x22 = await derive(XRAY_22);
  const x26 = await derive(XRAY_26);
  const fingerprints = new Set([blank.fingerprint, x22.fingerprint, x26.fingerprint]);
  assert.equal(fingerprints.size, 3, "three different sheets must produce three different rows");

  // --- Keys stay unique and every box is reachable ---
  for (const d of [blank, x22, x26]) {
    assert.equal(new Set(d.keys).size, d.keys.length, "derived keys must be unique");
    for (const key of d.keys) {
      assert.ok(d.derived.formFieldMappings[key], `every box must know where it reads from: ${key}`);
    }
    assert.equal(d.derived.stats.collisionCount, 0, "the repo fixtures must derive without collisions");
  }

  // --- Values: the sheet the driver actually filled comes back ---
  const values = readDerivedSheetValues({
    extraction: filled.extraction,
    formFieldMappings: filled.derived.formFieldMappings,
  });
  assert.ok(values.filledCount > 80, `Sören's sheet should read ~91 values, read ${values.filledCount}`);
  assert.ok(
    Object.values(values.values).some((v) => String(v).includes("Sören")),
    "his name is in the file and should come back"
  );

  /*
   * --- An untouched sheet reads as untouched ---
   *
   * The Xray blank has 45 fields whose `value` is the string "all off" — a debugging summary that
   * `extractPdfFormFields` writes for a multi-widget toggle. Reading those as real values would
   * hand a driver a sheet with 45 boxes filled in reading "all off", on a sheet nobody has touched.
   */
  const blankValues = readDerivedSheetValues({
    extraction: x22.extraction,
    formFieldMappings: x22.derived.formFieldMappings,
  });
  assert.equal(blankValues.filledCount, 0, "an untouched blank must read as empty");

  // --- The flat export has no form layer at all: this is the refusal case, and it is real ---
  const flat = await extractPdfFormFields(readFileSync(XRAY_26_FLAT));
  assert.equal(flat.hasFormFields, false, "Xray's flat export must be recognised as unreadable");
  assert.ok(x26.extraction.fields.length > 200, "its editable twin must be readable");

  console.log(
    `derivedSheetDrift: all assertions passed ` +
      `(Mugen pair agree on ${blank.keys.length} boxes; Sören's sheet read ${values.filledCount} values)`
  );
}

void main();
