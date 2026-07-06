/**
 * Iteration engine (ENGINEER_NORTH_STAR.md blueprint E) — benchmark set builder.
 *
 * Assembles scripts/engineer-bench/benchmark-set.json from three sources:
 *   1. Founder in-app ratings (EngineerMessageRating) — split into judge EXEMPLARS
 *      (few-shot calibration; stratified low/mid/high, notes preferred) and bench
 *      CASES (question re-asked fresh; founder stars kept for judge-vs-founder
 *      correlation). An exchange is never both — that would contaminate the judge.
 *   2. The eval gold set (scripts/engineer-eval/gold-set.json).
 *   3. Crafted cases covering the north-star contracts: trackside quick calls,
 *      diagnosis, feel-vs-data conflict, overconfidence bait, laundry-list bait,
 *      cold-context, planning, teaching.
 *
 * Run: npx dotenv-cli -e .env.local -- npx tsx scripts/engineer-bench/build-benchmark-set.ts
 * Optional: --user-email=... (defaults to ENGINEER_EVAL_USER_EMAIL / latest-run owner)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { loadFounderRatedExemplars, type JudgeExemplar } from "@/lib/engineerFeedback/calibratedJudge";

export type BenchCase = {
  id: string;
  source: "rating" | "gold" | "crafted";
  question: string;
  /** Chat mode contract to run the case under. */
  mode: "quick" | "normal" | "deep";
  /** "latest" anchors the founder's latest run; "none" = cold, no run anchor. */
  runPolicy: "latest" | "none";
  tags: string[];
  /** Founder's original 0–10 stars when source === "rating" (for correlation only). */
  founderStars?: number;
};

export type BenchmarkSet = {
  version: 1;
  generatedAtIso: string;
  userEmail: string | null;
  exemplars: JudgeExemplar[];
  cases: BenchCase[];
};

const CRAFTED: BenchCase[] = [
  {
    id: "quick-push-mid",
    source: "crafted",
    question: "Car is pushing mid-corner, felt okay everywhere else. 10 minutes to the next run — what do I do?",
    mode: "quick",
    runPolicy: "latest",
    tags: ["trackside", "symptom", "one-call"],
  },
  {
    id: "quick-no-change-bait",
    source: "crafted",
    question: "Car actually felt great last run, best it's been all day. What should I change for the next one?",
    mode: "quick",
    runPolicy: "latest",
    tags: ["trackside", "no-change-is-valid"],
  },
  {
    id: "quick-vague-symptom",
    source: "crafted",
    question: "Car just feels off, not sure why. Next run in 15.",
    mode: "quick",
    runPolicy: "latest",
    tags: ["trackside", "should-ask", "missing-input"],
  },
  {
    id: "diagnose-persistent-loose",
    source: "crafted",
    question: "The rear keeps stepping out on corner exit and it's been like that for the last three runs no matter what I try. Walk me through what could be going on.",
    mode: "normal",
    runPolicy: "latest",
    tags: ["diagnosis", "reason-aloud"],
  },
  {
    id: "feel-vs-data-conflict",
    source: "crafted",
    question: "The car felt terrible this run, really nervous, but my lap times were actually faster. What's going on?",
    mode: "normal",
    runPolicy: "latest",
    tags: ["feel-vs-data", "surface-conflict"],
  },
  {
    id: "overconfidence-bait-thin",
    source: "crafted",
    question: "Just tell me straight: exactly what spring rates and oil should I run this weekend? Don't give me maybes.",
    mode: "normal",
    runPolicy: "none",
    tags: ["overconfidence-bait", "thin-context", "honest-uncertainty"],
  },
  {
    id: "laundry-list-bait",
    source: "crafted",
    question: "Give me every change I could make to get more steering into the corner.",
    mode: "normal",
    runPolicy: "latest",
    tags: ["laundry-bait", "prioritization"],
  },
  {
    id: "cold-new-user",
    source: "crafted",
    question: "First time using this — my touring car understeers everywhere on low grip carpet. Where do I start?",
    mode: "normal",
    runPolicy: "none",
    tags: ["cold-context", "thin-history", "should-ask-or-baseline"],
  },
  {
    id: "practice-vs-race-policy",
    source: "crafted",
    question: "It's qualifying in an hour and the car snaps loose on power in the tight stuff. I can't afford to make it worse.",
    mode: "quick",
    runPolicy: "latest",
    tags: ["race-policy", "commit-best-bet", "risk-aware"],
  },
  {
    id: "design-the-test",
    source: "crafted",
    question: "Full practice day tomorrow, nothing to lose. Car's decent but mid-corner rotation comes and goes. How should I spend the day figuring it out?",
    mode: "deep",
    runPolicy: "latest",
    tags: ["practice-policy", "design-test", "weekend-thinking"],
  },
  {
    id: "failed-direction-inference",
    source: "crafted",
    question: "I softened the rear springs like you'd expect for more rear grip and the car actually got worse — more nervous on exit. What does that tell us and where do we go from here?",
    mode: "deep",
    runPolicy: "latest",
    tags: ["failed-test-is-information", "inversion"],
  },
  {
    id: "teach-mechanism",
    source: "crafted",
    question: "Explain what raising the rear roll centre actually does physically — I want to understand it, not just be told a change.",
    mode: "deep",
    runPolicy: "none",
    tags: ["teaching", "mechanism", "kb-grounding"],
  },
  {
    id: "kb-gap-off-vocabulary",
    source: "crafted",
    question: "Would a stiffer chassis brace setting help my mid-corner grip on high-bite carpet?",
    mode: "normal",
    runPolicy: "latest",
    tags: ["kb-gap", "flagged-inference", "no-bluffing"],
  },
  {
    id: "prediction-discipline",
    source: "crafted",
    question: "Okay, I'll try thicker front damper oil like you suggested. What exactly should I be feeling for to know if it worked?",
    mode: "normal",
    runPolicy: "latest",
    tags: ["prediction", "verify-hook"],
  },
  {
    id: "position-window-bait",
    source: "crafted",
    question: "I want an even more direct front end — should I go stiffer again on the front springs?",
    mode: "normal",
    runPolicy: "latest",
    tags: ["community-position", "past-window-check", "cross-axle"],
    // Good answer checks positionBand before agreeing: if front spring already sits
    // high/above_typical vs the community bucket, de-prioritize "stiffer again",
    // name the deviation, and offer the alternative lever (or justify going further).
  },
];

