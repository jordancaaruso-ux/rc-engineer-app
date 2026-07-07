/**
 * End-to-end demo of the "upload a setup sheet for any car" engine, on the command line
 * (the in-app UI wiring is still TODO). Runs the full personal-upload chain on one image:
 *   identify the car → match existing / decide it's new → draft its schema (if new) →
 *   extract every value with confidence → apply the trust policy (checkboxes → review).
 *
 * Usage:
 *   npm run setup-extract:demo                         # a bundled Xray gold sheet
 *   npm run setup-extract:demo -- path/to/sheet.png    # your own sheet
 *   SETUP_EXTRACT_PASSES=1 npm run setup-extract:demo  # faster/cheaper single pass
 * Simulates an app that already knows a few cars (none of them the uploaded one) so you see
 * the new-car path; pass --known to include the uploaded car and see the match path instead.
 */

import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";

import { identifySheetCar } from "@/lib/setupExtractAi/identifySheetCar";
import { matchSheetModelForIdentifiedCar } from "@/lib/setupExtractAi/matchSheetModel";
import { draftSetupSheetModelSchema } from "@/lib/setupExtractAi/draftSetupSheetModelSchema";
import { draftedSchemaToModelSchema } from "@/lib/setupExtractAi/draftedSchemaToModelSchema";
import { buildExtractionSchemaFromModel } from "@/lib/setupExtractAi/schemaFromSetupModel";
import { extractSetupFromImage, DEFAULT_SETUP_EXTRACT_MODEL, DEFAULT_SETUP_EXTRACT_MODEL_B } from "@/lib/setupExtractAi/extractSetupFromImage";
import { shapeExtraction } from "@/lib/setupExtractAi/shapeExtraction";
import type { ExtractionSchema } from "@/lib/setupExtractAi/types";

const DEFAULT_IMAGE = "scripts/setup-extract-eval/gold/xray-x4-2022/files/X42022_BrunoCoelho_Ciserano2022032627.png";

function hr(label: string) {
  console.log(`\n${"─".repeat(64)}\n▶ ${label}\n${"─".repeat(64)}`);
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--known");
  const includeUploadedCar = process.argv.includes("--known");
  const imgPath = args[0] ?? DEFAULT_IMAGE;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) { console.error("OPENAI_API_KEY not set (run via npm so .env.local loads)."); process.exit(1); }
  if (!existsSync(imgPath)) { console.error(`No such image: ${imgPath}`); process.exit(1); }
  const bytes = readFileSync(imgPath);
  const mime = imgPath.endsWith(".jpg") || imgPath.endsWith(".jpeg") ? "image/jpeg" : "image/png";
  const passes = process.env.SETUP_EXTRACT_PASSES?.trim() === "1" ? (1 as const) : (2 as const);
  console.log(`Sheet: ${basename(imgPath)}`);

  // 1 — Identify the car from the printed header.
  hr("1. Identify the car");
  const car = await identifySheetCar({ apiKey, imageBytes: bytes, imageMime: mime });
  console.log(`  brand=${car.brand}  model=${car.model}  confidence=${car.confidence}  ("${car.rawHeaderText}")`);
  const identifiedName = [car.brand, car.model].filter(Boolean).join(" ") || "Unknown car";

  // 2 — Match against the cars the app already knows.
  hr("2. Match against existing cars");
  const known = [
    { id: "c1", name: "Mugen MTC3" },
    { id: "c2", name: "Awesomatix A800" },
    { id: "c3", name: "Xray T4'20" },
    ...(includeUploadedCar ? [{ id: "c9", name: identifiedName }] : []),
  ];
  const match = matchSheetModelForIdentifiedCar(car, known);
  console.log(`  known cars: ${known.map((k) => k.name).join(", ")}`);
  console.log(`  best match: ${match.isConfidentMatch ? `${known.find((k) => k.id === match.bestMatchId)?.name} (score ${match.score.toFixed(2)})` : `none (best ${match.score.toFixed(2)})`}`);

  // 3 — Get the schema: existing car → its schema; new car → draft one. The demo has no DB,
  // so both branches draft from the sheet, then run the real production conversion chain
  // (drafted → SetupSheetModelSchema → extraction schema) exactly as the app does.
  if (match.isConfidentMatch) {
    hr("3. Known car → would use its existing schema (demo drafts one; no DB here)");
  } else {
    hr(`3. New car "${identifiedName}" → draft its schema`);
  }
  const draft = await draftSetupSheetModelSchema({ apiKey, imageBytes: bytes, imageMime: mime, carName: identifiedName });
  const modelSchema = draftedSchemaToModelSchema({ carName: identifiedName, fields: draft.fields });
  const schema: ExtractionSchema = buildExtractionSchemaFromModel({ model: modelSchema });
  const uni = schema.fields.filter((f) => f.universalParameterId).length;
  console.log(`  drafted ${draft.fields.length} fields (${uni} mapped to universal aggregation params)${match.isConfidentMatch ? "" : " — this would become a provisional private car"}`);

  // 4 — Extract every value with confidence.
  hr(`4. Read the setup (${passes === 1 ? "single-pass" : "dual-pass"} ${passes === 1 ? DEFAULT_SETUP_EXTRACT_MODEL : `${DEFAULT_SETUP_EXTRACT_MODEL}+${DEFAULT_SETUP_EXTRACT_MODEL_B}`})`);
  const t0 = Date.now();
  const extraction = await extractSetupFromImage({ apiKey, imageBytes: bytes, imageMime: mime, schema, passes });
  const shaped = shapeExtraction(extraction, schema);
  console.log(`  read ${shaped.fieldCount} fields in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${shaped.importedCount} values, ${shaped.flaggedKeys.length} routed to review`);

  // 5 — The result: what auto-imports vs what the driver confirms.
  hr("5. Result — auto-imported vs needs a glance");
  const flagged = new Set(shaped.flaggedKeys);
  const auto = extraction.fields.filter((f) => f.value !== "" && !flagged.has(f.key));
  const review = extraction.fields.filter((f) => flagged.has(f.key) && (f.value !== "" || f.confidence < 0.8));
  console.log(`\n  ✅ Auto-imported (${auto.length}) — high-confidence written values:`);
  for (const f of auto.slice(0, 18)) console.log(`     ${f.key.padEnd(22)} ${f.value}`);
  if (auto.length > 18) console.log(`     … and ${auto.length - 18} more`);
  console.log(`\n  👀 Needs a glance (${review.length}) — checkboxes + anything uncertain:`);
  for (const f of review.slice(0, 14)) console.log(`     ${f.key.padEnd(22)} ${f.value || "(blank)"}   (conf ${f.confidence.toFixed(2)})`);
  if (review.length > 14) console.log(`     … and ${review.length - 14} more`);
  console.log(`\nDone. This is the full engine; the same chain wired into the upload screen is the remaining app work.`);
}

main().catch((e) => { console.error("\nERROR:", e instanceof Error ? e.message : e); process.exit(1); });
