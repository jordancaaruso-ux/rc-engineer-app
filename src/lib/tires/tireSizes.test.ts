import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { filterOptionSections } from "@/lib/search/optionSearch";
import { tirePickerKeywords } from "@/lib/tires/tireCatalogFilter";
import { tireSizeFor } from "@/lib/tires/tireSizes";

/**
 * The tire picker searches each tire's size (`tireSizes.ts`), so "1/12" finds the 1/12 tires in the
 * pan list and never its 1/10 ones (test drive, 2026-09-26). The sizes come from the seed files by
 * way of `tireSizes.json`, and the first test checks the two still agree. After a seed file
 * changes, rebuild it with:
 *
 *     UPDATE_TIRE_SIZES=1 npx tsx --test src/lib/tires/tireSizes.test.ts
 */

/** `LISTS` in `scripts/import-tire-lists.ts`: each per-class list's seed file and model-code tag. */
const LISTS = [
  { file: "seeds/tires_offroad_8th.json", codeTag: "8TH" },
  { file: "seeds/tires_onroad_8th.json", codeTag: "8TH-ONROAD" },
  { file: "seeds/tires_pan.json", codeTag: "PAN" },
  { file: "seeds/tires_formula.json", codeTag: "F1" },
  { file: "seeds/tires_touring_foam.json", codeTag: "FOAM-10TH" },
] as const;

type SeedRow = { brand?: string; model?: string | null; compound?: string | null; size?: string | null };

/** The model code `scripts/import-tire-lists.ts` gives a row: brand, tread, compound and list tag. */
function seedModelCode(row: SeedRow, codeTag: string): string | null {
  const brand = row.brand?.trim();
  const model = row.model?.trim() || "";
  const compound = row.compound?.trim() || "";
  if (!brand || (!model && !compound)) return null;
  return [brand, model, compound, codeTag]
    .filter(Boolean)
    .join("-")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sizesFromSeeds(): Record<string, string> {
  const byCode = new Map<string, string>();
  for (const { file, codeTag } of LISTS) {
    const rows = JSON.parse(readFileSync(join(process.cwd(), file), "utf8")) as SeedRow[];
    for (const row of rows) {
      const code = seedModelCode(row, codeTag);
      const size = row.size?.trim();
      // A later row with the same code wins, as the import's upsert does.
      if (code && size) byCode.set(code, size);
    }
  }
  return Object.fromEntries([...byCode.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

const INDEX_PATH = join(process.cwd(), "src/lib/tires/tireSizes.json");

test("tireSizes.json holds every per-class list's sizes, as the seed files have them", () => {
  const built = sizesFromSeeds();
  if (process.env.UPDATE_TIRE_SIZES === "1") {
    writeFileSync(INDEX_PATH, `${JSON.stringify(built, null, 2)}\n`, "utf8");
  }
  const committed = JSON.parse(readFileSync(INDEX_PATH, "utf8")) as Record<string, string>;
  assert.deepEqual(
    committed,
    built,
    "A tire seed file changed. Rebuild: UPDATE_TIRE_SIZES=1 npx tsx --test src/lib/tires/tireSizes.test.ts"
  );
});

test("a tire from a per-class list has its size; any other tire has none", () => {
  assert.equal(tireSizeFor("AAA-MODEL-SUPPLY-DONUT-MAGENTA-32-PAN"), "1/12 donut, 1.925in");
  assert.equal(tireSizeFor("BSR-RACING-VELODROME-EHW-RADIAL-ORANGE-PAN"), "1/10 pan");
  // A driver's own tire, and a code the 1/10 off-road list gave (rims are left out on purpose).
  assert.equal(tireSizeFor("SWEEP-D32"), null);
  assert.equal(tireSizeFor("PRO-LINE-ELECTRON-2-0-MC"), null);
  assert.equal(tireSizeFor(null), null);
});

/** A picker row the way `TireTypeCombobox` builds one. */
function pickerRow(label: string, modelCode: string) {
  return {
    value: modelCode,
    label,
    keywords: tirePickerKeywords({ modelCode, size: tireSizeFor(modelCode) }),
  };
}

const PAN_LIST = [
  pickerRow("AAA Model Supply Donut Magenta (32)", "AAA-MODEL-SUPPLY-DONUT-MAGENTA-32-PAN"),
  pickerRow("BSR Racing Front Pink (30)", "BSR-RACING-FRONT-PINK-30-PAN"),
  pickerRow("BSR Racing Velodrome EHW Radial Orange", "BSR-RACING-VELODROME-EHW-RADIAL-ORANGE-PAN"),
  pickerRow("BSR Racing Race Radial Carpet", "BSR-RACING-RACE-RADIAL-CARPET-PAN"),
];

function found(query: string): string[] {
  return filterOptionSections(query, [{ key: "all", label: null, options: PAN_LIST }]).flatMap((s) =>
    s.options.map((o) => o.label)
  );
}

test("'1/12' finds the pan list's 1/12 tires and none of its 1/10 ones", () => {
  assert.deepEqual(found("1/12"), ["AAA Model Supply Donut Magenta (32)", "BSR Racing Front Pink (30)"]);
  assert.deepEqual(found("1/10"), ["BSR Racing Velodrome EHW Radial Orange", "BSR Racing Race Radial Carpet"]);
  assert.deepEqual(found("1/12 donut"), ["AAA Model Supply Donut Magenta (32)"]);
  assert.deepEqual(found("1/12 front"), ["BSR Racing Front Pink (30)"]);
});

test("the name still finds a tire whose size says nothing of it", () => {
  assert.deepEqual(found("magenta"), ["AAA Model Supply Donut Magenta (32)"]);
  assert.deepEqual(found("velodrome"), ["BSR Racing Velodrome EHW Radial Orange"]);
});
