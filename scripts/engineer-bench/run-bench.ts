/**
 * Iteration engine (ENGINEER_NORTH_STAR.md blueprint E) — bench runner.
 *
 * Answers every benchmark case through the real chat pipeline, scores each answer
 * with the founder-calibrated judge, and reports quality + cost + latency so any
 * pipeline change earns its complexity with numbers ("show me numbers first").
 *
 * Run:   npx dotenv-cli -e .env.local -- npx tsx scripts/engineer-bench/run-bench.ts --label=baseline
 * Args:  --set=path            (default scripts/engineer-bench/benchmark-set.json)
 *        --label=name          (required-ish; names the results file)
 *        --limit=N             (first N cases — cheap smoke runs)
 *        --tag=trackside       (only cases carrying this tag)
 *        --concurrency=1       (parallel cases; keep low for TPM)
 *        --case-delay=18       (seconds between case starts, TPM spacing)
 *        --compare=results.json (print deltas vs a previous results file)
 *        --skip-judge          (answers + cost/latency only)
 *
 * DB access is read-only (runEngineerChatTurn does not persist exchanges).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { runEngineerChatTurn } from "@/lib/engineerPhase5/engineerChatPipeline";
import {
  ENGINEER_DEFAULT_MODEL,
  engineerReasoningEffort,
} from "@/lib/engineerPhase5/openaiEngineer";
import {
  judgeEngineerAnswer,
  judgeEngineerAnswerSampled,
  type CalibratedJudgeResult,
  type JudgeExemplar,
} from "@/lib/engineerFeedback/calibratedJudge";
import { buildEngineerResponseMetadata } from "@/lib/engineerFeedback/extractResponseMetadata";
import { sleepMs } from "@/lib/openAiRetry";
import type { BenchCase, BenchmarkSet } from "./build-benchmark-set";

/** USD per 1M tokens (input, output). Estimates — update when models/prices move. */
const PRICING: Record<string, { inPerM: number; outPerM: number }> = {
  "gpt-4o": { inPerM: 2.5, outPerM: 10 },
  "gpt-4o-mini": { inPerM: 0.15, outPerM: 0.6 },
  "gpt-5": { inPerM: 1.25, outPerM: 10 },
  "gpt-5.5": { inPerM: 1.25, outPerM: 10 },
  // Longest-prefix match below, so this also prices "gpt-5.6-terra".
  "gpt-5.6": { inPerM: 2.5, outPerM: 15 },
};

function priceFor(model: string): { inPerM: number; outPerM: number } | null {
  const m = model.trim().toLowerCase();
  // Longest prefix wins — first-match order would price "gpt-5.6-terra" off the "gpt-5" row and
  // report the 5.6 arm at half its real input cost.
  const key = Object.keys(PRICING)
    .filter((k) => m.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? PRICING[key] : null;
}

type BenchResult = {
  id: string;
  source: BenchCase["source"];
  mode: BenchCase["mode"];
  tags: string[];
  question: string;
  answer: string | null;
  judge: CalibratedJudgeResult | null;
  founderStars: number | null;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  estCostUsd: number | null;
  error: string | null;
};

type BenchRun = {
  generatedAtIso: string;
  label: string;
  setPath: string;
  answerModel: string;
  /** Resolved `ENGINEER_REASONING_EFFORT` (null = model default). Names the arm in a model×effort A/B. */
  answerEffort: string | null;
  judgeModel: string;
  caseCount: number;
  summary: Record<string, unknown>;
  results: BenchResult[];
};

function parseArgs(argv: string[]) {
  const get = (name: string) =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
  const num = (name: string, dflt: number) => {
    const v = Number(get(name));
    return Number.isFinite(v) && v > 0 ? v : dflt;
  };
  return {
    setPath: get("set") ?? path.join(process.cwd(), "scripts/engineer-bench/benchmark-set.json"),
    label: get("label") ?? "unlabeled",
    limit: get("limit") ? Math.floor(num("limit", Infinity)) : Infinity,
    tag: get("tag"),
    concurrency: Math.floor(num("concurrency", 1)),
    // Full-context answers are ~23K prompt tokens; at a 30K TPM org limit one case
    // nearly fills the minute — default spacing keeps answer + judge under the cap.
    caseDelayMs: Math.floor(num("case-delay", 45) * 1000),
    comparePath: get("compare"),
    skipJudge: argv.includes("--skip-judge"),
    // >1 repeat-samples the judge per case and takes the median (cuts the observed
    // ±1-3 absolute-score noise at N× judge cost). Default 1 keeps results files
    // comparable with earlier runs.
    judgeSamples: Math.floor(num("judge-samples", 1)),
  };
}

async function resolveUserId(): Promise<string> {
  const email = process.env.ENGINEER_EVAL_USER_EMAIL?.trim().toLowerCase();
  if (email) {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`User not found for ENGINEER_EVAL_USER_EMAIL=${email}`);
    return u.id;
  }
  const id = process.env.ENGINEER_EVAL_USER_ID?.trim();
  if (id) return id;
  const latest = await prisma.run.findFirst({ orderBy: { sortAt: "desc" }, select: { userId: true } });
  if (!latest) throw new Error("No runs in DB — set ENGINEER_EVAL_USER_EMAIL or ENGINEER_EVAL_USER_ID");
  return latest.userId;
}

