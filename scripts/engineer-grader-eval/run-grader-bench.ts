/**
 * Phase 1 grader-eval driver — the core pairwise loop.
 *
 * For each scenario: seed its world on the throwaway branch, answer it TWICE (engine-A
 * vs engine-B — two model configs, swapped via ENGINEER_MODEL so both keep full tool
 * parity and no production code changes), then have the founder-calibrated judge pick a
 * winner. Writes a BLIND results file the pairwise page renders for the founder to label,
 * and ingest-pairwise.ts scores grader-vs-founder agreement against.
 *
 * Engines default gpt-5.5 (A) vs gpt-4o (B); override GRADER_ENGINE_A_MODEL /
 * GRADER_ENGINE_B_MODEL. Serial only — the model swap mutates a global env var, so
 * concurrency is pinned to 1.
 *
 * Run against the THROWAWAY BRANCH (see seedBranch.ts safety):
 *   npm run engineer:grader:bench -- --label=phase1 --reset
 */
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { runEngineerChatTurn } from "@/lib/engineerPhase5/engineerChatPipeline";
import {
  judgeEngineerAnswerPairwise,
  type JudgeExemplar,
  type PairwiseVerdict,
} from "@/lib/engineerFeedback/calibratedJudge";
import { sleepMs } from "@/lib/openAiRetry";
import type { Scenario } from "./types";
import { loadScenariosFromDirs } from "./scenarioIo";
import { assertGraderDb, purgeSynthetic, seedScenario } from "./seedBranch";

/** USD per 1M tokens (input, output). Estimates — update when models/prices move. */
const PRICING: Record<string, { inPerM: number; outPerM: number }> = {
  "gpt-5.5": { inPerM: 5, outPerM: 15 },
  "gpt-4o": { inPerM: 2.5, outPerM: 10 },
  "gpt-4o-mini": { inPerM: 0.15, outPerM: 0.6 },
  grok: { inPerM: 3, outPerM: 15 },
};
function priceFor(model: string) {
  const m = model.trim().toLowerCase();
  for (const key of Object.keys(PRICING)) if (m.startsWith(key)) return PRICING[key];
  return null;
}
function estCost(model: string, usage: { promptTokens: number; completionTokens: number } | null | undefined) {
  const p = priceFor(model);
  if (!usage || !p) return null;
  return (usage.promptTokens / 1e6) * p.inPerM + (usage.completionTokens / 1e6) * p.outPerM;
}

type EngineAnswer = {
  model: string;
  answer: string | null;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  estCostUsd: number | null;
};

type PairResult = {
  scenarioId: string;
  source: Scenario["source"];
  question: string;
  mode: string;
  tags: string[];
  difficultyTag: string | null;
  plantedError: { kind: string; description: string } | null;
  /** Engine identities are here for analysis; the pairwise PAGE must not show them. */
  engineA: EngineAnswer;
  engineB: EngineAnswer;
  /** Grader verdict in A/B terms (winner "A" | "B" | "tie"). */
  graderVerdict: PairwiseVerdict | null;
  error: string | null;
};

