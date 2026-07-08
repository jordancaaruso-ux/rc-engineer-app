/**
 * Failure-distribution report — ENGINEER_SUGGESTION_QUALITY_PLAN.md, step 1 / first
 * concrete artifact (a).
 *
 * The plan decides its next month by NUMBERS, not argument: tag every bench + rated
 * production failure as misdiagnosis / miscalibration / genericness / laundry_list and
 * read the distribution. Diagnosis-layer dominant → build the diagnosis keystone;
 * miscalibration dominant → build the calibration keystone.
 *
 * MODES
 *   (default)      Free tag-mapping over existing bench result files. No DB, no OpenAI.
 *                  BLIND to misdiagnosis (no judge tag exists) — reported as unmeasured.
 *   --classify     Re-run the rubric-decomposed LLM classifier on each answer. Measures
 *                  misdiagnosis, the rubric, and the false-confidence veto. Costs OpenAI $.
 *   --production[=N]  Also pull latest N rated production answers from the DB and classify
 *                  them (implies --classify; needs .env.local + DB).
 *
 * Run (free):     npx tsx scripts/engineer-bench/failure-distribution.ts
 * Run (classify): npx dotenv-cli -e .env.local -- npx tsx scripts/engineer-bench/failure-distribution.ts --classify
 * Run (prod):     npx dotenv-cli -e .env.local -- npx tsx scripts/engineer-bench/failure-distribution.ts --classify --production=50
 * Args: --files=a.json,b.json  --label=name  --production=N
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  addToDistribution,
  emptyDistribution,
  judgeTagsToFailureClasses,
  judgeTagsToSecondarySignals,
  knowledgeLayerFailureCount,
  primaryFailureFromClasses,
  FAILURE_CLASSES,
  SECONDARY_FAILURE_SIGNALS,
  type FailureClass,
  type FailureDistribution,
  type SecondaryFailureSignal,
} from "@/lib/engineerFeedback/failureTaxonomy";
import { classifyAnswerFailures, type CoverageAttribution } from "@/lib/engineerFeedback/failureClassifier";
import { buildKbCoverageManifest } from "@/lib/engineerFeedback/kbCoverageManifest";
import type { JudgeTag } from "@/lib/engineerFeedback/calibratedJudge";

const KB_DIR = path.join(process.cwd(), "content/vehicle-dynamics");

/** Read approved KB files (top-level, excludes drafts/ + readme) into the coverage manifest. */
async function loadApprovedKbManifest(): Promise<string> {
  const entries = await fs.readdir(KB_DIR, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && e.name.endsWith(".md") && e.name.toLowerCase() !== "readme.md");
  const loaded = await Promise.all(
    files.map(async (e) => ({ file: e.name, content: await fs.readFile(path.join(KB_DIR, e.name), "utf8") }))
  );
  return buildKbCoverageManifest(loaded);
}

const COVERAGE_KEYS: readonly CoverageAttribution[] = ["in_kb", "kb_gap", "mixed", "not_applicable", "unknown"];
function emptyCoverage(): Record<CoverageAttribution, number> {
  return Object.fromEntries(COVERAGE_KEYS.map((k) => [k, 0])) as Record<CoverageAttribution, number>;
}

const RESULTS_DIR = path.join(process.cwd(), "scripts/engineer-bench/results");

/** Case tags that make a case a confidence trap — where false confidence is the trap. */
const CONFIDENCE_TRAP_TAGS = new Set([
  "overconfidence-bait",
  "thin-context",
  "honest-uncertainty",
  "no-change-is-valid",
  "should-ask",
  "missing-input",
  "should-ask-or-baseline",
  "kb-gap",
  "cold-context",
  "thin-history",
  "past-window-check",
  "failed-test-is-information",
]);

type LoadedResult = {
  id: string;
  source: string;
  mode: string;
  tags: string[];
  question: string;
  answer: string | null;
  judge: { score0to10: number; tags: string[] } | null;
  error: string | null;
};

