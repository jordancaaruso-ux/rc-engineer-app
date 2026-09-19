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

async function main() {
  const prisma = new PrismaClient();
  const user = await prisma.user.findFirst({ where: { email: "jordancaaruso@gmail.com" }, select: { id: true } });
  if (!user) throw new Error("no user");
  const runs = await prisma.run.findMany({
    where: { userId: user.id, loggingComplete: true },
    orderBy: { sortAt: "asc" },
    select: {
      id: true, sortAt: true, sessionCompletedAt: true, createdAt: true,
      carId: true, trackId: true, carNameSnapshot: true, trackNameSnapshot: true,
      bestLapSeconds: true, avgTop5LapSeconds: true, carRating: true,
      tireRunNumber: true, tireTypeId: true, conditionsAirTempC: true,
      handlingAssessmentJson: true, driverNotes: true, notes: true,
      setupSnapshot: { select: { data: true } },
    },
  });
  console.log("completed runs:", runs.length);

  const withSetup = runs.map((r) => ({ ...r, flat: flatten(r.setupSnapshot?.data) }));
  const sizes = withSetup.map((r) => Object.keys(r.flat).length);
  const nonEmpty = withSetup.filter((r) => Object.keys(r.flat).length >= 5);
  console.log("runs with >=5 setup values:", nonEmpty.length, "| median keys:", sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)]);
  console.log("runs with carRating:", runs.filter((r) => r.carRating != null).length,
    "| with bestLap:", runs.filter((r) => r.bestLapSeconds != null).length,
    "| with both:", runs.filter((r) => r.carRating != null && r.bestLapSeconds != null).length);

  // Consecutive pairs on the same car (setup follows the car), any track.
  const byCar = new Map<string, typeof nonEmpty>();
  for (const r of nonEmpty) {
    const k = r.carId ?? r.carNameSnapshot ?? "unknown";
    if (!byCar.has(k)) byCar.set(k, []);
    byCar.get(k)!.push(r);
  }

  const dist = new Map<number, number>();
  const keyChanges = new Map<string, { n: number; usable: number; sameTrack: number; sameDay: number }>();
  let pairs = 0, usablePairs = 0, oneKeyPairs = 0, oneKeyUsable = 0;
  const dayOf = (r: (typeof nonEmpty)[number]) => (r.sessionCompletedAt ?? r.createdAt).toISOString().slice(0, 10);

  for (const list of byCar.values()) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      const keys = new Set([...Object.keys(a.flat), ...Object.keys(b.flat)]);
      const changed = [...keys].filter((k) => a.flat[k] !== b.flat[k]);
      if (changed.length === 0) { dist.set(0, (dist.get(0) ?? 0) + 1); continue; }
      pairs++;
      const bucket = changed.length >= 4 ? 4 : changed.length;
      dist.set(bucket, (dist.get(bucket) ?? 0) + 1);
      const outcome = a.carRating != null && b.carRating != null || a.bestLapSeconds != null && b.bestLapSeconds != null;
      if (outcome) usablePairs++;
      if (changed.length === 1) { oneKeyPairs++; if (outcome) oneKeyUsable++; }
      for (const k of changed) {
        const e = keyChanges.get(k) ?? { n: 0, usable: 0, sameTrack: 0, sameDay: 0 };
        e.n++;
        if (outcome) e.usable++;
        if (a.trackId && a.trackId === b.trackId) e.sameTrack++;
        if (dayOf(a) === dayOf(b)) e.sameDay++;
        keyChanges.set(k, e);
      }
    }
  }
  console.log("\nconsecutive same-car pairs — keys changed:",
    [...dist.entries()].sort((x, y) => x[0] - y[0]).map(([k, v]) => `${k === 4 ? "4+" : k}:${v}`).join("  "));
  console.log(`pairs with a change: ${pairs} | with pace or rating both sides: ${usablePairs} | single-key: ${oneKeyPairs} (usable ${oneKeyUsable})`);

  const top = [...keyChanges.entries()].sort((a, b) => b[1].usable - a[1].usable).slice(0, 22);
  console.log("\nmost-changed keys (n = times changed, usable = outcome both sides):");
  for (const [k, e] of top) console.log(`  ${e.usable.toString().padStart(3)} usable / ${e.n.toString().padStart(3)} changes  sameTrack ${e.sameTrack.toString().padStart(3)}  sameDay ${e.sameDay.toString().padStart(3)}  ${k}`);
  console.log("\nkeys changed 3+ times WITH outcome both sides:", [...keyChanges.values()].filter((e) => e.usable >= 3).length);
  console.log("keys changed 4+ times with outcome:", [...keyChanges.values()].filter((e) => e.usable >= 4).length);
  await prisma.$disconnect();
}
main();
