/**
 * Dev only: grade a scan's saved crossings against the hand-made truth set.
 *
 *   node scripts/dev-grade-truth.mjs <picks.json> <jobId>
 *
 * A pick is the frame where the car's centre sat on the line, judged by eye (±1 frame, 33ms).
 * The detector reports between frames, so within one frame is a pass. A pick of null means the
 * car never crossed the drawn segment — the only right answer there is silence.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const [picksPath, jobId] = process.argv.slice(2);
const truth = JSON.parse(readFileSync(picksPath, "utf8"));
const prisma = new PrismaClient();
const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: jobId } });
const marks = job.manualJson.marks ?? [];
await prisma.$disconnect();

const FRAME_MS = 1000 / 29.97;
const rows = [];
for (const p of truth.picks) {
  const mark = marks.find((m) => m.driverRole === p.role && m.lapNumber === p.lap && m.lineKey === p.line);
  if (p.t == null) {
    rows.push({ ...p, got: mark?.videoTimeSec ?? null, verdict: mark ? "FALSE POSITIVE (no real crossing)" : "correct silence" });
    continue;
  }
  if (!mark) { rows.push({ ...p, got: null, verdict: "missing / held back" }); continue; }
  const d = (mark.videoTimeSec - p.t) * 1000;
  const verdict = Math.abs(d) <= FRAME_MS ? "pass (≤1 frame)" : Math.abs(d) <= 2 * FRAME_MS ? "near (≤2 frames)" : Math.abs(d) < 300 ? "OFF" : "WRONG CAR / WRONG MOMENT";
  rows.push({ ...p, got: mark.videoTimeSec, dMs: d, verdict });
}

console.log(`truth picks: ${truth.picks.length} · saved marks on job: ${marks.length}\n`);
console.log("who   lap line   truth      detector     Δms   verdict");
for (const r of rows) {
  const who = r.role === "me" ? "you  " : "sandy";
  const t = r.t == null ? "   none  " : r.t.toFixed(3);
  const g = r.got == null ? "    —    " : r.got.toFixed(3);
  const d = r.dMs == null ? "     " : String(Math.round(r.dMs)).padStart(5);
  console.log(`${who} L${String(r.lap).padEnd(2)} ${r.line}   ${t}   ${g}   ${d}   ${r.verdict}`);
}
const graded = rows.filter((r) => r.dMs != null);
const abs = graded.map((r) => Math.abs(r.dMs)).sort((a, b) => a - b);
const pass = graded.filter((r) => Math.abs(r.dMs) <= FRAME_MS).length;
const wrong = graded.filter((r) => Math.abs(r.dMs) >= 300).length;
const missing = rows.filter((r) => r.t != null && r.got == null).length;
const fp = rows.filter((r) => r.t == null && r.got != null).length;
console.log(`\nfound & graded ${graded.length}/${rows.filter((r) => r.t != null).length} · within 1 frame ${pass} · median |Δ| ${abs.length ? Math.round(abs[Math.floor(abs.length / 2)]) : "—"}ms · worst ${abs.length ? Math.round(abs[abs.length - 1]) : "—"}ms`);
console.log(`wrong car/moment written as fact: ${wrong} · missing or held back: ${missing} · false positives on no-crossing: ${fp}`);
