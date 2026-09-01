/** Dump the rows align/migrate will touch, verbatim, to a timestamped JSON file. */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const label = process.argv[2] ?? "backup";
  const model = await prisma.setupSheetModel.findFirstOrThrow({
    where: { slug: "awesomatix_a800rr" },
    select: { id: true, schemaJson: true },
  });
  const blanks = await prisma.setupSheetBlank.findMany({
    where: { setupSheetModelId: model.id, isEdition: true },
    select: { id: true, boxesJson: true, derivedMappingsJson: true, schemaFieldsJson: true, setupDocumentId: true },
  });
  const calibrations = await prisma.setupSheetCalibration.findMany({
    where: { setupSheetModelId: model.id },
    select: { id: true, name: true, calibrationDataJson: true },
  });
  const snapshots = await prisma.$queryRawUnsafe<Array<{ id: string; data: unknown }>>(
    `SELECT id, data FROM "SetupSnapshot" WHERE data ? 'front_shock_oil' OR data ? 'ff_inner_top_link_spacer' OR data ? 'front_upper_hub_spacer'`
  );
  const out = path.resolve("scripts", `a800rr-edition-backup-${label}.json`);
  await writeFile(out, JSON.stringify({ takenAt: new Date().toISOString(), model, blanks, calibrations, snapshots }, null, 2));
  console.log(`backed up model schema, ${blanks.length} edition blanks, ${calibrations.length} calibrations, ${snapshots.length} snapshots → ${out}`);
}

main().finally(() => prisma.$disconnect());
