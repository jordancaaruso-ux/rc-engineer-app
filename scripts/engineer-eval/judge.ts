/**
 * The calibrated preference judge (docs/ENGINEER_NORTH_STAR.md §4).
 *
 *   npm run engineer:eval:judge -- --batch 2026-08-14 --arms v1,v1-nets [--fewshot ratings/<batch>-founder.json]
 *
 * Runs on a Claude model — deliberately a DIFFERENT family than the Engineer (models
 * favour their siblings' answers). Every pair is judged twice with presentation order
 * swapped; disagreement = tie (position bias is measured and real). Requires
 * ANTHROPIC_API_KEY in .env.local (eval-only).
 *
 * The judge's authority is bounded by its exam score (agreement.ts): below κ 0.6 it may
 * do nothing; ≥0.6 steer experiments; ≥0.75 gate ships. It never overrides the physics
 * gate.
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const JUDGE_MODEL = process.env.ENGINEER_JUDGE_MODEL?.trim() || "claude-opus-5";
const FEWSHOT_MAX = 12;

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

type AnswerFile = {
  arm: string;
  answers: Record<string, { question: string; archetype: string; reply: string }>;
};

type Verdict = "first" | "second" | "tie";

function parseVerdict(text: string): Verdict | null {
  const m = text.match(/VERDICT:\s*(first|second|tie)/i);
  return m ? (m[1].toLowerCase() as Verdict) : null;
}

function buildFewshot(fewshotPath: string | null, a: AnswerFile, b: AnswerFile): string {
  if (!fewshotPath) return "";
  const full = path.isAbsolute(fewshotPath) ? fewshotPath : path.join(__dirname, fewshotPath);
  if (!fs.existsSync(full)) {
    console.warn(`[judge] few-shot file not found: ${full} — judging with rubric only`);
    return "";
  }
  const rated = JSON.parse(fs.readFileSync(full, "utf8")) as {
    armA: string;
    armB: string;
    ratings: Record<string, { verdict: "A" | "B" | "tie"; reason: string | null }>;
  };
  const examples: string[] = [];
  for (const [id, r] of Object.entries(rated.ratings)) {
    if (examples.length >= FEWSHOT_MAX) break;
    const qa = a.answers[id];
    const qb = b.answers[id];
    if (!qa || !qb) continue;
    const founderPick =
      r.verdict === "tie" ? "tie" : r.verdict === "A" ? "the first answer" : "the second answer";
    examples.push(
      `QUESTION: ${qa.question}\nFIRST ANSWER:\n${qa.reply}\nSECOND ANSWER:\n${qb.reply}\nFOUNDER'S PICK: ${founderPick}${r.reason ? `\nFOUNDER'S REASON: ${r.reason}` : ""}`
    );
  }
  if (examples.length === 0) return "";
  return `\n\nWORKED EXAMPLES — real pairs the founder rated, with his picks. Learn his taste from these:\n\n${examples.join("\n\n---\n\n")}\n`;
}

async function judgeOnce(
  client: Anthropic,
  rubric: string,
  fewshot: string,
  question: string,
  first: string,
  second: string
): Promise<Verdict | null> {
  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 16000,
    system: rubric + fewshot,
    messages: [
      {
        role: "user",
        content: `QUESTION THE DRIVER ASKED:\n${question}\n\nFIRST ANSWER:\n${first}\n\nSECOND ANSWER:\n${second}\n\nWhich answer would the founder prefer? Weigh the rubric, then end your reply with exactly one line: "VERDICT: first" or "VERDICT: second" or "VERDICT: tie".`,
      },
    ],
  });
  if (response.stop_reason === "refusal") return null;
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return parseVerdict(text);
}

async function main() {
  const batch = argValue("--batch");
  const armsArg = argValue("--arms");
  if (!batch || !armsArg || armsArg.split(",").length !== 2) {
    console.error("Usage: engineer:eval:judge -- --batch <name> --arms <armA>,<armB> [--fewshot <ratings file>]");
    process.exit(1);
  }
  const [armA, armB] = armsArg.split(",").map((s) => s.trim());
  const dir = path.join(__dirname, "answers", batch);
  const a = JSON.parse(fs.readFileSync(path.join(dir, `${armA}.json`), "utf8")) as AnswerFile;
  const b = JSON.parse(fs.readFileSync(path.join(dir, `${armB}.json`), "utf8")) as AnswerFile;
  const rubric = fs.readFileSync(path.join(__dirname, "judge-rubric.md"), "utf8");
  const fewshot = buildFewshot(argValue("--fewshot"), a, b);

  const client = new Anthropic();
  const ids = Object.keys(a.answers).filter((id) => b.answers[id]);

  const outDir = path.join(__dirname, "verdicts", batch);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${armA}-vs-${armB}.judge.json`);
  const existing: Record<string, unknown> = fs.existsSync(outPath)
    ? (JSON.parse(fs.readFileSync(outPath, "utf8")).verdicts ?? {})
    : {};

  const verdicts = existing as Record<
    string,
    { pass1: Verdict | null; pass2: Verdict | null; final: "A" | "B" | "tie" }
  >;

  for (const id of ids) {
    if (verdicts[id]) continue;
    const q = a.answers[id];
    process.stdout.write(`[judge] ${id} … `);
    // Pass 1: A first. Pass 2: B first. Disagreement (after un-swapping) = tie.
    const pass1 = await judgeOnce(client, rubric, fewshot, q.question, q.reply, b.answers[id].reply);
    const pass2 = await judgeOnce(client, rubric, fewshot, q.question, b.answers[id].reply, q.reply);
    const p1: "A" | "B" | "tie" | null =
      pass1 === "first" ? "A" : pass1 === "second" ? "B" : pass1;
    const p2: "A" | "B" | "tie" | null =
      pass2 === "first" ? "B" : pass2 === "second" ? "A" : pass2;
    const final: "A" | "B" | "tie" = p1 != null && p1 === p2 ? p1 : "tie";
    verdicts[id] = { pass1, pass2, final };
    console.log(`${final}${p1 !== p2 ? " (order-swap disagreement → tie)" : ""}`);
    fs.writeFileSync(
      outPath,
      JSON.stringify({ batch, armA, armB, judgeModel: JUDGE_MODEL, verdicts }, null, 2)
    );
  }

  const counts = { A: 0, B: 0, tie: 0 } as Record<string, number>;
  for (const v of Object.values(verdicts)) counts[v.final]++;
  console.log(`\n${armA}: ${counts.A}  ${armB}: ${counts.B}  tie: ${counts.tie} → ${outPath}`);
  console.log("Reminder: this judge steers nothing until agreement.ts reports κ ≥ 0.6 vs the founder holdout.");
}

void main();
