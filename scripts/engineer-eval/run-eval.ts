/**
 * Run: npx dotenv-cli -e .env.local -- npx tsx scripts/engineer-eval/run-eval.ts
 * Optional: --gold=path --user-id=cuid --concurrency=1 --case-delay=18
 */
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { runEngineerChatTurn } from "@/lib/engineerPhase5/engineerChatPipeline";
import { buildEngineerResponseMetadata } from "@/lib/engineerFeedback/extractResponseMetadata";
import { reviewEngineerAnswer } from "@/lib/engineerFeedback/reviewEngineerAnswer";
import { reviewerPassesShipBar } from "@/lib/engineerFeedback/reviewerParse";
import {
  goldCasesFromCandidates,
  mergeGoldSetCases,
  type GoldSetCase,
} from "@/lib/engineerFeedback/goldSetCandidateUtil";
import { sleepMs } from "@/lib/openAiRetry";

type GoldSet = {
  version: number;
  cases: GoldSetCase[];
};

const DEFAULT_CASE_DELAY_MS = 18_000;

function parseCaseDelayMs(argv: string[]): number {
  for (const arg of argv) {
    if (arg.startsWith("--case-delay=")) {
      const n = Number(arg.slice("--case-delay=".length));
      if (Number.isFinite(n) && n >= 0) return Math.floor(n * 1000);
    }
  }
  const env = Number(process.env.ENGINEER_EVAL_CASE_DELAY_MS);
  if (Number.isFinite(env) && env >= 0) return Math.floor(env);
  return DEFAULT_CASE_DELAY_MS;
}

function parseArgs(argv: string[]) {
  let goldPath = path.join(process.cwd(), "scripts/engineer-eval/gold-set.json");
  let userId = process.env.ENGINEER_EVAL_USER_ID?.trim() || "";
  let concurrency = 1;
  let includeAuto = false;
  let includeDbPromoted = false;
  const caseDelayMs = parseCaseDelayMs(argv);
  for (const arg of argv) {
    if (arg.startsWith("--gold=")) goldPath = arg.slice("--gold=".length);
    if (arg.startsWith("--user-id=")) userId = arg.slice("--user-id=".length);
    if (arg.startsWith("--concurrency=")) {
      const n = Number(arg.slice("--concurrency=".length));
      if (Number.isFinite(n) && n >= 1) concurrency = Math.floor(n);
    }
    if (arg === "--include-auto") includeAuto = true;
    if (arg === "--include-db-promoted") includeDbPromoted = true;
  }
  return { goldPath, userId, concurrency, includeAuto, includeDbPromoted, caseDelayMs };
}

async function resolveUserId(explicit: string): Promise<string> {
  if (explicit) {
    const u = await prisma.user.findUnique({ where: { id: explicit }, select: { id: true } });
    if (!u) throw new Error(`User not found: ${explicit}`);
    return u.id;
  }
  const email = process.env.ENGINEER_EVAL_USER_EMAIL?.trim().toLowerCase();
  if (email) {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`User not found for ENGINEER_EVAL_USER_EMAIL=${email}`);
    return u.id;
  }
  const latest = await prisma.run.findFirst({
    orderBy: { sortAt: "desc" },
    select: { userId: true },
  });
  if (!latest) throw new Error("No runs in DB — set ENGINEER_EVAL_USER_ID or ENGINEER_EVAL_USER_EMAIL");
  return latest.userId;
}