function arg(name: string): string | null {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}
function num(name: string, dflt: number): number {
  const v = Number(arg(name));
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

/** Force one model across every tier so engine-A/B differ only by the model variable. */
function applyEngineModel(model: string): void {
  process.env.ENGINEER_MODEL = model;
  delete process.env.ENGINEER_DEEP_MODEL;
  delete process.env.ENGINEER_LIGHT_MODEL;
}

async function loadExemplars(): Promise<JudgeExemplar[]> {
  const p = arg("exemplars") ?? path.join(process.cwd(), "scripts/engineer-grader-eval/results/exemplars.json");
  try {
    const parsed = JSON.parse(await fs.readFile(p, "utf8")) as { exemplars?: JudgeExemplar[] };
    return parsed.exemplars ?? [];
  } catch {
    console.warn(`No exemplars file at ${p} — judge runs from the rubric alone (less calibrated).`);
    return [];
  }
}

async function answerWith(
  model: string,
  seeded: { userId: string; runId: string; question: string; mode: Scenario["mode"] }
): Promise<EngineAnswer> {
  applyEngineModel(model);
  const t0 = Date.now();
  const turn = await runEngineerChatTurn({
    userId: seeded.userId,
    question: seeded.question,
    runId: seeded.runId,
    mode: seeded.mode,
  });
  const usage = turn.usage ?? null;
  return {
    model,
    answer: turn.reply,
    latencyMs: Date.now() - t0,
    promptTokens: usage?.promptTokens ?? null,
    completionTokens: usage?.completionTokens ?? null,
    estCostUsd: estCost(model, usage),
  };
}

async function main() {
  assertGraderDb(); // seeds write to the branch — refuse unless it's the declared throwaway DB
  const label = arg("label") ?? "phase1";
  const dir = arg("dir") ?? path.join(process.cwd(), "scripts/engineer-grader-eval/scenarios");
  const seedDir = path.join(process.cwd(), "scripts/engineer-grader-eval/seed");
  const tag = arg("tag");
  const limit = arg("limit") ? Math.floor(num("limit", Infinity)) : Infinity;
  const caseDelayMs = Math.floor(num("case-delay", 30) * 1000);
  const skipJudge = process.argv.includes("--skip-judge");
  const engineAModel = process.env.GRADER_ENGINE_A_MODEL?.trim() || "gpt-5.5";
  const engineBModel = process.env.GRADER_ENGINE_B_MODEL?.trim() || "gpt-4o";

  let scenarios = await loadScenariosFromDirs([dir, seedDir]);
  if (tag) scenarios = scenarios.filter((s) => (s.tags ?? []).includes(tag));
  if (Number.isFinite(limit)) scenarios = scenarios.slice(0, limit);
  if (scenarios.length === 0) throw new Error(`No scenarios found in ${dir} or ${seedDir}`);

  const exemplars = await loadExemplars();
  console.log(
    `Grader bench "${label}": ${scenarios.length} scenarios · A=${engineAModel} vs B=${engineBModel} · judge exemplars=${exemplars.length}`
  );

  if (process.argv.includes("--reset")) {
    const n = await purgeSynthetic();
    console.log(`Purged ${n} prior synthetic users.`);
  }

  const results: PairResult[] = [];
  for (let i = 0; i < scenarios.length; i++) {
    const scn = scenarios[i];
    if (i > 0 && caseDelayMs > 0) await sleepMs(caseDelayMs);
    process.stdout.write(`[${i + 1}/${scenarios.length}] ${scn.id} (${scn.mode})… `);
    try {
      const seeded = await seedScenario(scn);
      const engineA = await answerWith(engineAModel, seeded);
      const engineB = await answerWith(engineBModel, seeded);
      let graderVerdict: PairwiseVerdict | null = null;
      if (!skipJudge && engineA.answer && engineB.answer) {
        graderVerdict = await judgeEngineerAnswerPairwise({
          question: seeded.question,
          answerA: engineA.answer,
          answerB: engineB.answer,
          exemplars,
        });
      }
      console.log(
        `A ${Math.round(engineA.latencyMs / 1000)}s · B ${Math.round(engineB.latencyMs / 1000)}s · grader=${
          graderVerdict ? graderVerdict.winner + (graderVerdict.agreedBothOrders ? "" : "?") : "-"
        }`
      );
      results.push({
        scenarioId: scn.id,
        source: scn.source,
        question: seeded.question,
        mode: scn.mode,
        tags: scn.tags ?? [],
        difficultyTag: scn.difficultyTag ?? null,
        plantedError: scn.plantedError ?? null,
        engineA,
        engineB,
        graderVerdict,
        error: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`ERROR: ${msg}`);
      results.push({
        scenarioId: scn.id,
        source: scn.source,
        question: scn.question,
        mode: scn.mode,
        tags: scn.tags ?? [],
        difficultyTag: scn.difficultyTag ?? null,
        plantedError: scn.plantedError ?? null,
        engineA: { model: engineAModel, answer: null, latencyMs: 0, promptTokens: null, completionTokens: null, estCostUsd: null },
        engineB: { model: engineBModel, answer: null, latencyMs: 0, promptTokens: null, completionTokens: null, estCostUsd: null },
        graderVerdict: null,
        error: msg,
      });
    }
  }

  // --- Summary ---
  const judged = results.filter((r) => r.graderVerdict);
  const winnerCounts = { A: 0, B: 0, tie: 0 };
  let closeCalls = 0;
  for (const r of judged) {
    winnerCounts[r.graderVerdict!.winner] += 1;
    if (r.graderVerdict!.winner === "tie" || !r.graderVerdict!.agreedBothOrders) closeCalls += 1;
  }
  const costs = results.flatMap((r) => [r.engineA.estCostUsd, r.engineB.estCostUsd]).filter((c): c is number => c != null);
  const summary = {
    scenarioCount: results.length,
    errorCount: results.filter((r) => r.error).length,
    judgedCount: judged.length,
    graderWinnerCounts: winnerCounts,
    closeCallCount: closeCalls,
    totalEstCostUsd: costs.length ? Math.round(costs.reduce((s, c) => s + c, 0) * 100) / 100 : null,
  };

  const payload = {
    generatedAtIso: new Date().toISOString(),
    label,
    engineAModel,
    engineBModel,
    judgeModel: process.env.ENGINEER_JUDGE_MODEL?.trim() || "gpt-4o",
    exemplarCount: exemplars.length,
    summary,
    results,
  };

  const outDir = path.join(process.cwd(), "scripts/engineer-grader-eval/results");
  await fs.mkdir(outDir, { recursive: true });
  const stamp = payload.generatedAtIso.replace(/[:.]/g, "-");
  const outFile = path.join(outDir, `grader-${label}-${stamp}.json`);
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2), "utf8");

  console.log(`\n--- Grader bench "${label}" ---`);
  console.log(`Scenarios:      ${summary.scenarioCount} (${summary.errorCount} errors)`);
  console.log(`Grader winners: A ${winnerCounts.A} · B ${winnerCounts.B} · tie ${winnerCounts.tie}`);
  console.log(`Close-calls:    ${summary.closeCallCount} (tie or position-bias) — where trust is actually earned`);
  console.log(`Cost (both engines): ~$${summary.totalEstCostUsd ?? "n/a"} (estimates)`);
  console.log(`Results file:   ${outFile}`);
  console.log(`Next: npm run engineer:grader:rating-page  → label the pairs  → npm run engineer:grader:ingest`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
