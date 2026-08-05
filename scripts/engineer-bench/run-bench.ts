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
 *        --ids=a,b,c           (exact case ids — use this for model A/Bs, not --limit)
 *        --run-id=cmr...       (pin ONE run that every runPolicy:"latest" case asks about)
 *        --run-ids=r1,r2,r3    (one run PER CASE, positionally matched to --ids)
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
/**
 * Pricing comes from `budgets.ts` — the same table the spend cap uses.
 *
 * This file used to keep its own copy, and the two drifted: the local table priced gpt-5.5 at
 * gpt-5's 1.25/10 and reported the baseline at ~$0.116/answer when the real figure is ~4x that.
 * One table, one source of truth. `estimateCostUsd` also applies the cached-input discount, which
 * the old local maths ignored entirely — the Engineer resends a large stable prefix every tool-loop
 * round, so ignoring it overstated cost by however much of the prompt was actually cache-served.
 */
import { estimateCostUsd } from "@/lib/aiUsage/budgets";
import { runEngineerChatTurn } from "@/lib/engineerChat/runChatTurn";
import {
  ENGINEER_CHAT_MODEL,
  engineerReasoningEffort,
} from "@/lib/engineerChat/openaiChatClient";
import {
  judgeEngineerAnswer,
  judgeEngineerAnswerSampled,
  type CalibratedJudgeResult,
  type JudgeExemplar,
} from "@/lib/engineerFeedback/calibratedJudge";
import { buildEngineerResponseMetadata } from "@/lib/engineerFeedback/extractResponseMetadata";
import { sleepMs } from "@/lib/openAiRetry";
import type { BenchCase, BenchmarkSet } from "./build-benchmark-set";

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
  /**
   * Subset of `promptTokens` served from OpenAI's prompt cache, at 10% of the input rate.
   * The pipeline has always returned this; the bench used to discard it and price every input
   * token at full rate, which overstated cost per answer.
   */
  cachedPromptTokens: number | null;
  estCostUsd: number | null;
  /**
   * The run this case actually answered about. Recorded per case, not per bench, because
   * `--run-ids=` lets every case sit on a different run — and "which run was this?" is the first
   * thing anyone asks when reading two arms side by side.
   */
  anchorRunId: string | null;
  /** Human-readable "date · car · track · notes" for the anchor run, for the comparison page. */
  anchorRunLabel: string | null;
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
    // Exact case ids, comma-separated. --limit takes the FIRST N, which is fine for a smoke run
    // but useless for a model A/B: every arm has to answer the same cases, and the ones worth
    // comparing on aren't the first three in the file.
    ids: get("ids")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? null,
    // Pin the run that runPolicy:"latest" cases answer about. Unset = newest run, which drifts.
    runId: get("run-id"),
    // One run PER CASE, positionally matched to --ids. One anchor run for every case makes an A/B
    // measure "which model reads this one run better", which a single unlucky run can decide.
    // Spreading the cases over different runs tests the models against different context instead.
    runIds: get("run-ids")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? null,
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

