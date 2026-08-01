/**
 * Objective, deterministic comparison of two bench arms. No model judges anything here.
 *
 * Built for the prompt-ablation question — "how much of CHAT_SYSTEM does the model actually need,
 * given it already gets the full KB and the context JSON?" — but it applies to any two arms.
 *
 * Checks, all mechanical:
 *   length        — words per answer, the thing we are trying to reduce
 *   md-leak       — a KB filename reaching the driver (LOCK_NEVER_NAME_KB_FILES)
 *   feel-words    — feel language outside the closed list, which is PARSED from
 *                   concepts/bite-hold.md so this can never drift from the KB
 *   sign-claims   — the specific reversals the LOCK blocks exist to prevent
 *
 * Sign checks only fire when the topic comes up. Silence is NOT a pass — it means the case set
 * never asked, and that is reported as "not exercised" rather than folded into a score.
 *
 * Run: npm run engineer:bench:compare -- --a=<file>.json --b=<file>.json
 */
import fs from "node:fs/promises";
import path from "node:path";

type BenchFile = {
  label: string;
  answerModel: string;
  results: Array<{ id: string; answer: string | null; error: string | null }>;
};

/** The reversals each LOCK exists to prevent. `bad` matching = the LOCK earned its place. */
const SIGN_CHECKS: Array<{ lock: string; topic: RegExp; bad: RegExp; note: string }> = [
  {
    lock: "LOCK_DAMPER_OIL",
    topic: /damper oil|\bcSt\b|thicker oil|lighter oil|thinner oil/i,
    bad: /(thicker|heavier)[^.]{0,60}(react|respond|load)[^.]{0,20}(faster|quicker|sooner)|(lighter|thinner)[^.]{0,60}more damping/i,
    note: "thicker = faster-reacting, or lighter = more damping",
  },
  {
    lock: "LOCK_TOE_GAIN (rear)",
    topic: /toe.?gain|toe_gain_shims_rear/i,
    bad: /more shims[^.]{0,60}more (toe.?gain|gain)|add(ing)? shims[^.]{0,60}(increase|more)[^.]{0,20}gain/i,
    note: "more rear shims = more toe gain (this platform is the opposite)",
  },
  {
    lock: "LOCK_TOE_GAIN (front bump-steer)",
    topic: /bump.?steer|bump_steer_shims_front/i,
    bad: /more (bump.?steer )?shims[^.]{0,60}less bump.?in/i,
    note: "more front bump-steer shims = less bump-in (front runs the opposite sense to rear)",
  },
  {
    lock: "LOCK_RC_SIGN_CORE (upper inner)",
    topic: /upper inner|roll cent/i,
    bad: /rais(e|ing)[^.]{0,40}upper inner[^.]{0,60}(higher|rais)[^.]{0,20}roll cent|upper inner[^.]{0,30}(up|higher)[^.]{0,40}roll cent(re|er) (goes )?(up|higher)/i,
    note: "raising upper inner raises RC (here it LOWERS it)",
  },
  {
    lock: "LOCK_RC_SIGN_CORE (upper outer)",
    topic: /upper outer/i,
    bad: /lower(ing)?[^.]{0,40}upper outer[^.]{0,60}(rais|higher)[^.]{0,20}roll cent/i,
    note: "lowering upper outer raises RC (it tends lower)",
  },
  {
    lock: "LOCK_VOCABULARY (responsive)",
    topic: /roll cent|upper link|flatter/i,
    bad: /(lower|flatter)[^.]{0,60}responsive/i,
    note: '"responsive" used for a lower RC / flatter link',
  },
];

const MD_LEAK = /\b[a-z0-9][\w-]*\.md\b|\bthe KB says\b/i;

