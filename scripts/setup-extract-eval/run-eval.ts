/**
 * Setup-sheet extraction eval (Stage 0 of docs/SETUP_UPLOAD_NORTH_STAR.md).
 *
 * Scores the Stage-1 AI vision extractor against hand-verified gold sheets.
 * Per-field outcomes:
 *   correct           — extracted value matches gold (flagged or not)
 *   wrong_flagged     — mismatch, but confidence < flag threshold (review catches it)
 *   wrong_confident   — mismatch presented confidently (THE failure that burns trust)
 * Ship bar per SETUP_UPLOAD_NORTH_STAR.md: correct-or-flagged ≥ 95%.
 *
 * Usage:
 *   npm run setup-extract:eval                  # all gold sheets with expected values
 *   npm run setup-extract:eval -- coelho        # only sheets whose filename matches
 *   SETUP_EXTRACT_MODEL=gpt-4.1 npm run setup-extract:eval
 * Requires OPENAI_API_KEY (loaded from .env.local via dotenv-cli in the npm script).
 */

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";

import {
  extractSetupFromImage,
  DEFAULT_SETUP_EXTRACT_MODEL,
  DEFAULT_SETUP_EXTRACT_MODEL_B,
} from "@/lib/setupExtractAi/extractSetupFromImage";
import { parseExtractionSchema, EXTRACTION_FLAG_THRESHOLD, isFlagged } from "@/lib/setupExtractAi/types";
import { matchesExpected } from "@/lib/setupExtractAi/normalizeExtractedValue";
import { suggestUniversalParameterId } from "@/lib/setupSheetModels/matchUniversalParameter";

const GOLD_ROOT = join(process.cwd(), "scripts", "setup-extract-eval", "gold");
const OUT_DIR = join(process.cwd(), "scripts", "setup-extract-eval", "results");

type ExpectedFile = {
  /** Draft gold sets are reported but clearly labeled. */
  status?: "draft" | "verified";
  fields: Record<string, string | { value: string; accept?: string[] }>;
};

type FieldOutcome = "correct" | "wrong_flagged" | "wrong_confident";

function loadExpected(path: string): ExpectedFile {
  return JSON.parse(readFileSync(path, "utf8")) as ExpectedFile;
}

