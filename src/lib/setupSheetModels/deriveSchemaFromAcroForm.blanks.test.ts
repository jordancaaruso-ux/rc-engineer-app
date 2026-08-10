import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";
import { deriveSchemaFromAcroForm } from "@/lib/setupSheetModels/deriveSchemaFromAcroForm";
import { DEBUG_SHEET_BLANKS } from "@/lib/setupSheetModels/debugSheetBlanks";
import { isReservedSetupKey } from "@/lib/setupSheetModels/reservedSetupKeys";

/**
 * The derived keys for the real manufacturer blanks, pinned exactly.
 *
 * ============================== WHY PIN A LIST THIS LONG ==============================
 *
 * A derived key is permanent. The moment one driver saves one sheet it is frozen into run history,
 * fill drafts, baselines, setup deltas and every aggregation row — and renaming one does not error,
 * it silently empties every saved sheet that used it.
 *
 * So the danger is not a bug in `deriveSchemaFromAcroForm`. It is an innocent-looking tweak to it:
 * a nudge to `readerOrder`'s 4pt row tolerance, a widened `GENERIC_NAME_PATTERNS`, a change to when
 * `isChoiceGroup` fires. Each of those re-keys real sheets across the whole catalog, and nothing
 * about the change announces that. This file is the announcement.
 *
 * A failure here is not automatically a bug. It means the change re-keys existing sheets, and that
 * is a decision to take deliberately — with a migration for the drivers already on those chassis —
 * rather than by accident. Once taken, re-pin with:
 *
 *     UPDATE_DERIVED_KEYS=1 npx tsx src/lib/setupSheetModels/deriveSchemaFromAcroForm.blanks.test.ts
 *
 * The blanks are the best case and the worst case on purpose: Xray names its own fields, Mugen
 * ships `Text2`…`Text142`.
 */

type BlankPin = {
  fieldCount: number;
  parameterCount: number;
  placeholderLabelCount: number;
  withOptionsCount: number;
  splitFieldCount: number;
  collidedKeys: string[];
  reservedKeys: string[];
  keys: string[];
};

const PIN_PATH = join(process.cwd(), "src/lib/setupSheetModels/derivedKeys.blanks.json");
const UPDATING = process.env.UPDATE_DERIVED_KEYS === "1";

async function derivePins(): Promise<Record<string, BlankPin>> {
  const out: Record<string, BlankPin> = {};
  for (const [id, blank] of Object.entries(DEBUG_SHEET_BLANKS)) {
    const path = join(process.cwd(), blank.path);
    assert.ok(existsSync(path), `${id}: blank missing at ${blank.path}`);

    const extraction = await extractPdfFormFields(readFileSync(path));
    assert.equal(extraction.hasFormFields, true, `${id}: the blank lost its form layer`);

    const { schema, formFieldMappings, stats, boxes } = deriveSchemaFromAcroForm(extraction, blank.label);

    // Invariants that hold for every sheet, checked here rather than pinned — a driver typing into
    // a box whose value goes nowhere is the failure these prevent.
    const keys = schema.fields.map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length, `${id}: duplicate keys`);
    for (const k of keys) {
      assert.ok(formFieldMappings[k], `${id}: ${k} maps to no box on the paper`);
      assert.equal(isReservedSetupKey(k), false, `${id}: ${k} claims a key the app rewrites on save`);
    }
    assert.equal(boxes.length, keys.length, `${id}: every parameter needs a place on the page`);
    const order = schema.fields.map((f) => f.sortOrder);
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `${id}: reader order is not monotonic`);

    out[id] = {
      fieldCount: stats.fieldCount,
      parameterCount: stats.parameterCount,
      placeholderLabelCount: stats.placeholderLabelCount,
      withOptionsCount: stats.withOptionsCount,
      splitFieldCount: stats.splitFieldCount,
      collidedKeys: stats.collidedKeys,
      reservedKeys: stats.reservedKeys,
      keys,
    };
  }
  return out;
}

/** Name what moved. "521 keys changed" sends you reading the whole file; three names do not. */
function reportKeyDrift(id: string, expected: string[], actual: string[]): void {
  const before = new Set(expected);
  const after = new Set(actual);
  const gone = expected.filter((k) => !after.has(k));
  const fresh = actual.filter((k) => !before.has(k));
  const moved = gone.length === 0 && fresh.length === 0;

  const lines = [
    `${id}: derived keys moved — every saved sheet on this chassis would lose the values under them.`,
  ];
  if (moved) lines.push(`  same ${expected.length} keys, different order (reader order changed)`);
  if (gone.length) lines.push(`  ${gone.length} gone:  ${gone.slice(0, 12).join(", ")}${gone.length > 12 ? " …" : ""}`);
  if (fresh.length) lines.push(`  ${fresh.length} new:   ${fresh.slice(0, 12).join(", ")}${fresh.length > 12 ? " …" : ""}`);
  lines.push(`  If this is deliberate: UPDATE_DERIVED_KEYS=1 npx tsx ${"src/lib/setupSheetModels/deriveSchemaFromAcroForm.blanks.test.ts"}`);
  assert.fail(lines.join("\n"));
}

async function main() {
  const pins = await derivePins();

  if (UPDATING) {
    writeFileSync(PIN_PATH, `${JSON.stringify(pins, null, 2)}\n`, "utf8");
    for (const [id, p] of Object.entries(pins)) {
      console.log(`  ${id.padEnd(14)} ${p.parameterCount} parameters, ${p.parameterCount - p.placeholderLabelCount} named`);
    }
    console.log("derivedKeys.blanks.json re-pinned");
    return;
  }

  assert.ok(existsSync(PIN_PATH), `no pinned keys — run with UPDATE_DERIVED_KEYS=1 to create them`);
  const expected = JSON.parse(readFileSync(PIN_PATH, "utf8")) as Record<string, BlankPin>;

  assert.deepEqual(Object.keys(pins).sort(), Object.keys(expected).sort(), "the set of pinned blanks changed");

  for (const [id, got] of Object.entries(pins)) {
    const want = expected[id]!;
    if (JSON.stringify(got.keys) !== JSON.stringify(want.keys)) reportKeyDrift(id, want.keys, got.keys);
    assert.equal(got.fieldCount, want.fieldCount, `${id}: fields read off the PDF changed`);
    assert.equal(got.parameterCount, want.parameterCount, `${id}: parameter count changed`);
    assert.equal(got.splitFieldCount, want.splitFieldCount, `${id}: multi-box splitting changed`);
    assert.equal(got.withOptionsCount, want.withOptionsCount, `${id}: choice-group detection changed`);
    // How many boxes still need naming by hand is the number that decides whether a chassis is
    // usable to the Engineer, so a silent move in it matters as much as the keys themselves.
    assert.equal(got.placeholderLabelCount, want.placeholderLabelCount, `${id}: unnamed-box count changed`);
    assert.deepEqual(got.collidedKeys, want.collidedKeys, `${id}: key collisions changed`);
    assert.deepEqual(got.reservedKeys, want.reservedKeys, `${id}: reserved-name suffixes changed`);
  }

  console.log("deriveSchemaFromAcroForm.blanks.test.ts ok");
}

void main();
