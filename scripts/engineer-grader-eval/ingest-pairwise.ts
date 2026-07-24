/**
 * Ingest founder pairwise labels and score GRADER-vs-FOUNDER agreement — the number
 * that decides whether the grader is trusted as a fitness function.
 *
 * Reports: preference-match rate (strict + non-inverted), agreement within the close-call
 * stratum (where trust is actually earned), held-out check, biggest disagreements, and —
 * with --reason-agreement — whether the grader picked for the SAME reason the founder did.
 *
 * Run:  npm run engineer:grader:ingest -- [--labels=results/pairwise-labels.json] [--reason-agreement]
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { PairwiseVerdict } from "@/lib/engineerFeedback/calibratedJudge";
import { llmChat, parseJsonLoose } from "./provider/llmChat";
import type { LlmProviderId } from "./provider/resolveProvider";

type LabelsFile = {
  labels: Array<{ label: string; scenarioId: string; flipped: boolean; pick: "1" | "2" | "tie"; note: string | null }>;
};
type GraderResults = {
  label: string;
  results: Array<{
    scenarioId: string;
    question: string;
    mode: string;
    source: string;
    difficultyTag: string | null;
    plantedError: { kind: string; description: string } | null;
    engineA: { answer: string | null };
    engineB: { answer: string | null };
    graderVerdict: PairwiseVerdict | null;
  }>;
};
type Winner = "A" | "B" | "tie";

function arg(name: string): string | null {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

/** Map the founder's display-order pick back to A/B, undoing the blind flip. */
export function founderWinner(pick: "1" | "2" | "tie", flipped: boolean): Winner {
  if (pick === "tie") return "tie";
  const firstIsA = !flipped; // flipped → Answer ① was engine B
  if (pick === "1") return firstIsA ? "A" : "B";
  return firstIsA ? "B" : "A";
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(0)}% (${n}/${d})`;
}

type Row = {
  key: string;
  scenarioId: string;
  question: string;
  grader: Winner;
  agreedBothOrders: boolean;
  founder: Winner;
  note: string | null;
  graderRationale: string;
  hard: boolean;
  graderAnswerFirst: string; // engine-A answer (for reason context)
  graderAnswerSecond: string;
  plantedError: { kind: string; description: string } | null;
  source: string;
};

async function classifyReason(row: Row, provider: LlmProviderId, model: string): Promise<"agree" | "partial" | "disagree" | "error"> {
  const system =
    "You compare two rationales for the SAME A/B preference between two RC-engineer answers. Decide whether they rest on the SAME deciding reason. Return ONLY JSON {\"agreement\":\"agree\"|\"partial\"|\"disagree\"}. agree = same core reason; partial = related but different emphasis; disagree = different/contradictory reasons.";
  const user = JSON.stringify({
    winner: row.grader,
    graderRationale: row.graderRationale,
    founderReason: row.note ?? "",
  });
  try {
    const res = await llmChat({ provider, model, temperature: 0, responseFormatJson: true, messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ] });
    const parsed = parseJsonLoose<{ agreement?: string }>(res.content);
    const a = parsed?.agreement;
    return a === "agree" || a === "partial" || a === "disagree" ? a : "error";
  } catch {
    return "error";
  }
}

async function main() {
  const resultsDir = path.join(process.cwd(), "scripts/engineer-grader-eval/results");

  // Labels file (default newest pairwise-labels*.json).
  let labelsPath = arg("labels");
  if (!labelsPath) {
    const cands = (await fs.readdir(resultsDir)).filter((f) => f.startsWith("pairwise-labels") && f.endsWith(".json")).sort();
    if (cands.length === 0) throw new Error("No pairwise-labels*.json in results/ — pass --labels=");
    labelsPath = path.join(resultsDir, cands[cands.length - 1]);
  } else {
    labelsPath = path.resolve(labelsPath);
  }
  const labelsFile = JSON.parse(await fs.readFile(labelsPath, "utf8")) as LabelsFile;
  if (!Array.isArray(labelsFile.labels) || labelsFile.labels.length === 0) throw new Error("Labels file has no labels");

  // Index grader results by label|scenarioId.
  const byKey = new Map<string, GraderResults["results"][number] & { label: string }>();
  for (const f of await fs.readdir(resultsDir)) {
    if (!f.startsWith("grader-") || !f.endsWith(".json")) continue;
    let parsed: GraderResults;
    try {
      parsed = JSON.parse(await fs.readFile(path.join(resultsDir, f), "utf8")) as GraderResults;
    } catch {
      continue;
    }
    if (!parsed.label || !Array.isArray(parsed.results)) continue;
    for (const r of parsed.results) byKey.set(`${parsed.label}|${r.scenarioId}`, { ...r, label: parsed.label });
  }

  const rows: Row[] = [];
  let unmatched = 0;
  for (const l of labelsFile.labels) {
    const hit = byKey.get(`${l.label}|${l.scenarioId}`);
    if (!hit || !hit.graderVerdict) {
      unmatched++;
      continue;
    }
    const grader = hit.graderVerdict.winner;
    const founder = founderWinner(l.pick, l.flipped);
    rows.push({
      key: `${l.label}|${l.scenarioId}`,
      scenarioId: l.scenarioId,
      question: hit.question,
      grader,
      agreedBothOrders: hit.graderVerdict.agreedBothOrders,
      founder,
      note: l.note,
      graderRationale: hit.graderVerdict.rationaleFirstOrder || hit.graderVerdict.rationaleSecondOrder || "",
      hard: grader === "tie" || founder === "tie" || !hit.graderVerdict.agreedBothOrders,
      graderAnswerFirst: hit.engineA.answer ?? "",
      graderAnswerSecond: hit.engineB.answer ?? "",
      plantedError: hit.plantedError,
      source: hit.source,
    });
  }
  if (rows.length === 0) throw new Error("No labeled scenarios matched judged grader results");

  // --- Core metrics ---
  const strict = rows.filter((r) => r.grader === r.founder).length;
  const inverted = rows.filter(
    (r) => (r.grader === "A" && r.founder === "B") || (r.grader === "B" && r.founder === "A")
  ).length;
  const nonInverted = rows.length - inverted;

  const hard = rows.filter((r) => r.hard);
  const clear = rows.filter((r) => !r.hard);
  const hardStrict = hard.filter((r) => r.grader === r.founder).length;
  const clearStrict = clear.filter((r) => r.grader === r.founder).length;

  console.log(`Grader-vs-founder over ${rows.length} labeled pairs (${unmatched} unmatched skipped):\n`);
  console.log(`  Preference-match (strict):   ${pct(strict, rows.length)}`);
  console.log(`  Non-inverted (no A↔B flip):  ${pct(nonInverted, rows.length)}`);
  console.log(`  Close-call stratum match:    ${pct(hardStrict, hard.length)}  ← where trust is earned`);
  console.log(`  Clear-cut stratum match:     ${pct(clearStrict, clear.length)}`);
  console.log(
    `\nReading it: strict-match on close-calls ≥ 80% → trust the grader as a fitness function; 60–80% → directional, confirm big calls yourself; < 60% → fix the grader (exemplars / model / sampling) before scaling scenarios.`
  );

  // Held-out sanity: scenarios are synthetic; flag any question overlapping the calibration exemplars.
  try {
    const ex = JSON.parse(await fs.readFile(path.join(resultsDir, "exemplars.json"), "utf8")) as {
      exemplars?: Array<{ question: string }>;
    };
    const exKeys = new Set((ex.exemplars ?? []).map((e) => e.question.slice(0, 120).toLowerCase()));
    const overlap = rows.filter((r) => exKeys.has(r.question.slice(0, 120).toLowerCase())).length;
    console.log(`\nHeld-out check: ${overlap} of ${rows.length} labeled questions overlap calibration exemplars (want 0).`);
  } catch {
    // exemplars.json optional
  }

  // Planted-error floor (secondary) — present only once planted pairs exist (Phase 2+).
  const planted = rows.filter((r) => r.plantedError);
  if (planted.length > 0) {
    console.log(`\nPlanted-error pairs: ${planted.length} (secondary floor) — inspect grader caught the degraded answer.`);
  }

  // Biggest disagreements — the cases to read.
  const disagreements = rows.filter((r) => r.grader !== r.founder);
  if (disagreements.length) {
    console.log(`\nDisagreements to read (${disagreements.length}):`);
    for (const d of disagreements.slice(0, 8)) {
      console.log(`  ${d.key}: grader=${d.grader} vs you=${d.founder}${d.note ? ` — you: ${d.note}` : ""}`);
    }
  }

  // Reason-agreement (opt-in; costs LLM calls) — only where the pick already matched.
  if (process.argv.includes("--reason-agreement")) {
    const provider = (process.env.GRADER_REASON_PROVIDER?.trim() as LlmProviderId) || "openai";
    const model = process.env.GRADER_REASON_MODEL?.trim() || "gpt-4o-mini";
    const matchedNonTie = rows.filter((r) => r.grader === r.founder && r.grader !== "tie" && r.note);
    const counts = { agree: 0, partial: 0, disagree: 0, error: 0 };
    for (const r of matchedNonTie) counts[await classifyReason(r, provider, model)] += 1;
    console.log(
      `\nReason-agreement on ${matchedNonTie.length} right-pick pairs (via ${provider}/${model}): ` +
        `agree ${counts.agree} · partial ${counts.partial} · disagree ${counts.disagree}${counts.error ? ` · error ${counts.error}` : ""}`
    );
    console.log(`  (right pick for the right reason = agree; "disagree" = right answer, wrong rationale — a subtler grader gap.)`);
  } else {
    console.log(`\nRe-run with --reason-agreement to check the grader picked for the SAME reason you did.`);
  }
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, "/").endsWith("engineer-grader-eval/ingest-pairwise.ts");
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
