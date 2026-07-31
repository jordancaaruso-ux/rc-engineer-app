/**
 * Feel-vocabulary lint over bench answers.
 *
 * The Engineer's feel vocabulary is a CLOSED list (see `concepts/bite-hold.md` and
 * `LOCK_VOCABULARY`). A banned-words list can only ever catch coinages someone has already
 * complained about — "take a set" and "crisper" were banned, and "punchy" and "lined up" appeared
 * in the next batch. So this checks two different things:
 *
 *   FAIL      — a known coinage, already ruled against. Regression check: this number must be 0.
 *   REVIEW    — a word used in a feel/prediction sentence that is not in the closed lexicon and is
 *               not ordinary English. Candidates for the next ruling, surfaced rather than judged.
 *
 * REVIEW is deliberately a lead, not a verdict. It cannot know what "reads as a feel word" — that
 * is a founder call. What it does is convert a thing found by eye, one batch at a time, into a
 * list that can be scanned in seconds and a FAIL count that either moves or does not.
 *
 * Run: npm run engineer:bench:vocab -- --files=r6-pinned-<stamp>.json
 *      (no --files → every *.json in results/ that looks like a bench run)
 */
import fs from "node:fs/promises";
import path from "node:path";

/** Ruled against by the founder. Each was written repeatedly before it was caught. */
const KNOWN_COINAGES: Array<{ re: RegExp; note: string }> = [
  { re: /\btakes? a set\b|\btaking a set\b|\btakes set\b/gi, note: "no driver can see a car 'take a set'" },
  { re: /\bcrisp(er|y)?\b/gi, note: "empty upgrade word" },
  { re: /\bpunch(y|ier)?\b/gi, note: "gearing word, and not a feel term" },
  { re: /\blined up\b/gi, note: "no mechanism, uncheckable" },
  { re: /\bskatey\b|\bskittish\b/gi, note: "coinage" },
  { re: /\bon top of it\b/gi, note: "coinage" },
  { re: /\bnervous[- ]feeling\b/gi, note: "coinage" },
  { re: /\btoo immediate\b/gi, note: "coinage" },
  { re: /\blong,? loaded corners?\b|\blonger mid[- ]corner\b/gi, note: "reads as sweepers only; name the phase" },
];

/** The closed list, mirroring `concepts/bite-hold.md`. */
const LEXICON = new Set([
  "bite", "hold", "grip", "initial", "overall", "precise", "pointy", "planted", "forgiving",
  "numb", "vague", "imprecise", "smoother", "smooth", "rolled", "responsive", "entry",
  "mid", "corner", "power", "track",
]);

/**
 * Ordinary English that shows up in prediction sentences and carries no feel claim. Kept short on
 * purpose: over-stuffing it hides real coinages, which is the failure mode that matters here.
 */
const ORDINARY = new Set([
  "the", "a", "an", "and", "or", "but", "if", "it", "its", "is", "are", "was", "be", "been",
  "to", "of", "in", "on", "at", "for", "from", "with", "as", "that", "this", "there", "then",
  "you", "your", "i", "we", "should", "would", "could", "may", "might", "will", "can", "not",
  "no", "more", "less", "same", "than", "so", "just", "still", "also", "only", "very", "much",
  "expect", "expects", "expected", "feel", "feels", "feeling", "felt", "look", "looking", "watch",
  "car", "rear", "front", "end", "tyre", "tyres", "tire", "tires", "lap", "laps", "run", "runs",
  "change", "changes", "changed", "test", "tests", "next", "first", "one", "two", "back", "out",
  "up", "down", "over", "under", "into", "through", "before", "after", "when", "where", "what",
  "which", "how", "why", "does", "do", "did", "get", "gets", "getting", "go", "goes", "going",
  "make", "makes", "made", "keep", "keeps", "let", "lets", "give", "gives", "take", "takes",
  "revert", "undo", "try", "trying", "worse", "better", "wrong", "right", "cause", "problem",
  "throttle", "power", "brake", "braking", "steering", "steer", "apex", "kerb", "kerbs", "bump",
  "bumps", "grip", "load", "loaded", "loading", "settle", "settles", "settled", "stable",
  "predictable", "repeatable", "consistent", "confidence", "time", "times", "pace", "slower",
  "faster", "slow", "fast", "step", "steps", "stepping", "push", "pushes", "pushing", "rotate",
  "rotates", "rotation", "slide", "slides", "sliding", "snap", "snaps", "hairpin", "sweeper",
  "setup", "spring", "gap", "damper", "diff", "oil", "toe", "camber", "shim", "shims", "arb",
  "median", "field", "community", "data", "value", "values", "number", "numbers",
]);

function arg(name: string): string | null {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

/** Sentences where a feel claim is most likely to live. */
function feelSentences(answer: string): string[] {
  return answer
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((s) => /\bexpect|\bfeel|\bshould\b.*\b(be|feel)|\bprediction\b/i.test(s));
}

function candidateWords(sentence: string): string[] {
  const words = sentence.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? [];
  return words.filter((w) => {
    if (LEXICON.has(w) || ORDINARY.has(w)) return false;
    // Adjective-ish shapes are where coinages hide ("punchy", "skatey", "pointier", "grabby").
    return /(y|ier|iest|ish|ive|able|ible)$/.test(w);
  });
}

async function main() {
  const resultsDir = path.join(process.cwd(), "scripts/engineer-bench/results");
  const filesArg = arg("files");
  const files = filesArg
    ? filesArg.split(",").map((f) => f.trim())
    : (await fs.readdir(resultsDir)).filter((f) => f.endsWith(".json") && !f.includes("pairwise-labels"));

  let totalFail = 0;
  const reviewCounts = new Map<string, number>();

  for (const f of files) {
    let parsed: { label?: string; answerModel?: string; results?: Array<{ id: string; answer: string | null }> };
    try {
      parsed = JSON.parse(await fs.readFile(path.join(resultsDir, f), "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(parsed.results)) continue;

    const fails: string[] = [];
    for (const r of parsed.results) {
      if (!r.answer) continue;
      for (const { re, note } of KNOWN_COINAGES) {
        const hits = r.answer.match(re);
        if (hits) fails.push(`${r.id}: "${hits[0]}" — ${note}`);
      }
      for (const s of feelSentences(r.answer)) {
        for (const w of candidateWords(s)) reviewCounts.set(w, (reviewCounts.get(w) ?? 0) + 1);
      }
    }
    totalFail += fails.length;
    console.log(`\n${f}  (${parsed.answerModel ?? "?"})`);
    if (fails.length === 0) {
      console.log(`  FAIL: 0`);
    } else {
      console.log(`  FAIL: ${fails.length}`);
      for (const x of fails) console.log(`    ${x}`);
    }
  }

  const review = [...reviewCounts.entries()].sort((a, b) => b[1] - a[1]);
  if (review.length > 0) {
    console.log(`\nREVIEW — words in feel/prediction sentences that are not in the closed lexicon:`);
    console.log(`  (a lead, not a verdict — some will be ordinary English this lint doesn't know)`);
    for (const [w, n] of review.slice(0, 25)) console.log(`  ${String(n).padStart(3)}x  ${w}`);
  }

  console.log(`\nTotal known-coinage failures: ${totalFail}`);
  process.exitCode = totalFail > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
