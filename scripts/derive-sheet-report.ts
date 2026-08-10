/**
 * What a real manufacturer blank turns into. Read-only, no DB.
 *
 * Run: npx tsx scripts/derive-sheet-report.ts [...paths to blank PDFs]
 * With no arguments it reports on every blank checked into the repo.
 *
 * This exists because the quality of a derived sheet is a property of the PDF, not of our code,
 * and it varies enormously by manufacturer. Look at the numbers before trusting the feature.
 */
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";
import { deriveSchemaFromAcroForm } from "@/lib/setupSheetModels/deriveSchemaFromAcroForm";

const DEFAULT_BLANKS = [
  "scripts/setup-extract-eval/gold/xray-x4-2026/files/x4_2026_set_up_editable_v02.pdf",
  "scripts/setup-extract-eval/gold/xray-x4-2022/files/X42022_blank.pdf",
  "scripts/setup-extract-eval/gold/mugen-mtc3/files/MTC3_EditableSetupSheet_CW.pdf",
];

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

async function main() {
  const paths = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_BLANKS;
  for (const path of paths) {
    if (!existsSync(path)) {
      console.log(`\n${basename(path)}  — NOT FOUND (${path})`);
      continue;
    }
    const extraction = await extractPdfFormFields(readFileSync(path));
    console.log(`\n${"=".repeat(72)}\n${basename(path)}`);
    if (!extraction.hasFormFields) {
      console.log(`  NO FORM LAYER — this is a scan. Reference document only, no fillable boxes.`);
      if (extraction.loadError) console.log(`  load error: ${extraction.loadError}`);
      continue;
    }

    const { schema, formFieldMappings, stats, boxes } = deriveSchemaFromAcroForm(extraction, basename(path));
    const named = stats.parameterCount - stats.placeholderLabelCount;

    console.log(`  fields in PDF        ${stats.fieldCount}`);
    console.log(`  parameters derived   ${stats.parameterCount}  (${stats.splitFieldCount} multi-box fields split)`);
    console.log(`  usable names         ${named}/${stats.parameterCount}  (${pct(named, stats.parameterCount)}) — the rest need naming by hand`);
    console.log(`  carry own choices    ${stats.withOptionsCount}`);
    console.log(`  sections             ${new Set(schema.fields.map((f) => f.sectionId)).size} (${schema.fields[0]?.sectionTitle ?? "—"} …)`);
    console.log(`  mappings             ${Object.keys(formFieldMappings).length}`);

    const problems: string[] = [];
    if (stats.collisionCount > 0) problems.push(`${stats.collisionCount} key collisions (permanent suffixes)`);
    if (stats.truncatedKeyCount > 0) problems.push(`${stats.truncatedKeyCount} keys hit the 48-char limit`);
    console.log(`  permanence risks     ${problems.length ? problems.join("; ") : "none"}`);
    // A collision suffix is frozen the moment anyone saves, so name them rather than count them.
    for (const c of stats.collidedKeys) console.log(`      ${c}`);

    // Integrity: every parameter must be reachable and uniquely addressed, or a driver types into
    // a box whose value goes nowhere.
    const keys = schema.fields.map((f) => f.key);
    const dupes = keys.length - new Set(keys).size;
    const unmapped = keys.filter((k) => !formFieldMappings[k]).length;
    const order = schema.fields.map((f) => f.sortOrder);
    const monotonic = order.every((v, i) => i === 0 || v > order[i - 1]!);
    console.log(`  integrity            ${dupes === 0 ? "unique keys" : `${dupes} DUPLICATE KEYS`}, ${unmapped === 0 ? "all mapped" : `${unmapped} UNMAPPED`}, order ${monotonic ? "monotonic" : "BROKEN"}`);

    // How a filled value looks. The app draws it the way the file asks, so this is what the driver
    // sees — and no two manufacturers agree, which is why none of it can be assumed.
    const tally = (pick: (b: (typeof boxes)[number]) => string | undefined): string => {
      const counts = new Map<string, number>();
      for (const b of boxes) {
        const v = pick(b);
        if (!v) continue;
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([v, n]) => `${v} ×${n}`)
        .join(", ");
    };
    console.log(`\n  filled values are drawn as the PDF asks:`);
    console.log(`    font       ${tally((b) => b.style.fontFamily.split(",")[0]) || "—"}`);
    console.log(`    colour     ${tally((b) => b.style.color) || "—"}`);
    console.log(`    alignment  ${tally((b) => b.style.alignment) || "—"}`);
    console.log(`    italic     ${boxes.filter((b) => b.style.italic).length}/${boxes.length}`);
    console.log(`    tick mark  ${tally((b) => b.style.checkMark) || "—"}`);

    console.log(`\n  first 8 parameters as the driver would meet them:`);
    for (const f of schema.fields.slice(0, 8)) {
      const opts = f.groupedOptionLabels?.length ? `  [${f.groupedOptionLabels.slice(0, 4).join(" / ")}]` : "";
      console.log(`    ${String(f.sortOrder).padStart(3)}  ${f.key.padEnd(26)} ${f.displayLabel}${opts}`);
    }
  }
  console.log();
}

void main();
