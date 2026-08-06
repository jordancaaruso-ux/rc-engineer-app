/**
 * Which lever does the Engineer reach for FIRST, and does that depend on the question?
 *
 * Run: npx tsx scripts/engineer-bench/lever-distribution.ts --files=a.json,b.json
 *
 * WHY THIS EXISTS. The Engineer recommends diff oil for almost everything, because
 * `diff-and-driveline.md` is the only knob file complete enough to answer straight out of —
 * see the 2026-08-05 entries in docs/engineer-feedback/correction-log-kb.md. This counts
 * whether a KB change actually moved that, without a model in the loop.
 *
 * THESE NUMBERS ARE A DETECTOR, NOT A TARGET. Aiming at "diff first on ≤1 of 7" would be aiming
 * at the count, and the count is easy to hit by writing the KB to suppress the diff — which would
 * make the answers worse while the score improved. Nothing here says an answer is good.
 *
 * What it is for: telling us cheaply whether the corpus change moved what the Engineer reaches
 * for AT ALL. If the two arms look the same, the wiring did nothing and there is no point
 * spending the founder's attention reading answers. If they differ, the answers get read blind
 * and the founder decides — that judgement is the only one that counts.
 *
 * The one row that IS a guard rather than an observation: the diff must go on leading the
 * throttle questions, because there it is the right answer. If that collapses, the change broke
 * something regardless of what the other rows say.
 *
 * The lever lexicon is parsed out of the KB's own `**Keys:**` lines and file titles, the same
 * trick compare-arms.ts uses for the feel list, so it cannot drift from the corpus.
 */
import fs from "node:fs/promises";
import path from "node:path";

type BenchCase = {
  id: string;
  question: string;
  answer: string;
  tags?: string[];
};
type BenchFile = { label?: string; results: BenchCase[] };

type Lever = { name: string; patterns: RegExp[] };

