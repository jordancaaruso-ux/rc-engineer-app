/**
 * Differential-grounding sweep — ENGINEER_SUGGESTION_QUALITY_PLAN.md step 1, context
 * diversity (founder critique 2026-07-08: the bench only ever answers against one context).
 *
 * Runs each probe question against EVERY fixture context and measures whether the answer
 * adapts (groundingDivergence.ts). Objective genericness signal that needs NO subjective
 * "is this generic" judgment: a context-sensitive probe whose answers barely move across
 * contexts is generic; a context-invariant (teaching) probe SHOULD stay stable.
 *
 * Curate fixtures:  npm run engineer:bench:grounding -- --list-runs
 * Run the sweep:    npm run engineer:bench:grounding -- --label=baseline
 * Args: --config=path (default grounding-probes.json) --case-delay=45 --list-runs
 *
 * DB access is read-only. Costs OpenAI $ (one answer per probe×fixture) — run deliberately.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { runEngineerChatTurn } from "@/lib/engineerChat/runChatTurn";
import { sleepMs } from "@/lib/openAiRetry";
import {
  groundingReport,
  groundingVerdict,
  groundingVerdictIsFailure,
  type ContextSensitivity,
  type GroundingVerdict,
} from "@/lib/engineerFeedback/groundingDivergence";

type Fixture = { label: string; runId: string | null; descriptor?: string };
type Probe = { id: string; sensitivity: ContextSensitivity; mode: "quick" | "normal" | "deep"; question: string };
type Config = { fixtures: Fixture[]; probes: Probe[] };

function parseArgs(argv: string[]) {
  const get = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? null;
  return {
    configPath: get("config") ?? path.join(process.cwd(), "scripts/engineer-bench/grounding-probes.json"),
    label: get("label") ?? "grounding",
    caseDelayMs: Math.floor((Number(get("case-delay")) || 45) * 1000),
    listRuns: argv.includes("--list-runs"),
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

/** Print recent runs with quick descriptors so the founder can copy runIds into fixtures. */
async function listRuns(userId: string): Promise<void> {
  const runs = await prisma.run.findMany({
    where: { userId },
    orderBy: { sortAt: "desc" },
    take: 25,
    select: {
      id: true,
      sortAt: true,
      carRating: true,
      car: { select: { name: true } },
      track: { select: { name: true } },
      notes: true,
      handlingProblems: true,
    },
  });
  console.log(`\nRecent runs for fixture curation (pick a VARIED spread — different cars, symptoms, ratings):\n`);
  for (const r of runs) {
    const when = r.sortAt ? new Date(r.sortAt).toISOString().slice(0, 10) : "?";
    const note = (r.handlingProblems ?? r.notes ?? "").replace(/\s+/g, " ").slice(0, 70);
    console.log(
      `  "${r.id}"  ${when}  ${r.car?.name ?? "?"} @ ${r.track?.name ?? "?"}  rating=${r.carRating ?? "-"}  ${note}`
    );
  }
  console.log(`\nPaste chosen ids into scripts/engineer-bench/grounding-probes.json fixtures[].runId.\n`);
}

async function latestRunId(userId: string): Promise<string | null> {
  const r = await prisma.run.findFirst({ where: { userId }, orderBy: { sortAt: "desc" }, select: { id: true } });
  return r?.id ?? null;
}

function resolveFixtureRunId(f: Fixture, latest: string | null): string | undefined {
  if (f.runId == null || f.runId === "none") return undefined;
  if (f.runId === "latest") return latest ?? undefined;
  return f.runId;
}

type ProbeResult = {
  id: string;
  sensitivity: ContextSensitivity;
  mode: string;
  question: string;
  answers: Array<{ fixture: string; answer: string | null; error: string | null }>;
  meanSimilarity: number;
  divergence: number;
  verdict: GroundingVerdict;
  isFailure: boolean;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const userId = await resolveUserId();

  if (args.listRuns) {
    await listRuns(userId);
    return;
  }

  const config = JSON.parse(await fs.readFile(args.configPath, "utf8")) as Config;
  const latest = await latestRunId(userId);
  console.log(
    `Grounding sweep "${args.label}": ${config.probes.length} probes × ${config.fixtures.length} fixtures = ${
      config.probes.length * config.fixtures.length
    } answers · user=${userId}`
  );

  const results: ProbeResult[] = [];
  let calls = 0;
  for (const probe of config.probes) {
    const answers: ProbeResult["answers"] = [];
    for (const fixture of config.fixtures) {
      if (calls > 0 && args.caseDelayMs > 0) await sleepMs(args.caseDelayMs);
      calls++;
      const runId = resolveFixtureRunId(fixture, latest);
      process.stdout.write(`[${calls}] ${probe.id} @ ${fixture.label}… `);
      try {
        const turn = await runEngineerChatTurn({ userId, question: probe.question, runId });
        answers.push({ fixture: fixture.label, answer: turn.reply, error: null });
        process.stdout.write(`${turn.reply.length} chars\n`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        answers.push({ fixture: fixture.label, answer: null, error: msg });
        process.stdout.write(`ERROR: ${msg}\n`);
      }
    }
    const texts = answers.map((a) => a.answer).filter((a): a is string => !!a);
    const report = groundingReport(texts);
    const verdict = groundingVerdict(probe.sensitivity, report.divergence);
    results.push({
      id: probe.id,
      sensitivity: probe.sensitivity,
      mode: probe.mode,
      question: probe.question,
      answers,
      meanSimilarity: report.meanSimilarity,
      divergence: report.divergence,
      verdict,
      isFailure: groundingVerdictIsFailure(verdict),
    });
  }

  // --- Report ---
  const lines: string[] = ["# Differential grounding sweep", "", `Label: **${args.label}** · ${config.fixtures.length} fixtures: ${config.fixtures.map((f) => f.label).join(", ")}`, ""];
  lines.push(`| probe | sensitivity | divergence | verdict |`);
  lines.push(`| --- | --- | --- | --- |`);
  for (const r of results) {
    const flag = r.isFailure ? " ⚠️" : "";
    lines.push(`| ${r.id} | ${r.sensitivity} | ${r.divergence.toFixed(2)} | **${r.verdict}**${flag} |`);
  }
  lines.push("");
  const generic = results.filter((r) => r.verdict === "generic");
  const inconsistent = results.filter((r) => r.verdict === "inconsistent");
  lines.push(
    `**Read:** ${generic.length}/${results.filter((r) => r.sensitivity === "sensitive").length} context-sensitive probes were GENERIC (answers barely changed across contexts). ${inconsistent.length} invariant probes were inconsistent. Divergence is a textual-adaptation proxy, not correctness — treat low divergence on a sensitive probe as evidence the Engineer under-used the varied context, then read the answers.`
  );
  lines.push("");
  const md = lines.join("\n");

  const outDir = path.join(process.cwd(), "scripts/engineer-bench/results");
  await fs.mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await fs.writeFile(path.join(outDir, `grounding-${args.label}-${stamp}.json`), JSON.stringify({ label: args.label, fixtures: config.fixtures, results }, null, 2), "utf8");
  await fs.writeFile(path.join(outDir, `grounding-${args.label}-${stamp}.md`), md, "utf8");
  console.log("\n" + md);
  console.log(`Wrote results/grounding-${args.label}-${stamp}.{json,md}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
