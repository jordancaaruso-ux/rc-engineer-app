/**
 * Score every case in mtc3-loop/cases against the LIVE MTC3 calibration.
 * Prints per-case accuracy + every failing field with its classification, and writes
 * a machine-readable report for the fix step.
 *
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/setup-extract-eval/mtc3-loop/score.ts
 *   Flags: --case=case-01 (only one case)  --runs=2 (repeat reads to expose OCR flakiness)
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import {
  loadLiveCalibration, readImageThroughCalibration, scoreCase,
  type GoldCase, type FieldVerdict,
} from "./mtc3-common";

const CASES_DIR = join(process.cwd(), "scripts", "setup-extract-eval", "mtc3-loop", "cases");
const REPORTS_DIR = join(process.cwd(), "scripts", "setup-extract-eval", "mtc3-loop", "reports");

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

export type CaseReport = {
  caseName: string;
  run: number;
  total: number;
  passed: number;
  failures: Array<FieldVerdict & { groupDetail?: { scores: Array<{ value: string; darkness: number }>; gate: string } }>;
};

async function main() {
  const apiKey = process.env.OPENAI_API_KEY!.trim();
  const live = await loadLiveCalibration();
  const only = arg("case");
  const runs = Number(arg("runs") ?? "1");

  const caseNames = readdirSync(CASES_DIR)
    .filter((f) => f.endsWith(".gold.json"))
    .map((f) => f.replace(".gold.json", ""))
    .filter((c) => !only || c === only)
    .sort();

  mkdirSync(REPORTS_DIR, { recursive: true });
  const reports: CaseReport[] = [];

  for (const caseName of caseNames) {
    const gold = JSON.parse(readFileSync(join(CASES_DIR, `${caseName}.gold.json`), "utf8")) as GoldCase;
    const jpg = readFileSync(join(CASES_DIR, `${caseName}.jpg`));
    const choicesOnly = process.argv.includes("--choices-only");
    for (let run = 1; run <= runs; run++) {
      const read = await readImageThroughCalibration(jpg, live.imageCalibration, apiKey, { skipOcr: choicesOnly });
      const verdicts = scoreCase(gold, read, live.imageCalibration).filter((v) => !choicesOnly || v.kind !== "text");
      const failures = verdicts
        .filter((v) => !v.ok)
        .map((v) => ({ ...v, ...(read.groupDetail[v.key] ? { groupDetail: { scores: read.groupDetail[v.key]!.scores, gate: read.groupDetail[v.key]!.gate } } : {}) }));
      const passed = verdicts.length - failures.length;
      reports.push({ caseName, run, total: verdicts.length, passed, failures });
      console.log(`\n${caseName} run${run}: ${passed}/${verdicts.length} (${((passed / verdicts.length) * 100).toFixed(1)}%)`);
      for (const f of failures) {
        const extra = f.groupDetail
          ? `  [${f.groupDetail.gate}] ${f.groupDetail.scores.slice(0, 4).map((s) => {
              const red = (s as { redness?: number }).redness;
              return `${s.value}=d${s.darkness.toFixed(3)}${red != null ? `/r${red.toFixed(3)}` : ""}`;
            }).join(" ")}`
          : "";
        console.log(`  FAIL ${f.failMode?.padEnd(13)} ${f.kind.padEnd(8)} ${f.key.padEnd(26)} gold="${f.gold}" read="${f.read}"${extra}`);
      }
    }
  }

  const summaryPath = join(REPORTS_DIR, `score-${Date.now()}.json`);
  writeFileSync(summaryPath, JSON.stringify(reports, null, 2));
  const totalFields = reports.reduce((s, r) => s + r.total, 0);
  const totalPassed = reports.reduce((s, r) => s + r.passed, 0);
  console.log(`\n=== OVERALL: ${totalPassed}/${totalFields} (${((totalPassed / totalFields) * 100).toFixed(2)}%) across ${reports.length} case-runs ===`);
  console.log(`Report: ${summaryPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
