/**
 * Tally the founder's blind pairwise picks into a per-model record.
 *
 * Reads results/model-pairwise-labels.json (exported from the pairwise page) and prints
 * wins/losses/ties per model, plus every head-to-head. Deliberately does no statistics: at three
 * cases per pair, a win count is a direction, not a result, and dressing it up as a p-value would
 * make it look like more than it is.
 *
 * Run: npm run engineer:bench:model-tally
 */
import fs from "node:fs/promises";
import path from "node:path";

type Label = {
  caseId: string;
  modelShownFirst: string;
  modelShownSecond: string;
  pick: "1" | "2" | "tie";
  winner: string | null;
  note: string | null;
};

function arg(name: string): string | null {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

async function main() {
  const resultsDir = path.join(process.cwd(), "scripts/engineer-bench/results");
  const file = arg("labels") ?? path.join(resultsDir, "model-pairwise-labels.json");
  const parsed = JSON.parse(await fs.readFile(file, "utf8")) as { labels: Label[] };
  const labels = parsed.labels ?? [];
  if (labels.length === 0) throw new Error(`No labels in ${file}`);

  const models = [...new Set(labels.flatMap((l) => [l.modelShownFirst, l.modelShownSecond]))].sort();
  const record = new Map(models.map((m) => [m, { win: 0, loss: 0, tie: 0 }]));
  const head = new Map<string, { a: number; b: number; tie: number }>();

  for (const l of labels) {
    const [x, y] = [l.modelShownFirst, l.modelShownSecond].sort();
    const hKey = `${x} vs ${y}`;
    const h = head.get(hKey) ?? { a: 0, b: 0, tie: 0 };
    if (l.pick === "tie" || !l.winner) {
      record.get(l.modelShownFirst)!.tie++;
      record.get(l.modelShownSecond)!.tie++;
      h.tie++;
    } else {
      const loser = l.winner === l.modelShownFirst ? l.modelShownSecond : l.modelShownFirst;
      record.get(l.winner)!.win++;
      record.get(loser)!.loss++;
      if (l.winner === x) h.a++;
      else h.b++;
    }
    head.set(hKey, h);
  }

  console.log(`\n--- Blind pairwise tally (${labels.length} comparisons judged) ---\n`);
  const rows = [...record.entries()]
    .map(([model, r]) => ({ model, ...r, decisive: r.win + r.loss }))
    .sort((a, b) => b.win - b.loss - (a.win - a.loss));
  console.log("arm (model@effort)".padEnd(28) + "W".padStart(4) + "L".padStart(4) + "T".padStart(4) + "  win% (of decisive)");
  for (const r of rows) {
    const pct = r.decisive > 0 ? `${Math.round((r.win / r.decisive) * 100)}%` : "—";
    console.log(
      r.model.padEnd(28) +
        String(r.win).padStart(4) +
        String(r.loss).padStart(4) +
        String(r.tie).padStart(4) +
        `  ${pct}`
    );
  }

  console.log(`\nHead-to-head:`);
  for (const [k, h] of [...head.entries()].sort()) {
    const [x, y] = k.split(" vs ");
    console.log(`  ${k}:  ${x} ${h.a} — ${h.b} ${y}  (${h.tie} tie)`);
  }

  const notes = labels.filter((l) => l.note);
  if (notes.length > 0) {
    console.log(`\nYour reasons:`);
    for (const l of notes) {
      console.log(`  [${l.caseId}] ${l.winner ?? "tie"} — ${l.note}`);
    }
  }
  console.log(
    `\nThree cases per pair. Read a 3–0 as a signal and a 2–1 as noise; if it matters, run more cases.\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
