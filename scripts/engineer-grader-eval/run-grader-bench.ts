/**
 * Phase 1 grader-eval driver — the core pairwise loop.
 *
 * For each scenario: seed its world on the throwaway branch, answer it TWICE (engine-A
 * vs engine-B — two engine CONFIGS, applied via env vars so both keep full tool parity
 * and no production code changes), then have the founder-calibrated judge pick a winner.
 * Writes a BLIND results file the pairwise page renders for the founder to label, and
 * ingest-pairwise.ts scores grader-vs-founder agreement against.
 *
 * Both engines default gpt-5.5 — the model question is settled (founder, 2026-07-29);
 * engines differ by CONFIG, not model. Two levers:
 *   GRADER_ENGINE_A_MODEL / GRADER_ENGINE_B_MODEL   (rarely needed now)
 *   GRADER_ENGINE_A_ENV / GRADER_ENGINE_B_ENV       ("K=V,K=V" — any env-flagged
 *     experiment, e.g. B="ENGINEER_RULE13_OFF=1" for the rule-13 A/B, or
 *     B="ENGINEER_FULL_KB_IN_CONTEXT=0,ENGINEER_CHAT_CONTEXT_MAX_CHARS=8000" for the
 *     deliberately-degraded arm that validates the grader against known-direction gaps)
 * Serial only — the config swap mutates global env vars, so concurrency is pinned to 1.
 *
 * Run against the THROWAWAY BRANCH (see seedBranch.ts safety):
 *   npm run engineer:grader:bench -- --label=phase1 --reset
 *
 * Re-judge an existing results file (new judge model/exemplars, no re-answering cost):
 *   ENGINEER_JUDGE_MODEL=gpt-5.5 npm run engineer:grader:bench -- --rejudge=results/grader-<label>-<stamp>.json
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
import { estimateCostUsd } from "@/lib/aiUsage/budgets";
import { sleepMs } from "@/lib/openAiRetry";
import type { Scenario } from "./types";
import { loadScenariosFromDirs } from "./scenarioIo";
import { assertGraderDb, purgeSynthetic, seedScenario } from "./seedBranch";

/**
 * USD per 1M tokens for providers `budgets.ts` doesn't know about.
 *
 * OpenAI models are priced by `estimateCostUsd` below — the same table the production spend cap
 * uses. This file used to keep a full copy, and it had gpt-5.5 at 5/15 while the bench had 1.25/10
 * and the truth is 5/30; three tables, three answers. Only xAI lives here now, because it is
 * eval-only and has no business in the production cap table.
 */
const NON_OPENAI_PRICING: Record<string, { inPerM: number; outPerM: number }> = {
  grok: { inPerM: 3, outPerM: 15 },
};

function estCost(
  model: string,
  usage:
    | { promptTokens: number; completionTokens: number; cachedPromptTokens?: number }
    | null
    | undefined
) {
  if (!usage) return null;
  const m = model.trim().toLowerCase();
  const nonOpenAi = Object.keys(NON_OPENAI_PRICING).find((k) => m.startsWith(k));
  if (nonOpenAi) {
    const p = NON_OPENAI_PRICING[nonOpenAi];
    return (usage.promptTokens / 1e6) * p.inPerM + (usage.completionTokens / 1e6) * p.outPerM;
  }
  return estimateCostUsd({
    model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    cachedPromptTokens: usage.cachedPromptTokens,
  });
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
  /** True when the question was asked with no runId/mode — the un-anchored production path. */
  unanchored: boolean;
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

/** Parse "K=V,K=V" engine-config specs (GRADER_ENGINE_A_ENV / GRADER_ENGINE_B_ENV). */
function parseEngineEnv(spec: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (spec ?? "").split(",")) {
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const k = pair.slice(0, idx).trim();
    if (k) out[k] = pair.slice(idx + 1).trim();
  }
  return out;
}

const ENGINE_A_ENV = parseEngineEnv(process.env.GRADER_ENGINE_A_ENV);
const ENGINE_B_ENV = parseEngineEnv(process.env.GRADER_ENGINE_B_ENV);
/** Union of both arms' keys — cleared before each answer so arms can't leak into each other. */
const ENGINE_ENV_KEYS = [...new Set([...Object.keys(ENGINE_A_ENV), ...Object.keys(ENGINE_B_ENV)])];