type LoadedRun = {
  label: string;
  answerModel: string;
  judgeModel: string;
  results: LoadedResult[];
};

type ClassifiedRubricTotals = {
  n: number;
  diagnosis: number;
  calibration: number;
  specificity: number;
  actionability: number;
  prediction: number;
};

type FileReport = {
  label: string;
  answerModel: string;
  judgeModel: string;
  n: number;
  avgJudgeScore: number | null;
  mode: "tag-mapped" | "classified";
  dist: FailureDistribution;
  /** Trap cases + how many committed false confidence on them. */
  trapCases: number;
  trapFalseConfidence: number;
  /** Only in classify mode. */
  rubric: ClassifiedRubricTotals | null;
  /** Classify mode: coverage of answers that carry >=1 failure class. */
  coverageOfFailures: Record<CoverageAttribution, number> | null;
  /** Classify mode: knowledge-layer failures (misdiagnosis primary or wrong_physics),
   *  split into KB gaps (→ KB sweep) vs failures despite coverage (→ diagnosis keystone). */
  knowledgeLayer: { total: number; kbGap: number; inKb: number; other: number } | null;
};

function parseArgs(argv: string[]) {
  const get = (name: string) =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
  const productionRaw = get("production");
  return {
    files: get("files")?.split(",").map((f) => f.trim()).filter(Boolean) ?? null,
    label: get("label") ?? "failure-distribution",
    classify: argv.includes("--classify") || argv.includes("--production") || productionRaw != null,
    production: argv.includes("--production") || productionRaw != null,
    productionLimit: productionRaw ? Math.max(1, Math.floor(Number(productionRaw)) || 50) : 50,
    // Skip the bench result files entirely — e.g. to classify ONLY production answers.
    noFiles: argv.includes("--no-files"),
  };
}

function isBenchRun(obj: unknown): obj is LoadedRun {
  return (
    !!obj &&
    typeof obj === "object" &&
    Array.isArray((obj as { results?: unknown }).results) &&
    (obj as { results: unknown[] }).results.every(
      (r) => !!r && typeof r === "object" && "id" in (r as object)
    )
  );
}

async function discoverResultFiles(): Promise<string[]> {
  const entries = await fs.readdir(RESULTS_DIR);
  return entries
    .filter((f) => f.endsWith(".json"))
    .filter((f) => !f.startsWith("pairwise-"))
    .filter((f) => f !== "founder-ratings.json")
    .map((f) => path.join(RESULTS_DIR, f));
}

async function loadRun(file: string): Promise<LoadedRun | null> {
  try {
    const obj = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    if (!isBenchRun(obj)) return null;
    const run = obj as LoadedRun & { setPath?: string };
    return {
      label: run.label ?? path.basename(file),
      answerModel: run.answerModel ?? "?",
      judgeModel: run.judgeModel ?? "?",
      results: run.results,
    };
  } catch {
    return null;
  }
}

function isTrapCase(caseTags: string[]): boolean {
  return caseTags.some((t) => CONFIDENCE_TRAP_TAGS.has(t));
}

