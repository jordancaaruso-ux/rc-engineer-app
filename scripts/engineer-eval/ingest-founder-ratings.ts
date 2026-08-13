/**
 * De-shuffle an exported founder-ratings JSON into arm terms.
 *
 *   npm run engineer:eval:ingest -- --file ~/Downloads/founder-ratings-2026-08-14.json
 *
 * Re-derives the left/right order from the embedded seed (same PRNG as the page builder)
 * and writes ratings/<batch>-founder.json with verdicts as "A" | "B" | "tie" where A/B are
 * the arms named in the export's meta.
 */
import fs from "node:fs";
import path from "node:path";

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const file = argValue("--file");
  if (!file) {
    console.error("Usage: engineer:eval:ingest -- --file <exported.json>");
    process.exit(1);
  }
  const exported = JSON.parse(fs.readFileSync(file, "utf8")) as {
    meta: { batch: string; armA: string; armB: string; seed: number };
    ratings: Record<string, { verdict: "left" | "right" | "tie"; reason?: string }>;
  };
  const { batch, armA, armB, seed } = exported.meta;

  // Recompute the shuffle exactly as the page builder did: iterate the SAME id order
  // (answers file key order, intersected) and draw one random number per pair.
  const dir = path.join(__dirname, "answers", batch);
  const a = JSON.parse(fs.readFileSync(path.join(dir, `${armA}.json`), "utf8")) as {
    answers: Record<string, unknown>;
  };
  const b = JSON.parse(fs.readFileSync(path.join(dir, `${armB}.json`), "utf8")) as {
    answers: Record<string, unknown>;
  };
  const rand = mulberry32(seed);
  const ids = Object.keys(a.answers).filter((id) => (b.answers as never)[id]);
  const aFirstById = new Map(ids.map((id) => [id, rand() < 0.5]));

  const out: Record<string, { verdict: "A" | "B" | "tie"; reason: string | null }> = {};
  for (const [id, r] of Object.entries(exported.ratings)) {
    if (!r?.verdict) continue;
    const aFirst = aFirstById.get(id);
    if (aFirst == null) continue;
    const verdict =
      r.verdict === "tie" ? "tie" : (r.verdict === "left") === aFirst ? "A" : "B";
    out[id] = { verdict, reason: r.reason?.trim() || null };
  }

  const ratingsDir = path.join(__dirname, "ratings");
  fs.mkdirSync(ratingsDir, { recursive: true });
  const outPath = path.join(ratingsDir, `${batch}-founder.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify({ batch, armA, armB, rater: "founder", ratings: out }, null, 2)
  );
  const counts = { A: 0, B: 0, tie: 0 } as Record<string, number>;
  for (const r of Object.values(out)) counts[r.verdict]++;
  console.log(
    `${Object.keys(out).length} verdicts → ${outPath}  (${armA}: ${counts.A}, ${armB}: ${counts.B}, tie: ${counts.tie})`
  );
}

void main();
