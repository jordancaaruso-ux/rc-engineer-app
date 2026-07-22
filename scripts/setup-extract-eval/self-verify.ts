/**
 * Generalized setup-sheet self-verify loop (full-sheet images).
 *
 * Fill the calibration's blank AcroForm with known values -> render page 1 server-side -> read
 * through the REAL production image pipeline -> diff vs the filled gold. Free ground truth; the
 * loop is its own accuracy test. Use to tune a derived image map to near-perfect for a model.
 *
 *   npm run setup-extract:self-verify -- --cal=<calId> [--cases=5] [--choices-only] [--case=3] [--verbose]
 * or:
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/setup-extract-eval/self-verify.ts --cal=<calId>
 */
import { prisma } from "@/lib/prisma";
import {
  loadCalibrationForVerify,
  loadAcroGeometry,
  fillSyntheticCase,
  extractGoldFromFilledPdf,
  renderPdfFirstPageToPng,
  readThroughProductionPipeline,
  readThroughAcroFormPipeline,
  scoreCaseRaw,
  rederiveImageMap,
  type FieldVerdict,
} from "./selfVerifyCore";

function arg(flag: string): string | undefined {
  const hit = process.argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
}

async function main() {
  const calId = arg("--cal");
  if (!calId) throw new Error("Pass --cal=<calibrationId>");
  const nCases = Number(arg("--cases") ?? "5");
  const choicesOnly = Boolean(arg("--choices-only"));
  const onlyCase = arg("--case") ? Number(arg("--case")) : undefined;
  const verbose = Boolean(arg("--verbose"));

  const rederive = Boolean(arg("--rederive"));
  const acroform = Boolean(arg("--acroform"));

  console.log(`Loading calibration ${calId} …`);
  const live = await loadCalibrationForVerify(calId);
  if (rederive) {
    const r = await rederiveImageMap(live);
    console.log(`Re-derived image map: ${r.derivedFields} fields, contentBox=${r.contentBoxDetected ? "yes" : "NO"}.`);
  }
  const geo = await loadAcroGeometry(live.blankPdfBytes);
  const fieldCount = live.imageCalibration.fields.length;
  console.log(`imageCalibration: ${fieldCount} fields; contentBox=${live.imageCalibration.reference.contentBox ? "yes" : "NO"}; path=${acroform ? "ACROFORM (form fields)" : "IMAGE (render + OCR)"}; running ${onlyCase ? 1 : nCases} case(s)${choicesOnly ? " (choices only)" : ""}.\n`);

  const totals = { ok: 0, fail: 0, byMode: { miss: 0, wrong: 0, hallucination: 0 } as Record<string, number> };
  // Aggregate per-field failure counts across cases so systematically-broken fields surface.
  const fieldFailCounts = new Map<string, { fails: number; kind: string; examples: FieldVerdict[] }>();

  const indices = onlyCase != null ? [onlyCase] : Array.from({ length: nCases }, (_, i) => i + 1);
  for (const i of indices) {
    const filled = await fillSyntheticCase({ caseIndex: i, live, blankPdfBytes: live.blankPdfBytes, geo });
    const gold = await extractGoldFromFilledPdf(filled, live);
    // --acroform reads the editable PDF straight through the form-field path (no render, no OCR);
    // the default renders it to an image and reads it the way a photo/flattened upload is read.
    const read = acroform
      ? await readThroughAcroFormPipeline(filled, live.rawData)
      : await readThroughProductionPipeline(
          await renderPdfFirstPageToPng(new Uint8Array(filled), { scale: 2 }),
          live.imageCalibration,
          live.rawData
        );
    let verdicts = scoreCaseRaw(gold, read, live.imageCalibration);
    if (choicesOnly) verdicts = verdicts.filter((v) => v.kind !== "text");

    const okN = verdicts.filter((v) => v.ok).length;
    const failN = verdicts.length - okN;
    totals.ok += okN;
    totals.fail += failN;
    console.log(`case-${i}: ${okN}/${verdicts.length} ok, align=${read.anchorMatchScore.toFixed(3)}${failN ? `  — ${failN} FAIL` : ""}`);
    for (const v of verdicts) {
      if (v.ok) continue;
      if (v.failMode) totals.byMode[v.failMode] = (totals.byMode[v.failMode] ?? 0) + 1;
      const rec = fieldFailCounts.get(v.key) ?? { fails: 0, kind: v.kind, examples: [] };
      rec.fails++;
      if (rec.examples.length < 3) rec.examples.push(v);
      fieldFailCounts.set(v.key, rec);
      if (verbose) console.log(`   FAIL ${v.failMode} [${v.kind}] ${v.key}: gold="${v.gold}" read="${v.read}"`);
    }
  }

  const totalScored = totals.ok + totals.fail;
  const pct = totalScored ? ((totals.ok / totalScored) * 100).toFixed(1) : "0";
  console.log(`\n=== ${totals.ok}/${totalScored} (${pct}%) — miss=${totals.byMode.miss ?? 0} wrong=${totals.byMode.wrong ?? 0} hallucination=${totals.byMode.hallucination ?? 0} ===`);

  if (fieldFailCounts.size) {
    console.log(`\nFields failing (most cases first):`);
    const ranked = [...fieldFailCounts.entries()].sort((a, b) => b[1].fails - a[1].fails);
    for (const [key, rec] of ranked) {
      const label = live.labelByKey.get(key);
      const ex = rec.examples[0]!;
      console.log(`  ${rec.fails}× [${rec.kind}] ${key}${label ? ` (${label})` : ""}  e.g. gold="${ex.gold}" read="${ex.read}" (${ex.failMode})`);
    }
  } else {
    console.log("\nAll scored fields passed. 🎯");
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