async function buildFileReport(run: LoadedRun, classify: boolean, manifest: string): Promise<FileReport> {
  const judged = run.results.filter((r) => !r.error && r.answer && r.judge);
  const dist = emptyDistribution();
  const rubric: ClassifiedRubricTotals = {
    n: 0,
    diagnosis: 0,
    calibration: 0,
    specificity: 0,
    actionability: 0,
    prediction: 0,
  };
  const coverageOfFailures = emptyCoverage();
  const knowledgeLayer = { total: 0, kbGap: 0, inKb: 0, other: 0 };
  let trapCases = 0;
  let trapFalseConfidence = 0;

  for (const r of judged) {
    const trap = isTrapCase(r.tags);
    if (trap) trapCases += 1;

    if (classify) {
      process.stdout.write(`  classify ${run.label}/${r.id}… `);
      const a = await classifyAnswerFailures({
        question: r.question,
        answer: r.answer!,
        kbCoverageManifest: manifest,
      });
      addToDistribution(dist, a.failureClasses, a.secondarySignals);
      rubric.n += 1;
      rubric.diagnosis += a.rubric.diagnosis;
      rubric.calibration += a.rubric.calibration;
      rubric.specificity += a.rubric.specificity;
      rubric.actionability += a.rubric.actionability;
      rubric.prediction += a.rubric.prediction;
      if (trap && a.falseConfidenceVeto) trapFalseConfidence += 1;
      if (a.failureClasses.length > 0) coverageOfFailures[a.coverage] += 1;
      // Knowledge-layer split: misdiagnosis primary or a wrong-physics claim.
      if (a.primaryFailure === "misdiagnosis" || a.secondarySignals.includes("wrong_physics")) {
        knowledgeLayer.total += 1;
        if (a.coverage === "kb_gap") knowledgeLayer.kbGap += 1;
        else if (a.coverage === "in_kb") knowledgeLayer.inKb += 1;
        else knowledgeLayer.other += 1;
      }
      process.stdout.write(`${a.primaryFailure ?? "clean"} [${a.coverage}]\n`);
    } else {
      const tags = (r.judge!.tags ?? []) as JudgeTag[];
      addToDistribution(dist, judgeTagsToFailureClasses(tags), judgeTagsToSecondarySignals(tags));
      if (trap && tags.includes("false_confidence")) trapFalseConfidence += 1;
    }
  }

  const scores = judged.map((r) => r.judge!.score0to10);
  const avgJudgeScore =
    scores.length > 0 ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 100) / 100 : null;

  return {
    label: run.label,
    answerModel: run.answerModel,
    judgeModel: run.judgeModel,
    n: judged.length,
    avgJudgeScore,
    mode: classify ? "classified" : "tag-mapped",
    dist,
    trapCases,
    trapFalseConfidence,
    rubric: classify ? rubric : null,
    coverageOfFailures: classify ? coverageOfFailures : null,
    knowledgeLayer: classify ? knowledgeLayer : null,
  };
}

/** Pull rated production answers and classify them as a synthetic "production" run. */
async function buildProductionReport(limit: number, manifest: string): Promise<FileReport | null> {
  const { prisma } = await import("@/lib/prisma");
  const rows = await prisma.engineerMessageRating.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: { stars: true, contextSnapshot: true },
  });
  const dist = emptyDistribution();
  const rubric: ClassifiedRubricTotals = {
    n: 0,
    diagnosis: 0,
    calibration: 0,
    specificity: 0,
    actionability: 0,
    prediction: 0,
  };
  const coverageOfFailures = emptyCoverage();
  const knowledgeLayer = { total: 0, kbGap: 0, inKb: 0, other: 0 };
  const scores: number[] = [];
  let considered = 0;
  for (const row of rows) {
    const snap = row.contextSnapshot as Record<string, unknown> | null;
    const question = typeof snap?.question === "string" ? snap.question.trim() : "";
    const answer = typeof snap?.answer === "string" ? snap.answer.trim() : "";
    if (!question || !answer) continue;
    considered += 1;
    scores.push(row.stars);
    process.stdout.write(`  classify production/${considered}… `);
    const a = await classifyAnswerFailures({ question, answer, kbCoverageManifest: manifest });
    addToDistribution(dist, a.failureClasses, a.secondarySignals);
    rubric.n += 1;
    rubric.diagnosis += a.rubric.diagnosis;
    rubric.calibration += a.rubric.calibration;
    rubric.specificity += a.rubric.specificity;
    rubric.actionability += a.rubric.actionability;
    rubric.prediction += a.rubric.prediction;
    if (a.failureClasses.length > 0) coverageOfFailures[a.coverage] += 1;
    if (a.primaryFailure === "misdiagnosis" || a.secondarySignals.includes("wrong_physics")) {
      knowledgeLayer.total += 1;
      if (a.coverage === "kb_gap") knowledgeLayer.kbGap += 1;
      else if (a.coverage === "in_kb") knowledgeLayer.inKb += 1;
      else knowledgeLayer.other += 1;
    }
    process.stdout.write(`${a.primaryFailure ?? "clean"} [${a.coverage}]\n`);
  }
  await prisma.$disconnect();
  if (considered === 0) return null;
  return {
    label: `production (${considered} rated)`,
    answerModel: "production",
    judgeModel: "classifier",
    n: considered,
    avgJudgeScore: Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 100) / 100,
    mode: "classified",
    dist,
    trapCases: 0,
    trapFalseConfidence: 0,
    rubric,
    coverageOfFailures,
    knowledgeLayer,
  };
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