/** Pin an anchor run explicitly, refusing ids that aren't this user's. */
async function resolveOwnedRun(userId: string, runId: string): Promise<{ id: string; label: string }> {
  const r = await prisma.run.findFirst({
    where: { id: runId, userId },
    select: {
      id: true,
      sortAt: true,
      notes: true,
      tireRunNumber: true,
      carNameSnapshot: true,
      trackNameSnapshot: true,
      car: { select: { name: true } },
      track: { select: { name: true } },
      event: { select: { name: true } },
    },
  });
  if (!r) throw new Error(`run id ${runId} not found for the eval user (wrong id, or another user's run)`);
  const when = r.sortAt ? r.sortAt.toISOString().slice(0, 10) : "?";
  const car = r.car?.name ?? r.carNameSnapshot ?? "—";
  const track = r.track?.name ?? r.trackNameSnapshot ?? r.event?.name ?? "—";
  const note = (r.notes ?? "").replace(/\s+/g, " ").slice(0, 90);
  const label = `${when} · ${car} · ${track} · tyre run ${r.tireRunNumber}${note ? ` · "${note}"` : " · (no notes)"}`;
  return { id: r.id, label };
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
  if (args.ids) {
    const byId = new Map(cases.map((c) => [c.id, c]));
    const missing = args.ids.filter((id) => !byId.has(id));
    // Fail loudly. A typo'd id silently dropping a case would leave two arms answering different
    // question sets, and the comparison would look fine right up until it meant nothing.
    if (missing.length > 0) {
      throw new Error(`--ids not found in the set: ${missing.join(", ")}`);
    }
    cases = args.ids.map((id) => byId.get(id)!);
  }
  if (args.tag) cases = cases.filter((c) => c.tags.includes(args.tag!));
  if (Number.isFinite(args.limit)) cases = cases.slice(0, args.limit);
  if (cases.length === 0) throw new Error("No cases after filters");

  const userId = await resolveUserId();
  // Cases with runPolicy:"latest" answer about ONE run. Left to itself the bench picks whatever is
  // newest, so the subject of the comparison drifts every time a run is logged — and a model A/B
  // that silently changed the question halfway through would look fine and mean nothing. --run-id
  // pins it. Ownership is checked because a run id belonging to someone else would otherwise pull a
  // different driver's car into the answers without a word.
  const anchorRun = args.runId ? await resolveOwnedRun(userId, args.runId) : null;
  const anchorRunId = anchorRun?.id ?? (await latestRunId(userId));
  if (anchorRun) console.log(`Anchor run pinned: ${anchorRun.id} — ${anchorRun.label}`);

  // Per-case anchors. Positional against --ids, so an off-by-one would silently answer the wrong
  // question about the wrong run; require the two lists to line up exactly rather than zipping
  // whatever is there.
  const runByCaseId = new Map<string, { id: string; label: string }>();
  if (args.runIds) {
    if (!args.ids) throw new Error("--run-ids requires --ids (they are matched positionally)");
    if (args.runIds.length !== args.ids.length) {
      throw new Error(
        `--run-ids has ${args.runIds.length} entries but --ids has ${args.ids.length}; they are matched positionally and must be the same length`
      );
    }
    console.log(`\nPer-case anchor runs:`);
    for (let i = 0; i < args.ids.length; i++) {
      const resolved = await resolveOwnedRun(userId, args.runIds[i]);
      runByCaseId.set(args.ids[i], resolved);
      console.log(`  ${args.ids[i].padEnd(30)} → ${resolved.id}  ${resolved.label}`);
    }
    console.log("");
  }
  // Default must track the pipeline's own default, not a hardcoded "gpt-4o" — the results file is
  // the only record of which model wrote the answers, and a stale label silently mislabels an arm.
  // ENGINEER_CHAT_MODEL, not ENGINEER_DEFAULT_MODEL: the bench exercises the CHAT pipeline, and
  // since the 2026-08-01 split those defaults differ. Labelling from the wrong constant priced a
  // terra run at gpt-5.5 rates and stamped the wrong model into the results file.
  const answerModel = process.env.ENGINEER_MODEL?.trim() || ENGINEER_CHAT_MODEL;
  const answerEffort = engineerReasoningEffort(answerModel);
  const judgeModel = process.env.ENGINEER_JUDGE_MODEL?.trim() || "gpt-4o";
  const exemplars: JudgeExemplar[] = set.exemplars ?? [];

  console.log(
    `Bench "${args.label}": ${cases.length} cases · answer=${answerModel} (effort=${answerEffort ?? "model default"}) · judge=${judgeModel} (${exemplars.length} exemplars) · user=${userId}`
  );

  const results = await runPool(cases, args.concurrency, async (c, index): Promise<BenchResult> => {
    if (index > 0 && args.caseDelayMs > 0) await sleepMs(args.caseDelayMs);
    const perCase = runByCaseId.get(c.id) ?? null;
    const runId =
      c.runPolicy === "latest" ? (perCase?.id ?? anchorRunId ?? undefined) : undefined;
    const anchorRunLabel = runId ? (perCase?.label ?? anchorRun?.label ?? null) : null;
    const t0 = Date.now();
    process.stdout.write(`[${index + 1}/${cases.length}] ${c.id} (${c.mode})… `);
    try {
      const turn = await runEngineerChatTurn({
        userId,
        question: c.question,
        runId,
        // IGNORED since Engineer v0 (2026-08-05) — kept because the anchoring problem it solves
        // will come back the moment run data does. Every case now measures the KB and the prompt
        // alone, so cases whose question assumes the driver's own numbers ("why is MY car loose")
        // are being scored on an answer that can only say it cannot see them. Read the scores
        // accordingly, and do not compare them with any bench run recorded before that date.
        anchor: runId
          ? { kind: "run", id: runId, compareRunId: null, setupId: null, pinned: true }
          : null,
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

      const estCostUsd = turn.usage
        ? estimateCostUsd({
            model: answerModel,
            promptTokens: turn.usage.promptTokens,
            completionTokens: turn.usage.completionTokens,
            cachedPromptTokens: turn.usage.cachedPromptTokens,
          })
        : null;

      // Cache-hit share is the single biggest lever on cost per answer, so print it per case
      // rather than leaving it to be reconstructed from the results file.
      const cacheHitPct =
        turn.usage && turn.usage.promptTokens > 0
          ? Math.round((turn.usage.cachedPromptTokens / turn.usage.promptTokens) * 100)
          : null;

      console.log(
        `judge=${judge ? judge.score0to10 : "-"}/10 · ${Math.round(latencyMs / 1000)}s · ${
          turn.usage ? `${turn.usage.promptTokens}+${turn.usage.completionTokens}tok` : "usage n/a"
        }${cacheHitPct != null ? ` · ${cacheHitPct}% cached` : ""}${
          estCostUsd != null ? ` · ~$${estCostUsd.toFixed(3)}` : ""
        }`
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
        cachedPromptTokens: turn.usage?.cachedPromptTokens ?? null,
        estCostUsd,
        anchorRunId: runId ?? null,
        anchorRunLabel,
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
        cachedPromptTokens: null,
        estCostUsd: null,
        anchorRunId: runId ?? null,
        anchorRunLabel,
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
  // Cache-hit share across the whole run. This is what decides whether an answer costs the
  // full-rate figure or a fraction of it, so it belongs in the summary, not just per case.
  const totalPromptTokens = results.reduce((s, r) => s + (r.promptTokens ?? 0), 0);
  const totalCachedTokens = results.reduce((s, r) => s + (r.cachedPromptTokens ?? 0), 0);
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
    avgPromptTokens: results.length > 0 ? Math.round(totalPromptTokens / results.length) : null,
    cachedPromptTokenPct:
      totalPromptTokens > 0 ? Math.round((totalCachedTokens / totalPromptTokens) * 100) : null,
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
    `Prompt:            avg ${summary.avgPromptTokens ?? "n/a"} tok · ${summary.cachedPromptTokenPct ?? "n/a"}% served from cache`
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
