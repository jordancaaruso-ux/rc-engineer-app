/**
 * Ingest founder ratings (exported from rating-page.html) and compute judge-vs-founder
 * agreement — the number that decides whether the AI judge can gate iterations.
 *
 * Reports: Pearson correlation, mean absolute error, per-case table, and the biggest
 * judge misses. With --write-exemplars, appends a stratified pick of the founder's
 * ratings to benchmark-set.json exemplars so the judge calibrates on them next run.
 *
 * Run:  npm run engineer:bench:pearson -- --ratings=results/founder-ratings.json
 *       (omit --ratings to use the newest founder-ratings*.json in results/)
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { BenchmarkSet } from "./build-benchmark-set";

type RatingsFile = {
  ratings: Array<{ label: string; id: string; stars: number; note: string | null }>;
};
type ResultsFile = {
  label: string;
  results: Array<{
    id: string;
    question: string;
    answer: string | null;
    judge: { score0to10: number; tags: string[] } | null;
  }>;
};

function arg(name: string): string | null {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
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

async function main() {
  const resultsDir = path.join(process.cwd(), "scripts/engineer-bench/results");
  let ratingsPath = arg("ratings");
  if (!ratingsPath) {
    const candidates = (await fs.readdir(resultsDir))
      .filter((f) => f.startsWith("founder-ratings") && f.endsWith(".json"))
      .sort();
    if (candidates.length === 0) throw new Error("No founder-ratings*.json in results/ — pass --ratings=");
    ratingsPath = path.join(resultsDir, candidates[candidates.length - 1]);
  } else {
    ratingsPath = path.resolve(ratingsPath);
  }
  const ratingsFile = JSON.parse(await fs.readFile(ratingsPath, "utf8")) as RatingsFile;
  if (!Array.isArray(ratingsFile.ratings) || ratingsFile.ratings.length === 0) {
    throw new Error("Ratings file has no ratings");
  }

  // Index all bench results by label|id.
  const byKey = new Map<string, { question: string; answer: string; judgeScore: number | null }>();
  for (const f of await fs.readdir(resultsDir)) {
    if (!f.endsWith(".json") || f.startsWith("pairwise-") || f.startsWith("founder-ratings")) continue;
    let parsed: ResultsFile;
    try {
      parsed = JSON.parse(await fs.readFile(path.join(resultsDir, f), "utf8")) as ResultsFile;
    } catch {
      continue;
    }
    if (!parsed.label || !Array.isArray(parsed.results)) continue;
    for (const r of parsed.results) {
      if (!r.answer) continue;
      byKey.set(`${parsed.label}|${r.id}`, {
        question: r.question,
        answer: r.answer,
        judgeScore: r.judge?.score0to10 ?? null,
      });
    }
  }

  const rows: Array<{
    key: string;
    founder: number;
    judge: number;
    note: string | null;
    question: string;
    answer: string;
  }> = [];
  let unmatched = 0;
  for (const r of ratingsFile.ratings) {
    const hit = byKey.get(`${r.label}|${r.id}`);
    if (!hit) {
      unmatched++;
      continue;
    }
    if (hit.judgeScore == null) continue;
    rows.push({
      key: `${r.label}|${r.id}`,
      founder: r.stars,
      judge: hit.judgeScore,
      note: r.note,
      question: hit.question,
      answer: hit.answer,
    });
  }
  if (rows.length === 0) throw new Error("No rated cases matched judged bench results");

  const pairs = rows.map((r): [number, number] => [r.judge, r.founder]);
  const p = pearson(pairs);
  const mae = rows.reduce((s, r) => s + Math.abs(r.judge - r.founder), 0) / rows.length;
  const meanFounder = rows.reduce((s, r) => s + r.founder, 0) / rows.length;
  const meanJudge = rows.reduce((s, r) => s + r.judge, 0) / rows.length;

  console.log(`Judge-vs-founder over ${rows.length} rated answers (${unmatched} unmatched skipped):`);
  console.log(`  Pearson r:        ${p == null ? "n/a (<3 cases or zero variance)" : p.toFixed(3)}`);
  console.log(`  Mean abs error:   ${mae.toFixed(2)} points`);
  console.log(`  Mean score:       founder ${meanFounder.toFixed(2)} · judge ${meanJudge.toFixed(2)} (bias ${(meanJudge - meanFounder).toFixed(2)})`);
  console.log(`\nReading it: r ≥ 0.7 → judge can gate iterations; 0.4–0.7 → directional only, confirm big calls yourself; < 0.4 → fix the judge before trusting any experiment.`);

  const misses = [...rows].sort((a, b) => Math.abs(b.judge - b.founder) - Math.abs(a.judge - a.founder)).slice(0, 5);
  console.log(`\nBiggest judge misses:`);
  for (const m of misses) {
    console.log(`  ${m.key}: founder ${m.founder} vs judge ${m.judge}${m.note ? ` — note: ${m.note}` : ""}`);
  }

  if (process.argv.includes("--write-exemplars")) {
    const setPath = path.join(process.cwd(), "scripts/engineer-bench/benchmark-set.json");
    const set = JSON.parse(await fs.readFile(setPath, "utf8")) as BenchmarkSet;
    const existing = new Set((set.exemplars ?? []).map((e) => e.question.slice(0, 200).toLowerCase()));
    // Stratified: prefer noted ratings, spread across low/mid/high bands.
    const byBand = [
      rows.filter((r) => r.founder <= 4),
      rows.filter((r) => r.founder >= 5 && r.founder <= 7),
      rows.filter((r) => r.founder >= 8),
    ].map((band) => band.sort((a, b) => Number(Boolean(b.note)) - Number(Boolean(a.note))));
    const picks = byBand.flatMap((band) => band.slice(0, 3));
    let added = 0;
    for (const pick of picks) {
      const k = pick.question.slice(0, 200).toLowerCase();
      if (existing.has(k)) continue;
      existing.add(k);
      set.exemplars = set.exemplars ?? [];
      set.exemplars.push({
        question: pick.question,
        answer: pick.answer,
        stars: pick.founder,
        note: pick.note,
      });
      added++;
    }
    await fs.writeFile(setPath, JSON.stringify(set, null, 2));
    console.log(`\nAppended ${added} exemplars to benchmark-set.json (now ${set.exemplars?.length ?? 0} total).`);
  } else {
    console.log(`\nRe-run with --write-exemplars to feed these ratings back into the judge's calibration.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
