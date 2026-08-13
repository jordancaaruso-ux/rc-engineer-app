/**
 * The physics gate — the tasteless checker (docs/ENGINEER_NORTH_STAR.md §4).
 *
 *   npm run engineer:eval:gate -- --batch 2026-08-14 --arm v1
 *
 * For every answer: extract its physical claims, check each for entailment against the
 * KB + nets corpus. Three-way per claim: supported / contradicted / not-in-corpus.
 * CONTRADICTED = auto-fail (logged with the claim). NOT-IN-CORPUS is logged, never
 * failed — punishing unsupported-but-plausible advice would collapse answers into KB
 * parroting. Deliberately a separate program from the preference judge so prompt
 * iteration can never charm it. Requires ANTHROPIC_API_KEY.
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { loadFullVehicleDynamicsKb } from "@/lib/engineer/kb";
import { ENGINEER_NETS_HEADER, loadNets } from "@/lib/engineer/nets";

const GATE_MODEL = process.env.ENGINEER_JUDGE_MODEL?.trim() || "claude-opus-5";

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

type AnswerFile = {
  arm: string;
  answers: Record<string, { question: string; archetype: string; reply: string }>;
};

type ClaimCheck = {
  claim: string;
  verdict: "supported" | "contradicted" | "not_in_corpus";
  passage: string | null;
};

function parseChecks(text: string): ClaimCheck[] | null {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as ClaimCheck[];
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (c) =>
        c &&
        typeof c.claim === "string" &&
        ["supported", "contradicted", "not_in_corpus"].includes(c.verdict)
    );
  } catch {
    return null;
  }
}

async function main() {
  const batch = argValue("--batch");
  const armId = argValue("--arm");
  if (!batch || !armId) {
    console.error("Usage: engineer:eval:gate -- --batch <name> --arm <id>");
    process.exit(1);
  }
  const dir = path.join(__dirname, "answers", batch);
  const file = JSON.parse(fs.readFileSync(path.join(dir, `${armId}.json`), "utf8")) as AnswerFile;

  const kb = await loadFullVehicleDynamicsKb();
  const nets = await loadNets({ discipline: null });
  const corpus =
    kb.markdown + (nets.text.trim() ? `\n\n${ENGINEER_NETS_HEADER}${nets.text}` : "");

  const system = `You are a physics fact-checker for an RC race-engineering assistant. Below is the assistant's ENTIRE trusted corpus (a vehicle-dynamics knowledge base, plus empirical setup priors). You judge whether an answer's claims are consistent with it.

For the answer you are given:
1. Extract every atomic PHYSICAL claim — statements about what a setup change does mechanically or what the car will do. Ignore style, hedges, questions, and process suggestions.
2. For each claim, judge against the corpus ONLY:
   - "supported": the corpus states it or it follows directly.
   - "contradicted": the corpus states the opposite or the claim collapses a tension the corpus deliberately holds open (the corpus stores mechanisms and explicitly keeps some outcomes two-sided; an answer asserting one side as certain, without the condition that decides it, is contradicted).
   - "not_in_corpus": the corpus is silent — this is NOT a failure, only a note.
3. Reply with ONLY a JSON array: [{"claim": "...", "verdict": "supported|contradicted|not_in_corpus", "passage": "<short corpus quote or null>"}]

THE CORPUS:

${corpus}`;

  const client = new Anthropic();
  const outDir = path.join(__dirname, "verdicts", batch);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${armId}.gate.json`);
  const existing: Record<string, unknown> = fs.existsSync(outPath)
    ? (JSON.parse(fs.readFileSync(outPath, "utf8")).results ?? {})
    : {};

  const results = existing as Record<
    string,
    { checks: ClaimCheck[]; contradicted: number; notInCorpus: number; pass: boolean }
  >;

  for (const [id, ans] of Object.entries(file.answers)) {
    if (results[id]) continue;
    process.stdout.write(`[gate] ${id} … `);
    const response = await client.messages.create({
      model: GATE_MODEL,
      max_tokens: 16000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `QUESTION:\n${ans.question}\n\nANSWER TO CHECK:\n${ans.reply}`,
        },
      ],
    });
    if (response.stop_reason === "refusal") {
      console.log("refused — skipped");
      continue;
    }
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const checks = parseChecks(text);
    if (!checks) {
      console.log("unparseable — skipped");
      continue;
    }
    const contradicted = checks.filter((c) => c.verdict === "contradicted").length;
    const notInCorpus = checks.filter((c) => c.verdict === "not_in_corpus").length;
    results[id] = { checks, contradicted, notInCorpus, pass: contradicted === 0 };
    console.log(
      `${results[id].pass ? "pass" : "FAIL"} (${checks.length} claims, ${contradicted} contradicted, ${notInCorpus} outside corpus)`
    );
    fs.writeFileSync(outPath, JSON.stringify({ batch, arm: armId, gateModel: GATE_MODEL, results }, null, 2));
  }

  const failed = Object.entries(results).filter(([, r]) => !r.pass);
  console.log(`\n${Object.keys(results).length} answers checked, ${failed.length} failed → ${outPath}`);
  for (const [id, r] of failed) {
    for (const c of r.checks.filter((c) => c.verdict === "contradicted")) {
      console.log(`  FAIL ${id}: "${c.claim}"${c.passage ? `\n        corpus: "${c.passage}"` : ""}`);
    }
  }
}

void main();
