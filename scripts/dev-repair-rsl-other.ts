/** Re-seat a C01B-RSL that fell into the chassis "Other" box back onto its tick. [--apply] */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; other: string; preset: string }>>(
    `SELECT id, data->'chassis'->>'otherText' AS other, data->'chassis'->>'selectedPreset' AS preset
     FROM "SetupSnapshot"
     WHERE lower(replace(data->'chassis'->>'otherText', '_', '-')) LIKE '%rsl%'`
  );
  console.log(`snapshots with RSL text in chassis Other: ${rows.length}`);
  for (const r of rows) {
    // Only the demoted TICK (the schema's minted token, exactly). "C01RSL" typed as free text
    // months before the option existed is the driver's own words — history stays.
    const isMintedToken = r.other.trim().toLowerCase().replace(/-/g, "_") === "c01b_rsl";
    console.log(
      `  ${r.id}: preset=${JSON.stringify(r.preset)} other=${JSON.stringify(r.other)}${isMintedToken ? "" : " — typed text, left alone"}`
    );
    if (!APPLY || !isMintedToken) continue;
    const snap = await prisma.setupSnapshot.findUniqueOrThrow({
      where: { id: r.id },
      select: { data: true },
    });
    const data = snap.data as Record<string, unknown>;
    data.chassis = { selectedPreset: "C01B-RSL", otherText: "" };
    await prisma.setupSnapshot.update({ where: { id: r.id }, data: { data: data as object } });
    console.log(`    repaired → { selectedPreset: "C01B-RSL", otherText: "" }`);
  }
  if (!APPLY) console.log("DRY RUN — re-run with --apply to write.");
}

main().finally(() => prisma.$disconnect());