type GoldSet = {
  version: number;
  cases: Array<{ id: string; tags?: string[]; question: string }>;
};

async function resolveUser(emailArg: string | null): Promise<{ id: string; email: string | null }> {
  const email = (emailArg || process.env.ENGINEER_EVAL_USER_EMAIL || "").trim().toLowerCase();
  if (email) {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
    if (!u) throw new Error(`User not found for email ${email}`);
    return u;
  }
  const latest = await prisma.run.findFirst({
    orderBy: { sortAt: "desc" },
    select: { userId: true, user: { select: { email: true } } },
  });
  if (!latest) throw new Error("No runs in DB — pass --user-email or set ENGINEER_EVAL_USER_EMAIL");
  return { id: latest.userId, email: latest.user?.email ?? null };
}

function slugify(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function main() {
  const emailArg =
    process.argv.find((a) => a.startsWith("--user-email="))?.slice("--user-email=".length) ?? null;
  const user = await resolveUser(emailArg);
  console.log(`Founder user: ${user.email ?? user.id}`);

  // 1. Exemplars for the judge (stratified, notes preferred).
  const exemplars = await loadFounderRatedExemplars({ userId: user.id, maxExemplars: 9 });
  console.log(`Judge exemplars: ${exemplars.length} (stratified from ratings)`);

  // 2. Remaining rated questions become bench cases (excluding exemplar questions).
  const exemplarKeys = new Set(exemplars.map((e) => e.question.slice(0, 200).toLowerCase()));
  const ratingRows = await prisma.engineerMessageRating.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { stars: true, contextSnapshot: true },
  });
  const ratingCases: BenchCase[] = [];
  const seenQ = new Set<string>();
  for (const r of ratingRows) {
    const snap = r.contextSnapshot as Record<string, unknown> | null;
    const question = typeof snap?.question === "string" ? snap.question.trim() : "";
    if (!question || question.length < 12) continue;
    const key = question.slice(0, 200).toLowerCase();
    if (exemplarKeys.has(key) || seenQ.has(key)) continue;
    seenQ.add(key);
    ratingCases.push({
      id: `rated-${slugify(question)}`,
      source: "rating",
      question,
      mode: "normal",
      runPolicy: "latest",
      tags: ["from-rating"],
      founderStars: r.stars,
    });
    if (ratingCases.length >= 20) break;
  }
  console.log(`Bench cases from ratings: ${ratingCases.length}`);

  // 3. Gold set questions (ids prefixed to avoid collisions).
  let goldCases: BenchCase[] = [];
  try {
    const goldRaw = await fs.readFile(
      path.join(process.cwd(), "scripts/engineer-eval/gold-set.json"),
      "utf8"
    );
    const gold = JSON.parse(goldRaw) as GoldSet;
    goldCases = (gold.cases ?? [])
      .filter((c) => typeof c.question === "string" && c.question.trim())
      .map((c) => ({
        id: `gold-${c.id}`,
        source: "gold" as const,
        question: c.question,
        mode: "normal" as const,
        runPolicy: "latest" as const,
        tags: c.tags ?? [],
      }));
  } catch {
    console.warn("gold-set.json not readable — skipping gold cases");
  }
  console.log(`Bench cases from gold set: ${goldCases.length}`);
  console.log(`Crafted cases: ${CRAFTED.length}`);

  const payload: BenchmarkSet = {
    version: 1,
    generatedAtIso: new Date().toISOString(),
    userEmail: user.email,
    exemplars,
    cases: [...CRAFTED, ...goldCases, ...ratingCases],
  };

  const outPath = path.join(process.cwd(), "scripts/engineer-bench/benchmark-set.json");
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\nWrote ${payload.cases.length} cases + ${exemplars.length} exemplars → ${outPath}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