async function enrichRunIds(userId: string, c: GoldSetCase): Promise<{ runId: string; compareRunId: string }> {
  if (c.runId) {
    return {
      runId: c.runId,
      compareRunId: c.compareRunId?.trim() ?? "",
    };
  }
  const runs = await prisma.run.findMany({
    where: { userId },
    orderBy: { sortAt: "desc" },
    take: 2,
    select: { id: true },
  });
  return {
    runId: runs[0]?.id ?? "",
    compareRunId: runs[1]?.id ?? "",
  };
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

async function loadEvalCases(params: {
  goldPath: string;
  includeAuto: boolean;
  includeDbPromoted: boolean;
}): Promise<{ cases: GoldSetCase[]; sources: string[] }> {
  const raw = await fs.readFile(params.goldPath, "utf8");
  const gold = JSON.parse(raw) as GoldSet;
  if (!Array.isArray(gold.cases)) {
    throw new Error(`Invalid gold set in ${params.goldPath}`);
  }

  const sources = [params.goldPath];
  let cases = [...gold.cases];

  if (params.includeAuto) {
    const autoPath = path.join(process.cwd(), "scripts/engineer-eval/gold-set-auto.json");
    try {
      const autoRaw = await fs.readFile(autoPath, "utf8");
      const auto = JSON.parse(autoRaw) as GoldSet;
      if (Array.isArray(auto.cases) && auto.cases.length > 0) {
        cases = mergeGoldSetCases(cases, auto.cases);
        sources.push(autoPath);
      }
    } catch {
      // optional file
    }
  }

  if (params.includeDbPromoted) {
    const rows = await prisma.engineerGoldSetCandidate.findMany({
      where: { status: "promoted" },
      orderBy: { promotedAt: "asc" },
      select: {
        id: true,
        promotedCaseId: true,
        question: true,
        runId: true,
        compareRunId: true,
      },
    });
    const dbCases = goldCasesFromCandidates(rows);
    if (dbCases.length > 0) {
      cases = mergeGoldSetCases(cases, dbCases);
      sources.push("db:promoted");
    }
  }

  if (cases.length === 0) {
    throw new Error(`No cases loaded from ${params.goldPath}`);
  }

  return { cases, sources };
}

async function main() {
  const started = Date.now();
  const { goldPath, userId: userIdArg, concurrency, includeAuto, includeDbPromoted, caseDelayMs } =
    parseArgs(process.argv.slice(2));

  const { cases, sources } = await loadEvalCases({ goldPath, includeAuto, includeDbPromoted });

  const userId = await resolveUserId(userIdArg);
  console.log(`Eval user: ${userId}`);
  console.log(
    `Gold set: ${sources.join(" + ")} (${cases.length} cases, concurrency=${concurrency}, case-delay=${Math.round(caseDelayMs / 1000)}s)`
  );

  const results = await runPool(cases, concurrency, async (c, index) => {
    if (index > 0 && caseDelayMs > 0) {
      process.stdout.write(`  waiting ${Math.round(caseDelayMs / 1000)}s (TPM spacing)… `);
      await sleepMs(caseDelayMs);
      console.log("go");
    }
    const ids = await enrichRunIds(userId, c);
    const t0 = Date.now();
    process.stdout.write(`[${index + 1}/${cases.length}] ${c.id}… `);
    try {
      const turn = await runEngineerChatTurn({
        userId,
        question: c.question,
        runId: ids.runId || undefined,
        compareRunId: ids.compareRunId || undefined,
      });
      const meta = buildEngineerResponseMetadata({
        question: c.question,
        answer: turn.reply,
        contextJson: turn.contextJson,
        resolvedFocus: turn.resolvedFocus,
        runId: ids.runId,
        compareRunId: ids.compareRunId,
        source: "eval",
      });
      const review = await reviewEngineerAnswer({
        question: c.question,
        answer: turn.reply,
        kbSections: meta.kbSections,
        runId: meta.runId,
        compareRunId: meta.compareRunId,
      });
      const pass = reviewerPassesShipBar(review);
      console.log(`score=${review.score} ${pass ? "PASS" : "FAIL"} (${Date.now() - t0}ms)`);
      return {
        id: c.id,
        tags: c.tags ?? [],
        question: c.question,
        runId: ids.runId || null,
        compareRunId: ids.compareRunId || null,
        answer: turn.reply,
        kbSections: meta.kbSections ?? [],
        review,
        pass,
        latencyMs: Date.now() - t0,
        error: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`ERROR (${Date.now() - t0}ms): ${msg}`);
      return {
        id: c.id,
        tags: c.tags ?? [],
        question: c.question,
        runId: ids.runId || null,
        compareRunId: ids.compareRunId || null,
        answer: null,
        kbSections: [],
        review: null,
        pass: false,
        latencyMs: Date.now() - t0,
        error: msg,
      };
    }
  });

  const scored = results.filter((r) => r.review);
  const avg =
    scored.length > 0
      ? scored.reduce((s, r) => s + (r.review?.score ?? 0), 0) / scored.length
      : 0;
  const failCount = results.filter((r) => !r.pass).length;
  const errorCount = results.filter((r) => r.error).length;
  const wrongPhysics = results.filter((r) => r.review?.tags.includes("wrong_physics")).length;

  const payload = {
    generatedAtIso: new Date().toISOString(),
    userId,
    goldPath,
    goldSources: sources,
    summary: {
      total: results.length,
      avgReviewerScore: Math.round(avg * 100) / 100,
      failCount,
      errorCount,
      wrongPhysicsCount: wrongPhysics,
      shipBarPass: avg >= 4 && wrongPhysics === 0 && errorCount === 0,
      elapsedMs: Date.now() - started,
      caseDelayMs,
    },
    results,
  };

  const outDir = path.join(process.cwd(), "scripts/engineer-eval/results");
  await fs.mkdir(outDir, { recursive: true });
  const stamp = payload.generatedAtIso.replace(/[:.]/g, "-");
  const outFile = path.join(outDir, `${stamp}.json`);
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2), "utf8");

  console.log("\n--- Summary ---");
  console.log(`Avg reviewer score: ${payload.summary.avgReviewerScore}/5`);
  console.log(`Failures: ${failCount}/${results.length}`);
  console.log(`Errors: ${errorCount}/${results.length}`);
  console.log(`wrong_physics flags: ${wrongPhysics}`);
  console.log(`Ship bar: ${payload.summary.shipBarPass ? "PASS" : "FAIL"}`);
  console.log(`Results: ${outFile}`);
  console.log(`Elapsed: ${Math.round(payload.summary.elapsedMs / 1000)}s`);

  if (!payload.summary.shipBarPass) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