function arg(name: string): string | null {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

/** Parse the closed feel list straight out of the KB so this file cannot fall out of sync. */
async function closedList(): Promise<Set<string>> {
  const md = await fs.readFile(
    path.join(process.cwd(), "content/vehicle-dynamics/concepts/bite-hold.md"),
    "utf8"
  );
  const section = md.split(/^## Feel vocabulary/m)[1] ?? "";
  const terms = [...section.matchAll(/`([^`]+)`/g)].map((m) => m[1].toLowerCase());
  const words = new Set<string>();
  for (const t of terms) for (const w of t.split(/\s+/)) words.add(w);
  return words;
}

/** Words that look like feel language: adjective-ish, in a sentence about feel or expectation. */
function feelViolations(answer: string, allowed: Set<string>): string[] {
  const out: string[] = [];
  const sentences = answer.split(/(?<=[.!?])\s+|\n+/);
  for (const s of sentences) {
    if (!/\bexpect|\bfeel|\bshould\b/i.test(s)) continue;
    for (const w of s.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []) {
      if (allowed.has(w)) continue;
      if (!/(y|ier|iest|ish)$/.test(w)) continue;
      if (/^(very|only|really|likely|early|earlier|easily|any|many|every|apply|verify|identify)$/.test(w)) continue;
      out.push(w);
    }
  }
  return [...new Set(out)];
}

async function load(file: string): Promise<BenchFile> {
  const p = path.isAbsolute(file) ? file : path.join(process.cwd(), "scripts/engineer-bench/results", file);
  return JSON.parse(await fs.readFile(p, "utf8")) as BenchFile;
}

async function main() {
  const aFile = arg("a");
  const bFile = arg("b");
  if (!aFile || !bFile) throw new Error("need --a=<file>.json --b=<file>.json");
  const [A, B] = await Promise.all([load(aFile), load(bFile)]);
  const allowed = await closedList();

  const byId = new Map(B.results.map((r) => [r.id, r]));
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

  console.log(`\nA = ${A.label}   B = ${B.label}   (model ${A.answerModel})`);
  console.log(`Closed feel list parsed from bite-hold.md: ${allowed.size} allowed tokens\n`);

  let wa = 0;
  let wb = 0;
  console.log("LENGTH (words)");
  console.log("  case".padEnd(32) + "A".padStart(6) + "B".padStart(8) + "   delta");
  for (const r of A.results) {
    const o = byId.get(r.id);
    if (!r.answer || !o?.answer) continue;
    const x = words(r.answer);
    const y = words(o.answer);
    wa += x;
    wb += y;
    const d = Math.round(((y - x) / x) * 100);
    console.log("  " + r.id.padEnd(30) + String(x).padStart(6) + String(y).padStart(8) + `   ${d > 0 ? "+" : ""}${d}%`);
  }
  console.log("  " + "TOTAL".padEnd(30) + String(wa).padStart(6) + String(wb).padStart(8) + `   ${Math.round(((wb - wa) / wa) * 100)}%`);

  for (const [name, F] of [["A", A], ["B", B]] as const) {
    const md: string[] = [];
    const feel: string[] = [];
    for (const r of F.results) {
      if (!r.answer) continue;
      const leak = r.answer.match(MD_LEAK);
      if (leak) md.push(`${r.id}: "${leak[0]}"`);
      const v = feelViolations(r.answer, allowed);
      if (v.length) feel.push(`${r.id}: ${v.join(", ")}`);
    }
    console.log(`\n${name} — .md / "the KB says" leaks: ${md.length}`);
    for (const x of md) console.log(`    ${x}`);
    console.log(`${name} — feel words outside the closed list: ${feel.length} case(s)`);
    for (const x of feel) console.log(`    ${x}`);
  }

  console.log(`\nSIGN CHECKS (a hit means that LOCK is earning its place)`);
  for (const c of SIGN_CHECKS) {
    const row = (F: BenchFile) => {
      const touched = F.results.filter((r) => r.answer && c.topic.test(r.answer));
      const wrong = touched.filter((r) => c.bad.test(r.answer!));
      return { touched: touched.length, wrong: wrong.map((r) => r.id) };
    };
    const ra = row(A);
    const rb = row(B);
    const fmt = (r: { touched: number; wrong: string[] }) =>
      r.touched === 0 ? "not exercised" : r.wrong.length ? `REVERSED (${r.wrong.join(", ")})` : `ok (${r.touched} mention${r.touched > 1 ? "s" : ""})`;
    console.log(`  ${c.lock.padEnd(34)} A: ${fmt(ra).padEnd(28)} B: ${fmt(rb)}`);
    if (ra.wrong.length || rb.wrong.length) console.log(`      failure looks like: ${c.note}`);
  }
  console.log(
    `\n"not exercised" means these six cases never raised the topic — it is NOT evidence the lock is unnecessary.\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