async function main() {
  const filter = process.argv[2]?.toLowerCase() ?? "";
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error("OPENAI_API_KEY is not set (run via npm script so .env.local loads).");
    process.exit(1);
  }
  const model = process.env.SETUP_EXTRACT_MODEL?.trim() || DEFAULT_SETUP_EXTRACT_MODEL;
  const modelB = process.env.SETUP_EXTRACT_MODEL_B?.trim() || DEFAULT_SETUP_EXTRACT_MODEL_B;
  // Bulk-aggregation lane knobs: SETUP_EXTRACT_PASSES=1 (cheap single pass) and
  // SETUP_EXTRACT_SCOPE=universal (score only cross-car aggregation parameters).
  const passes = process.env.SETUP_EXTRACT_PASSES?.trim() === "1" ? (1 as const) : (2 as const);
  const universalScope = process.env.SETUP_EXTRACT_SCOPE?.trim() === "universal";

  const styles = readdirSync(GOLD_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory());
  let totalCorrect = 0;
  let totalWrongFlagged = 0;
  let totalWrongConfident = 0;
  let totalFields = 0;
  const confidentMistakes: string[] = [];
  mkdirSync(OUT_DIR, { recursive: true });

  for (const style of styles) {
    const styleDir = join(GOLD_ROOT, style.name);
    const schemaRaw = JSON.parse(readFileSync(join(styleDir, "schema.json"), "utf8"));
    const schema = parseExtractionSchema(schemaRaw);
    if (!schema) {
      console.error(`Invalid schema.json in ${style.name}`);
      continue;
    }
    const filesDir = join(styleDir, "files");
    const expectedDir = join(styleDir, "expected");
    if (!existsSync(expectedDir)) continue;

    for (const expFile of readdirSync(expectedDir).filter((f) => f.endsWith(".json"))) {
      const sheetBase = basename(expFile, ".json");
      if (filter && !sheetBase.toLowerCase().includes(filter)) continue;
      const imgPathPng = join(filesDir, `${sheetBase}.png`);
      const imgPathJpg = join(filesDir, `${sheetBase}.jpg`);
      const imgPath = existsSync(imgPathPng) ? imgPathPng : imgPathJpg;
      if (!existsSync(imgPath)) {
        console.error(`Missing sheet file for ${sheetBase}`);
        continue;
      }
      const expected = loadExpected(join(expectedDir, expFile));
      const goldTag = expected.status === "verified" ? "verified" : "DRAFT gold";

      const modelLabel = passes === 1 ? model : modelB !== model ? `${model}+${modelB}` : model;
      const scopeLabel = universalScope ? ", universal-scope" : "";
      process.stdout.write(
        `\n=== ${style.name} / ${sheetBase} (${goldTag}) — model ${modelLabel}, ${passes === 1 ? "single-pass" : "dual-pass"}${scopeLabel}\n`
      );
      const t0 = Date.now();
      const extraction = await extractSetupFromImage({
        apiKey,
        imageBytes: readFileSync(imgPath),
        imageMime: imgPath.endsWith(".jpg") ? "image/jpeg" : "image/png",
        schema,
        model,
        modelB,
        passes,
      });
      const ms = Date.now() - t0;

      const byKey = new Map(extraction.fields.map((f) => [f.key, f]));
      let correct = 0;
      const wrongFlagged: string[] = [];
      const wrongConfident: string[] = [];

      const scoredEntries = Object.entries(expected.fields).filter(
        ([key]) => !universalScope || suggestUniversalParameterId(key) !== undefined
      );
      for (const [key, expRaw] of scoredEntries) {
        const exp = typeof expRaw === "string" ? { value: expRaw } : expRaw;
        const got = byKey.get(key) ?? { key, value: "", confidence: 0 };
        const ok = matchesExpected({ extracted: got.value, expected: exp.value, accept: exp.accept });
        let outcome: FieldOutcome;
        if (ok) {
          outcome = "correct";
          correct++;
        } else if (isFlagged(got)) {
          outcome = "wrong_flagged";
          wrongFlagged.push(`${key}: got "${got.value}" (conf ${got.confidence.toFixed(2)}) expected "${exp.value}"`);
        } else {
          outcome = "wrong_confident";
          const line = `${key}: got "${got.value}" (conf ${got.confidence.toFixed(2)}) expected "${exp.value}"`;
          wrongConfident.push(line);
          confidentMistakes.push(`${sheetBase} :: ${line}`);
        }
        void outcome;
      }

      const n = scoredEntries.length;
      const flaggedCount = extraction.fields.filter(isFlagged).length;
      totalCorrect += correct;
      totalWrongFlagged += wrongFlagged.length;
      totalWrongConfident += wrongConfident.length;
      totalFields += n;

      const orFlagged = ((correct + wrongFlagged.length) / n) * 100;
      console.log(
        `fields ${n} | correct ${correct} | wrong-flagged ${wrongFlagged.length} | WRONG-CONFIDENT ${wrongConfident.length} | correct-or-flagged ${orFlagged.toFixed(1)}% | flagged-for-review ${flaggedCount} | ${(ms / 1000).toFixed(1)}s`
      );
      if (wrongConfident.length > 0) {
        console.log(`  ✗ confident mistakes:`);
        for (const line of wrongConfident) console.log(`    ${line}`);
      }
      if (wrongFlagged.length > 0) {
        console.log(`  ~ flagged mistakes (review catches these):`);
        for (const line of wrongFlagged) console.log(`    ${line}`);
      }

      writeFileSync(
        join(OUT_DIR, `${sheetBase}.extraction.json`),
        JSON.stringify({ model, ms, extraction }, null, 2)
      );
    }
  }

  if (totalFields === 0) {
    console.error("\nNo gold sheets matched. Add expected/*.json files first.");
    process.exit(1);
  }
  const orFlagged = ((totalCorrect + totalWrongFlagged) / totalFields) * 100;
  const correctPct = (totalCorrect / totalFields) * 100;
  console.log(`\n================ TOTAL ================`);
  console.log(`fields scored     : ${totalFields}`);
  console.log(`correct           : ${totalCorrect} (${correctPct.toFixed(1)}%)`);
  console.log(`wrong but flagged : ${totalWrongFlagged}`);
  console.log(`WRONG CONFIDENT   : ${totalWrongConfident}`);
  console.log(`correct-or-flagged: ${orFlagged.toFixed(1)}%  (ship bar ≥ 95%, flag threshold ${EXTRACTION_FLAG_THRESHOLD})`);
  if (confidentMistakes.length > 0) {
    console.log(`\nAll confident mistakes:`);
    for (const line of confidentMistakes) console.log(`  ${line}`);
  }
  console.log(`\nRaw extractions written to scripts/setup-extract-eval/results/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
