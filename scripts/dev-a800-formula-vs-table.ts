/**
 * READ-ONLY. Does the app's hand-typed spring-rate table agree with the formula the A800RR PDF
 * carries in its own form layer?
 *
 * The sheet's script (field Text91, front):
 *   a = spring_gap_front, b = lower_arm_extension_front
 *   CheckBox8  = spring_front            (ticked = STD)
 *   CheckBox11 = srs_arrangement_front   (ticked = I)
 *
 *   base = 0.81 * 84.497 * exp(0.1087 * (srs === "I" ? a : a - 4)) * 28.7^2 / (28.7 + b)^2
 *   rate = spring === "STD" ? base : 0.797 * base
 */
import { computeSpringRateLookupForSide } from "@/lib/setupCalculations/springRateLookup";
import { prisma } from "@/lib/prisma";

function sheetFormula(args: {
  gap: number;
  ext: number;
  srs: "I" | "II";
  spring: "STD" | "S";
}): number {
  const a = args.srs === "I" ? args.gap : args.gap - 4;
  const lever = (28.7 * 28.7) / ((28.7 + args.ext) * (28.7 + args.ext));
  const base = 0.81 * 84.497 * Math.exp(0.1087 * a) * lever;
  return args.spring === "STD" ? base : 0.797 * base;
}

function appTable(args: { gap: number; ext: number; srs: "I" | "II"; spring: "STD" | "S" }) {
  return computeSpringRateLookupForSide(
    {
      spring_gap_front: String(args.gap),
      lower_arm_extension_front: String(args.ext),
      srs_arrangement_front: args.srs,
      spring_front: args.spring,
    },
    "front"
  );
}

function sweep(label: string, ext: number) {
  let worst = 0;
  let worstAt = "";
  let n = 0;
  let blanks = 0;
  for (const srs of ["I", "II"] as const) {
    for (const spring of ["STD", "S"] as const) {
      for (let g = 0; g <= 5.0001; g += 0.2) {
        const gap = Number(g.toFixed(1));
        const want = sheetFormula({ gap, ext, srs, spring });
        const got = appTable({ gap, ext, srs, spring });
        n++;
        if (got.rate == null) { blanks++; continue; }
        const pct = Math.abs(got.rate - want) / want * 100;
        if (pct > worst) { worst = pct; worstAt = `srs ${srs} · ${spring} · gap ${gap} — sheet ${want.toFixed(1)}, app ${got.rate}`; }
      }
    }
  }
  console.log(`\n${label}`);
  console.log(`  ${n} points · app returned nothing for ${blanks}`);
  console.log(`  worst disagreement: ${worst.toFixed(2)}%${worstAt ? `  (${worstAt})` : ""}`);
}

async function howOftenDoesExtensionMatter() {
  const snaps = await prisma.setupSnapshot.findMany({
    select: { data: true },
    orderBy: { createdAt: "desc" },
    take: 8000,
  });
  let a800 = 0, nonZeroExt = 0, offTable = 0, offStep = 0, above4 = 0, gapSides = 0;
  const extValues = new Map<string, number>();
  const gapBuckets = new Map<string, number>();
  for (const s of snaps) {
    const d = (s.data ?? {}) as Record<string, unknown>;
    if (!("spring_gap_front" in d || "srs_arrangement_front" in d)) continue;
    a800++;
    for (const side of ["front", "rear"] as const) {
      const raw = d[`lower_arm_extension_${side}`];
      const ext = raw == null || raw === "" ? 0 : Number(String(raw).replace(",", "."));
      const key = Number.isFinite(ext) ? String(ext) : String(raw);
      extValues.set(key, (extValues.get(key) ?? 0) + 1);
      if (Number.isFinite(ext) && ext !== 0) nonZeroExt++;
      const gapRaw = d[`spring_gap_${side}`];
      const gap = gapRaw == null || gapRaw === "" ? null : Number(String(gapRaw).replace(",", "."));
      if (gap != null && Number.isFinite(gap)) {
        gapSides++;
        if (gap > 4.0) above4++;
        gapBuckets.set(
          gap > 4 ? "above 4.0" : `${Math.floor(gap)}.x`,
          (gapBuckets.get(gap > 4 ? "above 4.0" : `${Math.floor(gap)}.x`) ?? 0) + 1
        );
        const eff = gap - (Number.isFinite(ext) ? ext : 0);
        if (eff < 0 || eff > 5) offTable++;
        if (Math.abs(eff / 0.2 - Math.round(eff / 0.2)) > 1e-6) offStep++;
      }
    }
  }
  console.log(`\nA800RR-looking snapshots: ${a800} (${a800 * 2} sides)`);
  console.log(`  sides with a NON-ZERO lower arm extension: ${nonZeroExt}`);
  console.log(`  sides whose effective gap falls OUTSIDE the 0–5 mm table: ${offTable}`);
  console.log(`  sides whose effective gap is NOT on a 0.2 mm step (so it gets snapped): ${offStep}`);
  console.log("  lower arm extension values seen:",
    [...extValues.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([v, c]) => `${v}×${c}`).join(", "));
  // The table tracks the formula exactly to 4.0 mm and then goes LINEAR (+1.7 per 0.2 step) while
  // the formula keeps compounding — so all of the divergence is at the top of the range.
  console.log(`  spring gaps recorded: ${gapSides} sides · above 4.0 mm: ${above4} (${(above4 / gapSides * 100).toFixed(2)}%)`);
  console.log("  distribution:", [...gapBuckets.entries()].sort().map(([k, v]) => `${k}: ${v}`).join(" · "));
}

async function main() {
  sweep("extension = 0 mm (the case the table was typed for)", 0);
  sweep("extension = 1 mm", 1);
  sweep("extension = 2 mm", 2);
  await howOftenDoesExtensionMatter();

  // Off-step and off-range gaps: what the table cannot answer but the formula can.
  console.log("\noff-step / off-range gaps (extension 0, srs I, STD):");
  for (const gap of [0.1, 1.3, 3.7, 5.4, 6.0]) {
    const want = sheetFormula({ gap, ext: 0, srs: "I", spring: "STD" });
    const got = appTable({ gap, ext: 0, srs: "I", spring: "STD" });
    console.log(`  gap ${String(gap).padEnd(4)} — sheet ${want.toFixed(1)} · app ${got.rate ?? `(nothing: ${got.resolution})`}`);
  }
}

main().finally(() => prisma.$disconnect());

/**
 * Appended 2026-08-26: the table tracks the formula exactly to 4.0 mm and then goes LINEAR
 * (+1.7 per 0.2 step) while the formula keeps compounding — so the divergence is all at the top
 * of the range. How many real setups actually sit up there?
 */