/**
 * Force one model across every tier and apply this engine's env overrides, so the two
 * answers differ only by the declared config. Clears the other arm's keys first.
 */
function applyEngineConfig(model: string, extraEnv: Record<string, string>): void {
  process.env.ENGINEER_MODEL = model;
  delete process.env.ENGINEER_DEEP_MODEL;
  delete process.env.ENGINEER_LIGHT_MODEL;
  for (const k of ENGINE_ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(extraEnv)) process.env[k] = v;
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
  extraEnv: Record<string, string>,
  seeded: { userId: string; runId: string; question: string; mode: Scenario["mode"] },
  opts?: { unanchored?: boolean }
): Promise<EngineAnswer> {
  applyEngineConfig(model, extraEnv);
  const t0 = Date.now();
  // Unanchored scenarios exercise the production path where no run is in focus — the
  // exact strata every pre-2026-07-29 eval skipped (a runId was always passed). The
  // world is still fully seeded; only the QUESTION arrives cold, like a driver typing
  // into an un-anchored chat. (Scenario `mode` is legacy corpus metadata — the mode
  // system is retired and runEngineerChatTurn no longer accepts it.)
  const turn = await runEngineerChatTurn({
    userId: seeded.userId,
    question: seeded.question,
    runId: opts?.unanchored ? undefined : seeded.runId,
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

function summarize(results: PairResult[]) {
  const judged = results.filter((r) => r.graderVerdict);
  const winnerCounts = { A: 0, B: 0, tie: 0 };
  let closeCalls = 0;
  for (const r of judged) {
    winnerCounts[r.graderVerdict!.winner] += 1;
    if (r.graderVerdict!.winner === "tie" || !r.graderVerdict!.agreedBothOrders) closeCalls += 1;
  }
  const costs = results
    .flatMap((r) => [r.engineA.estCostUsd, r.engineB.estCostUsd])
    .filter((c): c is number => c != null);
  return {
    scenarioCount: results.length,
    errorCount: results.filter((r) => r.error).length,
    judgedCount: judged.length,
    graderWinnerCounts: winnerCounts,
    closeCallCount: closeCalls,
    totalEstCostUsd: costs.length ? Math.round(costs.reduce((s, c) => s + c, 0) * 100) / 100 : null,
  };
}

/**
 * --rejudge=<results.json>: re-run the pairwise judge over an existing results file with
 * the CURRENT judge model + exemplars, writing a new file. Answers are reused verbatim —
 * this is the judge-upgrade path (e.g. ENGINEER_JUDGE_MODEL=gpt-5.5) without re-spending
 * the answer cost. No DB writes, so the throwaway-branch guard is skipped.
 */
async function rejudgeExisting(resultsPath: string): Promise<void> {
  const abs = path.isAbsolute(resultsPath) ? resultsPath : path.join(process.cwd(), resultsPath);
  const original = JSON.parse(await fs.readFile(abs, "utf8")) as {
    label?: string;
    results?: PairResult[];
  } & Record<string, unknown>;
  const results = original.results ?? [];
  if (results.length === 0) throw new Error(`No results in ${abs}`);
  const exemplars = await loadExemplars();
  const judgeModel = process.env.ENGINEER_JUDGE_MODEL?.trim() || "gpt-4o";
  const caseDelayMs = Math.floor(num("case-delay", 5) * 1000);
  console.log(
    `Re-judging ${results.length} pairs from ${path.basename(abs)} · judge=${judgeModel} · exemplars=${exemplars.length}`
  );
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (i > 0 && caseDelayMs > 0) await sleepMs(caseDelayMs);
    process.stdout.write(`[${i + 1}/${results.length}] ${r.scenarioId}… `);
    if (!r.engineA.answer || !r.engineB.answer) {
      console.log("skipped (missing answer)");
      continue;
    }
    r.graderVerdict = await judgeEngineerAnswerPairwise({
      question: r.question,
      answerA: r.engineA.answer,
      answerB: r.engineB.answer,
      exemplars,
    });
    console.log(`grader=${r.graderVerdict.winner}${r.graderVerdict.agreedBothOrders ? "" : "?"}`);
  }
  const label = `${original.label ?? "unlabeled"}-rejudged`;
  const payload = {
    ...original,
    label,
    judgeModel,
    exemplarCount: exemplars.length,
    rejudgedFrom: path.basename(abs),
    generatedAtIso: new Date().toISOString(),
    summary: summarize(results),
    results,
  };
  const stamp = payload.generatedAtIso.replace(/[:.]/g, "-");
  const outFile = path.join(path.dirname(abs), `grader-${label}-${stamp}.json`);
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2), "utf8");
  const s = payload.summary;
  console.log(`\n--- Re-judge "${label}" ---`);
  console.log(`Grader winners: A ${s.graderWinnerCounts.A} · B ${s.graderWinnerCounts.B} · tie ${s.graderWinnerCounts.tie}`);
  console.log(`Close-calls:    ${s.closeCallCount}`);
  console.log(`Results file:   ${outFile}`);
}