function renderMarkdown(reports: FileReport[], classify: boolean): string {
  const lines: string[] = [];
  lines.push(`# Engineer failure distribution`);
  lines.push("");
  lines.push(
    `Generated by \`scripts/engineer-bench/failure-distribution.ts\` (${classify ? "classified — LLM rubric" : "tag-mapped — free"}).`
  );
  lines.push("");
  if (!classify) {
    lines.push(
      `> **Misdiagnosis is UNMEASURED in tag-mapped mode** — the calibrated judge has no misdiagnosis tag, so a 0 below means "not measured", not "absent". Run \`--classify\` to measure it.`
    );
    lines.push("");
  }

  // Primary-failure table across configs — the keystone read.
  lines.push(`## Primary failure by config (single worst failure per answer)`);
  lines.push("");
  const header = ["config", "model", "n", "avg", ...FAILURE_CLASSES, "clean", "trap-FC"];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const r of reports) {
    const cells = [
      r.label,
      r.answerModel,
      String(r.n),
      r.avgJudgeScore != null ? r.avgJudgeScore.toFixed(2) : "–",
      ...FAILURE_CLASSES.map((c) => `${r.dist.byPrimary[c]} (${pct(r.dist.byPrimary[c], r.n)})`),
      `${r.dist.cleanCount} (${pct(r.dist.cleanCount, r.n)})`,
      r.trapCases > 0 ? `${r.trapFalseConfidence}/${r.trapCases}` : "–",
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push("");

  // Secondary signals.
  lines.push(`## Secondary signals (multi-label, not part of the four-way decision)`);
  lines.push("");
  const sHeader = ["config", ...SECONDARY_FAILURE_SIGNALS];
  lines.push(`| ${sHeader.join(" | ")} |`);
  lines.push(`| ${sHeader.map(() => "---").join(" | ")} |`);
  for (const r of reports) {
    const cells = [
      r.label,
      ...SECONDARY_FAILURE_SIGNALS.map((s) => `${r.dist.bySecondary[s]} (${pct(r.dist.bySecondary[s], r.n)})`),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push("");

  if (classify) {
    lines.push(`## Rubric averages (classified mode)`);
    lines.push("");
    const rHeader = ["config", "diagnosis /3", "calibration /3", "specificity /3", "actionability /3", "prediction /1"];
    lines.push(`| ${rHeader.join(" | ")} |`);
    lines.push(`| ${rHeader.map(() => "---").join(" | ")} |`);
    for (const r of reports) {
      if (!r.rubric || r.rubric.n === 0) continue;
      const n = r.rubric.n;
      const avg = (x: number) => (x / n).toFixed(2);
      lines.push(
        `| ${r.label} | ${avg(r.rubric.diagnosis)} | ${avg(r.rubric.calibration)} | ${avg(
          r.rubric.specificity
        )} | ${avg(r.rubric.actionability)} | ${avg(r.rubric.prediction)} |`
      );
    }
    lines.push("");
  }

  if (classify) {
    lines.push(`## Coverage attribution — reasoning failure vs KB gap (classified mode)`);
    lines.push("");
    lines.push(
      `Splits failures by whether the physics the answer needed was in the KB. \`kb_gap\` → the KB-completion sweep; \`in_kb\` → the diagnosis/calibration keystones. This is what keeps an incomplete KB from inflating the keystone case.`
    );
    lines.push("");
    const cHeader = ["config", "knowledge-layer fails", "of which KB gap", "despite coverage", "other/unclear"];
    lines.push(`| ${cHeader.join(" | ")} |`);
    lines.push(`| ${cHeader.map(() => "---").join(" | ")} |`);
    for (const r of reports) {
      if (!r.knowledgeLayer) continue;
      const k = r.knowledgeLayer;
      lines.push(`| ${r.label} | ${k.total} | ${k.kbGap} | ${k.inKb} | ${k.other} |`);
    }
    lines.push("");
  }

  // Keystone interpretation.
  lines.push(`## Keystone read`);
  lines.push("");
  for (const r of reports) {
    const knowledge = knowledgeLayerFailureCount(r.dist);
    const miscal = r.dist.byClass.miscalibration;
    const generic = r.dist.byClass.genericness;
    const misdxNote = knowledge.misdiagnosisMeasured
      ? `${r.dist.byClass.misdiagnosis} misdiagnosis`
      : `misdiagnosis UNMEASURED`;
    const gapNote =
      classify && r.knowledgeLayer
        ? ` — of ${r.knowledgeLayer.total} knowledge-layer fails, ${r.knowledgeLayer.kbGap} are KB gaps (→ sweep) and ${r.knowledgeLayer.inKb} are despite coverage (→ diagnosis keystone)`
        : "";
    lines.push(
      `- **${r.label}** — knowledge-layer failures (${misdxNote} + ${r.dist.bySecondary.wrong_physics} wrong-physics) = ${knowledge.count}; miscalibration = ${miscal}; genericness = ${generic}; laundry-list = ${r.dist.byClass.laundry_list}${gapNote}.`
    );
  }
  lines.push("");
  lines.push(
    classify
      ? `_Diagnosis keystone earns the next month only if knowledge-layer failures DESPITE coverage dominate; if they're mostly KB gaps, the KB-completion sweep is the lever. Calibration keystone if miscalibration dominates._`
      : `_Diagnosis keystone earns the next month if knowledge-layer + misdiagnosis dominate; calibration keystone if miscalibration dominates. Tag-mapped runs cannot see misdiagnosis or coverage attribution — run --classify for the real split._`
  );
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const files = args.noFiles
    ? []
    : args.files
      ? args.files.map((f) => (path.isAbsolute(f) ? f : path.join(RESULTS_DIR, f)))
      : await discoverResultFiles();

  // Coverage attribution only matters (and only costs tokens) in classify mode.
  const manifest = args.classify ? await loadApprovedKbManifest() : "";
  if (args.classify) console.log(`KB coverage manifest: ${manifest.split("\n").length} approved files\n`);

  const reports: FileReport[] = [];
  for (const file of files) {
    const run = await loadRun(file);
    if (!run) {
      console.warn(`skip (not a bench run): ${path.basename(file)}`);
      continue;
    }
    if (run.results.length === 0) continue;
    reports.push(await buildFileReport(run, args.classify, manifest));
  }

  if (args.production) {
    const prod = await buildProductionReport(args.productionLimit, manifest);
    if (prod) reports.push(prod);
    else console.warn("No rated production answers with question+answer found.");
  }

  if (reports.length === 0) {
    console.error("No bench result files found. Run engineer:bench first, or pass --files=.");
    process.exit(1);
  }

  const md = renderMarkdown(reports, args.classify);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(RESULTS_DIR, `${args.label}-${stamp}.json`);
  const mdPath = path.join(RESULTS_DIR, `${args.label}-${stamp}.md`);
  await fs.writeFile(
    jsonPath,
    JSON.stringify({ generatedAtIso: new Date().toISOString(), mode: args.classify ? "classified" : "tag-mapped", reports }, null, 2),
    "utf8"
  );
  await fs.writeFile(mdPath, md, "utf8");

  console.log("\n" + md);
  console.log(`\nWrote ${path.relative(process.cwd(), jsonPath)}`);
  console.log(`Wrote ${path.relative(process.cwd(), mdPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
