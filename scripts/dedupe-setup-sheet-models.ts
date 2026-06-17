/**
 * One-time migration helper: collapse duplicate global SetupSheetModel rows that accumulated while
 * models were per-user (e.g. many "Mugen MTC3"). Picks the best keeper per chassis (authorized →
 * richest schema → most attached data → canonical slug → newest), repoints every Car / calibration /
 * setup document from the losers onto the keeper, then deletes the losers.
 *
 * SAFE BY DEFAULT: dry-run prints the plan and changes nothing.
 *   Dry-run: npx tsx scripts/dedupe-setup-sheet-models.ts
 *   Apply:   npx tsx scripts/dedupe-setup-sheet-models.ts --apply
 *
 * Run against a Neon branch first. After applying in every environment, add the global unique index
 * (see the printed SQL) and then the deferred Prisma migration can declare @@unique([slug]).
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { normalizeSetupSheetModelName } from "@/lib/setupSheetModels/normalizeModelName";
import {
  planSetupSheetModelDedupe,
  type DedupeModelRow,
} from "@/lib/setupSheetModels/dedupeElection";

const APPLY = process.argv.includes("--apply");

function fieldCountOf(schemaJson: unknown): number {
  if (schemaJson && typeof schemaJson === "object") {
    const fields = (schemaJson as { fields?: unknown }).fields;
    if (Array.isArray(fields)) return fields.length;
  }
  return 0;
}

async function loadRows(): Promise<DedupeModelRow[]> {
  const rows = await prisma.setupSheetModel.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      isAuthorized: true,
      schemaJson: true,
      updatedAt: true,
      _count: { select: { cars: true, calibrations: true, setupDocuments: true } },
    },
  });
  return rows.map((m) => ({
    id: m.id,
    name: m.name,
    slug: m.slug,
    isAuthorized: m.isAuthorized,
    fieldCount: fieldCountOf(m.schemaJson),
    carCount: m._count.cars,
    calibrationCount: m._count.calibrations,
    documentCount: m._count.setupDocuments,
    updatedAt: m.updatedAt.getTime(),
  }));
}

async function mergeLoserIntoWinner(loserId: string, winnerId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.car.updateMany({
      where: { setupSheetModelId: loserId },
      data: { setupSheetModelId: winnerId },
    });
    await tx.setupSheetCalibration.updateMany({
      where: { setupSheetModelId: loserId },
      data: { setupSheetModelId: winnerId },
    });
    await tx.setupDocument.updateMany({
      where: { setupSheetModelId: loserId },
      data: { setupSheetModelId: winnerId },
    });

    const [winner, loser] = await Promise.all([
      tx.setupSheetModel.findUnique({
        where: { id: winnerId },
        select: { defaultCalibrationId: true },
      }),
      tx.setupSheetModel.findUnique({
        where: { id: loserId },
        select: { defaultCalibrationId: true },
      }),
    ]);
    // Release the loser's unique defaultCalibrationId before deleting, and adopt it if the keeper
    // has none (the calibration itself was already repointed to the keeper above).
    if (loser?.defaultCalibrationId) {
      await tx.setupSheetModel.update({
        where: { id: loserId },
        data: { defaultCalibrationId: null },
      });
      if (winner && !winner.defaultCalibrationId) {
        await tx.setupSheetModel.update({
          where: { id: winnerId },
          data: { defaultCalibrationId: loser.defaultCalibrationId },
        });
      }
    }

    await tx.setupSheetModel.delete({ where: { id: loserId } });
  });
}

async function runPass(label: string, keyOf: (row: DedupeModelRow) => string): Promise<number> {
  const rows = await loadRows();
  const groups = planSetupSheetModelDedupe(rows, keyOf);
  if (groups.length === 0) {
    console.log(`[dedupe] ${label}: no duplicates.`);
    return 0;
  }
  let count = 0;
  for (const g of groups) {
    console.log(
      `[dedupe] ${label} "${g.key}" → keep "${g.winner.name}" (${g.winner.id}, authorized=${g.winner.isAuthorized}); merge ${g.losers.length}:`
    );
    for (const l of g.losers) {
      console.log(
        `           - "${l.name}" (${l.id}) cars=${l.carCount} cals=${l.calibrationCount} docs=${l.documentCount}`
      );
      if (APPLY) await mergeLoserIntoWinner(l.id, g.winner.id);
      count++;
    }
  }
  return count;
}

async function main(): Promise<void> {
  console.log(`[dedupe] mode=${APPLY ? "APPLY" : "DRY-RUN"} (pass --apply to write changes)`);
  const byName = await runPass("by-name", (r) => normalizeSetupSheetModelName(r.name));
  const bySlug = await runPass("by-slug", (r) => r.slug.trim().toLowerCase());
  console.log(`[dedupe] ${APPLY ? "merged" : "would merge"} ${byName + bySlug} duplicate row(s).`);
  if (APPLY) {
    console.log("[dedupe] Done. Once every environment is deduped, add the global unique index:");
    console.log('         CREATE UNIQUE INDEX "SetupSheetModel_slug_key" ON "SetupSheetModel"("slug");');
    console.log("         then declare @@unique([slug]) in prisma/schema.prisma.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