async function main() {
  const rejudgePath = arg("rejudge");
  if (rejudgePath) {
    // Judge-only pass: no seeding, no answering, no DB writes.
    await rejudgeExisting(rejudgePath);
    return;
  }
  assertGraderDb(); // seeds write to the branch — refuse unless it's the declared throwaway DB
  const label = arg("label") ?? "phase1";
  const dir = arg("dir") ?? path.join(process.cwd(), "scripts/engineer-grader-eval/scenarios");
  const seedDir = path.join(process.cwd(), "scripts/engineer-grader-eval/seed");
  const tag = arg("tag");
  const limit = arg("limit") ? Math.floor(num("limit", Infinity)) : Infinity;
  const caseDelayMs = Math.floor(num("case-delay", 30) * 1000);
  const skipJudge = process.argv.includes("--skip-judge");
  // gpt-4o is dead (founder, 2026-07-29): both arms run the shipping model; experiments
  // differ by GRADER_ENGINE_*_ENV config, never by dropping to an older model.
  const engineAModel = process.env.GRADER_ENGINE_A_MODEL?.trim() || "gpt-5.5";
  const engineBModel = process.env.GRADER_ENGINE_B_MODEL?.trim() || "gpt-5.5";

  // unanchored/ holds the degraded-path stratum (asked with no runId — see types.ts);
  // kept in its own subdir so `--tag=degraded-path` and eyeballing both stay easy.
  let scenarios = await loadScenariosFromDirs([dir, path.join(dir, "unanchored"), seedDir]);
  if (tag) scenarios = scenarios.filter((s) => (s.tags ?? []).includes(tag));
  if (Number.isFinite(limit)) scenarios = scenarios.slice(0, limit);
  if (scenarios.length === 0) throw new Error(`No scenarios found in ${dir} or ${seedDir}`);

  const exemplars = await loadExemplars();
  const envDesc = (env: Record<string, string>) =>
    Object.entries(env).map(([k, v]) => `${k}=${v}`).join(",") || "(default config)";
  console.log(
    `Grader bench "${label}": ${scenarios.length} scenarios · A=${engineAModel} [${envDesc(ENGINE_A_ENV)}] vs B=${engineBModel} [${envDesc(ENGINE_B_ENV)}] · judge exemplars=${exemplars.length}`
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
      const unanchored = scn.unanchored === true;
      const engineA = await answerWith(engineAModel, ENGINE_A_ENV, seeded, { unanchored });
      const engineB = await answerWith(engineBModel, ENGINE_B_ENV, seeded, { unanchored });
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
        unanchored,
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
        unanchored: scn.unanchored === true,
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
  const summary = summarize(results);
  const winnerCounts = summary.graderWinnerCounts;

  const payload = {
    generatedAtIso: new Date().toISOString(),
    label,
    engineAModel,
    engineBModel,
    /** Config specs so a results file is self-describing about what A/B actually were. */
    engineAEnv: envDesc(ENGINE_A_ENV),
    engineBEnv: envDesc(ENGINE_B_ENV),
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