/** Levers whose plain-English names are not derivable from a filename or a parameter key. */
const NAME_HINTS: Record<string, string[]> = {
  "diff-and-driveline": ["diff oil", "diff", "differential", "coupling"],
  "spring-rate": ["spring rate", "spring", "springs", "spring gap"],
  arb: ["arb", "anti-roll bar", "sway bar", "roll bar", "bar"],
  "damper-oil": ["damper oil", "damping", "damper", "shock oil", "pack"],
  camber: ["camber"],
  toe: ["toe"],
  "droop-downstop": ["droop", "downstop", "upstop"],
  "ride-height-and-rake": ["ride height", "rake"],
  "under-lower-arm": ["under lower arm", "under-lower-arm", "lower arm shim"],
  "under-hub": ["under hub", "under-hub"],
  "upper-link-geometry": ["upper link", "upper inner", "upper outer", "roll centre", "roll center"],
  "bump-steer-toe-gain": ["bump steer", "toe gain"],
  "anti-dive-anti-squat": ["anti-dive", "anti dive", "anti-squat", "anti squat"],
  "steering-geometry-ackermann": ["ackermann", "steering throw", "steering geometry"],
  "bodyshell-aero": ["body position", "bodyshell", "aero", "wing"],
  "weight-distribution-and-ballast": ["ballast", "weight distribution", "weight balance"],
  "flex-chassis": ["chassis flex", "flex"],
  caster: ["caster"],
  "shock-geometry": ["shock position", "shock geometry", "laid down", "stood up", "motion ratio"],
  "servo-horn-steering-response": ["servo horn"],
  "awesomatix-spring-gap-damper": ["damper percent", "damper %"],
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build the lexicon from the KB itself so it cannot fall out of sync with the corpus. */
async function buildLevers(): Promise<Lever[]> {
  const dir = path.join(process.cwd(), "content/vehicle-dynamics");
  const files = (await fs.readdir(dir)).filter(
    (f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md"
  );
  const levers: Lever[] = [];
  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const raw = await fs.readFile(path.join(dir, file), "utf8");
    const phrases = new Set<string>(NAME_HINTS[slug] ?? []);

    // Title words, e.g. "## Damper oil (thicker vs lighter)" -> "damper oil"
    const title = /^##\s+(.+)$/m.exec(raw)?.[1] ?? "";
    const titleCore = title.replace(/\(.*?\)/g, "").trim().toLowerCase();
    if (titleCore.length > 2) phrases.add(titleCore);

    // Parameter keys, e.g. `damper_oil_front` -> "damper oil front"
    for (const m of raw.matchAll(/`([a-z0-9_]+)`/g)) {
      const words = m[1].replace(/_/g, " ").trim();
      if (words.split(" ").length >= 2) phrases.add(words);
    }
    if (phrases.size === 0) continue;
    levers.push({
      name: slug,
      patterns: [...phrases]
        .sort((a, b) => b.length - a.length)
        .map((p) => new RegExp(`\\b${escapeRe(p)}\\b`, "i")),
    });
  }
  return levers;
}

/** Earliest character index at which this lever is named, or -1. */
function firstIndexOf(lever: Lever, text: string): number {
  let best = -1;
  for (const re of lever.patterns) {
    const m = re.exec(text);
    if (m && m.index >= 0 && (best === -1 || m.index < best)) best = m.index;
  }
  return best;
}

const CLASSIFY_RE =
  /\b(sweeper|hairpin|steady.?state|transient|long corner|settled|tight or fast|chicane)\b/i;
const JARGON = [
  "load timing",
  "load-transfer share",
  "corner regime",
  "steady-state",
  "steady state",
  "transient",
  "long corner",
];

function sentences(text: string): string[] {
  return text.split(/(?<=[.?!])\s+/);
}

function analyse(rows: BenchCase[]) {
  const perCase = rows.map((r) => {
    const answer = r.answer ?? "";
    const tag = r.tags?.includes("throttle") ? "throttle" : "non-throttle";
    return { id: r.id, tag, answer };
  });
  return perCase;
}

async function main() {
  const arg = process.argv.find((a) => a.startsWith("--files="));
  if (!arg) {
    console.error("usage: --files=<resultsA.json>,<resultsB.json>");
    process.exit(1);
  }
  const levers = await buildLevers();
  console.log(`Lexicon parsed from the KB: ${levers.length} levers\n`);

  for (const file of arg.slice("--files=".length).split(",")) {
    const bench = JSON.parse(await fs.readFile(file.trim(), "utf8")) as BenchFile;
    const rows = analyse(bench.results ?? []);
    const label = bench.label ?? path.basename(file);

    const firstBy: Record<string, string[]> = {};
    const diffFirst = { throttle: 0, "non-throttle": 0 };
    const diffAtAll = { throttle: 0, "non-throttle": 0 };
    const totals = { throttle: 0, "non-throttle": 0 };
    let classifyQs = 0;
    let jargonHits = 0;
    const lengths: number[] = [];

    for (const row of rows) {
      totals[row.tag as "throttle" | "non-throttle"]++;
      lengths.push(row.answer.split(/\s+/).filter(Boolean).length);

      const hits = levers
        .map((l) => ({ name: l.name, at: firstIndexOf(l, row.answer) }))
        .filter((h) => h.at >= 0)
        .sort((a, b) => a.at - b.at);

      const first = hits[0]?.name ?? "(none)";
      (firstBy[first] ??= []).push(`${row.id}[${row.tag}]`);
      if (first === "diff-and-driveline") diffFirst[row.tag as "throttle"]++;
      if (hits.some((h) => h.name === "diff-and-driveline")) diffAtAll[row.tag as "throttle"]++;

      classifyQs += sentences(row.answer).filter(
        (s) => s.includes("?") && CLASSIFY_RE.test(s)
      ).length;
      jargonHits += JARGON.filter((j) => row.answer.toLowerCase().includes(j)).length;
    }

    lengths.sort((a, b) => a - b);
    const median = lengths[Math.floor(lengths.length / 2)] ?? 0;

    console.log("=".repeat(70));
    console.log(label);
    console.log("=".repeat(70));
    console.log("First lever named:");
    for (const [name, ids] of Object.entries(firstBy).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${String(ids.length).padStart(2)}  ${name.padEnd(30)} ${ids.join(" ")}`);
    }
    console.log(`\nDistinct levers named first : ${Object.keys(firstBy).length}`);
    console.log(
      `Diff FIRST, non-throttle    : ${diffFirst["non-throttle"]}/${totals["non-throttle"]}`
    );
    console.log(
      `Diff mentioned, throttle    : ${diffAtAll.throttle}/${totals.throttle}   <- GUARD: must stay high, the diff is right here`
    );
    console.log(`Classification questions    : ${classifyQs}`);
    console.log(`Internal jargon leaks       : ${jargonHits}`);
    console.log(`Median answer length        : ${median} words`);
    console.log(
      `\n(Observations, not scores. They say whether behaviour moved — not whether it improved.\n Only reading the answers does that.)\n`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
