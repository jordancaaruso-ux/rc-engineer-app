/**
 * READ-ONLY measurement: how many stored A800RR snapshots hold a spring rate or final drive
 * that disagrees with the inputs stored beside them?
 *
 * Written while fixing "the derived boxes don't recompute" (2026-08-26). The question it answers
 * is whether a live recompute is enough on its own, or whether history also needs repairing.
 */
import { PrismaClient } from "@prisma/client";
import { computeA800rrDerived } from "@/lib/setupCalculations/a800rrDerived";

const prisma = new PrismaClient();

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1] ?? "?";
  console.log("db host:", host);

  const snaps = await prisma.setupSnapshot.findMany({
    select: { id: true, data: true },
    orderBy: { createdAt: "desc" },
    take: 8000,
  });
  console.log("snapshots read:", snaps.length);

  let a800 = 0;
  let rateStale = 0, rateAbsent = 0, rateOk = 0, rateNoInputs = 0;
  let ratioStale = 0, ratioAbsent = 0, ratioOk = 0, ratioNoInputs = 0;
  const examples: string[] = [];

  for (const s of snaps) {
    const d = (s.data ?? {}) as Record<string, unknown>;
    const isA800 =
      "spring_gap_front" in d || "srs_arrangement_front" in d || "front_spring_rate_gf_mm" in d;
    if (!isA800) continue;
    a800++;
    const { computed } = computeA800rrDerived(d as never);

    for (const side of ["front", "rear"] as const) {
      const key = `${side}_spring_rate_gf_mm`;
      const stored = num(d[key]);
      const calc = side === "front" ? computed.frontSpringRateGfMm : computed.rearSpringRateGfMm;
      if (calc == null) { rateNoInputs++; continue; }
      if (stored == null) { rateAbsent++; continue; }
      if (Math.abs(stored - calc) > 0.05) {
        rateStale++;
        if (examples.length < 12) {
          examples.push(
            `${s.id.slice(-6)} ${key}: stored ${stored} vs computed ${calc}` +
            ` (gap ${d[`spring_gap_${side}`]}, spring ${d[`spring_${side}`]}, srs ${d[`srs_arrangement_${side}`]}, ext ${d[`lower_arm_extension_${side}`] ?? "-"})`
          );
        }
      } else rateOk++;
    }

    const storedRatio = num(d["final_drive_ratio"]);
    if (computed.finalDriveRatio == null) ratioNoInputs++;
    else if (storedRatio == null) ratioAbsent++;
    else if (Math.abs(storedRatio - computed.finalDriveRatio) > 0.005) {
      ratioStale++;
      if (examples.length < 20) {
        examples.push(
          `${s.id.slice(-6)} final_drive_ratio: stored ${storedRatio} vs computed ${computed.finalDriveRatio.toFixed(4)} (spur ${d["spur"]}, pinion ${d["pinion"]})`
        );
      }
    } else ratioOk++;
  }

  console.log("\nA800RR-looking snapshots:", a800);
  console.log("spring rate (2 sides each) — matches:", rateOk, "| STALE:", rateStale, "| key absent:", rateAbsent, "| cannot compute:", rateNoInputs);
  console.log("final drive               — matches:", ratioOk, "| STALE:", ratioStale, "| key absent:", ratioAbsent, "| cannot compute:", ratioNoInputs);
  console.log("\nexamples:");
  for (const e of examples) console.log("  " + e);
}

main().finally(() => prisma.$disconnect());
