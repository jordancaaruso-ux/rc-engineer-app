/**
 * Judge exam scoring — Cohen's kappa between the judge and the founder holdout.
 *
 *   npm run engineer:eval:stats -- --batch 2026-08-14 --arms v1,v1-nets
 *
 * Compares verdicts/<batch>/<armA>-vs-<armB>.judge.json against
 * ratings/<batch>-founder.json on the questions both rated. The number decides what the
 * judge may do (docs/ENGINEER_NORTH_STAR.md §4): κ < 0.6 nothing; ≥ 0.6 steer
 * experiments (founder still audits); ≥ 0.75 gate ships. The frozen holdout must never
 * appear in the judge's few-shot examples, or the exam is worthless — keep calibration
 * pairs and exam pairs in separate batches.
 *
 * Also reports the win-rate delta with a reminder of the noise floor: at n=50, only
 * splits ≥ ~65/35 beat coin-flip noise.
 */
import fs from "node:fs";
import path from "node:path";

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

type Label = "A" | "B" | "tie";

function cohenKappa(pairs: Array<[Label, Label]>): number {
  const labels: Label[] = ["A", "B", "tie"];
  const n = pairs.length;
  if (n === 0) return NaN;
  let agree = 0;
  const marg1 = new Map<Label, number>();
  const marg2 = new Map<Label, number>();
  for (const [x, y] of pairs) {
    if (x === y) agree++;
    marg1.set(x, (marg1.get(x) ?? 0) + 1);
    marg2.set(y, (marg2.get(y) ?? 0) + 1);
  }
  const po = agree / n;
  let pe = 0;
  for (const l of labels) {
    pe += ((marg1.get(l) ?? 0) / n) * ((marg2.get(l) ?? 0) / n);
  }
  if (pe === 1) return 1;
  return (po - pe) / (1 - pe);
}

async function main() {
  const batch = argValue("--batch");
  const armsArg = argValue("--arms");
  if (!batch || !armsArg || armsArg.split(",").length !== 2) {
    console.error("Usage: engineer:eval:stats -- --batch <name> --arms <armA>,<armB>");
    process.exit(1);
  }
  const [armA, armB] = armsArg.split(",").map((s) => s.trim());

  const judgePath = path.join(__dirname, "verdicts", batch, `${armA}-vs-${armB}.judge.json`);
  const founderPath = path.join(__dirname, "ratings", `${batch}-founder.json`);

  const judge = JSON.parse(fs.readFileSync(judgePath, "utf8")) as {
    verdicts: Record<string, { final: Label }>;
  };
  const founder = JSON.parse(fs.readFileSync(founderPath, "utf8")) as {
    ratings: Record<string, { verdict: Label }>;
  };

  const pairs: Array<[Label, Label]> = [];
  const disagreements: string[] = [];
  for (const [id, f] of Object.entries(founder.ratings)) {
    const j = judge.verdicts[id];
    if (!j) continue;
    pairs.push([f.verdict, j.final]);
    if (f.verdict !== j.final) disagreements.push(`${id}: founder=${f.verdict} judge=${j.final}`);
  }

  const kappa = cohenKappa(pairs);
  const agree = pairs.filter(([x, y]) => x === y).length;

  console.log(`Batch ${batch} — ${armA} vs ${armB}`);
  console.log(`Overlapping verdicts: ${pairs.length}`);
  console.log(`Raw agreement: ${agree}/${pairs.length} (${((agree / pairs.length) * 100).toFixed(1)}%)`);
  console.log(`Cohen's κ: ${kappa.toFixed(3)}`);
  console.log("");
  if (Number.isNaN(kappa) || pairs.length < 20) {
    console.log("VERDICT: not enough overlapping pairs to trust any number (want 30+, ideally 50).");
  } else if (kappa >= 0.75) {
    console.log("VERDICT: κ ≥ 0.75 — the judge may gate ship decisions (Goodhart guards stay on).");
  } else if (kappa >= 0.6) {
    console.log("VERDICT: κ ≥ 0.6 — the judge may steer experiments; founder audits before anything ships.");
  } else {
    console.log("VERDICT: κ < 0.6 — the judge is not usable. Rework judge-rubric.md from the founder's reasons and re-sit the exam.");
  }
  if (disagreements.length > 0) {
    console.log(`\nDisagreements (${disagreements.length}) — rubric-rework material:`);
    for (const d of disagreements) console.log(`  ${d}`);
  }

  // Win-rate readout with the noise floor stated.
  const judgeCounts = { A: 0, B: 0, tie: 0 } as Record<Label, number>;
  for (const v of Object.values(judge.verdicts)) judgeCounts[v.final]++;
  const decided = judgeCounts.A + judgeCounts.B;
  if (decided > 0) {
    console.log(
      `\nJudge win rate (excl. ties): ${armA} ${judgeCounts.A}/${decided}, ${armB} ${judgeCounts.B}/${decided}` +
        `\nNoise floor: at n=50 only splits ≥ ~65/35 beat coin-flip noise — smaller deltas are not evidence.`
    );
  }
}

void main();