async function latestRunId(userId: string): Promise<string | null> {
  const r = await prisma.run.findFirst({
    where: { userId },
    orderBy: { sortAt: "desc" },
    select: { id: true },
  });
  return r?.id ?? null;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function pearson(pairs: Array<[number, number]>): number | null {
  const n = pairs.length;
  if (n < 3) return null;
  const mx = pairs.reduce((s, [x]) => s + x, 0) / n;
  const my = pairs.reduce((s, [, y]) => s + y, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();

  const setRaw = await fs.readFile(args.setPath, "utf8");
  const set = JSON.parse(setRaw) as BenchmarkSet;
  let cases = set.cases;
  if (args.tag) cases = cases.filter((c) => c.tags.includes(args.tag!));
  if (Number.isFinite(args.limit)) cases = cases.slice(0, args.limit);
  if (cases.length === 0) throw new Error("No cases after filters");

  const userId = await resolveUserId();
  const anchorRunId = await latestRunId(userId);
  // Default must track the pipeline's own default, not a hardcoded "gpt-4o" — the results file is
  // the only record of which model wrote the answers, and a stale label silently mislabels an arm.
  const answerModel = process.env.ENGINEER_MODEL?.trim() || ENGINEER_DEFAULT_MODEL;
  const answerEffort = engineerReasoningEffort(answerModel);
  const judgeModel = process.env.ENGINEER_JUDGE_MODEL?.trim() || "gpt-4o";
  const exemplars: JudgeExemplar[] = set.exemplars ?? [];

  console.log(
    `Bench "${args.label}": ${cases.length} cases · answer=${answerModel} (effort=${answerEffort ?? "model default"}) · judge=${judgeModel} (${exemplars.length} exemplars) · user=${userId}`
  );

  const results = await runPool(cases, args.concurrency, async (c, index): Promise<BenchResult> => {
    if (index > 0 && args.caseDelayMs > 0) await sleepMs(args.caseDelayMs);
    const runId = c.runPolicy === "latest" ? anchorRunId ?? undefined : undefined;
    const t0 = Date.now();
    process.stdout.write(`[${index + 1}/${cases.length}] ${c.id} (${c.mode})… `);
    try {
      const turn = await runEngineerChatTurn({
        userId,
        question: c.question,
        runId,
      });
      const latencyMs = Date.now() - t0;
      const meta = buildEngineerResponseMetadata({
        question: c.question,
        answer: turn.reply,
        contextJson: turn.contextJson,
        resolvedFocus: turn.resolvedFocus,
        runId: runId ?? "",
        compareRunId: "",
        source: "bench",
      });

      let judge: CalibratedJudgeResult | null = null;
      if (!args.skipJudge) {
        judge =
          args.judgeSamples > 1
            ? await judgeEngineerAnswerSampled(
                {
                  question: c.question,
                  answer: turn.reply,
                  exemplars,
                  kbSections: meta.kbSections,
                },
                args.judgeSamples
              )
            : await judgeEngineerAnswer({
                question: c.question,
                answer: turn.reply,
                exemplars,
                kbSections: meta.kbSections,
              });
      }

      const price = priceFor(answerModel);
      const estCostUsd =
        turn.usage && price
          ? (turn.usage.promptTokens / 1e6) * price.inPerM +
            (turn.usage.completionTokens / 1e6) * price.outPerM
          : null;

      console.log(
        `judge=${judge ? judge.score0to10 : "-"}/10 · ${Math.round(latencyMs / 1000)}s · ${
          turn.usage ? `${turn.usage.promptTokens}+${turn.usage.completionTokens}tok` : "usage n/a"
        }${estCostUsd != null ? ` · ~$${estCostUsd.toFixed(3)}` : ""}`
      );

      return {
        id: c.id,
        source: c.source,
        mode: c.mode,
        tags: c.tags,
        question: c.question,
        answer: turn.reply,
        judge,
        founderStars: c.founderStars ?? null,
        latencyMs,
        promptTokens: turn.usage?.promptTokens ?? null,
        completionTokens: turn.usage?.completionTokens ?? null,
        estCostUsd,
        error: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`ERROR: ${msg}`);
      return {
        id: c.id,
        source: c.source,
        mode: c.mode,
        tags: c.tags,
        question: c.question,
        answer: null,
        judge: null,
        founderStars: c.founderStars ?? null,
        latencyMs: Date.now() - t0,
        promptTokens: null,
        completionTokens: null,
        estCostUsd: null,
        error: msg,
      };
    }
  });

  // --- Summary ---
  const judged = results.filter((r) => r.judge);
  const avgJudge =
    judged.length > 0 ? judged.reduce((s, r) => s + (r.judge?.score0to10 ?? 0), 0) / judged.length : null;
  const tagCounts: Record<string, number> = {};
  for (const r of judged) {
    for (const t of r.judge?.tags ?? []) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
  }
  const latencies = results.filter((r) => !r.error).map((r) => r.latencyMs).sort((a, b) => a - b);
  const costs = results.filter((r) => r.estCostUsd != null).map((r) => r.estCostUsd!);
  const corrPairs: Array<[number, number]> = results
    .filter((r) => r.judge && typeof r.founderStars === "number")
    .map((r) => [r.founderStars!, r.judge!.score0to10]);
  const corr = pearson(corrPairs);

  const summary = {
    caseCount: results.length,
    errorCount: results.filter((r) => r.error).length,
    avgJudgeScore0to10: avgJudge != null ? Math.round(avgJudge * 100) / 100 : null,
    judgeTagCounts: tagCounts,
    latencyMsP50: percentile(latencies, 50),
    latencyMsP95: percentile(latencies, 95),
    avgEstCostUsd:
      costs.length > 0 ? Math.round((costs.reduce((s, c) => s + c, 0) / costs.length) * 10000) / 10000 : null,
    totalEstCostUsd:
      costs.length > 0 ? Math.round(costs.reduce((s, c) => s + c, 0) * 100) / 100 : null,
    judgeVsFounderPearson: corr != null ? Math.round(corr * 100) / 100 : null,
    judgeVsFounderPairs: corrPairs.length,
    elapsedMs: Date.now() - started,
  };

  const payload: BenchRun = {
    generatedAtIso: new Date().toISOString(),
    label: args.label,
    setPath: args.setPath,
    answerModel,
    answerEffort,
    judgeModel,
    caseCount: results.length,
    summary,
    results,
  };

  const outDir = path.join(process.cwd(), "scripts/engineer-bench/results");
  await fs.mkdir(outDir, { recursive: true });
  const stamp = payload.generatedAtIso.replace(/[:.]/g, "-");
  const outFile = path.join(outDir, `${args.label}-${stamp}.json`);
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2), "utf8");

  console.log(`\n--- Bench "${args.label}" summary ---`);
  console.log(`Avg judge score:   ${summary.avgJudgeScore0to10 ?? "n/a"}/10 (${judged.length} judged)`);
  console.log(`Failure tags:      ${JSON.stringify(tagCounts)}`);
  console.log(
    `Latency:           p50 ${summary.latencyMsP50 != null ? Math.round(summary.latencyMsP50 / 1000) + "s" : "n/a"} · p95 ${summary.latencyMsP95 != null ? Math.round(summary.latencyMsP95 / 1000) + "s" : "n/a"}`
  );
  console.log(
    `Cost (answer path): avg ~$${summary.avgEstCostUsd ?? "n/a"} · total ~$${summary.totalEstCostUsd ?? "n/a"} (estimates)`
  );
  console.log(
    `Judge vs founder:  ${summary.judgeVsFounderPearson ?? "n/a"} Pearson over ${summary.judgeVsFounderPairs} rated cases`
  );
  console.log(`Errors:            ${summary.errorCount}/${results.length}`);
  console.log(`Results file:      ${outFile}`);

  // --- Comparison vs a previous run ---
  if (args.comparePath) {
    try {
      const prevRaw = await fs.readFile(args.comparePath, "utf8");
      const prev = JSON.parse(prevRaw) as BenchRun;
      const prevById = new Map(prev.results.map((r) => [r.id, r]));
      let up = 0;
      let down = 0;
      let same = 0;
      const moves: string[] = [];
      for (const r of results) {
        const p = prevById.get(r.id);
        if (!p?.judge || !r.judge) continue;
        const d = r.judge.score0to10 - p.judge.score0to10;
        if (d > 0) up++;
        else if (d < 0) down++;
        else same++;
        if (Math.abs(d) >= 2) moves.push(`${r.id}: ${p.judge.score0to10} → ${r.judge.score0to10}`);
      }
      const prevAvg = prev.summary?.avgJudgeScore0to10;
      console.log(`\n--- vs "${prev.label}" (${args.comparePath}) ---`);
      console.log(`Avg judge: ${prevAvg ?? "n/a"} → ${summary.avgJudgeScore0to10 ?? "n/a"}`);
      console.log(`Cases: ${up} up · ${down} down · ${same} same`);
      if (moves.length) console.log(`Big moves (|Δ|≥2):\n  ${moves.join("\n  ")}`);
    } catch (e) {
      console.warn(`Compare failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
