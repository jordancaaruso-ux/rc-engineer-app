/**
 * Phase A driver — bank the scenario corpus while Grok access lasts.
 *
 * Screening design: walks the axis grid so every corner is probed at least once, rather
 * than crossing two guessed axes deeply. Grok writes only the driver's words; all setup /
 * lap / handling structure comes from Jordan's real runs.
 *
 * Prereq: run `npm run engineer:grader:snapshot-seeds` first (needs prod DB, read-only) —
 * the factory refuses to invent setups from nothing.
 *
 * Run:  npm run engineer:grader:generate -- --count=300
 *       --provider=xai|openai  --model=grok-4.5  --skip-llm  --dry-run  --out=<dir>
 */
import fs from "node:fs/promises";
import path from "node:path";
import type {
  ArchetypeId,
  HistoryDepth,
  ProblemTypeId,
  QuestionShapeId,
  Scenario,
  SetupFreshness,
  SetupPoolEntry,
} from "./types";
import { ARCHETYPE_IDS } from "./archetypes";
import { QUESTION_SHAPE_IDS } from "./questionShapes";
import { buildSkeleton, narrateScenario, type QuestionBank } from "./scenarioFactory";
import { gateScenario } from "./coherenceGate";
import { loadScenarios, writeScenario } from "./scenarioIo";
import { defaultModelFor, type LlmProviderId } from "./provider/resolveProvider";

const HISTORY_DEPTHS: HistoryDepth[] = ["single-run", "single-day", "single-day", "season"]; // single-day dominant
const SETUP_FRESHNESS: SetupFreshness[] = ["fresh", "stale", "partial"];
const PROBLEM_TYPES: ProblemTypeId[] = [
  "entry-understeer",
  "mid-understeer",
  "exit-oversteer",
  "on-power-snap",
  "traction-roll",
  "braking-loose",
  "darty",
  "inconsistent",
  "tires-going-off",
  "nothing-wrong",
];
const GRIP_LEVELS: Array<"LOW" | "MEDIUM" | "HIGH"> = ["LOW", "MEDIUM", "HIGH"];
const CAR_FAMILIARITY: Array<"template" | "sparse"> = ["template", "template", "sparse"];
const DATA_CONFLICTS: Array<string | null> = [null, null, null, "felt-worse-but-faster"];

