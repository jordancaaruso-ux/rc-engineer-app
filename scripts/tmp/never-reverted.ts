import { PrismaClient } from "@prisma/client";
function flatten(obj: unknown, prefix = "", out: Record<string, string> = {}) {
  if (obj == null || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else if (v !== null && v !== undefined && v !== "") out[key] = String(v);
  }
  return out;
}
const num = (s?: string) => { const n = Number(s); return Number.isFinite(n) ? n : null; };
async function main() {
  const prisma = new PrismaClient();
  const user = await prisma.user.findFirst({ where: { email: "jordancaaruso@gmail.com" }, select: { id: true } });
  const runs = await prisma.run.findMany({
    where: { userId: user!.id, loggingComplete: true },
    orderBy: { sortAt: "asc" },
    select: { id: true, sortAt: true, sessionCompletedAt: true, createdAt: true, carId: true, carNameSnapshot: true,
      trackNameSnapshot: true, bestLapSeconds: true, carRating: true, setupSnapshot: { select: { data: true } } },
  });
  const rows = runs.map((r) => ({ ...r, flat: flatten(r.setupSnapshot?.data) })).filter((r) => Object.keys(r.flat).length >= 5);
  const byCar = new Map<string, typeof rows>();
  for (const r of rows) { const k = r.carId ?? "unknown"; if (!byCar.has(k)) byCar.set(k, []); byCar.get(k)!.push(r); }

  // A change that stuck: key moves at run i and never returns to its old value in the runs after.
  const stuck: Array<{ key: string; from: string; to: string; when: string; runsSince: number; ratingBefore: number | null; ratingAfter: number | null }> = [];
  for (const list of byCar.values()) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      for (const k of new Set([...Object.keys(a.flat), ...Object.keys(b.flat)])) {
        if (a.flat[k] === b.flat[k]) continue;
        const after = list.slice(i);
        if (after.some((r) => r.flat[k] === a.flat[k])) continue; // reverted later
        const before3 = list.slice(Math.max(0, i - 3), i).map((r) => r.carRating).filter((x): x is number => x != null);
        const after3 = after.slice(0, 3).map((r) => r.carRating).filter((x): x is number => x != null);
        const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
        stuck.push({ key: k, from: a.flat[k] ?? "—", to: b.flat[k] ?? "—",
          when: (b.sessionCompletedAt ?? b.createdAt).toISOString().slice(0, 10),
          runsSince: after.length - 1, ratingBefore: avg(before3), ratingAfter: avg(after3) });
      }
    }
  }
  const worse = stuck.filter((s) => s.ratingBefore != null && s.ratingAfter != null && s.ratingAfter < s.ratingBefore - 0.4 && s.runsSince >= 3);
  console.log("changes that stuck (never returned to the old value):", stuck.length);
  console.log("...of those, rating dropped >=0.4 after and >=3 runs since:", worse.length);
  for (const s of worse.sort((a, b) => (a.ratingAfter! - a.ratingBefore!) - (b.ratingAfter! - b.ratingBefore!)).slice(0, 12))
    console.log(`  ${s.when}  ${s.key}: ${s.from} -> ${s.to}   rating ${s.ratingBefore!.toFixed(1)} -> ${s.ratingAfter!.toFixed(1)}  (${s.runsSince} runs since)`);
  await prisma.$disconnect();
}
main();
