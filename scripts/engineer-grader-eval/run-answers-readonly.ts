/**
 * READ-ONLY answer pass — fires grader-corpus QUESTIONS at the founder's REAL account.
 *
 * Why this exists: the full pairwise bench (run-grader-bench.ts) seeds synthetic worlds
 * and therefore needs the throwaway Neon branch (.env.grader). This script needs no infra:
 * `runEngineerChatTurn` only READS, so it can run against .env.local today.
 *
 * Trade-off, stated plainly: only the scenario's QUESTION is used. The synthetic world
 * (thin data / no timing / stale setup archetypes) is NOT applied — every answer is
 * grounded in the real anchor run. Good for delivery + grounding flaws; it does NOT
 * exercise the data-sparsity axes.
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/engineer-grader-eval/run-answers-readonly.ts --limit=12 --label=pilot
 */
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { runEngineerChatTurn } from "@/lib/engineerPhase5/engineerChatPipeline";
import { sleepMs } from "@/lib/openAiRetry";

const SCENARIO_DIR = path.join(process.cwd(), "scripts/engineer-grader-eval/scenarios");
const RESULTS_DIR = path.join(process.cwd(), "scripts/engineer-grader-eval/results");

/** USD per 1M tokens. Estimates — mirror run-grader-bench.ts. */
const PRICING: Record<string, { inPerM: number; outPerM: number }> = {
  "gpt-5.5": { inPerM: 5, outPerM: 15 },
  "gpt-4o": { inPerM: 2.5, outPerM: 10 },
};

type Axes = Record<string, string | null>;
type Scenario = { id: string; question: string; axes: Axes; source?: string };

type AnswerRow = {
  scenarioId: string;
  question: string;
  axes: Axes;
  reply: string | null;
  error: string | null;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  estCostUsd: number | null;
};

function arg(argv: string[], name: string): string | null {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function loadScenarios(): Promise<Scenario[]> {
  const files = (await fs.readdir(SCENARIO_DIR)).filter(
    (f) => f.endsWith(".json") && !f.startsWith("_")
  );
  files.sort();
  const out: Scenario[] = [];
  for (const f of files) {
    const raw = await fs.readFile(path.join(SCENARIO_DIR, f), "utf8");
    const s = JSON.parse(raw) as Scenario;
    if (s?.question) out.push(s);
  }
  return out;
}

/**
 * Greedy multi-axis spread.
 *
 * Round-robin on ONE axis is not enough: the corpus is generated as an explicit
 * cross-product walk, so taking the first entry of each questionShape bucket lands on
 * the SAME problemType every time (a 12-question sample came out 9/12 entry-understeer).
 * Instead, repeatedly take the scenario that introduces the most values we have not seen
 * yet across ALL axes, so a small pilot spans shape AND problem AND archetype.
 */
const SPREAD_AXES = ["questionShape", "problemType", "archetype", "handlingRichness"] as const;

function stratify(scenarios: Scenario[], limit: number): Scenario[] {
  if (limit >= scenarios.length) return scenarios;
  const seen = new Map<string, Set<string>>(SPREAD_AXES.map((a) => [a, new Set<string>()]));
  const remaining = [...scenarios];
  const picked: Scenario[] = [];

  while (picked.length < limit && remaining.length) {
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < remaining.length; i += 1) {
      let score = 0;
      for (const axis of SPREAD_AXES) {
        const v = remaining[i].axes?.[axis];
        if (v && !seen.get(axis)!.has(String(v))) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
        if (score === SPREAD_AXES.length) break; // can't do better
      }
    }
    const chosen = remaining.splice(bestIdx, 1)[0];
    for (const axis of SPREAD_AXES) {
      const v = chosen.axes?.[axis];
      if (v) seen.get(axis)!.add(String(v));
    }
    // Every axis covered → start a fresh pass so later picks keep spreading.
    if (SPREAD_AXES.every((a) => seen.get(a)!.size >= new Set(scenarios.map((s) => s.axes?.[a]).filter(Boolean)).size)) {
      for (const a of SPREAD_AXES) seen.get(a)!.clear();
    }
    picked.push(chosen);
  }
  return picked;
}

async function resolveUserId(explicit: string | null): Promise<string> {
  if (explicit) return explicit;
  const envId = process.env.ENGINEER_EVAL_USER_ID?.trim();
  if (envId) return envId;
  const email = process.env.ENGINEER_EVAL_USER_EMAIL?.trim().toLowerCase();
  if (email) {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (u) return u.id;
  }
  const latest = await prisma.run.findFirst({
    orderBy: { createdAt: "desc" },
    select: { userId: true },
  });
  if (!latest) throw new Error("No runs found — cannot resolve a user to answer against.");
  return latest.userId;
}

async function main() {
  const argv = process.argv.slice(2);
  const limit = Number(arg(argv, "limit") ?? "12");
  const label = arg(argv, "label") ?? "readonly";
  const delayMs = Number(arg(argv, "delay") ?? "18") * 1000;
  const model = process.env.ENGINEER_MODEL?.trim() || "gpt-5.5";

  const userId = await resolveUserId(arg(argv, "user-id"));
  const all = await loadScenarios();
  const picked = stratify(all, limit);

  console.log(`User: ${userId}`);
  console.log(`Corpus: ${all.length} scenarios · running ${picked.length} · model ${model}`);
  console.log(`Shapes covered: ${new Set(picked.map((s) => s.axes?.questionShape)).size}`);

  const rows: AnswerRow[] = [];
  const price = PRICING[model] ?? null;

  for (let i = 0; i < picked.length; i += 1) {
    const s = picked[i];
    const started = Date.now();
    let reply: string | null = null;
    let error: string | null = null;
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;
    try {
      const out = await runEngineerChatTurn({ userId, question: s.question });
      reply = out.reply;
      promptTokens = out.usage?.promptTokens ?? null;
      completionTokens = out.usage?.completionTokens ?? null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const latencyMs = Date.now() - started;
    const estCostUsd =
      price && promptTokens != null && completionTokens != null
        ? (promptTokens / 1e6) * price.inPerM + (completionTokens / 1e6) * price.outPerM
        : null;

    rows.push({
      scenarioId: s.id,
      question: s.question,
      axes: s.axes ?? {},
      reply,
      error,
      latencyMs,
      promptTokens,
      completionTokens,
      estCostUsd,
    });

    const tag = error ? "ERROR" : `${reply?.length ?? 0} chars`;
    console.log(
      `[${i + 1}/${picked.length}] ${s.axes?.questionShape ?? "?"} · ${s.id} → ${tag} (${latencyMs}ms)`
    );
    if (i < picked.length - 1 && delayMs > 0) await sleepMs(delayMs);
  }

  const totalCost = rows.reduce((a, r) => a + (r.estCostUsd ?? 0), 0);
  await fs.mkdir(RESULTS_DIR, { recursive: true });
  const outPath = path.join(RESULTS_DIR, `readonly-${label}.json`);
  await fs.writeFile(
    outPath,
    JSON.stringify(
      {
        label,
        model,
        userId,
        corpusSize: all.length,
        answered: rows.length,
        totalEstCostUsd: Number(totalCost.toFixed(3)),
        note: "Questions only — synthetic worlds NOT applied; answers grounded in the real anchor run.",
        rows,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`\nWrote ${rows.length} answers → ${outPath}`);
  console.log(`Est. cost: $${totalCost.toFixed(2)} (errors: ${rows.filter((r) => r.error).length})`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