function arg(name: string): string | null {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

/**
 * Shapes whose wording presupposes something is wrong. Pairing one with the
 * "nothing-wrong" problem produces nonsense ("the best it's been is costing me the most
 * time"), so the pairing is corrected rather than left for the gate to reject.
 */
const PROBLEM_ASSUMING_SHAPES = new Set<QuestionShapeId>([
  "pointed",
  "trackside-urgent",
  "laundry-bait",
  "demanding",
  "challenging",
  "vague",
]);

/** FNV-1a — spreads the secondary axes without correlating them to the primary walk. */
function hashPick(seed: string, length: number): number {
  if (length <= 0) return 0;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % length;
}

/**
 * Screening walk. The two headline axes (question shape × problem type) are crossed as an
 * explicit product so all 10×10 combinations appear within 100 scenarios; the rest are
 * hash-spread so they don't correlate with that walk.
 *
 * Co-prime strides were WRONG here: shapes and problems are both length 10, so `i*3 % 10`
 * and `i*7 % 10` share a period and locked each shape to exactly one problem — a third of
 * the grid could never be generated.
 */
function cellFor(i: number) {
  const shapeCount = QUESTION_SHAPE_IDS.length;
  const problemCount = PROBLEM_TYPES.length;
  const questionShape: QuestionShapeId = QUESTION_SHAPE_IDS[i % shapeCount];
  const archetype: ArchetypeId = ARCHETYPE_IDS[hashPick(`arch|${i}`, ARCHETYPE_IDS.length)];
  let problemType = PROBLEM_TYPES[Math.floor(i / shapeCount) % problemCount];
  // "What should I change?" when nothing is wrong is the whole point of no-change-bait.
  if (questionShape === "no-change-bait") {
    problemType = "nothing-wrong";
  } else if (problemType === "nothing-wrong" && PROBLEM_ASSUMING_SHAPES.has(questionShape)) {
    // Swap in a real symptom — the shape only makes sense against an actual problem.
    problemType = PROBLEM_TYPES[(i * 7 + 1) % (PROBLEM_TYPES.length - 1)];
  }
  // "Walk me through the day" needs a day to walk through — a lone run would just be
  // rejected, wasting the cell.
  const historyDepth =
    questionShape === "debrief"
      ? (["single-day", "single-day", "season"] as const)[hashPick(`hist|${i}`, 3)]
      : HISTORY_DEPTHS[hashPick(`hist|${i}`, HISTORY_DEPTHS.length)];
  const setupFreshness = SETUP_FRESHNESS[hashPick(`fresh|${i}`, SETUP_FRESHNESS.length)];
  const gripLevel = GRIP_LEVELS[hashPick(`grip|${i}`, GRIP_LEVELS.length)];
  const carFamiliarity = CAR_FAMILIARITY[hashPick(`car|${i}`, CAR_FAMILIARITY.length)];
  // A no-timing user has no lap data, so a "felt worse but was faster" conflict is
  // impossible — generating it just burns a cell on a guaranteed rejection.
  const dataConflict =
    archetype === "no-timing" ? null : DATA_CONFLICTS[hashPick(`conf|${i}`, DATA_CONFLICTS.length)];
  return {
    archetype,
    questionShape,
    problemType,
    historyDepth,
    setupFreshness,
    gripLevel,
    carFamiliarity,
    dataConflict,
  };
}

async function main() {
  const count = Math.max(1, Math.floor(Number(arg("count") ?? 60)));
  const provider = (arg("provider") as LlmProviderId) ?? "xai";
  const model = arg("model") ?? defaultModelFor(provider);
  const skipLlm = process.argv.includes("--skip-llm");
  const dryRun = process.argv.includes("--dry-run");
  const seedDir = arg("seeds") ?? path.join(process.cwd(), "scripts/engineer-grader-eval/seed");
  const outDir = arg("out") ?? path.join(process.cwd(), "scripts/engineer-grader-eval/scenarios");

  const seeds = await loadScenarios(seedDir);
  if (seeds.length === 0) {
    throw new Error(
      `No real-run seeds in ${seedDir}. Run \`npm run engineer:grader:snapshot-seeds\` first — ` +
        `the factory perturbs YOUR real setups and will not invent them.`
    );
  }

  // The setup pool is the "full mix" — every sheet behind the aggregation dataset, so
  // scenarios span many chassis and tuning philosophies, not one driver's two tracks.
  let pool: SetupPoolEntry[] = [];
  try {
    const raw = JSON.parse(await fs.readFile(path.join(seedDir, "_setup-pool.json"), "utf8")) as {
      entries?: SetupPoolEntry[];
    };
    pool = raw.entries ?? [];
  } catch {
    pool = [];
  }
  if (pool.length === 0) {
    console.warn(
      `No _setup-pool.json — falling back to the seeds' own setups (narrower mix). ` +
        `Re-run snapshot-seeds to build the pool.`
    );
  }

  // Committed, reviewable driver-voice variants — the no-API path to question variety.
  let questionBank: QuestionBank | null = null;
  try {
    questionBank = JSON.parse(
      await fs.readFile(path.join(process.cwd(), "scripts/engineer-grader-eval/questionBank.json"), "utf8")
    ) as QuestionBank;
  } catch {
    console.warn("No questionBank.json — falling back to one template per shape (highly repetitive).");
  }
  const bankSize = questionBank
    ? Object.values(questionBank.shapes ?? {}).reduce((s, v) => s + v.length, 0)
    : 0;

  console.log(
    `Generating ${count} scenarios from ${seeds.length} real seeds · setup pool ${pool.length} sheets · question bank ${bankSize} variants · narrator=${skipLlm ? "off (bank only)" : `${provider}/${model}`}${dryRun ? " · DRY RUN" : ""}`
  );

  const stats = { written: 0, ruleFailed: 0, llmFailed: 0, narrateFailed: 0 };
  const cellCounts = new Map<string, number>();
  const templateCounts = new Map<string, number>();

  for (let i = 0; i < count; i++) {
    const cell = cellFor(i);
    const base = seeds[i % seeds.length];
    // Stride the pool separately from the seeds so world-structure and setup-sheet
    // combinations don't lock in step with each other.
    const setupEntry = pool.length ? pool[(i * 3 + 1) % pool.length] : null;
    let scn: Scenario;
    try {
      scn = buildSkeleton({ base, index: i, setupEntry, questionBank, ...cell });
    } catch (err) {
      console.log(`  [${i}] skeleton failed: ${err instanceof Error ? err.message : err}`);
      stats.ruleFailed++;
      continue;
    }

    if (!skipLlm) {
      try {
        scn = await narrateScenario(scn, { provider, model });
      } catch (err) {
        stats.narrateFailed++;
        console.log(`  [${i}] narration failed, keeping fallback wording: ${err instanceof Error ? err.message : err}`);
      }
    }

    const coherence = await gateScenario(scn, { provider, model, skipLlm });
    scn.coherence = coherence;
    if (coherence.verdict === "fail") {
      if (coherence.checkedBy === "rules") stats.ruleFailed++;
      else stats.llmFailed++;
      console.log(`  [${i}] ${scn.id} REJECTED (${coherence.checkedBy}): ${coherence.reason}`);
      continue;
    }

    if (!dryRun) await writeScenario(outDir, scn);
    stats.written++;
    const key = `${cell.archetype}|${cell.questionShape}`;
    cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
    templateCounts.set(
      scn.world.car.setupSheetTemplate ?? "(none)",
      (templateCounts.get(scn.world.car.setupSheetTemplate ?? "(none)") ?? 0) + 1
    );
    if (stats.written % 20 === 0) console.log(`  …${stats.written} written`);
  }

  console.log(`\n--- Corpus ---`);
  console.log(`Written:        ${stats.written}${dryRun ? " (dry run — nothing saved)" : ` → ${outDir}`}`);
  console.log(`Rejected:       ${stats.ruleFailed} by rules · ${stats.llmFailed} by coherence check`);
  if (stats.narrateFailed) console.log(`Narration fell back to templates on ${stats.narrateFailed}`);
  console.log(`Distinct archetype×question cells covered: ${cellCounts.size}`);
  console.log(
    `Chassis mix: ${[...templateCounts.entries()].map(([t, n]) => `${t}×${n}`).join(" · ") || "none"}`
  );
  if (!dryRun && stats.written > 0) {
    const manifest = path.join(outDir, "_corpus-summary.json");
    await fs.writeFile(
      manifest,
      JSON.stringify({ generatedAtIso: new Date().toISOString(), provider, model, stats, count }, null, 2),
      "utf8"
    );
    console.log(`Summary:        ${manifest}`);
  }
  console.log(`\nNext: eyeball a few scenarios, then run the answers pass.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
