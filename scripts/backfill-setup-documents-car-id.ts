/**
 * One-time: assign A800R/A800RR-class car to setup documents (and linked snapshots)
 * that are missing carId. Safe to re-run: skips rows that already have carId.
 *
 * Run: npx tsx scripts/backfill-setup-documents-car-id.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function pickA800TargetCar(
  cars: Array<{ id: string; name: string; setupSheetTemplate: string | null; createdAt: Date }>
): { id: string; reason: string } | null {
  const template = cars.filter((c) => c.setupSheetTemplate === "awesomatix_a800rr");
  if (template.length === 1) {
    return { id: template[0].id, reason: "only awesomatix_a800rr template car" };
  }
  if (template.length > 1) {
    template.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return { id: template[0].id, reason: "oldest among multiple awesomatix_a800rr cars" };
  }
  const nameMatch = cars.filter((c) => /A800/i.test(c.name));
  if (nameMatch.length === 1) {
    return { id: nameMatch[0].id, reason: "only car with A800 in name" };
  }
  if (nameMatch.length > 1) {
    nameMatch.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return { id: nameMatch[0].id, reason: "oldest among cars with A800 in name" };
  }
  return null;
}

async function ensureTargetCarForUser(userId: string): Promise<{ id: string; created: boolean; reason: string }> {
  const cars = await prisma.car.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, setupSheetTemplate: true, createdAt: true },
  });
  const picked = pickA800TargetCar(cars);
  if (picked) return { id: picked.id, created: false, reason: picked.reason };

  const created = await prisma.car.create({
    data: {
      userId,
      name: "A800RR",
      setupSheetTemplate: "awesomatix_a800rr",
    },
    select: { id: true },
  });
  return { id: created.id, created: true, reason: "created default A800RR car (no A800/template match)" };
}

async function main() {
  const usersWithMissing = await prisma.setupDocument.findMany({
    where: { carId: null },
    distinct: ["userId"],
    select: { userId: true },
  });

  console.log(`Users with at least one SetupDocument missing carId: ${usersWithMissing.length}`);

  for (const { userId } of usersWithMissing) {
    const target = await ensureTargetCarForUser(userId);
    console.log(`user=${userId} targetCar=${target.id} (${target.reason})${target.created ? " [NEW CAR]" : ""}`);

    const docUpdate = await prisma.setupDocument.updateMany({
      where: { userId, carId: null },
      data: { carId: target.id },
    });
    console.log(`  updated SetupDocument rows: ${docUpdate.count}`);

    const snapUpdate = await prisma.$executeRaw`
      UPDATE "SetupSnapshot" AS s
      SET "carId" = d."carId"
      FROM "SetupDocument" AS d
      WHERE d."createdSetupId" = s."id"
        AND s."carId" IS NULL
        AND d."carId" IS NOT NULL
        AND d."userId" = ${userId}
    `;
    console.log(`  updated SetupSnapshot rows (raw): ${snapUpdate}`);
  }

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
